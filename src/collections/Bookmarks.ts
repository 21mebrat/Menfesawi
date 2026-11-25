import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'
import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import { bookmarkEndpoints } from '../lib/server/bookmarks/endpoints'
import { targetTypes } from '../lib/server/bookmarks/targets'

// Payload's compound-index configuration only accepts schema fields. The discriminator,
// BSON relationship value and descending _id are native MongoDB index paths.
export async function ensureBookmarkIndexes(adapter: MongooseAdapter) {
  await adapter.collections.bookmarks.collection.createIndexes([
    {
      key: { user: 1, 'target.relationTo': 1, 'target.value': 1 },
      unique: true,
      name: 'bookmark_identity',
    },
    { key: { user: 1, createdAt: -1, _id: -1 }, name: 'bookmark_newest' },
  ])
}

export const Bookmarks: CollectionConfig = {
  slug: 'bookmarks',
  labels: { singular: { en: 'Bookmark', am: 'እልባት' }, plural: { en: 'Bookmarks', am: 'እልባቶች' } },
  timestamps: true,
  admin: {
    hidden: true,
    description: { en: 'Private bookmarks for each account.', am: 'ለእያንዳንዱ መለያ የግል እልባቶች።' },
  },
  lockDocuments: false,
  graphQL: false,
  disableDuplicate: true,
  endpoints: bookmarkEndpoints,
  // All external access uses the owner-scoped DTO. In particular the raw polymorphic
  // field must never be populated with the privileges of a staff caller.
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
        throw new APIError('Use the authenticated bookmark operations.', 403)
      },
    ],
  },
  fields: [
    {
      name: 'user',
      label: { en: 'Account', am: 'መለያ' },
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'target',
      label: { en: 'Saved content', am: 'የተቀመጠ ይዘት' },
      type: 'relationship',
      relationTo: [...targetTypes],
      required: true,
    },
    {
      name: 'note',
      type: 'textarea',
      label: { en: 'Private note', am: 'የግል ማስታወሻ' },
      maxLength: 2000,
    },
  ],
}
