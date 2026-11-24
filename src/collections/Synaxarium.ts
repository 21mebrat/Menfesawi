import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { ValidationError } from 'payload'

import { canAccessAdmin, isAdmin, isStaff } from '../access'
import type { SynaxariumEntry } from '../payload-types'

import {
  calendarOrder,
  calendarSlug,
  ethiopianDay,
  ethiopianMonth,
  validateMonthAndDay,
} from './fields/calendarEntry'

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
    beforeValidate: [validateMonthAndDay, validateReadings],
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
    calendarSlug(),
    {
      name: 'summary',
      type: 'textarea',
      localized: true,
      maxLength: 5000,
      label: { en: 'Summary', am: 'ማጠቃለያ' },
    },
    ethiopianMonth(),
    ethiopianDay(),
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
    calendarOrder(),
  ],
}
