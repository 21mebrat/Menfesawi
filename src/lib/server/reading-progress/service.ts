import type { CollectionAfterDeleteHook, PayloadRequest } from 'payload'
import { mongo, Types } from 'mongoose'
import { fail, session } from '../library/coordination'
import { withOwner, type PrivateAccountOptions, type PrivateLocale } from '../privateAccount'
import { isID, publicSummaries, targetKey, type BookmarkTarget } from '../bookmarks/targets'

export type ReadingPosition = { publication: string; section: string; passage?: string | null }
export type ProgressPreconditions = { expectedRevision: number; generation?: string }
type Base = { id: string; revision: number; updatedAt: string }
type Navigation = { id: string; title: string | null; slug: string }
export type MyReadingProgress = Base &
  (
    | { status: 'unavailable' }
    | {
        status: 'available'
        publication: Navigation
        section: Navigation
        passage: { id: string; label: string | null; number: number | null } | null
      }
  )
interface StoredPosition {
  publication: Types.ObjectId
  section: Types.ObjectId
  passage: Types.ObjectId | null
}
interface Row extends StoredPosition {
  _id: Types.ObjectId
  user: Types.ObjectId
  revision: number
  createdAt: Date
  updatedAt: Date
}

function store(req: PayloadRequest) {
  const db = req.payload.db.connection.db
  if (!db) throw new Error('Reading progress database unavailable.')
  return db.collection<Row>(
    req.payload.db.collections['reading-progress'].collection.collectionName,
  )
}
function id(value: unknown) {
  if (!isID(value)) return fail('Invalid reading position identifier.')
  return new Types.ObjectId(value)
}
function exact(input: unknown, allowed: readonly string[]) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    fail('Unexpected reading progress fields.')
}
const optionFields = ['req', 'locale', 'fallbackLocale']
const conflict = () =>
  fail(
    'Reading progress changed or its precondition is missing. Refetch before saving or resetting.',
    409,
  )
function precondition(value: ProgressPreconditions, reset = false) {
  if (!value) return conflict()
  exact(value, ['expectedRevision', 'generation'])
  const { expectedRevision: revision, generation } = value
  if (!Number.isSafeInteger(revision) || revision < 0) return conflict()
  if (revision === 0) {
    if (reset || generation !== undefined) return conflict()
    return { revision, generation: null }
  }
  if (!isID(generation) || (!reset && revision === Number.MAX_SAFE_INTEGER)) return conflict()
  return { revision, generation: new Types.ObjectId(generation) }
}

async function resolve(req: PayloadRequest, positions: StoredPosition[], locale: PrivateLocale) {
  const targets: BookmarkTarget[] = []
  for (const pos of positions) {
    targets.push(
      { relationTo: 'publications', value: pos.publication.toHexString() },
      { relationTo: 'publication-sections', value: pos.section.toHexString() },
    )
    if (pos.passage) targets.push({ relationTo: 'passages', value: pos.passage.toHexString() })
  }
  const summaries = await publicSummaries(req, targets, { ...locale, includePassageExcerpt: false })
  return positions.map((pos) => {
    const get = (relationTo: BookmarkTarget['relationTo'], value: Types.ObjectId) =>
      summaries.get(targetKey({ relationTo, value: value.toHexString() }))
    const pub = get('publications', pos.publication)
    const section = get('publication-sections', pos.section)
    const passage = pos.passage && get('passages', pos.passage)
    if (
      !pub?.slug ||
      !section?.slug ||
      section.publicationId !== pub.id ||
      (pos.passage && passage?.sectionId !== section.id)
    )
      return { status: 'unavailable' } as const
    return {
      status: 'available',
      publication: { id: pub.id, title: pub.title, slug: pub.slug },
      section: { id: section.id, title: section.title, slug: section.slug },
      passage: passage
        ? { id: passage.id, label: passage.title, number: passage.number ?? null }
        : null,
    } as const
  })
}
const metadata = (row: Row): Base => ({
  id: row._id.toHexString(),
  revision: row.revision,
  updatedAt: row.updatedAt.toISOString(),
})

