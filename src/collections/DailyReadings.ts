import type {
  CollectionBeforeValidateHook,
  CollectionConfig,
  FilterOptions,
  PayloadRequest,
} from 'payload'
import { ValidationError } from 'payload'

import { canAccessAdmin, isAdmin, isStaff } from '../access'
import { isEthiopianLeapYear } from '../lib/ethiopianDate'
import { passageSort } from '../lib/server/reading/navigation'
import type { DailyReading } from '../payload-types'
import {
  calendarOrder,
  calendarSlug,
  ethiopianDay,
  ethiopianMonth,
  validateMonthAndDay,
} from './fields/calendarEntry'

function invalid(req: PayloadRequest, path: string, en: string, am: string): never {
  throw new ValidationError({ errors: [{ path, message: req.i18n.language === 'am' ? am : en }] })
}

const validateYear: CollectionBeforeValidateHook<DailyReading> = ({ data, originalDoc, req }) => {
  if (!data) return
  const entry = { ...originalDoc, ...data }
  if (entry.dateMode === 'recurring') {
    data.ethiopianYear = null
    return data
  }
  if (entry.dateMode !== 'specific-year') {
    invalid(
      req,
      'dateMode',
      'Choose a recurring date or a specific year.',
      'ተደጋጋሚ ቀን ወይም የተወሰነ ዓመት ይምረጡ።',
    )
  }
  const year = entry.ethiopianYear
  if (typeof year !== 'number' || !Number.isSafeInteger(year) || year < 1) {
    invalid(
      req,
      'ethiopianYear',
      'Enter a positive, safe whole Ethiopian year.',
      'ከዜሮ በላይ የሆነ ሙሉ የኢትዮጵያ ዓመት ያስገቡ።',
    )
  }
  if (entry.ethiopianMonth === '13' && entry.ethiopianDay === 6 && !isEthiopianLeapYear(year)) {
    invalid(
      req,
      'ethiopianDay',
      'Pagumen 6 occurs only in an Ethiopian leap year.',
      'ጳጉሜን ፮ የሚውለው በዘመነ ሉቃስ ብቻ ነው።',
    )
  }
}

function relationshipId(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string')
    return value.id
}

const passagesInSection: FilterOptions = ({ siblingData }) => {
  if (!siblingData || typeof siblingData !== 'object' || !('section' in siblingData)) return false
  const section = relationshipId(siblingData.section)
  return section ? { section: { equals: section } } : false
}

