import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload, type RequiredDataFromCollectionSlug } from 'payload'

import config from '@/payload.config'
import type { User } from '@/payload-types'
import { GET, POST } from '@/app/(payload)/api/[...slug]/route'
import { POST as graphql } from '@/app/(payload)/api/graphql/route'
import { getWudaseMaryamExamplePublicationData } from '@/lib/server/reading/examples'
import { getOrderedPassages } from '@/lib/server/reading/navigation'

type Entry = RequiredDataFromCollectionSlug<'daily-readings'>
const collection = 'daily-readings'
const invalid = (path: string) => ({
  name: 'ValidationError',
  data: { errors: expect.arrayContaining([expect.objectContaining({ path })]) },
})

describe('Daily readings', () => {
  let payload: Payload
  let editor: User
  let admin: User
  let member: User
  let inactive: User
  let editorToken: string
  let memberToken: string
  let publication: string
  let root: string
  let section: string
  let other: string
  const users: string[] = []
  const entries = new Set<string>()
  const passages: string[] = []
  const sections: string[] = []
  const commemorations: string[] = []
  const password = randomUUID()

  async function user(role: User['role'], isActive = true) {
    const doc = await payload.create({
      collection: 'users',
      data: {
        role,
        isActive,
        password,
        email: randomUUID() + '@example.test',
        name: 'Reading test',
      },
    })
    users.push(doc.id)
    return doc
  }
  async function login(account: User) {
    const { token } = await payload.login({
      collection: 'users',
      data: { email: account.email, password },
    })
    if (!token) throw new Error('Expected a test login')
    return token
  }
  async function makeSection(parent?: string, status: 'published' | 'draft' = 'published') {
    const slug = randomUUID()
    const doc = await payload.create({
      collection: 'publication-sections',
      user: editor,
      depth: 0,
      data: {
        title: slug,
        slug,
        publication,
        parent,
        typeKey: parent ? 'prayer' : 'day',
        order: 0,
        _status: status,
      },
    })
    sections.push(doc.id)
    return doc.id
  }
  async function passage(
    section: string,
    order: number,
    number?: number,
    status: 'published' | 'draft' = 'published',
    createdAt?: string,
  ) {
    const doc = await payload.create({
      collection: 'passages',
      user: editor,
      depth: 0,
      data: { section, order, number, createdAt, text: { english: randomUUID() }, _status: status },
    })
    passages.push(doc.id)
    return doc.id
  }
  async function commemorate(title: string, status: 'published' | 'draft' = 'published') {
    const doc = await payload.create({
      collection: 'synaxarium',
      user: editor,
      depth: 0,
      data: {
        title,
        slug: randomUUID(),
        order: 0,
        ethiopianMonth: '1',
        ethiopianDay: 1,
        _status: status,
      },
    })
    commemorations.push(doc.id)
    return doc.id
  }
  function data(patch: Partial<Entry> = {}): Entry {
    return {
      title: 'Live assignment',
      slug: randomUUID(),
      dateMode: 'recurring',
      ethiopianMonth: '1',
      ethiopianDay: 1,
      order: 0,
      readings: [{ label: 'Whole section', section }],
      _status: 'published',
      ...patch,
    }
  }
  async function create(patch: Partial<Entry> = {}, draft = false) {
    const doc = await payload.create({
      collection,
      data: data(patch),
      depth: 0,
      user: editor,
      overrideAccess: false,
      draft,
    })
    entries.add(doc.id)
    return doc
  }
  function edit(id: string, patch: Partial<Entry>, draft = false) {
    return payload.update({
      collection,
      id,
      data: patch,
      user: editor,
      overrideAccess: false,
      depth: 0,
      draft,
    })
  }
  async function rest(id: string, token?: string) {
    return GET(
      new Request(`http://localhost/api/${collection}/${id}?draft=true&depth=4`, {
        headers: token ? { Authorization: 'JWT ' + token } : {},
      }),
      { params: Promise.resolve({ slug: [collection, id] }) },
    )
  }
  async function query(document: string, token?: string) {
    const response = await graphql(
      new Request('http://localhost/api/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'JWT ' + token } : {}),
        },
        body: JSON.stringify({ query: document }),
      }),
    )
    expect(response.status).toBe(200)
    return response.json()
  }

  beforeAll(async () => {
    payload = await getPayload({ config })
    admin = await user('admin')
    editor = await user('editor')
    member = await user('member')
    inactive = await user('admin', false)
    memberToken = await login(member)
    editorToken = await login(editor)
    publication = (
      await payload.create({
        collection: 'publications',
        user: editor,
        data: { ...getWudaseMaryamExamplePublicationData(), slug: randomUUID() },
      })
    ).id
    root = await makeSection()
    section = await makeSection(root)
    other = await makeSection(root)
  })
  afterAll(async () => {
    for (const id of entries) await payload.delete({ collection, id })
    for (const id of commemorations) await payload.delete({ collection: 'synaxarium', id })
    for (const id of passages) await payload.delete({ collection: 'passages', id })
    for (const id of sections.reverse())
      await payload.delete({ collection: 'publication-sections', id })
    if (publication) await payload.delete({ collection: 'publications', id: publication })
    for (const id of users) await payload.delete({ collection: 'users', id })
  })

  it('allows multiple recurring and specific-year assignments and preserves editor-entered slugs', async () => {
    const date = { ethiopianMonth: '12', ethiopianDay: 30 } as const
    const annual = await create({ ...date, order: 2 })
    const second = await create({ ...date, order: 2 })
    const exact = await create({ ...date, dateMode: 'specific-year', ethiopianYear: 2016 })
    await create({ ...date, dateMode: 'specific-year', ethiopianYear: 2017 })
    const result = await payload.find({
      collection,
      depth: 0,
      overrideAccess: false,
      sort: ['order', 'id'],
      where: {
        ethiopianMonth: { equals: '12' },
        ethiopianDay: { equals: 30 },
        or: [
          { dateMode: { equals: 'recurring' } },
          { dateMode: { equals: 'specific-year' }, ethiopianYear: { equals: 2016 } },
        ],
      },
    })
    expect(result.docs.map((doc) => doc.id)).toEqual([exact.id, ...[annual.id, second.id].sort()])
    expect(await edit(annual.id, { title: 'Renamed' })).toMatchObject({ slug: annual.slug })
    await expect(create({ slug: annual.slug })).rejects.toMatchObject(invalid('slug'))
  })

  it('enforces Pagumen boundaries across a four-year cycle and validates the effective draft date', async () => {
    const date = { ethiopianMonth: '13', ethiopianDay: 6 } as const
    const annual = await create(date)
    for (const year of [2015, 2019])
      expect(
        await create({ ...date, dateMode: 'specific-year', ethiopianYear: year }),
      ).toMatchObject({ ethiopianYear: year })
    for (const year of [2014, 2016, 2017, 2018])
      await expect(
        create({ ...date, dateMode: 'specific-year', ethiopianYear: year }),
      ).rejects.toMatchObject(invalid('ethiopianDay'))
    await expect(edit(annual.id, { dateMode: 'specific-year' })).rejects.toMatchObject(
      invalid('ethiopianYear'),
    )
    await edit(
      annual.id,
      { dateMode: 'specific-year', ethiopianYear: 2015, _status: 'draft' },
      true,
    )
    await expect(edit(annual.id, { ethiopianYear: 2016 }, true)).rejects.toMatchObject(
      invalid('ethiopianDay'),
    )
    expect(await edit(annual.id, { _status: 'published' })).toMatchObject({
      dateMode: 'specific-year',
      ethiopianYear: 2015,
    })
    const recurring = await edit(annual.id, { dateMode: 'recurring' })
    expect(recurring.ethiopianYear ?? null).toBeNull()
    await expect(edit(annual.id, { dateMode: 'specific-year' })).rejects.toMatchObject(
      invalid('ethiopianYear'),
    )
    const normal = await create({ ethiopianDay: 30 })
    await expect(edit(normal.id, { ethiopianMonth: '13' })).rejects.toMatchObject(
      invalid('ethiopianDay'),
    )
    await edit(normal.id, {
      dateMode: 'specific-year',
      ethiopianYear: 2016,
      ethiopianMonth: '13',
      ethiopianDay: 5,
    })
    await expect(edit(normal.id, { ethiopianDay: 6 })).rejects.toMatchObject(
      invalid('ethiopianDay'),
    )
  })

  it('returns field-specific errors for invalid date modes, months, days, years, and orders', async () => {
    for (const [field, value] of [
      ['dateMode', 'unknown'],
      ['ethiopianMonth', '14'],
      ['ethiopianMonth', 1],
      ['ethiopianDay', 0],
      ['ethiopianDay', 31],
      ['ethiopianDay', 1.5],
      ['ethiopianYear', null],
      ['ethiopianYear', 0],
      ['ethiopianYear', -2],
      ['ethiopianYear', 2015.5],
      ['ethiopianYear', Number.MAX_SAFE_INTEGER + 1],
      ['order', -1],
      ['order', 0.5],
      ['order', Number.MAX_SAFE_INTEGER + 1],
    ] as const) {
      const response = await POST(
        new Request('http://localhost/api/daily-readings', {
          method: 'POST',
          headers: { Authorization: 'JWT ' + editorToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...data({ dateMode: 'specific-year', ethiopianYear: 2015 }),
            [field]: value,
          }),
        }),
        { params: Promise.resolve({ slug: [collection] }) },
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        errors: [
          { data: { errors: expect.arrayContaining([expect.objectContaining({ path: field })]) } },
        ],
      })
    }
    await expect(create({ ethiopianMonth: '13', ethiopianDay: 7 })).rejects.toMatchObject(
      invalid('ethiopianDay'),
    )
  })

  it('requires readings to publish, including status-only publication of an empty saved draft', async () => {
    await expect(create({ readings: [] })).rejects.toMatchObject(invalid('readings'))
    const doc = await create({ readings: [] }, true)
    await expect(edit(doc.id, { _status: 'published' })).rejects.toMatchObject(invalid('readings'))
    await expect(
      edit(doc.id, { readings: [{ label: '', section }], _status: 'published' }),
    ).rejects.toMatchObject(invalid('readings.0.label'))
    await edit(doc.id, { readings: [{ label: 'Reading', section }] }, true)
    expect(await edit(doc.id, { _status: 'published' })).toMatchObject({
      _status: 'published',
      readings: [{ label: 'Reading', section }],
    })
  })

  it('uses navigation order for ranges, preserves row and commemoration order, and validates both endpoints', async () => {
    const section = await makeSection(root)
    const one = await passage(section, 1, 90)
    const two = await passage(section, 1, 90)
    const last = await passage(section, 9)
    const foreign = await passage(other, 1)
    const ids = (await getOrderedPassages(payload, section)).docs.map((doc) => doc.id)
    expect(ids).toEqual([two, one, last])
    const firstSaint = await commemorate('First')
    const secondSaint = await commemorate('Second')
    const readings = [
      { label: 'Range', section, startPassage: two, endPassage: last },
      { label: 'Single', section, startPassage: one },
      { label: 'Whole', section: other },
      { label: 'Equal endpoints', section, startPassage: last, endPassage: last },
      { label: 'Tied order', section, startPassage: two, endPassage: one },
    ]
    const doc = await create({ readings, commemorations: [secondSaint, firstSaint] })
    expect(doc).toMatchObject({ readings, commemorations: [secondSaint, firstSaint] })
    const row = { label: 'Range', section }
    const missing = randomBytes(12).toString('hex')
    for (const [patch, field] of [
      [{ endPassage: last }, 'startPassage'],
      [{ startPassage: foreign }, 'startPassage'],
      [{ startPassage: one, endPassage: foreign }, 'endPassage'],
      [{ startPassage: one, endPassage: two }, 'endPassage'],
      [{ startPassage: last, endPassage: one }, 'endPassage'],
      [{ startPassage: missing }, 'startPassage'],
      [{ startPassage: one, endPassage: missing }, 'endPassage'],
      [{ section: missing }, 'section'],
    ] as const)
      await expect(edit(doc.id, { readings: [{ ...row, ...patch }] })).rejects.toMatchObject(
        invalid('readings.0.' + field),
      )
    await expect(edit(doc.id, { commemorations: [missing] })).rejects.toMatchObject(
      invalid('commemorations'),
    )
  })

  it('breaks equal order and timestamp ties by ID and rechecks partially edited rows', async () => {
    const section = await makeSection(root)
    const timestamp = '2024-01-01T00:00:00.000Z'
    const a = await passage(section, 1, undefined, 'published', timestamp)
    const b = await passage(section, 1, undefined, 'published', timestamp)
    const [first, second] = [a, b].sort()
    const ordered = await getOrderedPassages(payload, section)
    expect(ordered.docs.map(({ id, createdAt }) => [id, createdAt])).toEqual([
      [first, timestamp],
      [second, timestamp],
    ])
    const row = { label: 'Range', section, startPassage: first, endPassage: second }
    const doc = await create({ readings: [row] })
    const id = doc.readings?.[0].id
    expect(id).toBeTruthy()
    // Payload merges subfields of an existing array row using its ID.
    const updateRow = (patch: {
      endPassage?: string
      startPassage?: string | null
      section?: string
    }) =>
      payload.update({
        collection,
        id: doc.id,
        user: editor,
        overrideAccess: false,
        depth: 0,
        data: { readings: [{ id, ...patch }] },
      })
    await expect(updateRow({ section: other })).rejects.toMatchObject(
      invalid('readings.0.startPassage'),
    )
    await expect(updateRow({ startPassage: null })).rejects.toMatchObject(
      invalid('readings.0.startPassage'),
    )
    await expect(updateRow({ startPassage: second, endPassage: first })).rejects.toMatchObject(
      invalid('readings.0.endPassage'),
    )
    expect(await updateRow({ endPassage: first })).toMatchObject({
      readings: [{ ...row, endPassage: first }],
    })
  })

  it('revalidates the saved draft after a passage moves and preserves the original live assignment', async () => {
    const moving = await passage(other, 2)
    const doc = await create()
    const staged = [{ label: 'Staged reading', section: other, startPassage: moving }]
    expect(
      await edit(doc.id, { readings: staged, title: 'Staged', _status: 'draft' }, true),
    ).toMatchObject({ readings: staged })
    await payload.update({
      collection: 'passages',
      id: moving,
      user: editor,
      data: { section, _status: 'published' },
    })
    await expect(edit(doc.id, { _status: 'published' })).rejects.toMatchObject(
      invalid('readings.0.startPassage'),
    )
    expect(
      await payload.findByID({ collection, id: doc.id, overrideAccess: false, depth: 0 }),
    ).toMatchObject({ title: 'Live assignment', readings: [{ label: 'Whole section', section }] })
  })

  it('allows active staff to edit and only active admins to delete', async () => {
    const doc = await create()
    for (const account of [member, inactive]) {
      const options = { collection, user: account, overrideAccess: false } as const
      await expect(payload.create({ ...options, data: data() })).rejects.toMatchObject({
        status: 403,
      })
      await expect(
        payload.update({ ...options, id: doc.id, data: { title: 'Denied' } }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(payload.delete({ ...options, id: doc.id })).rejects.toMatchObject({
        status: 403,
      })
    }
    await expect(
      payload.delete({ collection, id: doc.id, user: editor, overrideAccess: false }),
    ).rejects.toMatchObject({ status: 403 })
    expect(
      await payload.delete({ collection, id: doc.id, user: admin, overrideAccess: false }),
    ).toMatchObject({ id: doc.id })
    entries.delete(doc.id)
  })

  it('serves only the live revision to anonymous users and members through Local API, REST, and GraphQL', async () => {
    const doc = await create()
    const hidden = await create({ title: 'Draft only' }, true)
    await edit(doc.id, { title: 'Private revision', _status: 'draft' }, true)
    const document = `{ live: DailyReading(id:"${doc.id}",draft:true){ title } hidden: DailyReading(id:"${hidden.id}",draft:true){title} }`
    for (const [reader, token] of [
      [null, undefined],
      [member, memberToken],
    ] as const) {
      const opts = {
        collection,
        overrideAccess: false,
        draft: true,
        user: reader,
        depth: 0,
      } as const
      expect(
        (await payload.find({ ...opts, where: { id: { in: [doc.id, hidden.id] } } })).docs,
      ).toMatchObject([{ id: doc.id, title: 'Live assignment' }])
      expect(await payload.findByID({ ...opts, id: doc.id })).toMatchObject({
        title: 'Live assignment',
      })
      await expect(payload.findByID({ ...opts, id: hidden.id })).rejects.toMatchObject({
        status: 404,
      })
      await expect(payload.findVersions(opts)).rejects.toMatchObject({ status: 403 })
      const response = await rest(doc.id, token)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ title: 'Live assignment' })
      expect((await rest(hidden.id, token)).status).toBe(404)
      expect(await query(document, token)).toMatchObject({
        data: { live: { title: 'Live assignment' }, hidden: null },
      })
    }
    expect(await query(document, editorToken)).toMatchObject({
      data: { live: { title: 'Private revision' }, hidden: { title: 'Draft only' } },
    })
  })

  it('allows editorial references to unpublished records and respects live visibility during population', async () => {
    const hiddenRoot = await makeSection(undefined, 'draft')
    const hiddenChild = await makeSection(hiddenRoot)
    const privatePassage = await passage(hiddenChild, 0)
    const draftPassage = await passage(section, 10, undefined, 'draft')
    const saint = await commemorate('Public commemoration')
    const hiddenSaint = await commemorate('Unpublished biography', 'draft')
    await payload.update({
      collection: 'synaxarium',
      id: saint,
      draft: true,
      data: { title: 'Private biography', _status: 'draft' },
    })
    const doc = await create(
      {
        readings: [
          { label: 'Hidden ancestor', section: hiddenChild, startPassage: privatePassage },
          { label: 'Draft passage', section, startPassage: draftPassage },
          { label: 'Draft section', section: hiddenRoot },
        ],
        commemorations: [saint, hiddenSaint],
      },
      true,
    )
    await edit(doc.id, { _status: 'published' })
    const gql = `{ DailyReading(id:"${doc.id}",draft:true){readings{section(draft:true){id} startPassage(draft:true){id}} commemorations(draft:true){title}} }`
    const response = await rest(doc.id)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      readings: [
        { section: hiddenChild, startPassage: privatePassage },
        { section: { id: section }, startPassage: draftPassage },
        { section: hiddenRoot },
      ],
      commemorations: [{ title: 'Public commemoration' }, hiddenSaint],
    })
    expect(await query(gql, memberToken)).toMatchObject({
      data: {
        DailyReading: {
          readings: [
            { section: null, startPassage: null },
            { section: { id: section }, startPassage: null },
            { section: null },
          ],
          commemorations: [{ title: 'Public commemoration' }],
        },
      },
    })
    await payload.update({
      collection: 'publications',
      id: publication,
      user: editor,
      draft: false,
      data: { _status: 'draft' },
    })
    expect(await query(gql)).toMatchObject({
      data: {
        DailyReading: { readings: [{ section: null }, { section: null }, { section: null }] },
      },
    })
  })
})