export function saveMyReadingProgress(
  position: ReadingPosition,
  conditions: ProgressPreconditions,
  options: PrivateAccountOptions,
): Promise<MyReadingProgress> {
  return withOwner(options, true, async (req, user, locale) => {
    exact(options, optionFields)
    const { revision, generation } = precondition(conditions)
    exact(position, ['publication', 'section', 'passage'])
    const pos: StoredPosition = {
      publication: id(position.publication),
      section: id(position.section),
      passage: position.passage == null ? null : id(position.passage),
    }
    const sessionOptions = { session: await session(req) }
    const records = store(req)
    const identity = { user, publication: pos.publication }
    const current = await records.findOne(identity, {
      ...sessionOptions,
      projection: { _id: 1, revision: 1 },
    })
    if (
      generation
        ? !current || !generation.equals(current._id) || current.revision !== revision
        : current !== null
    )
      return conflict()
    const [resolved] = await resolve(req, [pos], locale)
    if (resolved.status !== 'available') return fail('Reading position unavailable.', 404)
    const now = new Date()
    if (!generation) {
      const row: Row = {
        ...pos,
        user,
        _id: new Types.ObjectId(),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
      try {
        await records.insertOne(row, sessionOptions)
      } catch (error) {
        if (
          error instanceof mongo.MongoServerError &&
          error.code === 11000 &&
          error.keyPattern?.user === 1 &&
          error.keyPattern?.publication === 1
        )
          return conflict()
        throw error
      }
      return { ...metadata(row), ...resolved }
    }
    const row = await records.findOneAndUpdate(
      { ...identity, _id: generation, revision },
      {
        $set: { section: pos.section, passage: pos.passage, updatedAt: now },
        $inc: { revision: 1 },
      },
      { ...sessionOptions, returnDocument: 'after' },
    )
    if (!row) return conflict()
    return { ...metadata(row), ...resolved }
  })
}

export function getMyReadingProgress(
  publicationId: string,
  options: PrivateAccountOptions,
): Promise<MyReadingProgress | null> {
  return withOwner(options, false, async (req, user, locale) => {
    exact(options, optionFields)
    const row = await store(req).findOne(
      { user, publication: id(publicationId) },
      { session: await session(req) },
    )
    if (!row) return null
    const [resolved] = await resolve(req, [row], locale)
    return { ...metadata(row), ...resolved }
  })
}
export function listMyReadingProgress(
  options: PrivateAccountOptions & { page?: number; limit?: number },
) {
  return withOwner(options, false, async (req, user, locale) => {
    exact(options, [...optionFields, 'page', 'limit'])
    const { page = 1, limit = 25 } = options
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger((page - 1) * limit)
    )
      return fail('Invalid reading progress page or limit (1–100).')
    const rows = await store(req)
      .find({ user }, { session: await session(req) })
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit + 1)
      .toArray()
    const pageRows = rows.slice(0, limit)
    const resolved = await resolve(req, pageRows, locale)
    return {
      page,
      hasNextPage: rows.length > limit,
      docs: pageRows.map((row, i): MyReadingProgress => ({ ...metadata(row), ...resolved[i] })),
    }
  })
}
// Omit the publication selector when resetting an unavailable row from the list.
// Its server-issued ID is always required as the generation precondition.
export function resetMyReadingProgress(
  publicationId: string | null,
  conditions: ProgressPreconditions,
  options: PrivateAccountOptions,
) {
  return withOwner(options, true, async (req, user) => {
    exact(options, optionFields)
    const { revision, generation } = precondition(conditions, true)
    if (!generation) return conflict()
    const result = await store(req).deleteOne(
      {
        user,
        _id: generation,
        revision,
        ...(publicationId === null ? {} : { publication: id(publicationId) }),
      },
      { session: await session(req) },
    )
    if (!result.deletedCount) return conflict()
  })
}
export const removeDeletedUsersProgress: CollectionAfterDeleteHook = async ({
  req,
  id: userId,
}) => {
  await store(req).deleteMany({ user: id(String(userId)) }, { session: await session(req) })
}
