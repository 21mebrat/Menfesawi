import { getTranslation, t } from '@payloadcms/translations'
import { bookLabel } from '@/i18n/collectionLabels'
import {
  ValidationError,
  type Access,
  type CollectionSlug,
  type PayloadRequest,
  type CollectionBeforeDeleteHook,
  type CollectionBeforeValidateHook,
  type CollectionBeforeOperationHook,
} from 'payload'
import type { Book, Category, File as LibraryFile } from '@/payload-types'
import { isStaff } from '@/access'
import { getMongoSession } from '../reading/coordination'
import { fail, lock, ref, session } from './coordination'

function invalidField(
  req: PayloadRequest,
  path: string,
  key: Parameters<typeof bookLabel>[0],
): never {
  throw new ValidationError(
    {
      req,
      errors: [{ path, message: getTranslation(bookLabel(key), req.i18n) }],
    },
    req.t,
  )
}

export const liveOnly: CollectionBeforeOperationHook = ({ operation, req, args }) => {
  if (operation === 'read' && !isStaff(req.user)) args.draft = false
}
export const readCategories: Access = async ({ req }) => {
  if (isStaff(req.user)) return true
  // Only a published path from a root makes a node publicly navigable.
  const docs = await req.payload.db.collections.categories
    .find(
      { _status: 'published' },
      { parent: 1 },
      { session: await getMongoSession(req.payload, req) },
    )
    .lean<{ _id: unknown; parent?: unknown }[]>()
  const children = new Map<string, string[]>()
  for (const doc of docs) {
    const parent = String(doc.parent ?? '')
    const siblings = children.get(parent) ?? []
    siblings.push(String(doc._id))
    children.set(parent, siblings)
  }
  const ids = [...(children.get('') ?? [])]
  for (let i = 0; i < ids.length; i++)
    for (const child of children.get(ids[i]) ?? []) ids.push(child)
  return { id: { in: ids }, _status: { equals: 'published' } }
}
// These registered collections have a categories relationship and lock it on assignment.
const categorizedCollections = ['books', 'teachings', 'hymns'] as const

async function hasCurrentReference(
  req: PayloadRequest,
  collection: CollectionSlug,
  field: string,
  id: string | number,
) {
  const db = req.payload.db
  const mongoSession = await session(req)
  if (await db.collections[collection].exists({ [field]: id }).session(mongoSession)) return true
  return Boolean(
    await db.versions[collection]
      ?.exists({
        latest: true,
        ['version.' + field]: id,
      })
      .session(mongoSession),
  )
}

