// @vitest-environment node
import { Types } from 'mongoose'
import { randomUUID } from 'node:crypto'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import config from '@/payload.config'
import { workspaceData } from '@/components/admin/workspace-data'

vi.mock('server-only', () => ({}))

let payload: Payload
let otherId: string
let req: PayloadRequest
const marker = randomUUID()
const files = { slug: 'files', href: '/admin/collections/files', label: 'Files' }
const users = { slug: 'users', href: '/admin/collections/users', label: 'Users' }
const asOf = new Date('2023-03-28T12:00:00.000Z')

beforeAll(async () => {
  const url = new URL(process.env.TEST_DATABASE_URL || 'file:///missing')
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    process.env.DATABASE_URL !== url.href
  )
    throw new Error('Isolated test database required')
  payload = await getPayload({ config })
  const editor = await payload.create({
    collection: 'users',
    data: {
      email: marker + '@example.test',
      password: randomUUID(),
      name: 'Workspace fixture',
      role: 'editor',
      isActive: true,
    },
  })
  req = await createLocalReq({ user: { ...editor, collection: 'users' } }, payload)
  const other = await payload.create({
    collection: 'users',
    data: {
      email: randomUUID() + '@example.test',
      password: randomUUID(),
      name: 'Other account',
      role: 'member',
      isActive: true,
    },
  })
  otherId = other.id
  await payload.db.collections.users.collection.updateOne(
    { _id: new Types.ObjectId(otherId) },
    { $set: { createdAt: asOf } },
  )
  // Bulk fixtures set precise UTC instants without changing production timestamp hooks.
  const times = [
    '2023-02-28T23:59:59.999Z',
    '2023-03-01T00:00:00.000Z',
    ...Array<string>(503).fill('2023-03-27T23:59:59.999Z'),
    '2023-03-28T00:00:00.000Z',
    asOf.toISOString(),
    '2023-03-28T12:00:00.001Z',
  ]
  await payload.db.collections.files.collection.insertMany(
    times.map((time) => ({
      originalFilename: marker,
      createdAt: new Date(time),
      updatedAt: new Date(time),
    })),
  )
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  if (!payload) return
  await payload.db.collections.files.collection.deleteMany({ originalFilename: marker })
  if (otherId) await payload.delete({ collection: 'users', id: otherId })
  if (req?.user) await payload.delete({ collection: 'users', id: req.user.id })
  await payload.destroy()
})

it('counts a full UTC window and the partial current day with bounded, permission-checked queries', async () => {
  const counts = vi.spyOn(payload, 'count')
  const docs = vi.spyOn(payload, 'find')
  const { snapshot } = await workspaceData(req, [files, users], asOf)
  expect(snapshot.find((s) => s.slug === 'files')?.trend).toEqual([1, ...Array(25).fill(0), 503, 2])
  expect(snapshot.find((s) => s.slug === 'users')?.count).toBe(1)
  expect(snapshot.find((s) => s.slug === 'users')?.trend).toEqual(Array(28).fill(0))
  expect(counts.mock.calls.length).toBeLessThanOrEqual(58)
  expect(
    counts.mock.calls.every(([args]) => args.overrideAccess === false && args.req === req),
  ).toBe(true)
  expect(docs.mock.calls.map(([args]) => [args.collection, args.limit])).toEqual([
    ['users', 128],
    ['files', 4],
  ])
  expect(docs.mock.calls.every(([args]) => args.req === req && args.overrideAccess === false)).toBe(
    true,
  )
})

it('preserves independent metrics and sanitizes logging when a query fails', async () => {
  const logs = vi.spyOn(payload.logger, 'error').mockImplementation(() => {})
  vi.spyOn(payload, 'count').mockRejectedValueOnce(new Error('sensitive fixture'))
  vi.spyOn(payload, 'find').mockRejectedValueOnce(new Error('sensitive fixture'))
  const result = await workspaceData(req, [files], asOf)
  expect(result.snapshot[0].count).toBeNull()
  expect(result.snapshot[0].trend?.at(-1)).toBe(2)
  expect(result.missingRecent).toEqual(['Files'])
  expect(JSON.stringify(logs.mock.calls)).not.toContain('sensitive fixture')
})
it('propagates denied access', async () => {
  const error = Object.assign(new Error('Forbidden'), { status: 403 })
  vi.spyOn(payload, 'count').mockRejectedValueOnce(error)
  await expect(workspaceData(req, [files], asOf)).rejects.toBe(error)
})

it('falls back to exact daily counts if the size estimate becomes stale', async () => {
  vi.spyOn(payload, 'count').mockResolvedValueOnce({ totalDocs: 4 })
  const find = vi.spyOn(payload, 'find')
  const { snapshot } = await workspaceData(req, [files], asOf)
  expect(find.mock.calls[0][0]).toMatchObject({
    collection: 'files',
    limit: 128,
    select: { createdAt: true },
    overrideAccess: false,
  })
  expect(snapshot[0].trend).toEqual([1, ...Array(25).fill(0), 503, 2])
})

it('keeps an unreadable timestamp unavailable in the projected path', async () => {
  vi.spyOn(payload.logger, 'error').mockImplementation(() => {})
  const hooks = payload.collections.users.config.hooks.afterRead
  hooks.push(({ doc }) => {
    const visible = { ...doc }
    delete visible.createdAt
    return visible
  })
  try {
    expect((await workspaceData(req, [users])).snapshot[0]).toMatchObject({ count: 1, trend: null })
  } finally {
    hooks.pop()
  }
})
