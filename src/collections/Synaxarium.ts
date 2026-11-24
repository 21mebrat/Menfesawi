import type {
  CollectionBeforeValidateHook,
  CollectionConfig,
  TextFieldSingleValidation,
  NumberFieldSingleValidation,
} from 'payload'
import { ValidationError } from 'payload'

import { canAccessAdmin, isAdmin, isStaff } from '../access'
import type { SynaxariumEntry } from '../payload-types'

const monthOptions = [
  ['Meskerem', 'መስከረም'],
  ['Tikimt', 'ጥቅምት'],
  ['Hidar', 'ኅዳር'],
  ['Tahsas', 'ታኅሣሥ'],
  ['Tir', 'ጥር'],
  ['Yekatit', 'የካቲት'],
  ['Megabit', 'መጋቢት'],
  ['Miyazya', 'ሚያዝያ'],
  ['Ginbot', 'ግንቦት'],
  ['Sene', 'ሰኔ'],
  ['Hamle', 'ሐምሌ'],
  ['Nehase', 'ነሐሴ'],
  ['Pagumen', 'ጳጉሜን'],
].map(([en, am], index) => ({ label: { en, am }, value: String(index + 1) }))

const validateRecurringDate: CollectionBeforeValidateHook<SynaxariumEntry> = ({
  data,
  originalDoc,
  req,
}) => {
  if (!data) return
  const month =
    data.ethiopianMonth === undefined ? originalDoc?.ethiopianMonth : data.ethiopianMonth
  const day = data.ethiopianDay === undefined ? originalDoc?.ethiopianDay : data.ethiopianDay
  if (!monthOptions.some((option) => option.value === month)) {
    throw new ValidationError({
      errors: [
        {
          path: 'ethiopianMonth',
          message:
            req.i18n.language === 'am'
              ? 'ከአሥራ ሦስቱ ወራት አንዱን ይምረጡ።'
              : 'Select one of the thirteen Ethiopian months.',
        },
      ],
    })
  }
  const lastDay = month === '13' ? 6 : 30

  if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > lastDay) {
    throw new ValidationError({
      errors: [
        {
          path: 'ethiopianDay',
          message:
            req.i18n.language === 'am'
              ? `ለዚህ ወር ከ1 እስከ ${lastDay} ያለ ሙሉ ቁጥር ያስገቡ።`
              : `Enter a whole day from 1 through ${lastDay} for this month.`,
        },
      ],
    })
  }
}

const validateReadings: CollectionBeforeValidateHook<SynaxariumEntry> = async ({
  data,
  originalDoc,
  req,
}) => {
  const rows = data?.readings === undefined ? originalDoc?.readings : data.readings
  if (!Array.isArray(rows) || !rows.length) return

  const ids = rows.map((row) => (typeof row?.section === 'string' ? row.section : row?.section?.id))
  const distinct = [...new Set(ids.filter((id): id is string => typeof id === 'string'))]
  if (!distinct.length) return // Payload validates the required relationship on each row.
  // A single lookup keeps all rows on the request's transaction without concurrent queries.
  const { docs } = await req.payload.find({
    collection: 'publication-sections',
    where: { id: { in: distinct } },
    limit: distinct.length,
    pagination: false,
    depth: 0,
    select: { _status: true },
    overrideAccess: false,
    req,
  })
  const existing = new Set(docs.map(({ id }) => id))
  const index = ids.findIndex((id) => !id || !existing.has(id))
  if (index !== -1) {
    throw new ValidationError({
      errors: [
        {
          path: `readings.${index}.section`,
          message:
            req.i18n.language === 'am'
              ? 'ያለውን የህትመት ክፍል ይምረጡ።'
              : 'Select an existing publication section.',
        },
      ],
    })
  }
}

const validateSlug: TextFieldSingleValidation = (value, { req }) =>
  (typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) ||
  (req.i18n.language === 'am'
    ? 'ትንንሽ የእንግሊዝኛ ፊደላትን፣ ቁጥሮችን እና ነጠላ ሰረዞችን ይጠቀሙ።'
    : 'Use lowercase English letters, numbers, and single hyphens.')

