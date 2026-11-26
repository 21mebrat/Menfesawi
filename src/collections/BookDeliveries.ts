import { statusOptions } from '../i18n/collectionLabels'
import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access'

export const BookDeliveries: CollectionConfig = {
  slug: 'book-deliveries',
  labels: {
    singular: { en: 'Book Delivery', am: 'የመጽሐፍ ርክክብ' },
    plural: { en: 'Book Deliveries', am: 'የመጻሕፍት ርክክቦች' },
  },
  admin: {
    group: { en: 'Library', am: 'ቤተ መጻሕፍት' },
    defaultColumns: ['book', 'state', 'createdAt'],
  },
  access: {
    admin: ({ req }) => isAdmin(req.user),
    read: ({ req }) => isAdmin(req.user),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  indexes: [{ fields: ['book', 'state', 'user'] }],
  fields: [
    {
      name: 'book',
      label: { en: 'Book', am: 'መጽሐፍ' },
      type: 'relationship',
      relationTo: 'books',
      required: true,
    },
    {
      name: 'file',
      label: { en: 'PDF file', am: 'ፒዲኤፍ ፋይል' },
      type: 'relationship',
      relationTo: 'files',
      required: true,
    },
    {
      name: 'user',
      label: { en: 'Account', am: 'መለያ' },
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'bookRevision',
      label: { en: 'Book revision', am: 'የመጽሐፉ ማሻሻያ' },
      type: 'date',
      required: true,
    },
    { name: 'ticketHash', type: 'text', unique: true, required: true, hidden: true },
    { name: 'telegramUser', type: 'text', required: true, hidden: true },
    {
      name: 'expiresAt',
      label: { en: 'Ticket expiry', am: 'የፈቃድ ማብቂያ' },
      type: 'date',
      required: true,
    },
    {
      name: 'state',
      label: { en: 'Delivery status', am: 'የርክክብ ሁኔታ' },
      type: 'select',
      options: statusOptions('pending', 'sent', 'failed', 'uncertain'),
      required: true,
    },
    {
      name: 'messageId',
      label: { en: 'Delivery message ID', am: 'የመልእክት መለያ' },
      type: 'number',
      admin: { readOnly: true },
    },
    {
      name: 'failure',
      label: { en: 'Failure reason', am: 'የችግሩ ምክንያት' },
      type: 'text',
      admin: { readOnly: true },
    },
  ],
  timestamps: true,
}
