// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createLocalReq, getPayload } from 'payload'
import { expect, it, vi } from 'vitest'
import config from '@/payload.config'
import { workspaceData } from '@/components/admin/workspace-data'

vi.mock('server-only', () => ({}))

// Opt in on a fresh, empty isolated test database. Time only the server data call, after
// connection, fixture writes and index initialization. No production telemetry.
it.skipIf(process.env.WORKSPACE_BENCHMARK !== '1')(
  'measures a populated admin dashboard',
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL || 'file:///missing')
    if (
      url.hostname !== '127.0.0.1' ||
      !url.pathname.endsWith('_test') ||
      url.href !== process.env.DATABASE_URL
    )
      throw new Error('Isolated test database required')
    const payload = await getPayload({ config })
    const marker = randomUUID()
    const sizes = { books: 28, teachings: 56, media: 84, users: 27, files: 504 }
    const sources = ['books', 'teachings', 'media', 'users', 'files'] as const
    const items = sources.map((slug) => ({ slug, label: slug, href: '/admin/collections/' + slug }))
    const asOf = new Date()
    let adminId: string | undefined
    try {
      await Promise.all(sources.map((slug) => payload.db.collections[slug].init()))
      const admin = await payload.create({
        collection: 'users',
        data: {
          name: 'Benchmark',
          email: marker + '@example.test',
          password: randomUUID(),
          role: 'admin',
          isActive: true,
        },
      })
      adminId = admin.id
      for (const slug of sources) {
        // Fixed distribution across all 28 buckets; deterministic read shape,
        // no storage/network side effects from synthetic media or file fixtures.
        await payload.db.collections[slug].collection.insertMany(
          Array.from({ length: sizes[slug] }, (_, i) => {
            const id = marker + '-' + i
            const time = new Date(asOf.getTime() - (i % 28) * 86400000)
            return {
              benchMarker: marker,
              title: { en: id },
              slug: id,
              filename: id + '.pdf',
              originalFilename: id + '.pdf',
              email: id + '@example.test',
              _status: 'published',
              createdAt: time,
              updatedAt: time,
            }
          }),
        )
      }
      const counts = vi.spyOn(payload, 'count')
      const finds = vi.spyOn(payload, 'find')
      for (let sample = 0; sample < 6; sample++) {
        counts.mockClear()
        finds.mockClear()
        const req = await createLocalReq({ user: { ...admin, collection: 'users' } }, payload)
        const start = performance.now()
        const result = await workspaceData(req, items, asOf)
        const ms = performance.now() - start
        for (const row of result.snapshot) {
          // i % 28 assigns the first record to today, and the 28th to the oldest day.
          const expected = Array.from({ length: 28 }, (_, day) =>
            Math.floor((sizes[row.slug] + day) / 28),
          )
          expect(row.trend).toEqual(expected)
        }
        console.info(
          'workspace-benchmark',
          JSON.stringify({
            sample,
            counts: counts.mock.calls.length,
            finds: finds.mock.calls.length,
            ms: Math.round(ms * 10) / 10,
          }),
        )
      }
    } finally {
      vi.restoreAllMocks()
      for (const slug of sources)
        await payload.db.collections[slug].collection.deleteMany({ benchMarker: marker })
      if (adminId) await payload.delete({ collection: 'users', id: adminId })
      await payload.destroy()
    }
  },
  120000,
)