const validateOrder: NumberFieldSingleValidation = (value, { req }) =>
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
  (req.i18n.language === 'am'
    ? 'ዜሮ ወይም ከዜሮ በላይ የሆነ ሙሉ ቁጥር ያስገቡ።'
    : 'Enter a nonnegative whole number.')

export const Synaxarium: CollectionConfig<'synaxarium'> = {
  slug: 'synaxarium',
  labels: {
    singular: { en: 'Synaxarium Entry', am: 'የስንክሳር መዝገብ' },
    plural: { en: 'Synaxarium', am: 'ስንክሳር' },
  },
  typescript: { interface: 'SynaxariumEntry' },
  graphQL: { singularName: 'SynaxariumEntry', pluralName: 'Synaxarium' },
  admin: {
    group: { en: 'Content', am: 'ይዘት' },
    useAsTitle: 'title',
    defaultColumns: ['title', 'ethiopianMonth', 'ethiopianDay', '_status', 'order'],
    listSearchableFields: ['title', 'slug'],
    description: {
      en: 'Lives of saints and commemorations by Ethiopian calendar date.',
      am: 'የቅዱሳን ታሪኮችና መታሰቢያዎች በኢትዮጵያ ዘመን አቆጣጠር።',
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
  indexes: [{ fields: ['ethiopianMonth', 'ethiopianDay', 'order'] }],
  hooks: {
    beforeOperation: [
      ({ args, operation, req }) => {
        if (operation === 'read' && !isStaff(req.user)) args.draft = false
      },
    ],
    beforeValidate: [validateRecurringDate, validateReadings],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      localized: true,
      maxLength: 250,
      label: { en: 'Title', am: 'ርዕስ' },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      maxLength: 150,
      label: { en: 'Slug', am: 'የአገናኝ መለያ' },
      admin: {
        description: {
          en: 'A stable identifier shared across languages. Use lowercase English letters, numbers, and single hyphens.',
          am: 'በሁሉም ቋንቋዎች የሚያገለግል ቋሚ መለያ። ትንንሽ የእንግሊዝኛ ፊደላትን፣ ቁጥሮችን እና ነጠላ ሰረዞችን ይጠቀሙ።',
        },
      },
      validate: validateSlug,
    },
    {
      name: 'summary',
      type: 'textarea',
      localized: true,
      maxLength: 5000,
      label: { en: 'Summary', am: 'ማጠቃለያ' },
    },
    {
      name: 'ethiopianMonth',
      type: 'select',
      required: true,
      options: monthOptions,
      label: { en: 'Ethiopian month', am: 'የኢትዮጵያ ወር' },
    },
    {
      name: 'ethiopianDay',
      type: 'number',
      required: true,
      min: 1,
      max: 30,
      label: { en: 'Ethiopian day', am: 'የወሩ ቀን' },
      admin: {
        step: 1,
        description: {
          en: 'Pagumen 6 occurs only in Ethiopian leap years. When resolving this date for a specific year, check that the year is a leap year.',
          am: 'ጳጉሜን ፮ የሚውለው በዘመነ ሉቃስ ብቻ ነው። ቀኑን ለተወሰነ ዓመት ሲያሰሉ ዓመቱ ዘመነ ሉቃስ መሆኑን ያረጋግጡ።',
        },
      },
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: { en: 'Image', am: 'ምስል' },
      filterOptions: { purpose: { equals: 'content' } },
    },
    {
      name: 'readings',
      type: 'array',
      label: { en: 'Readings', am: 'ምንባባት' },
      labels: { singular: { en: 'Reading', am: 'ምንባብ' }, plural: { en: 'Readings', am: 'ምንባባት' } },
      fields: [
        {
          name: 'label',
          type: 'text',
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
      ],
    },
    {
      name: 'order',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
      label: { en: 'Order within the day', am: 'የዕለቱ ቅደም ተከተል' },
      admin: { step: 1 },
      validate: validateOrder,
    },
  ],
}