const validateReferences: CollectionBeforeValidateHook<DailyReading> = async ({
  data,
  originalDoc,
  req,
}) => {
  const entry = { ...originalDoc, ...data }
  const readings = entry.readings ?? []
  if (!Array.isArray(readings) || (entry._status === 'published' && !readings.length)) {
    invalid(req, 'readings', 'Add at least one reading to publish.', 'ለማተም ቢያንስ አንድ ምንባብ ያስገቡ።')
  }

  // Check the effective rows against current records on the write request, including on status-only publication.
  const rows = readings.map((row, i) => {
    const path = `readings.${i}`
    const section = relationshipId(row?.section)
    if (!section)
      invalid(req, path + '.section', 'Select a publication section.', 'የህትመት ክፍል ይምረጡ።')
    const start = relationshipId(row.startPassage)
    const end = relationshipId(row.endPassage)
    if (row.startPassage != null && !start)
      invalid(req, path + '.startPassage', 'Select an existing passage.', 'ያለውን ምንባብ ይምረጡ።')
    if (row.endPassage != null && !end)
      invalid(req, path + '.endPassage', 'Select an existing passage.', 'ያለውን ምንባብ ይምረጡ።')
    if (end && !start)
      invalid(req, path + '.startPassage', 'Select the start of this range.', 'የምንባቡን መጀመሪያ ይምረጡ።')
    return { section, start, end, path }
  })
  // These checks read only identity and membership. Editors may reference draft-only records.
  const options = { depth: 0, pagination: false, req, draft: false, overrideAccess: true } as const
  const sections = [...new Set(rows.map((row) => row.section))]
  if (sections.length) {
    const { docs } = await req.payload.find({
      ...options,
      collection: 'publication-sections',
      where: { id: { in: sections } },
      limit: sections.length,
      select: { _status: true },
    })
    const existing = new Set(docs.map((doc) => doc.id))
    for (const row of rows) {
      if (!existing.has(row.section))
        invalid(
          req,
          row.path + '.section',
          'Select an existing publication section.',
          'ያለውን የህትመት ክፍል ይምረጡ።',
        )
    }
  }

  const endpoints = [
    ...new Set(rows.flatMap(({ start, end }) => [start, end]).filter((id): id is string => !!id)),
  ]
  if (endpoints.length) {
    const { docs } = await req.payload.find({
      ...options,
      collection: 'passages',
      where: { id: { in: endpoints } },
      limit: endpoints.length,
      select: { section: true },
      sort: passageSort,
    })
    const positions = new Map(
      docs.map((doc, index) => [doc.id, { section: relationshipId(doc.section), index }]),
    )
    for (const row of rows) {
      const start = row.start && positions.get(row.start)
      const end = row.end && positions.get(row.end)
      for (const [field, id, position] of [
        ['startPassage', row.start, start],
        ['endPassage', row.end, end],
      ] as const) {
        if (id && (!position || position.section !== row.section)) {
          invalid(
            req,
            row.path + '.' + field,
            'Select an existing passage directly in this section.',
            'በዚህ ክፍል ሥር ያለውን ምንባብ ይምረጡ።',
          )
        }
      }
      if (start && end && start.index > end.index) {
        invalid(
          req,
          row.path + '.endPassage',
          'The end passage precedes the start in reading order.',
          'የመጨረሻው ምንባብ ከመጀመሪያው ምንባብ ቀድሟል።',
        )
      }
    }
  }

  const commemorations = entry.commemorations ?? []
  if (!Array.isArray(commemorations))
    invalid(req, 'commemorations', 'Select a list of commemorations.', 'የመታሰቢያዎችን ዝርዝር ይምረጡ።')
  if (commemorations.length) {
    const ids = [...new Set(commemorations.map(relationshipId))]
    const { docs } = await req.payload.find({
      ...options,
      collection: 'synaxarium',
      where: { id: { in: ids } },
      limit: ids.length,
      select: { _status: true },
    })
    if (docs.length !== ids.length)
      invalid(
        req,
        'commemorations',
        'Select existing Synaxarium entries.',
        'ያሉትን የስንክሳር መዛግብት ይምረጡ።',
      )
  }
}

