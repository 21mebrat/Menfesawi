import { randomUUID } from 'node:crypto'
import { getPayload } from 'payload'
import type { CollectionSlug } from 'payload'
import { getWudaseMaryamExamplePublicationData } from '../../src/lib/server/reading/examples'

// Only create and remove this run's own fixtures in an explicit local test DB.
export async function seedAdminWorkspace() {
  const db = new URL(process.env.TEST_DATABASE_URL || 'file:///missing')
  if (
    !['127.0.0.1', 'localhost'].includes(db.hostname) ||
    !db.pathname.endsWith('_test') ||
    process.env.DATABASE_URL !== db.href
  )
    throw new Error(
      'Set DATABASE_URL and TEST_DATABASE_URL to the same isolated local *_test database.',
    )
  const { default: config } = await import('../../src/payload.config')
  const payload = await getPayload({ config })
  // A first-run version index build can conflict with transactional draft creation.
  const models = [...Object.values(payload.db.collections), ...Object.values(payload.db.versions)]
  await Promise.all(models.map((model) => model.init()))
  const rows: { collection: CollectionSlug; id: string }[] = []
  const remember = (collection: CollectionSlug, row: { id: string }) => {
    rows.push({ collection, id: row.id })
    return row.id
  }
  const cleanup = async () => {
    for (const { collection, id } of rows.reverse()) await payload.delete({ collection, id })
    await payload.destroy()
  }
  const staff = async (role: 'admin' | 'editor') => {
    const credentials = { email: `${randomUUID()}@example.test`, password: randomUUID() }
    const user = await payload.create({
      collection: 'users',
      data: { ...credentials, name: role === 'admin' ? 'Hana' : 'Dawit', role, isActive: true },
    })
    return { ...credentials, id: remember('users', user) }
  }
  try {
    const admin = await staff('admin')
    const editor = await staff('editor')
    const category = remember(
      'categories',
      await payload.create({
        collection: 'categories',
        data: {
          name: 'Workspace book category',
          slug: randomUUID(),
          contentTypes: ['books'],
          _status: 'published',
        },
      }),
    )
    // Staff-only metadata fixture. No storage transport is involved.
    const file = remember(
      'files',
      await payload.create({
        collection: 'files',
        data: {
          originalFilename: 'workspace-fixture.pdf',
          mimeType: 'application/pdf',
          ingestionStatus: 'ready',
          isAvailable: false,
        },
      }),
    )
    const book = remember(
      'books',
      await payload.create({
        collection: 'books',
        draft: true,
        data: {
          title: 'Workspace test book',
          slug: randomUUID(),
          language: ['am'],
          authors: [{ name: 'First Author' }, { name: 'Second Author' }],
          categories: [category],
          file,
        },
      }),
    )
    const review = remember(
      'book-ratings',
      await payload.create({
        collection: 'book-ratings',
        data: {
          user: editor.id,
          book,
          score: 4,
          review: 'Workspace test review',
          reviewStatus: 'pending',
        },
      }),
    )
    const publication = remember(
      'publications',
      await payload.create({
        collection: 'publications',
        data: {
          ...getWudaseMaryamExamplePublicationData(),
          title: 'Workspace test publication',
          slug: randomUUID(),
          _status: 'published',
        },
      }),
    )
    const section = remember(
      'publication-sections',
      await payload.create({
        collection: 'publication-sections',
        data: {
          publication,
          typeKey: 'day',
          title: 'Workspace test section',
          slug: randomUUID(),
          order: 1,
          _status: 'published',
        },
      }),
    )
    return { admin, editor, book, category, review, publication, section, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
