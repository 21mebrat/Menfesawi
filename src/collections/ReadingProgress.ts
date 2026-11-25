import { APIError, type CollectionConfig } from 'payload'
import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import { progressEndpoints } from '../lib/server/reading-progress/endpoints'

export async function ensureReadingProgressIndexes(adapter: MongooseAdapter) {
  await adapter.collections['reading-progress'].collection.createIndexes([
    { key: { user: 1, publication: 1 }, unique: true, name: 'reading_progress_owner_publication' },
    { key: { user: 1, updatedAt: -1, _id: -1 }, name: 'reading_progress_newest' },
  ])
}
export const ReadingProgress: CollectionConfig = {
  slug: 'reading-progress',
  labels: {
    singular: { en: 'Reading Progress', am: 'የንባብ ሂደት' },
    plural: { en: 'Reading Progress', am: 'የንባብ ሂደት' },
  },
  admin: {
    hidden: true,
    description: {
      en: 'Private resume positions in structured publications.',
      am: 'በሕትመቶች ውስጥ ንባብን ለመቀጠል የሚቀመጡ የግል ቦታዎች።',
    },
  },
  graphQL: false,
  lockDocuments: false,
  disableDuplicate: true,
  timestamps: true,
  endpoints: progressEndpoints,
  access: {
    admin: () => false,
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeOperation: [
      () => {
        throw new APIError('Use the authenticated reading progress operations.', 403)
      },
    ],
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      label: { en: 'Account', am: 'መለያ' },
    },
    {
      name: 'publication',
      type: 'relationship',
      relationTo: 'publications',
      required: true,
      label: { en: 'Publication', am: 'ሕትመት' },
    },
    {
      name: 'section',
      type: 'relationship',
      relationTo: 'publication-sections',
      required: true,
      label: { en: 'Section', am: 'ክፍል' },
    },
    {
      name: 'passage',
      type: 'relationship',
      relationTo: 'passages',
      label: { en: 'Passage', am: 'ምንባብ' },
    },
    {
      name: 'revision',
      type: 'number',
      required: true,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      label: { en: 'Revision', am: 'የማሻሻያ ቁጥር' },
      validate: (value: unknown) =>
        (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
        'Expected a nonnegative safe integer.',
    },
  ],
}
