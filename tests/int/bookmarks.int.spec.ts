import { randomUUID } from 'node:crypto'
import { Types } from 'mongoose'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'
import type { User } from '@/payload-types'
import { DELETE, GET, PATCH, POST } from '@/app/(payload)/api/[...slug]/route'
import { POST as graphql } from '@/app/(payload)/api/graphql/route'
import { createPayloadSessionForUser } from '@/lib/auth/session'
import {
  deleteMyBookmark,
  getMyBookmark,
  listMyBookmarks,
  saveBookmark,
  updateMyBookmarkNote,
} from '@/lib/server/bookmarks/service'
import {
  type BookmarkTarget,
  type BookmarkTargetType,
  targetTypes,
} from '@/lib/server/bookmarks/targets'
import { getWudaseMaryamExamplePublicationData } from '@/lib/server/reading/examples'

describe('Private bookmarks', () => {
  let p: Payload,
    owner: User,
    admin: User,
    other: User,
    ownerReq: PayloadRequest,
    staffReq: PayloadRequest
  let root: string, file: string
  const ids = new Map<BookmarkTargetType, string>()
  const users: string[] = []
  const saints: string[] = []
  const name = { title: 'English fixture', _status: 'published' } as const
  async function user(role: User['role']) {
    const row = await p.create({
      collection: 'users',
      data: {
        role,
        name: 'Fixture',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
        isActive: true,
      },
    })
    users.push(row.id)
    return row
  }
  const request = (u: User) => createLocalReq({ user: { ...u, collection: 'users' } }, p)
  const target = (type: BookmarkTargetType): BookmarkTarget => ({
    relationTo: type,
    value: ids.get(type)!,
  })
  async function saint(status: 'draft' | 'published' = 'published') {
    const doc = await p.create({
      collection: 'synaxarium',
      data: {
        ...name,
        slug: randomUUID(),
        _status: status,
        ethiopianMonth: '1',
        order: 0,
        ethiopianDay: 2,
      },
    })
    saints.push(doc.id)
    return { relationTo: 'synaxarium', value: doc.id } as const
  }
  beforeAll(async () => {
    p = await getPayload({ config })
    // Wait for first-start Payload indexes before writing transactional fixtures.
    await Promise.all(Object.values(p.db.collections).map((model) => model.init()))
    admin = await user('admin')
    owner = await user('member')
    other = await user('member')
    ownerReq = await request(owner)
    staffReq = await request(admin)
    file = (
      await p.create({
        collection: 'files',
        data: {
          originalFilename: 'fixture.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10,
          isAvailable: true,
          ingestionStatus: 'ready',
          telegram: { fileId: 'private_fixture', messageId: 104, fileUniqueId: 'private_unique' },
        },
      })
    ).id
    ids.set(
      'books',
      (
        await p.create({
          collection: 'books',
          data: { ...name, slug: randomUUID(), language: ['am'], file },
        })
      ).id,
    )
    ids.set(
      'teachings',
      (
        await p.create({
          collection: 'teachings',
          data: {
            ...name,
            slug: randomUUID(),
            content: {
              root: {
                type: 'root',
                direction: 'ltr',
                format: '',
                indent: 0,
                version: 1,
                children: [
                  {
                    type: 'paragraph',
                    version: 1,
                    children: [{ type: 'text', version: 1, text: 'Fixture' }],
                  },
                ],
              },
            },
          },
        })
      ).id,
    )
    ids.set(
      'hymns',
      (
        await p.create({
          collection: 'hymns',
          data: { ...name, slug: randomUUID(), kind: 'general', lyrics: { english: 'Fixture' } },
        })
      ).id,
    )
    ids.set(
      'publications',
      (
        await p.create({
          collection: 'publications',
          user: admin,
          data: { ...getWudaseMaryamExamplePublicationData(), slug: randomUUID() },
        })
      ).id,
    )
    async function section(parent?: string) {
      return (
        await p.create({
          collection: 'publication-sections',
          user: admin,
          depth: 0,
          data: {
            ...name,
            slug: randomUUID(),
            publication: target('publications').value,
            order: 0,
            parent,
            typeKey: parent ? 'prayer' : 'day',
          },
        })
      ).id
    }
    root = await section()
    ids.set('publication-sections', await section(root))
    ids.set(
      'passages',
      (
        await p.create({
          collection: 'passages',
          user: admin,
          depth: 0,
          data: {
            section: target('publication-sections').value,
            order: 0,
            _status: 'published',
            text: { english: 'A'.repeat(200) },
            notes: [{ content: 'editorial-secret-fixture', visibility: 'editorial' }],
          },
        })
      ).id,
    )
    ids.set('synaxarium', (await saint()).value)
    ids.set(
      'daily-readings',
      (
        await p.create({
          collection: 'daily-readings',
          data: {
            ...name,
            slug: randomUUID(),
            dateMode: 'recurring',
            ethiopianMonth: '1',
            order: 0,
            ethiopianDay: 1,
            readings: [{ label: 'Reading', section: target('publication-sections').value }],
          },
        })
      ).id,
    )
  }, 120000)
  afterAll(async () => {
    if (!p) return
    for (const type of [
      'daily-readings',
      'passages',
      'publication-sections',
      'publications',
      'books',
      'hymns',
      'teachings',
    ] as const) {
      if (ids.has(type)) await p.delete({ collection: type, id: ids.get(type)!, user: admin })
      if (type === 'publication-sections' && root)
        await p.delete({ collection: type, id: root, user: admin })
    }
    for (const id of saints) await p.delete({ collection: 'synaxarium', id })
    if (file) await p.delete({ collection: 'files', id: file })
    for (const id of users) await p.delete({ collection: 'users', id })
  })

  it('saves every supported type and returns only public navigation fields', async () => {
    for (const type of targetTypes) {
      const saved = await saveBookmark(target(type), { req: staffReq, note: 'Staff private note' })
      expect(saved).toMatchObject({
        targetType: type,
        status: 'available',
        content: { id: target(type).value },
      })
      if (type === 'passages')
        expect(saved.content).toMatchObject({
          sectionId: target('publication-sections').value,
          excerpt: 'A'.repeat(160),
        })
    }
    const list = await listMyBookmarks({ req: staffReq })
    expect(list.docs).toHaveLength(8)
    expect(JSON.stringify(list)).not.toMatch(
      /editorial-secret-fixture|private_fixture|private_unique|originalFilename|telegram|@example|"_status"|"user":/,
    )
  })

  it('enforces the BSON unique index and preserves the first note on concurrent saves', async () => {
    const t = await saint()
    const [a, b] = await Promise.all([
      saveBookmark(t, { req: ownerReq, note: 'First caller' }),
      saveBookmark(t, { req: ownerReq, note: 'Second caller' }),
    ])
    expect(a).toEqual(b)
    expect(['First caller', 'Second caller']).toContain(a.note)
    expect(await saveBookmark(t, { req: ownerReq, note: 'Overwrite' })).toEqual(a)
    const model = p.db.collections.bookmarks
    const raw = await model.collection.findOne({ _id: new Types.ObjectId(a.id) })
    expect(raw?.target.value.toHexString()).toBe(t.value)
    expect(raw?.user.toHexString()).toBe(owner.id)
    const indexes = await model.collection.indexes()
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { user: 1, 'target.relationTo': 1, 'target.value': 1 },
          unique: true,
        }),
        expect.objectContaining({ key: { user: 1, createdAt: -1, _id: -1 } }),
      ]),
    )
    await expect(
      model.collection.insertOne({ user: raw!.user, target: raw!.target }),
    ).rejects.toMatchObject({ code: 11000 })
    expect((await saveBookmark(t, { req: staffReq })).id).not.toBe(a.id)
  })

  it('keeps bookmarks private across accounts including staff, and denies anonymous or stale inactive identities', async () => {
    const t = await saint()
    const row = await saveBookmark(t, { req: ownerReq, note: 'owner-only text' })
    const spoofed = { req: ownerReq, user: admin.id }
    await expect(saveBookmark(t, spoofed)).rejects.toMatchObject({ status: 400 })
    const retargeted = { req: ownerReq, target: target('books') }
    await expect(updateMyBookmarkNote(row.id, 'changed', retargeted)).rejects.toMatchObject({
      status: 400,
    })
    const viewer = await request(other)
    for (const req of [viewer, staffReq]) {
      expect(JSON.stringify(await listMyBookmarks({ req }))).not.toContain('owner-only text')
      await expect(getMyBookmark(row.id, { req })).rejects.toMatchObject({ status: 404 })
      await expect(updateMyBookmarkNote(row.id, 'changed', { req })).rejects.toMatchObject({
        status: 404,
      })
      await expect(deleteMyBookmark(row.id, { req })).rejects.toMatchObject({ status: 404 })
    }
    for (const note of ['😀'.repeat(1001), 'A'.repeat(2001)])
      await expect(updateMyBookmarkNote(row.id, note, { req: ownerReq })).rejects.toMatchObject({
        status: 400,
      })
    expect((await updateMyBookmarkNote(row.id, '<i>plain</i>', { req: ownerReq })).note).toBe(
      '<i>plain</i>',
    )
    const anon = await createLocalReq({}, p)
    await expect(listMyBookmarks({ req: anon })).rejects.toMatchObject({ status: 401 })
    await p.update({ collection: 'users', id: other.id, data: { isActive: false } })
    try {
      for (const op of [
        () => listMyBookmarks({ req: viewer }),
        () => saveBookmark(t, { req: viewer }),
        () => updateMyBookmarkNote(row.id, 'x', { req: viewer }),
        () => deleteMyBookmark(row.id, { req: viewer }),
      ])
        await expect(op()).rejects.toMatchObject({ status: 403 })
    } finally {
      await p.update({ collection: 'users', id: other.id, data: { isActive: true } })
    }
  })

  it('uses live anonymous visibility for staff, including saved drafts, ancestors and publications', async () => {
    const hidden = await saint('draft')
    await expect(saveBookmark(hidden, { req: staffReq })).rejects.toMatchObject({ status: 404 })
    await expect(
      saveBookmark(
        { relationTo: 'books', value: new Types.ObjectId().toString() },
        { req: staffReq },
      ),
    ).rejects.toMatchObject({ status: 404 })
    const t = await saint()
    await p.update({
      collection: 'synaxarium',
      id: t.value,
      draft: true,
      data: { title: 'Private revision', _status: 'draft' },
    })
    expect((await saveBookmark(t, { req: staffReq })).content?.title).toBe(name.title)
    const leaves = [target('publication-sections'), target('passages')]
    for (const leaf of leaves) await saveBookmark(leaf, { req: staffReq })
    for (const [collection, id] of [
      ['publication-sections', root],
      ['publications', target('publications').value],
    ] as const) {
      await p.update({ collection, id, user: admin, data: { _status: 'draft' } })
      try {
        for (const leaf of leaves) {
          await expect(saveBookmark(leaf, { req: staffReq })).rejects.toMatchObject({ status: 404 })
          expect(
            (await listMyBookmarks({ req: staffReq, targetType: leaf.relationTo })).docs[0],
          ).toMatchObject({ status: 'unavailable', content: null })
        }
      } finally {
        await p.update({ collection, id, user: admin, data: { _status: 'published' } })
      }
      for (const leaf of leaves)
        expect((await saveBookmark(leaf, { req: staffReq })).status).toBe('available')
    }
  })

  it('retains unavailable bookmarks and allows note edits, restoration and deletion', async () => {
    const t = await saint()
    const row = await saveBookmark(t, { req: ownerReq, note: 'My note' })
    await p.update({
      collection: 'synaxarium',
      id: t.value,
      data: { title: 'Hidden title', _status: 'draft' },
    })
    const hidden = await getMyBookmark(row.id, { req: ownerReq })
    expect(hidden).toEqual({ ...row, content: null, status: 'unavailable' })
    expect(JSON.stringify(hidden)).not.toContain(t.value)
    expect((await updateMyBookmarkNote(row.id, 'New note', { req: ownerReq })).note).toBe(
      'New note',
    )
    await p.update({ collection: 'synaxarium', id: t.value, data: { _status: 'published' } })
    expect((await getMyBookmark(row.id, { req: ownerReq })).content?.title).toBe('Hidden title')
    await p.delete({ collection: 'synaxarium', id: t.value })
    saints.splice(saints.indexOf(t.value), 1)
    expect((await updateMyBookmarkNote(row.id, null, { req: ownerReq })).status).toBe('unavailable')
    await deleteMyBookmark(row.id, { req: ownerReq })
    await expect(getMyBookmark(row.id, { req: ownerReq })).rejects.toMatchObject({ status: 404 })
  })

  it('batches filtered pages, breaks date ties by ID and preserves locale, session and caller state', async () => {
    const viewer = await request(other)
    const rows = []
    for (let i = 0; i < 4; i++) rows.push(await saveBookmark(await saint(), { req: viewer }))
    await saveBookmark(target('hymns'), { req: viewer })
    await p.db.collections.bookmarks.collection.updateMany(
      { user: new Types.ObjectId(other.id) },
      { $set: { createdAt: new Date(0) } },
    )
    const ordered = rows
      .map((r) => r.id)
      .sort()
      .reverse()
    const query = vi.spyOn(p, 'find')
    try {
      const first = await listMyBookmarks({ req: viewer, targetType: 'synaxarium', limit: 2 })
      expect(first.docs.map((r) => r.id)).toEqual(ordered.slice(0, 2))
      expect(first.hasNextPage).toBe(true)
      expect(query.mock.calls.filter(([args]) => args.collection === 'synaxarium')).toHaveLength(1)
      const second = await listMyBookmarks({
        req: viewer,
        targetType: 'synaxarium',
        limit: 2,
        page: 2,
      })
      expect(second.docs.map((r) => r.id)).toEqual(ordered.slice(2))
      expect(second.hasNextPage).toBe(false)
    } finally {
      query.mockRestore()
    }
    for (const invalid of [{ limit: 0 }, { limit: 101 }, { page: 1.5 }, { page: 0 }])
      await expect(listMyBookmarks({ req: viewer, ...invalid })).rejects.toMatchObject({
        status: 400,
      })
    const transactionID = await p.db.beginTransaction()
    if (!transactionID) throw new Error('Test transaction required')
    const req = await createLocalReq(
      {
        user: { ...other, collection: 'users' },
        locale: 'am',
        fallbackLocale: false,
        context: { sentinel: 'keep' },
        req: { transactionID },
      },
      p,
    )
    const { payloadDataLoader, context, user: identity } = req
    try {
      const a = await saveBookmark(target('books'), { req })
      expect(a.content?.title).toBeNull()
      expect(
        (await getMyBookmark(a.id, { req, locale: 'am', fallbackLocale: 'en' })).content?.title,
      ).toBe(name.title)
      expect(req.user).toBe(identity)
      expect(req.context).toBe(context)
      expect(req.context).toEqual({ sentinel: 'keep' })
      expect(req.payloadDataLoader).toBe(payloadDataLoader)
      expect(req.transactionID).toBe(transactionID)
      expect(req.locale).toBe('am')
      expect(req.fallbackLocale).toBe(false)
    } finally {
      await p.db.rollbackTransaction(transactionID)
    }
    expect((await listMyBookmarks({ req: viewer, targetType: 'books' })).docs).toEqual([])
  })

  it('serves only owner DTOs through REST and closes generic population, mutations and GraphQL', async () => {
    const tokens = await Promise.all(
      [owner, admin].map(
        async (u) => (await createPayloadSessionForUser({ payload: p, user: u })).token,
      ),
    )
    const http = (
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      suffix: string,
      token?: string,
      data?: unknown,
      extra?: Record<string, string>,
    ) => {
      const path = 'bookmarks' + suffix
      const req = new Request('http://localhost/api/' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token && { cookie: 'payload-token=' + token }),
          ...extra,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      })
      return { GET, POST, PATCH, DELETE }[method](req, {
        params: Promise.resolve({ slug: path.split('?')[0].split('/') }),
      })
    }
    const t = await saint()
    expect((await http('GET', '/mine')).status).toBe(401)
    expect((await http('POST', '/mine', tokens[0], { target: t, user: admin.id })).status).toBe(400)
    for (const bad of [
      { relationTo: 'files', value: file },
      { relationTo: 'media', value: file },
      { relationTo: 'books', value: 'bad' },
    ]) {
      expect((await http('POST', '/mine', tokens[0], { target: bad })).status).toBe(400)
    }
    expect(
      (
        await http(
          'POST',
          '/mine',
          tokens[0],
          { target: t },
          { origin: 'https://elsewhere.example' },
        )
      ).status,
    ).toBe(403)
    const response = await http('POST', '/mine', tokens[0], {
      target: t,
      note: 'Private HTTP note',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const row = await response.json()
    const path = '/mine/' + row.id
    for (const data of [
      { target: target('books') },
      { user: admin.id },
      { id: new Types.ObjectId().toHexString() },
    ]) {
      expect((await http('PATCH', path, tokens[0], data)).status).toBe(400)
    }
    expect((await http('GET', path, tokens[1])).status).toBe(404)
    expect((await http('DELETE', path, tokens[1])).status).toBe(404)
    expect((await http('PATCH', path, tokens[1], { note: 'spoof' })).status).toBe(404)
    expect((await http('PATCH', path, tokens[0], { note: 'Edited HTTP note' })).status).toBe(200)
    await p.update({
      collection: 'synaxarium',
      id: t.value,
      data: { _status: 'draft', title: 'Hidden HTTP title' },
    })
    const projected = await http('GET', path + '?depth=5&select[target]=true&draft=true', tokens[0])
    expect(await projected.json()).toEqual({
      ...row,
      note: 'Edited HTTP note',
      status: 'unavailable',
      content: null,
    })
    for (const token of tokens) {
      for (const [method, suffix, data] of [
        ['GET', '/' + row.id + '?depth=8&select[target]=true', undefined],
        ['POST', '', { target: t, user: owner.id }],
        ['PATCH', '/' + row.id, { user: admin.id }],
      ] as const) {
        expect((await http(method, suffix, token, data)).status).toBe(403)
      }
      const graph = await graphql(
        new Request('http://localhost/api/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: 'payload-token=' + token },
          body: JSON.stringify({
            query: '{ Bookmarks { docs { id note target { relationTo } } } }',
          }),
        }),
      )
      const json = await graph.json()
      expect(json.errors?.length).toBeGreaterThan(0)
      expect(JSON.stringify(json)).not.toMatch(/Edited HTTP note|Hidden HTTP title/)
      expect(json.data?.Bookmarks).toBeFalsy()
    }
    expect((await http('DELETE', path, tokens[0])).status).toBe(204)
    await expect(p.find({ collection: 'bookmarks', user: admin, depth: 5 })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('propagates unexpected target failures and removes personal notes only on successful account deletion', async () => {
    const transient = await user('member'),
      req = await request(transient)
    const row = await saveBookmark(target('books'), { req, note: 'Erase with account' })
    const err = new Error('Simulated query failure')
    const spy = vi.spyOn(p, 'find').mockRejectedValueOnce(err)
    try {
      await expect(listMyBookmarks({ req })).rejects.toBe(err)
    } finally {
      spy.mockRestore()
    }
    const tx = await p.db.beginTransaction()
    if (!tx) throw new Error('Test transaction required')
    try {
      await p.delete({
        collection: 'users',
        id: transient.id,
        req: await createLocalReq({ req: { transactionID: tx } }, p),
      })
    } finally {
      await p.db.rollbackTransaction(tx)
    }
    expect((await getMyBookmark(row.id, { req })).note).toBe('Erase with account')
    await p.delete({ collection: 'users', id: transient.id })
    users.splice(users.indexOf(transient.id), 1)
    expect(await p.db.collections.bookmarks.countDocuments({ user: transient.id })).toBe(0)
    await expect(listMyBookmarks({ req })).rejects.toMatchObject({ status: 403 })
  })
})
