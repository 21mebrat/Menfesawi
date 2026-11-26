import 'server-only'

import type { PayloadRequest } from 'payload'
import type { AdminItem } from './navigation'

const dayMs = 86_400_000
const collections = ['books', 'teachings', 'media', 'users', 'files'] as const
type Source = (typeof collections)[number]
type Status = 'published' | 'draft' | 'uploaded' | 'ready' | 'pending' | 'failed' | 'unavailable'
type RecentRow = { href: string; title: string; slug: Source; status: Status; updatedAt: string }

// Small collections need a single projected page. For larger collections keep
// the 28 scalar counts so request memory and transfer stay bounded. Reads stay
// sequential even on requests carrying a MongoDB transaction.
const timestampLimit = 128
async function dailyCounts(
  req: PayloadRequest,
  collection: Source,
  asOf: Date,
  total: number | null,
) {
  const start = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()) - 27 * dayMs
  if (total !== null && total <= timestampLimit) {
    const page = await req.payload.find({
      collection,
      req,
      overrideAccess: false,
      draft: false,
      depth: 0,
      limit: timestampLimit,
      sort: 'createdAt',
      select: { createdAt: true },
      where: {
        and: [
          { createdAt: { greater_than_equal: new Date(start).toISOString() } },
          { createdAt: { less_than_equal: asOf.toISOString() } },
        ],
      },
    })
    // A concurrent insertion can invalidate the size estimate. Never use a
    // truncated page. Missing/inaccessible timestamps make the trend unavailable.
    if (!page.hasNextPage) {
      const days: number[] = Array(28).fill(0)
      for (const doc of page.docs) {
        const day = Math.floor((Date.parse(doc.createdAt) - start) / dayMs)
        if (!Number.isInteger(day) || day < 0 || day >= days.length)
          throw new Error('Unavailable workspace timestamp')
        days[day]++
      }
      return days
    }
  }
  const counts: number[] = []
  for (let day = 0; day < 28; day++) {
    const from = start + day * dayMs
    const until =
      day === 27
        ? { less_than_equal: asOf.toISOString() }
        : { less_than: new Date(from + dayMs).toISOString() }
    const { totalDocs } = await req.payload.count({
      collection,
      req,
      overrideAccess: false,
      where: {
        and: [
          { createdAt: { greater_than_equal: new Date(from).toISOString() } },
          { createdAt: until },
        ],
      },
    })
    counts.push(totalDocs)
  }
  return counts
}

async function recentRows(req: PayloadRequest, slug: Exclude<Source, 'users'>, item: AdminItem) {
  const recent: RecentRow[] = []
  const latest = { req, overrideAccess: false, depth: 0, limit: 4, sort: ['-updatedAt', '-id'] }
  if (slug === 'books' || slug === 'teachings') {
    const { docs } = await req.payload.find({
      ...latest,
      collection: slug,
      draft: true,
      select: { title: true, _status: true, updatedAt: true },
    })
    for (const doc of docs)
      recent.push({
        slug,
        href: item.href + '/' + doc.id,
        title: doc.title || '—',
        status: doc._status ?? 'draft',
        updatedAt: doc.updatedAt,
      })
  } else if (slug === 'files') {
    const { docs } = await req.payload.find({
      ...latest,
      collection: slug,
      select: {
        originalFilename: true,
        ingestionStatus: true,
        isAvailable: true,
        updatedAt: true,
      },
    })
    for (const doc of docs)
      recent.push({
        slug,
        href: item.href + '/' + doc.id,
        title: doc.originalFilename,
        status:
          doc.ingestionStatus === 'ready' && !doc.isAvailable
            ? 'unavailable'
            : (doc.ingestionStatus ?? 'unavailable'),
        updatedAt: doc.updatedAt,
      })
  } else {
    const { docs } = await req.payload.find({
      ...latest,
      collection: slug,
      select: { filename: true, updatedAt: true },
    })
    for (const doc of docs)
      recent.push({
        slug,
        href: item.href + '/' + doc.id,
        title: doc.filename || '—',
        status: 'uploaded',
        updatedAt: doc.updatedAt,
      })
  }
  return recent
}

async function readMetric<T>(
  req: PayloadRequest,
  collection: Source,
  metric: string,
  read: () => Promise<T>,
) {
  try {
    return await read()
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error.status === 401 || error.status === 403)
    )
      throw error
    req.payload.logger.error({ collection, metric }, 'Admin workspace query failed')
    return null
  }
}

export async function workspaceData(req: PayloadRequest, items: AdminItem[], asOf = new Date()) {
  const snapshot = []
  const recent: RecentRow[] = []
  const missingRecent: string[] = []
  for (const slug of collections) {
    const item = items.find((entry) => entry.slug === slug)
    if (!item) continue
    const count = await readMetric(
      req,
      slug,
      'total',
      async () =>
        (await req.payload.count({ req, collection: slug, overrideAccess: false })).totalDocs,
    )
    const trend: number[] | null =
      count === 0
        ? Array(28).fill(0)
        : await readMetric(req, slug, 'daily', () => dailyCounts(req, slug, asOf, count))
    snapshot.push({ slug, count, trend })
    if (slug !== 'users') {
      const rows = await readMetric(req, slug, 'recent', () => recentRows(req, slug, item))
      if (rows) recent.push(...rows)
      else missingRecent.push(item.label)
    }
  }
  recent.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.href.localeCompare(a.href))
  return { snapshot, missingRecent, recent: recent.slice(0, 4), asOf: asOf.toISOString() }
}

export type WorkspaceData = Awaited<ReturnType<typeof workspaceData>>