export const validateCategory: CollectionBeforeValidateHook<Category> = async ({
  req,
  data,
  originalDoc,
}) => {
  if (!data) return
  const effective = { ...originalDoc, ...data }
  const seen = new Set([originalDoc?.id ?? effective.id])
  if (originalDoc?.id) {
    await lock(req, 'categories', originalDoc.id)
    // On status-only publication originalDoc may already contain the staged removal.
    const live = await req.payload.findByID({
      collection: 'categories',
      id: originalDoc.id,
      req,
      depth: 0,
      draft: false,
      select: { contentTypes: true },
    })
    for (const type of categorizedCollections) {
      if (
        live.contentTypes.includes(type) &&
        !effective.contentTypes?.includes(type) &&
        (await hasCurrentReference(req, type, 'categories', originalDoc.id))
      ) {
        fail(
          t({
            key: 'bookEditor:applicability',
            translations: req.i18n.translations,
            vars: {
              type: getTranslation(req.payload.collections[type].config.labels.plural, req.i18n),
            },
          }),
          409,
        )
      }
    }
  }
  let parent = ref(effective.parent)
  while (parent) {
    if (seen.has(parent)) invalidField(req, 'parent', 'cycle')
    seen.add(parent)
    await lock(req, 'categories', parent)
    const doc = await req.payload.findByID({
      collection: 'categories',
      id: parent,
      req,
      depth: 0,
      select: { parent: true },
      draft: false,
    })
    parent = ref(doc.parent)
  }
}
export const categoryReferences: CollectionBeforeValidateHook = async ({
  req,
  data,
  originalDoc,
  collection,
}) => {
  const ids = (data?.categories === undefined ? originalDoc?.categories : data.categories) ?? []
  if (!Array.isArray(ids)) return invalidField(req, 'categories', 'listCategories')
  for (const id of [...new Set(ids.map(ref))].sort()) {
    await lock(req, 'categories', id)
    const category = await req.payload.findByID({ collection: 'categories', id, req, depth: 0 })
    if (!category.contentTypes.some((type) => type === collection.slug))
      invalidField(req, 'categories', 'categoryError')
  }
}
export function primaryFile(book: Pick<Book, 'file' | 'files'>) {
  return ref(book.file) || (book.files?.length === 1 ? ref(book.files[0]) : '')
}
export function ready(
  file: LibraryFile,
): file is LibraryFile & { telegram: { fileId: string; messageId: number } } {
  return (
    file.ingestionStatus === 'ready' &&
    file.isAvailable &&
    file.mimeType === 'application/pdf' &&
    typeof file.telegram?.fileId === 'string' &&
    /^[A-Za-z0-9_-]+$/.test(file.telegram.fileId) &&
    Number.isSafeInteger(file.telegram.messageId) &&
    Number(file.telegram.messageId) > 0
  )
}
export const validateBook: CollectionBeforeValidateHook<Book> = async ({
  req,
  data,
  originalDoc,
}) => {
  if (!data) return
  const doc = { ...originalDoc, ...data }
  if (originalDoc?.id) await lock(req, 'books', originalDoc.id)
  if (doc.cover) {
    const id = ref(doc.cover)
    await lock(req, 'media', id)
    const image = await req.payload.findByID({ collection: 'media', id, req, depth: 0 })
    if (
      image.purpose !== 'content' ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType ?? '')
    )
      invalidField(req, 'cover', 'coverError')
  }
  const primary = primaryFile(doc)
  if (doc._status === 'published' && !primary) invalidField(req, 'file', 'missingPDF')
  if (doc._status === 'published' && !doc.file && primary) data.file = primary
  if (doc.files != null && !Array.isArray(doc.files)) return invalidField(req, 'files', 'listFiles')
  const ids = (doc.files ?? []).map(ref)
  if (primary) ids.push(primary)
  for (const id of [...new Set(ids)].sort()) {
    await lock(req, 'files', id)
    const file = await req.payload.findByID({ collection: 'files', req, id, depth: 0 })
    if (
      file.mimeType !== 'application/pdf' ||
      (doc._status === 'published' && id === primary && !ready(file))
    )
      invalidField(req, 'file', 'invalidPDF')
  }
}
export const guardDeletion: CollectionBeforeDeleteHook = async ({ req, id, collection }) => {
  const slug = collection.slug
  await lock(req, slug, String(id))
  const mongoSession = await session(req)
  if (
    slug === 'files' &&
    (await req.payload.db.collections.files
      .exists({ _id: id, ingestionStatus: 'pending' })
      .session(mongoSession))
  )
    fail('Reconcile the pending upload before deletion.', 409)
  const refs: [CollectionSlug, string][] =
    slug === 'categories'
      ? [
          ['categories', 'parent'],
          ...categorizedCollections.map((slug): [CollectionSlug, string] => [slug, 'categories']),
        ]
      : slug === 'files'
        ? [
            ['books', 'file'],
            ['books', 'files'],
            ['book-deliveries', 'file'],
          ]
        : slug === 'books'
          ? [
              ['book-deliveries', 'book'],
              ['book-ratings', 'book'],
            ]
          : [
              ['book-deliveries', 'user'],
              ['book-ratings', 'user'],
            ]
  for (const [target, path] of refs) {
    if (await hasCurrentReference(req, target, path, id))
      fail('Remove dependent records or active draft references first.', 409)
  }
  if (
    slug === 'users' &&
    (await req.payload.db.collections['auth-accounts']
      .exists({ provider: 'telegram', user: id })
      .session(mongoSession))
  )
    fail('This account has a retained Telegram link.', 409)
}