export const DailyReadings: CollectionConfig<'daily-readings'> = {
  slug: 'daily-readings',
  labels: {
    singular: { en: 'Daily Reading', am: 'የዕለቱ ምንባብ' },
    plural: { en: 'Daily Readings', am: 'የዕለቱ ምንባባት' },
  },
  typescript: { interface: 'DailyReading' },
  graphQL: { singularName: 'DailyReading', pluralName: 'DailyReadings' },
  admin: {
    group: { en: 'Content', am: 'ይዘት' },
    useAsTitle: 'title',
    listSearchableFields: ['title', 'slug'],
    defaultColumns: [
      'title',
      'dateMode',
      'ethiopianYear',
      'ethiopianMonth',
      'ethiopianDay',
      '_status',
      'order',
    ],
    description: {
      en: 'For an Ethiopian date, include all recurring sets for the month and day and all sets for that exact year, month and day. Sort the combined results by order, then ID, both ascending.',
      am: 'ለአንድ የኢትዮጵያ ቀን፣ በወሩና በቀኑ በየዓመቱ የሚደጋገሙትን እና ለዚያው ዓመት፣ ወርና ቀን የተመደቡትን ሁሉ ያካትቱ። ውጤቱን በቅደም ተከተል፣ ከዚያም በመለያ ከትንሹ ወደ ትልቁ ያስቀምጡ።',
    },
  },
  access: {
    admin: canAccessAdmin,
    read: ({ req }) => isStaff(req.user) || { _status: { equals: 'published' } },
    readVersions: ({ req }) => isStaff(req.user),
    create: ({ req }) => isStaff(req.user),
    update: ({ req }) => isStaff(req.user),
    delete: ({ req }) => isAdmin(req.user),
  },
  versions: { drafts: { validate: true }, maxPerDoc: 30 },
  timestamps: true,
  indexes: [{ fields: ['dateMode', 'ethiopianYear', 'ethiopianMonth', 'ethiopianDay', 'order'] }],
  hooks: {
    beforeOperation: [
      ({ args, operation, req }) => {
        if (operation === 'read' && !isStaff(req.user)) args.draft = false
      },
    ],
    beforeValidate: [validateMonthAndDay, validateYear, validateReferences],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      localized: true,
      required: true,
      maxLength: 250,
      label: { en: 'Title', am: 'ርዕስ' },
    },
    calendarSlug(),
    {
      name: 'introduction',
      type: 'textarea',
      localized: true,
      label: { en: 'Introduction', am: 'መግቢያ' },
    },
    {
      name: 'dateMode',
      type: 'select',
      required: true,
      label: { en: 'Date assignment', am: 'የቀን ምደባ' },
      options: [
        { value: 'recurring', label: { en: 'Every year', am: 'በየዓመቱ' } },
        { value: 'specific-year', label: { en: 'Specific year', am: 'ለተወሰነ ዓመት' } },
      ],
    },
    {
      name: 'ethiopianYear',
      type: 'number',
      min: 1,
      admin: { step: 1, condition: (_, sibling) => sibling.dateMode === 'specific-year' },
      label: { en: 'Ethiopian year', am: 'የኢትዮጵያ ዓመት' },
    },
    ethiopianMonth(),
    ethiopianDay(),
    {
      name: 'readings',
      type: 'array',
      label: { en: 'Readings', am: 'ምንባባት' },
      labels: { singular: { en: 'Reading', am: 'ምንባብ' }, plural: { en: 'Readings', am: 'ምንባባት' } },
      admin: {
        description: {
          en: 'Leave both passages empty for the whole section. Select only a start for one passage, or both endpoints for an inclusive range.',
          am: 'መላውን ክፍል ለማንበብ ሁለቱንም ባዶ ይተዉ። ለአንድ ምንባብ መጀመሪያውን ብቻ፣ ለተከታታይ ምንባባት ሁለቱንም ጫፎች ይምረጡ።',
        },
      },
      fields: [
        {
          name: 'label',
          type: 'text',
          required: true,
          localized: true,
          label: { en: 'Reading label', am: 'የምንባብ ስያሜ' },
        },
        {
          name: 'section',
          type: 'relationship',
          relationTo: 'publication-sections',
          required: true,
          label: { en: 'Publication section', am: 'የህትመት ክፍል' },
        },
        {
          name: 'startPassage',
          type: 'relationship',
          relationTo: 'passages',
          filterOptions: passagesInSection,
          label: { en: 'Start passage', am: 'የመጀመሪያ ምንባብ' },
        },
        {
          name: 'endPassage',
          type: 'relationship',
          relationTo: 'passages',
          filterOptions: passagesInSection,
          label: { en: 'End passage', am: 'የመጨረሻ ምንባብ' },
        },
      ],
    },
    {
      name: 'commemorations',
      type: 'relationship',
      relationTo: 'synaxarium',
      hasMany: true,
      label: { en: 'Commemorations', am: 'መታሰቢያዎች' },
    },
    calendarOrder(),
  ],
}
