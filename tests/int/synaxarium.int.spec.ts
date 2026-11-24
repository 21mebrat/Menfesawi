import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload, type RequiredDataFromCollectionSlug } from 'payload'

import config from '@/payload.config'
import type { User } from '@/payload-types'
import { GET, POST } from '@/app/(payload)/api/[...slug]/route'
import { POST as graphql } from '@/app/(payload)/api/graphql/route'
import { getBibleExamplePublicationData } from '@/lib/server/reading/examples'

type EntryData = RequiredDataFromCollectionSlug<'synaxarium'>

describe('Synaxarium', () => {
  let payload: Payload
  let admin: User
  let editor: User
  let member: User
  let inactive: User
  let memberToken: string
  let editorToken: string
  const password = randomUUID()
  const run = randomUUID()
  const users: string[] = []
  const entries: string[] = []
  const media: string[] = []
  const sections: string[] = []
  const passages: string[] = []
  const publications: string[] = []

  async function user(role: 'admin' | 'editor' | 'member', active = true) {
    const doc = await payload.create({
      collection: 'users',
      data: {
        role,
        isActive: active,
        name: 'Test user',
        email: `${randomUUID()}@example.test`,
        password,
      },
    })
    users.push(doc.id)
    return doc
  }

  function data(overrides: Partial<EntryData> = {}): EntryData {
    return {
      title: 'Test entry',
      slug: randomUUID(),
      ethiopianMonth: '1',
      ethiopianDay: 1,
      order: 0,
      _status: 'published',
      ...overrides,
    }
  }

  async function create(overrides: Partial<EntryData> = {}) {
    const doc = await payload.create({
      collection: 'synaxarium',
      data: data(overrides),
      overrideAccess: false,
      user: editor,
    })
    entries.push(doc.id)
    return doc
  }

  async function rest(id: string, token?: string) {
    const url = `http://localhost/api/synaxarium/${id}?draft=true&depth=3`
    return GET(new Request(url, { headers: token ? { Authorization: `JWT ${token}` } : {} }), {
      params: Promise.resolve({ slug: ['synaxarium', id] }),
    })
  }

  async function query(document: string, token?: string) {
    const response = await graphql(
      new Request('http://localhost/api/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `JWT ${token}` } : {}),
        },
        body: JSON.stringify({ query: document }),
      }),
    )
    expect(response.status).toBe(200)
    const result: unknown = await response.json()
    return result
  }

  beforeAll(async () => {
    payload = await getPayload({ config })
    admin = await user('admin')
    editor = await user('editor')
    member = await user('member')
    inactive = await user('admin', false)
    async function login(account: User) {
      const { token } = await payload.login({
        collection: 'users',
        data: { email: account.email, password },
      })
      if (!token) throw new Error('Expected an authenticated test session')
      return token
    }
    editorToken = await login(editor)
    memberToken = await login(member)
  })

  afterAll(async () => {
    for (const id of entries) await payload.delete({ collection: 'synaxarium', id })
    for (const id of passages) await payload.delete({ collection: 'passages', id })
    for (const id of sections.reverse())
      await payload.delete({ collection: 'publication-sections', id })
    for (const id of publications) await payload.delete({ collection: 'publications', id })
    for (const id of media)
      await payload.db.deleteOne({ collection: 'media', where: { id: { equals: id } } })
    for (const id of users) await payload.delete({ collection: 'users', id })
  })

  it('supports recurring day boundaries and orders multiple commemorations on one date', async () => {
    const later = await create({ ethiopianMonth: '13', ethiopianDay: 6, order: 5 })
    const first = await create({ ethiopianMonth: '13', ethiopianDay: 6 })
    await create({ ethiopianMonth: '12', ethiopianDay: 30 })
    const result = await payload.find({
      collection: 'synaxarium',
      overrideAccess: false,
      sort: 'order',
      where: {
        id: { in: [later.id, first.id] },
        ethiopianMonth: { equals: '13' },
        ethiopianDay: { equals: 6 },
      },
    })
    expect(result.docs.map(({ id }) => id)).toEqual([first.id, later.id])
  })

  it('rejects invalid recurring dates and order through the write API', async () => {
    for (const [field, value] of [
      ['ethiopianMonth', '0'],
      ['ethiopianMonth', '14'],
      ['ethiopianMonth', '1.5'],
      ['ethiopianMonth', 13],
      ['ethiopianDay', 0],
      ['ethiopianDay', -1],
      ['ethiopianDay', 1.5],
      ['ethiopianDay', 31],
      ['order', -1],
      ['order', 0.5],
    ] as const) {
      const response = await POST(
        new Request('http://localhost/api/synaxarium', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `JWT ${editorToken}` },
          body: JSON.stringify({ ...data(), [field]: value }),
        }),
        { params: Promise.resolve({ slug: ['synaxarium'] }) },
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        errors: [
          { data: { errors: expect.arrayContaining([expect.objectContaining({ path: field })]) } },
        ],
      })
    }
    await expect(create({ ethiopianMonth: '13', ethiopianDay: 7 })).rejects.toMatchObject({
      name: 'ValidationError',
    })
  })

  it('checks both sides of a partial date edit, including changes to a saved draft', async () => {
    const doc = await create({ ethiopianMonth: '12', ethiopianDay: 30 })
    const update = (patch: Partial<EntryData>, draft = false) =>
      payload.update({
        collection: 'synaxarium',
        id: doc.id,
        data: patch,
        draft,
        user: editor,
        overrideAccess: false,
      })
    await expect(update({ ethiopianMonth: '13' })).rejects.toMatchObject({
      name: 'ValidationError',
    })
    await update({ ethiopianMonth: '13', ethiopianDay: 6, _status: 'draft' }, true)
    await expect(update({ ethiopianDay: 7, _status: 'draft' }, true)).rejects.toMatchObject({
      name: 'ValidationError',
    })
    expect(
      await payload.findByID({ collection: 'synaxarium', id: doc.id, overrideAccess: false }),
    ).toMatchObject({
      ethiopianMonth: '12',
      ethiopianDay: 30,
    })
    await update({ _status: 'published' })
    expect(await update({ title: 'Edited' })).toMatchObject({
      ethiopianMonth: '13',
      ethiopianDay: 6,
    })
  })

  it('keeps a unique shared slug when titles and summaries change in either locale', async () => {
    const doc = await create({ summary: 'English summary' })
    await payload.update({
      collection: 'synaxarium',
      id: doc.id,
      locale: 'am',
      user: editor,
      data: { title: 'የሙከራ ርዕስ', summary: 'ማጠቃለያ', _status: 'published' },
    })
    expect(
      await payload.findByID({
        collection: 'synaxarium',
        id: doc.id,
        locale: 'am',
        fallbackLocale: false,
      }),
    ).toMatchObject({
      slug: doc.slug,
      title: 'የሙከራ ርዕስ',
      summary: 'ማጠቃለያ',
    })
    expect(
      await payload.findByID({ collection: 'synaxarium', id: doc.id, locale: 'en' }),
    ).toMatchObject({
      slug: doc.slug,
      title: doc.title,
      summary: 'English summary',
    })
    await expect(create({ slug: doc.slug })).rejects.toMatchObject({ name: 'ValidationError' })
    await expect(create({ slug: 'Invalid Slug' })).rejects.toMatchObject({
      name: 'ValidationError',
    })
  })

  it('serves only live published revisions to anonymous users and members, including draft requests', async () => {
    const live = await create({ title: 'Live title' })
    const hidden = await create({ title: 'Unpublished entry', _status: 'draft' })
    await payload.update({
      collection: 'synaxarium',
      id: live.id,
      user: editor,
      draft: true,
      data: { title: 'Unpublished revision', _status: 'draft' },
    })
    for (const [reader, token] of [
      [undefined, undefined],
      [member, memberToken],
    ] as const) {
      const list = await payload.find({
        collection: 'synaxarium',
        user: reader,
        overrideAccess: false,
        draft: true,
        where: { id: { in: [live.id, hidden.id] } },
        select: { title: true },
      })
      expect(list.docs).toEqual([{ id: live.id, title: 'Live title' }])
      const find = (id: string) =>
        payload.findByID({
          collection: 'synaxarium',
          id,
          user: reader,
          overrideAccess: false,
          draft: true,
        })
      expect(await find(live.id)).toMatchObject({ title: 'Live title' })
      await expect(find(hidden.id)).rejects.toMatchObject({ status: 404 })
      await expect(
        payload.findVersions({ collection: 'synaxarium', user: reader, overrideAccess: false }),
      ).rejects.toMatchObject({ status: 403 })
      const response = await rest(live.id, token)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ title: 'Live title' })
      expect((await rest(hidden.id, token)).status).toBe(404)
      expect(
        await query(
          `{ live: SynaxariumEntry(id: "${live.id}", draft: true) { title }
        hidden: SynaxariumEntry(id: "${hidden.id}", draft: true) { title } }`,
          token,
        ),
      ).toMatchObject({
        data: { live: { title: 'Live title' }, hidden: null },
      })
    }
    expect(
      await query(`{ SynaxariumEntry(id: "${live.id}", draft: true) { title } }`, editorToken),
    ).toEqual({
      data: { SynaxariumEntry: { title: 'Unpublished revision' } },
    })
  })

  it('restricts management to active staff and deletion to active admins', async () => {
    const doc = await create()
    for (const reader of [member, inactive]) {
      const options = { collection: 'synaxarium', user: reader, overrideAccess: false } as const
      await expect(payload.create({ ...options, data: data() })).rejects.toMatchObject({
        status: 403,
      })
      await expect(
        payload.update({ ...options, id: doc.id, data: { title: 'Rejected' } }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(payload.delete({ ...options, id: doc.id })).rejects.toMatchObject({
        status: 403,
      })
    }
    await expect(
      payload.delete({ collection: 'synaxarium', id: doc.id, user: editor, overrideAccess: false }),
    ).rejects.toMatchObject({ status: 403 })
    expect(
      await payload.delete({
        collection: 'synaxarium',
        id: doc.id,
        user: admin,
        overrideAccess: false,
      }),
    ).toMatchObject({ id: doc.id })
    entries.splice(entries.indexOf(doc.id), 1)
  })

  it('accepts content images and rejects avatar, missing image, and missing section IDs', async () => {
    // Only media metadata participates in relationship validation.
    for (const purpose of ['content', 'avatar'] as const) {
      const image = await payload.db.create({
        collection: 'media',
        data: { purpose, owner: editor.id, alt: 'Test image' },
      })
      media.push(image.id)
      if (purpose === 'content')
        expect(await create({ image: image.id })).toMatchObject({ image: { id: image.id } })
      else
        await expect(create({ image: image.id })).rejects.toMatchObject({ name: 'ValidationError' })
    }
    const missing = randomBytes(12).toString('hex')
    await expect(create({ image: missing })).rejects.toMatchObject({ name: 'ValidationError' })
    await expect(create({ readings: [{ section: missing }] })).rejects.toMatchObject({
      name: 'ValidationError',
    })
  })

  it('preserves reading order while enforcing live section, ancestor and publication visibility', async () => {
    const pub = await payload.create({
      collection: 'publications',
      user: editor,
      data: {
        ...getBibleExamplePublicationData(),
        slug: `reading-${run}`,
      },
    })
    publications.push(pub.id)
    async function section(slug: string, parent?: string) {
      const doc = await payload.create({
        collection: 'publication-sections',
        user: editor,
        data: {
          title: slug,
          slug,
          publication: pub.id,
          parent,
          typeKey: parent ? 'chapter' : 'book',
          order: 0,
          _status: 'published',
        },
      })
      sections.push(doc.id)
      return doc.id
    }
    const root = await section('root')
    const first = await section('first', root)
    const other = await section('other')
    const second = await section('second', other)
    const verse = await payload.create({
      collection: 'passages',
      user: editor,
      data: {
        section: second,
        text: { english: 'Test passage' },
        number: 1,
        order: 0,
        _status: 'published',
      },
    })
    passages.push(verse.id)
    const entry = await create({
      readings: [
        { label: 'Second reading', section: second },
        { label: 'First reading', section: first },
      ],
    })
    const read = async () => {
      const response = await rest(entry.id)
      expect(response.status).toBe(200)
      return response.json()
    }
    expect(await read()).toMatchObject({
      readings: [
        { label: 'Second reading', section: { id: second, title: 'second' } },
        { label: 'First reading', section: { id: first, title: 'first' } },
      ],
    })
    await payload.update({
      collection: 'publication-sections',
      id: first,
      draft: true,
      user: editor,
      data: { title: 'Private revision', _status: 'draft' },
    })
    await payload.update({
      collection: 'publication-sections',
      id: other,
      draft: false,
      user: editor,
      data: { _status: 'draft' },
    })
    expect(await read()).toMatchObject({
      readings: [{ section: second }, { section: { id: first, title: 'first' } }],
    })
    const gql = `{ entry: SynaxariumEntry(id: "${entry.id}", draft: true) { readings { section(draft: true) { title } } }
      passage: Passage(id: "${verse.id}", draft: true) { text { english } } }`
    expect(await query(gql, memberToken)).toMatchObject({
      data: {
        entry: { readings: [{ section: null }, { section: { title: 'first' } }] },
        passage: null,
      },
    })
    await payload.update({
      collection: 'publications',
      id: pub.id,
      user: editor,
      draft: false,
      data: { _status: 'draft' },
    })
    expect(await read()).toMatchObject({ readings: [{ section: second }, { section: first }] })
    expect(await query(gql)).toMatchObject({
      data: { entry: { readings: [{ section: null }, { section: null }] }, passage: null },
    })
  })
})
