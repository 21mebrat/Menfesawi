import { Types } from 'mongoose'
import type { Payload } from 'payload'
import { fail, session, transaction } from './coordination'

export async function publicBookStatistics(payload: Payload, id: string) {
  return transaction(payload, async (req) => {
    const { docs } = await payload.find({
      collection: 'books',
      req,
      draft: false,
      overrideAccess: false,
      depth: 0,
      limit: 1,
      pagination: false,
      where: { id: { equals: id }, _status: { equals: 'published' } },
      select: { slug: true },
    })
    if (!docs.length) return fail('Book unavailable.', 404)
    const book = new Types.ObjectId(id),
      s = await session(req)
    const scores = await payload.db.collections['book-ratings']
      .aggregate<{ _id: number; n: number; approved: number }>([
        { $match: { book } },
        {
          $group: {
            _id: '$score',
            n: { $sum: 1 },
            approved: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$reviewStatus', 'published'] },
                      { $gt: [{ $strLenCP: { $ifNull: ['$review', ''] } }, 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .session(s)
    const deliveries = await payload.db.collections['book-deliveries']
      .aggregate<{ successfulDeliveryCount: number; uniqueRecipientCount: number }>([
        { $match: { book, state: 'sent' } },
        { $group: { _id: '$user', n: { $sum: 1 } } },
        {
          $group: {
            _id: null,
            successfulDeliveryCount: { $sum: '$n' },
            uniqueRecipientCount: { $sum: 1 },
          },
        },
      ])
      .session(s)
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    let ratingCount = 0,
      total = 0,
      approvedReviewCount = 0
    for (const row of scores) {
      distribution[row._id] = row.n
      ratingCount += row.n
      total += row._id * row.n
      approvedReviewCount += row.approved
    }
    return {
      averageRating: ratingCount ? total / ratingCount : null,
      ratingCount,
      distribution,
      approvedReviewCount,
      successfulDeliveryCount: deliveries[0]?.successfulDeliveryCount ?? 0,
      uniqueRecipientCount: deliveries[0]?.uniqueRecipientCount ?? 0,
    }
  })
}
export async function publicBookReviews(payload: Payload, book: string, page = 1) {
  if (!Number.isSafeInteger(page) || page < 1) return fail('Invalid page.')
  return transaction(payload, async (req) => {
    const live = await payload.find({
      collection: 'books',
      req,
      overrideAccess: false,
      draft: false,
      where: { id: { equals: book }, _status: { equals: 'published' } },
      select: { slug: true },
      depth: 0,
      limit: 1,
      pagination: false,
    })
    if (!live.docs.length) return fail('Book unavailable.', 404)
    const rows = await payload.db.collections['book-ratings']
      .find(
        { book, reviewStatus: 'published', review: { $type: 'string', $ne: '' } },
        { score: 1, review: 1 },
      )
      .sort({ _id: 1 })
      .skip((page - 1) * 25)
      .limit(26)
      .session(await session(req))
      .lean<{ score: number; review: string }[]>()
    return {
      reviews: rows.slice(0, 25).map(({ score, review }) => ({ score, review })),
      hasNextPage: rows.length > 25,
    }
  })
}
