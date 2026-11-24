import { createHash } from 'node:crypto'
import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import type { BookRating } from '../payload-types'
import { fail, session } from '../lib/server/library/coordination'
import { isAdmin } from '../access'

const immutable = { update: () => false }
export const REVIEW_LIMIT = 1500
function reviewHash(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

const checkApproval: CollectionBeforeChangeHook<BookRating> = async ({
  data,
  originalDoc,
  req,
}) => {
  if (data.reviewStatus !== 'published') return

  const conflict = () =>
    fail(
      req.i18n.language === 'am'
        ? 'ገጹን ዳግም ይጫኑ፣ የአሁኑን አስተያየት ያንብቡና እንደገና ያጽድቁ።'
        : 'Reload the review, read the current text, and approve it again.',
      409,
    )
  if (!originalDoc?.id || !data.review) return conflict()
  const suppliedHash = data.reviewHash
  if (suppliedHash != null && suppliedHash !== reviewHash(data.review)) return conflict()

  // Lock the exact text through the Payload write. A score-only patch may retain
  // an existing approval, but a transition into published always needs proof.
  const locked = await req.payload.db.collections['book-ratings'].updateOne(
    {
      _id: originalDoc.id,
      review: data.review,
      ...(suppliedHash == null ? { reviewStatus: 'published' } : {}),
    },
    { $inc: { __v: 1 } },
    { timestamps: false, session: await session(req) },
  )
  if (!locked.matchedCount) return conflict()
}

export const BookRatings: CollectionConfig = {
  slug: 'book-ratings',
  labels: {
    singular: { en: 'Book Rating', am: 'የመጽሐፍ ደረጃ' },
    plural: { en: 'Book Ratings', am: 'የመጻሕፍት ደረጃዎች' },
  },
  admin: {
    group: { en: 'Library', am: 'ቤተ መጻሕፍት' },
    defaultColumns: ['book', 'score', 'reviewStatus', 'updatedAt'],
  },
  access: {
    admin: ({ req }) => isAdmin(req.user),
    read: ({ req }) => isAdmin(req.user),
    create: () => false,
    update: ({ req }) => isAdmin(req.user),
    delete: ({ req }) => isAdmin(req.user),
  },
  hooks: { beforeChange: [checkApproval] },
  indexes: [{ fields: ['book', 'user'], unique: true }],
  fields: [
    {
      name: 'book',
      label: { en: 'Book', am: 'መጽሐፍ' },
      type: 'relationship',
      relationTo: 'books',
      required: true,
      access: immutable,
    },
    {
      name: 'user',
      label: { en: 'Account', am: 'መለያ' },
      type: 'relationship',
      relationTo: 'users',
      required: true,
      access: immutable,
    },
    {
      name: 'score',
      label: { en: 'Score', am: 'ነጥብ' },
      type: 'number',
      min: 1,
      max: 5,
      required: true,
      validate: (v: unknown) =>
        (Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 5) ||
        'Select an integer from 1 to 5.',
      access: immutable,
    },
    {
      name: 'review',
      label: { en: 'Written review', am: 'የተጻፈ አስተያየት' },
      type: 'textarea',
      maxLength: REVIEW_LIMIT,
      access: immutable,
    },
    {
      name: 'reviewHash',
      type: 'text',
      virtual: true,
      label: { en: 'Reviewed text', am: 'የተገመገመ አስተያየት' },
      admin: {
        readOnly: true,
        disableBulkEdit: true,
        components: { Field: '/components/ReloadBookReview#ReloadBookReview' },
      },
      hooks: {
        afterRead: [
          ({ siblingData }) => (siblingData.review ? reviewHash(siblingData.review) : null),
        ],
        // Payload normally fills missing PATCH fields from the latest document.
        // A precondition must come from the caller who inspected the text.
        beforeValidate: [({ siblingData }) => siblingData.reviewHash ?? null],
      },
    },
    {
      name: 'reviewStatus',
      label: { en: 'Moderation status', am: 'የግምገማ ሁኔታ' },
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: ['pending', 'published', 'hidden'],
    },
  ],
  timestamps: true,
}
