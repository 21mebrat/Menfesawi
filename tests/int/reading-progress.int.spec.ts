import { randomUUID } from 'node:crypto'
import { Types } from 'mongoose'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import config from '@/payload.config'
import type { User } from '@/payload-types'
import { GET, PUT, DELETE, PATCH } from '@/app/(payload)/api/[...slug]/route'
import { POST as graphql } from '@/app/(payload)/api/graphql/route'
import { createPayloadSessionForUser } from '@/lib/auth/session'
import { getWudaseMaryamExamplePublicationData } from '@/lib/server/reading/examples'
import {
  saveMyReadingProgress as save,
  listMyReadingProgress as list,
  getMyReadingProgress as get,
  resetMyReadingProgress as reset,
  type MyReadingProgress,
} from '@/lib/server/reading-progress/service'

describe('Private reading progress', () => {
  let p: Payload, admin: User, visitor: User
  const users = new Set<string>(),
    pubs: string[] = [],
    sections: string[] = [],
    passages = new Set<string>()
  let pub: string,
    second: string,
    root: string,
    leaf: string,
    sibling: string,
    otherRoot: string,
    paragraph: string
  const first = { expectedRevision: 0 }
  const expected = (row: MyReadingProgress) => ({
    expectedRevision: row.revision,
    generation: row.id,
  })
  const reqFor = (u: User) => createLocalReq({ user: { ...u, collection: 'users' } }, p)
  async function account(role: User['role'] = 'member') {
    const u = await p.create({
      collection: 'users',
      data: {
        role,
        isActive: true,
        name: 'Progress fixture',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
      },
    })
    users.add(u.id)
    return u
  }
  async function publication() {
    const { id } = await p.create({
      collection: 'publications',
      user: admin,
      data: { ...getWudaseMaryamExamplePublicationData(), slug: randomUUID() },
    })
    pubs.push(id)
    return id
  }
  async function section(publication: string, parent?: string) {
    const { id } = await p.create({
      collection: 'publication-sections',
      depth: 0,
      user: admin,
      data: {
        title: 'Public section',
        slug: randomUUID(),
        order: 0,
        typeKey: parent ? 'prayer' : 'day',
        publication,
        parent,
        _status: 'published',
      },
    })
    sections.push(id)
    return id
  }
  async function passage(section: string, status: 'published' | 'draft' = 'published') {
    const { id } = await p.create({
      collection: 'passages',
      depth: 0,
      user: admin,
      data: {
        section,
        order: 0,
        text: { english: 'private-fixture-text' },
        notes: [{ content: 'editorial-fixture', visibility: 'editorial' }],
        _status: status,
      },
    })
    passages.add(id)
    return id
  }
  const options = async () => ({ req: await reqFor(await account()) })
  const start = () => ({ publication: pub, section: leaf })
  const atPassage = () => ({ ...start(), passage: paragraph })
  beforeAll(async () => {
    p = await getPayload({ config })
    await Promise.all(Object.values(p.db.collections).map((model) => model.init()))
    admin = await account('admin')
    visitor = await account()
    pub = await publication()
    second = await publication()
    root = await section(pub)
    leaf = await section(pub, root)
    sibling = await section(pub, root)
    otherRoot = await section(second)
    paragraph = await passage(leaf)
  }, 180000)
  afterAll(async () => {
    if (!p) return
    for (const id of passages) await p.delete({ collection: 'passages', id })
    for (const id of sections.reverse()) await p.delete({ collection: 'publication-sections', id })
    for (const id of pubs) await p.delete({ collection: 'publications', id })
    for (const id of users) await p.delete({ collection: 'users', id })
  }, 180000)

  it('binds revisions to the owner and record generation, including competing initial saves and backward moves', async () => {
    const opts = await options()
    const results = await Promise.allSettled([
      save(start(), first, opts),
      save(atPassage(), first, opts),
    ])
    const successes = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    expect(successes).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
    const original = successes[0]
    expect(original.revision).toBe(1)
    expect((await list(opts)).docs).toHaveLength(1)
    const moved = await save(atPassage(), expected(original), opts)
    expect(moved).toMatchObject({
      id: original.id,
      revision: 2,
      status: 'available',
      passage: { id: paragraph },
      section: { id: leaf },
      publication: { id: pub },
    })
    expect(JSON.stringify(moved)).not.toMatch(/private-fixture-text|editorial-fixture/)
    await expect(save(start(), expected(original), opts)).rejects.toMatchObject({ status: 409 })
    await expect(reset(pub, expected(original), opts)).rejects.toMatchObject({ status: 409 })
    expect(await get(pub, opts)).toEqual(moved)
    const earlier = await save(start(), expected(moved), opts)
    expect(earlier).toMatchObject({ revision: 3, passage: null, id: original.id })
    await reset(pub, expected(earlier), opts)
    expect(await get(pub, opts)).toBeNull()
    const replacement = await save(start(), first, opts)
    expect(replacement.revision).toBe(1)
    expect(replacement.id).not.toBe(original.id)
    await expect(save(atPassage(), expected(original), opts)).rejects.toMatchObject({ status: 409 })
    await expect(reset(null, expected(original), opts)).rejects.toMatchObject({ status: 409 })
    expect(await get(pub, opts)).toEqual(replacement)
    const raw = p.db.collections['reading-progress'].collection
    const indexes = await raw.indexes()
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { user: 1, publication: 1 }, unique: true }),
        expect.objectContaining({ key: { user: 1, updatedAt: -1, _id: -1 } }),
      ]),
    )
    await expect(
      raw.insertOne({
        user: new Types.ObjectId(opts.req.user!.id),
        publication: new Types.ObjectId(pub),
      }),
    ).rejects.toMatchObject({ code: 11000 })
  })

  it('rejects wrong membership and private positions for staff and retains the prior position', async () => {
    const opts = { req: await reqFor(admin) },
      row = await save(start(), first, opts)
    const draft = await passage(leaf, 'draft')
    const missing = new Types.ObjectId().toHexString()
    for (const pos of [
      { ...start(), section: otherRoot },
      { ...start(), section: sibling, passage: paragraph },
      { ...start(), passage: draft },
      { ...start(), section: missing },
      { ...start(), passage: missing },
    ])
      await expect(save(pos, expected(row), opts)).rejects.toMatchObject({ status: 404 })
    await p.update({
      collection: 'publication-sections',
      id: leaf,
      user: admin,
      draft: true,
      data: { title: 'Saved private revision', _status: 'draft' },
    })
    expect(await get(pub, opts)).toMatchObject({
      status: 'available',
      section: { title: 'Public section' },
    })
    for (const [collection, id] of [
      ['publication-sections', root],
      ['publications', pub],
    ] as const) {
      await p.update({ collection, id, user: admin, data: { _status: 'draft' } })
      try {
        await expect(save(atPassage(), expected(row), opts)).rejects.toMatchObject({ status: 404 })
        const hidden = await get(pub, opts)
        expect(hidden).toEqual({
          id: row.id,
          revision: 1,
          updatedAt: row.updatedAt,
          status: 'unavailable',
        })
      } finally {
        await p.update({ collection, id, user: admin, data: { _status: 'published' } })
      }
      expect((await get(pub, opts))?.status).toBe('available')
    }
    await reset(pub, expected(row), opts)
  })

  it('detects a moved or deleted passage, restores it on return and allows replacing or resetting unavailable progress', async () => {
    const opts = await options()
    const text = await passage(leaf)
    const pos = { ...start(), passage: text }
    const row = await save(pos, first, opts)
    const move = (section: string) =>
      p.update({
        collection: 'passages',
        id: text,
        user: admin,
        data: { section, _status: 'published' },
      })
    await move(sibling)
    const unavailable = { status: 'unavailable', id: row.id, revision: 1, updatedAt: row.updatedAt }
    expect((await list(opts)).docs).toEqual([unavailable])
    await move(leaf)
    expect(await get(pub, opts)).toEqual(row)
    await p.delete({ collection: 'passages', id: text })
    passages.delete(text)
    expect(await get(pub, opts)).toEqual(unavailable)
    const replaced = await save({ publication: pub, section: sibling }, expected(row), opts)
    expect(replaced).toMatchObject({ revision: 2, status: 'available', passage: null })
    await p.update({
      collection: 'publication-sections',
      id: sibling,
      user: admin,
      data: { _status: 'draft' },
    })
    try {
      const [hidden] = (await list(opts)).docs
      expect(hidden.status).toBe('unavailable')
      await reset(null, expected(hidden), opts)
      expect((await list(opts)).docs).toEqual([])
    } finally {
      await p.update({
        collection: 'publication-sections',
        id: sibling,
        user: admin,
        data: { _status: 'published' },
      })
    }
  })

  it('does not follow an empty section into another publication or attach a replacement after deletion', async () => {
    const opts = await options()
    const movable = await section(pub)
    const pos = { publication: pub, section: movable }
    const row = await save(pos, first, opts)
    await p.update({
      collection: 'publication-sections',
      id: movable,
      user: admin,
      data: { publication: second, _status: 'published' },
    })
    expect((await list(opts)).docs).toEqual([
      { id: row.id, revision: 1, updatedAt: row.updatedAt, status: 'unavailable' },
    ])
    expect(await get(second, opts)).toBeNull()
    await p.update({
      collection: 'publication-sections',
      id: movable,
      user: admin,
      data: { publication: pub, _status: 'published' },
    })
    expect(await get(pub, opts)).toEqual(row)
    await p.delete({ collection: 'publication-sections', id: movable })
    sections.splice(sections.indexOf(movable), 1)
    expect((await get(pub, opts))?.status).toBe('unavailable')
    await reset(null, expected(row), opts)
  })

  it('commits just one of two updates carrying the same preconditions', async () => {
    const opts = await options()
    const row = await save(start(), first, opts)
    const writes = await Promise.allSettled([
      save(atPassage(), expected(row), opts),
      save({ publication: pub, section: sibling }, expected(row), opts),
    ])
    const winners = writes.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    expect(winners).toHaveLength(1)
    expect(writes.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
    expect(winners[0].revision).toBe(2)
    expect(await get(pub, opts)).toEqual(winners[0])
  })

  it('isolates active accounts, checks persisted activation and rejects spoofed fields', async () => {
    const opts = await options(),
      row = await save(start(), first, opts)
    for (const u of [visitor, admin]) {
      const theirs = { req: await reqFor(u) }
      expect(await get(pub, theirs)).toBeNull()
      expect((await list(theirs)).docs).toEqual([])
      await expect(save(atPassage(), expected(row), theirs)).rejects.toMatchObject({ status: 409 })
      await expect(reset(null, expected(row), theirs)).rejects.toMatchObject({ status: 409 })
    }
    const anon = { req: await createLocalReq({}, p) }
    await expect(save(start(), first, anon)).rejects.toMatchObject({ status: 401 })
    await expect(list(anon)).rejects.toMatchObject({ status: 401 })
    const spoof = { ...opts, user: admin.id },
      pos = { ...start(), revision: 50 }
    await expect(save(start(), expected(row), spoof)).rejects.toMatchObject({ status: 400 })
    await expect(save(pos, expected(row), opts)).rejects.toMatchObject({ status: 400 })
    await expect(
      save({ ...start(), publication: second, section: otherRoot }, expected(row), opts),
    ).rejects.toMatchObject({ status: 409 })
    await p.update({ collection: 'users', id: opts.req.user!.id, data: { isActive: false } })
    for (const op of [
      () => list(opts),
      () => get(pub, opts),
      () => save(start(), expected(row), opts),
      () => reset(null, expected(row), opts),
    ])
      await expect(op()).rejects.toMatchObject({ status: 403 })
  })

  it('paginates by updated time and ID, batches lookups and preserves locale and caller transaction', async () => {
    const opts = await options(),
      one = await save(atPassage(), first, opts)
    const two = await save({ publication: second, section: otherRoot }, first, opts)
    expect((await list(opts)).docs.map((r) => r.id)).toEqual([two.id, one.id])
    await p.db.collections['reading-progress'].collection.updateMany(
      { user: new Types.ObjectId(opts.req.user!.id) },
      { $set: { updatedAt: new Date(0) } },
    )
    const sorted = [one.id, two.id].sort().reverse()
    const a = await list({ ...opts, limit: 1 }),
      b = await list({ ...opts, limit: 1, page: 2 })
    expect([a.docs[0].id, b.docs[0].id]).toEqual(sorted)
    expect(a.hasNextPage).toBe(true)
    expect(b.hasNextPage).toBe(false)
    for (const args of [{ page: 0 }, { limit: 0 }, { limit: 101 }, { page: 1.5 }])
      await expect(list({ ...opts, ...args })).rejects.toMatchObject({ status: 400 })
    const tx = await p.db.beginTransaction()
    if (!tx) throw new Error('Test transaction required')
    const req = await createLocalReq(
      {
        user: opts.req.user!,
        locale: 'am',
        fallbackLocale: false,
        context: { keep: 'context' },
        req: { transactionID: tx },
      },
      p,
    )
    const { user, context, payloadDataLoader } = req
    try {
      const query = vi.spyOn(p, 'find')
      try {
        const all = await list({ req })
        expect(all.docs.find((r) => r.id === one.id)).toMatchObject({
          status: 'available',
          section: { title: null },
        })
        expect(query.mock.calls.map(([args]) => args.collection).sort()).toEqual([
          'passages',
          'publication-sections',
          'publications',
        ])
      } finally {
        query.mockRestore()
      }
      expect(await get(pub, { req, fallbackLocale: 'en' })).toMatchObject({
        section: { title: 'Public section' },
      })
      await save(start(), expected(one), { req })
      expect(req.user).toBe(user)
      expect(req.context).toBe(context)
      expect(req.context).toEqual({ keep: 'context' })
      expect(req.transactionID).toBe(tx)
      expect(req.payloadDataLoader).toBe(payloadDataLoader)
      expect(req.locale).toBe('am')
      expect(req.fallbackLocale).toBe(false)
    } finally {
      await p.db.rollbackTransaction(tx)
    }
    expect((await get(pub, opts))?.revision).toBe(1)
  })

  it('protects REST/GraphQL and enforces revision and generation on authenticated private routes', async () => {
    const reader = await account()
    const { token } = await createPayloadSessionForUser({ payload: p, user: reader })
    const http = (
      method: 'GET' | 'PUT' | 'DELETE' | 'PATCH',
      path: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) => {
      const url = 'reading-progress' + path
      return { GET, PUT, DELETE, PATCH }[method](
        new Request('http://localhost/api/' + url, {
          method,
          headers: {
            cookie: 'payload-token=' + token,
            'content-type': 'application/json',
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        { params: Promise.resolve({ slug: url.split('?')[0].split('/') }) },
      )
    }
    const path = '/mine/' + pub
    expect((await http('PUT', path, { section: leaf })).status).toBe(409)
    expect((await http('PUT', path, { section: leaf, ...first, user: admin.id })).status).toBe(400)
    expect((await http('PUT', path, { section: leaf, ...first, publication: second })).status).toBe(
      400,
    )
    expect(
      (
        await http(
          'PUT',
          path,
          { section: leaf, ...first },
          { origin: 'https://elsewhere.example' },
        )
      ).status,
    ).toBe(403)
    expect((await http('GET', path, undefined, { cookie: '' })).status).toBe(401)
    const created = await http('PUT', path, { section: leaf, ...first })
    expect(created.status).toBe(200)
    expect(created.headers.get('cache-control')).toBe('private, no-store')
    const row: MyReadingProgress = await created.json()
    expect((await http('PUT', path, { section: leaf, expectedRevision: 1 })).status).toBe(409)
    expect((await http('GET', '/mine?user=' + admin.id)).status).toBe(400)
    expect((await http('GET', '/' + row.id + '?depth=5&select[section]=true')).status).toBe(403)
    expect((await http('PATCH', '/' + row.id, { user: admin.id, revision: 5 })).status).toBe(403)
    await expect(
      p.find({ collection: 'reading-progress', user: admin, depth: 5 }),
    ).rejects.toMatchObject({ status: 403 })
    const graph = await graphql(
      new Request('http://localhost/api/graphql', {
        method: 'POST',
        headers: { cookie: 'payload-token=' + token, 'content-type': 'application/json' },
        body: JSON.stringify({
          query: '{ __schema { queryType { fields { name } } mutationType { fields { name } } } }',
        }),
      }),
    )
    const schema = (await graph.json()).data.__schema
    const fields = [...schema.queryType.fields, ...schema.mutationType.fields].map(
      (field) => field.name,
    )
    expect(fields).toContain('Publications')
    expect(fields.some((name) => /reading.?progress/i.test(name))).toBe(false)
    const deletePath = '/mine/' + row.id
    expect((await http('DELETE', deletePath, {})).status).toBe(409)
    expect((await http('DELETE', deletePath, { expectedRevision: 2 })).status).toBe(409)
    expect((await http('DELETE', deletePath, { expectedRevision: 1 })).status).toBe(204)
    expect(await (await http('GET', path)).json()).toBeNull()
  })

  it('propagates query failures and coordinates account deletion and rollback with saves', async () => {
    const u = await account(),
      req = await reqFor(u)
    const tx = await p.db.beginTransaction()
    if (!tx) throw new Error('Test transaction required')
    let row: MyReadingProgress
    try {
      row = await save(start(), first, {
        req: await createLocalReq({ user: req.user!, req: { transactionID: tx } }, p),
      })
      // The insert is invisible to the delete transaction, but already holds its account lock.
      await expect(p.delete({ collection: 'users', id: u.id })).rejects.toThrow()
      await p.db.commitTransaction(tx)
    } catch (e) {
      await p.db.rollbackTransaction(tx)
      throw e
    }
    const failure = new Error('Progress test database failure')
    const spy = vi.spyOn(p, 'find').mockRejectedValueOnce(failure)
    try {
      await expect(save(atPassage(), expected(row), { req })).rejects.toBe(failure)
    } finally {
      spy.mockRestore()
    }
    expect(await get(pub, { req })).toEqual(row)
    const undo = await p.db.beginTransaction()
    if (!undo) throw new Error('Test transaction required')
    try {
      await p.delete({
        collection: 'users',
        id: u.id,
        req: await createLocalReq({ req: { transactionID: undo } }, p),
      })
    } finally {
      await p.db.rollbackTransaction(undo)
    }
    expect(await get(pub, { req })).toEqual(row)
    await p.delete({ collection: 'users', id: u.id })
    users.delete(u.id)
    expect(await p.db.collections['reading-progress'].countDocuments({ user: u.id })).toBe(0)
  })
})
