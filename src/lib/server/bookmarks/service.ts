import { Types } from 'mongoose'
import { type CollectionAfterDeleteHook, type PayloadRequest } from 'payload'
import { withOwner } from '../privateAccount'
import { fail, session } from '../library/coordination'
import {
  isID,
  isTargetType,
  publicSummaries,
  readTarget,
  targetKey,
  type BookmarkLocale,
  type BookmarkTarget,
  type BookmarkTargetType,
  type PublicBookmarkContent,
} from './targets'

type Options = BookmarkLocale & { req: PayloadRequest }
type ListOptions = Options & { page?: number; limit?: number; targetType?: BookmarkTargetType }
interface Row {
  _id: Types.ObjectId
  user: Types.ObjectId
  target: { relationTo: BookmarkTargetType; value: Types.ObjectId }
  note: string | null
  createdAt: Date
  updatedAt: Date
}
export type PrivateBookmark = {
  id: string
  note: string | null
  createdAt: string
  targetType: BookmarkTargetType
} & (
  { status: 'available'; content: PublicBookmarkContent } | { status: 'unavailable'; content: null }
)

function store(req: PayloadRequest) {
  const db = req.payload.db.connection.db
  if (!db) throw new Error('Bookmark database unavailable.')
  return db.collection<Row>(req.payload.db.collections.bookmarks.collection.collectionName)
}
function objectID(id: string) {
  if (!isID(id)) return fail('Invalid bookmark ID.')
  return new Types.ObjectId(id)
}
function noteText(note: unknown) {
  if (note == null) return null
  if (typeof note !== 'string' || note.length > 2000)
    return fail('A note may contain up to 2,000 characters.')
  return note
}

function targetOf(row: Row): BookmarkTarget {
  return { relationTo: row.target.relationTo, value: row.target.value.toHexString() }
}
function present(row: Row, content?: PublicBookmarkContent): PrivateBookmark {
  const base = {
    id: row._id.toHexString(),
    targetType: row.target.relationTo,
    createdAt: row.createdAt.toISOString(),
    note: row.note ?? null,
  }
  return content
    ? { ...base, status: 'available', content }
    : { ...base, status: 'unavailable', content: null }
}
async function presentOne(req: PayloadRequest, row: Row | null, locale: BookmarkLocale) {
  if (!row) return fail('Bookmark not found.', 404)
  const target = targetOf(row)
  return present(row, (await publicSummaries(req, [target], locale)).get(targetKey(target)))
}

export function saveBookmark(target: BookmarkTarget, options: Options & { note?: string | null }) {
  return withOwner(options, true, async (req, user, locale) => {
    const selected = readTarget(target)
    const note = noteText(options.note)
    const content = (await publicSummaries(req, [selected], locale)).get(targetKey(selected))
    if (!content) return fail('Bookmark target unavailable.', 404)
    const value = objectID(selected.value),
      now = new Date()
    const row = await store(req).findOneAndUpdate(
      { user, 'target.relationTo': selected.relationTo, 'target.value': value },
      {
        $setOnInsert: {
          user,
          target: { relationTo: selected.relationTo, value },
          note,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: 'after', session: await session(req) },
    )
    if (!row) throw new Error('Bookmark upsert returned no document.')
    return present(row, content)
  })
}

export function listMyBookmarks(options: ListOptions) {
  return withOwner(options, false, async (req, user, locale) => {
    const { page = 1, limit = 25, targetType } = options
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger((page - 1) * limit)
    )
      return fail('Invalid bookmark page or limit (1–100).')
    if (targetType !== undefined && !isTargetType(targetType))
      return fail('Unsupported bookmark type.')
    const rows = await store(req)
      .find(
        { user, ...(targetType && { 'target.relationTo': targetType }) },
        { session: await session(req) },
      )
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit + 1)
      .toArray()
    const pageRows = rows.slice(0, limit)
    const summaries = await publicSummaries(req, pageRows.map(targetOf), locale)
    return {
      docs: pageRows.map((row) => present(row, summaries.get(targetKey(targetOf(row))))),
      page,
      hasNextPage: rows.length > limit,
    }
  })
}
export function getMyBookmark(id: string, options: Options) {
  return withOwner(options, false, async (req, user, locale) =>
    presentOne(
      req,
      await store(req).findOne({ _id: objectID(id), user }, { session: await session(req) }),
      locale,
    ),
  )
}
export function updateMyBookmarkNote(id: string, note: string | null, options: Options) {
  return withOwner(options, true, async (req, user, locale) =>
    presentOne(
      req,
      await store(req).findOneAndUpdate(
        { _id: objectID(id), user },
        { $set: { note: noteText(note), updatedAt: new Date() } },
        { session: await session(req), returnDocument: 'after' },
      ),
      locale,
    ),
  )
}
export function deleteMyBookmark(id: string, options: Options) {
  return withOwner(options, true, async (req, user) => {
    const result = await store(req).deleteOne(
      { _id: objectID(id), user },
      { session: await session(req) },
    )
    if (!result.deletedCount) return fail('Bookmark not found.', 404)
  })
}
// Users.beforeDelete already locks the account and applies its retention guards.
export const removeDeletedUsersBookmarks: CollectionAfterDeleteHook = async ({ req, id }) => {
  await store(req).deleteMany({ user: objectID(String(id)) }, { session: await session(req) })
}
