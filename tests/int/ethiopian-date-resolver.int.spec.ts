import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createLocalReq,
  getPayload,
  type Payload,
  type PayloadRequest,
  type RequiredDataFromCollectionSlug,
} from 'payload'

import config from '@/payload.config'
import type { User } from '@/payload-types'
import { getWudaseMaryamExamplePublicationData } from '@/lib/server/reading/examples'
import { resolvePublicEthiopianDate } from '@/lib/server/reading/resolvePublicEthiopianDate'

type Entry = RequiredDataFromCollectionSlug<'daily-readings'>
const date = (day: number) => ({ year: 2015, month: 11, day })
const unavailable = (label: string) => ({ label, status: 'unavailable' })

describe('Public Ethiopian date resolver', () => {
  let payload: Payload
  let admin: User
  let editor: User
  let publication: string
  let root: string
  let section: string
  const assignments: string[] = []
  const saints: string[] = []
  const passages = new Set<string>()
  const sections: string[] = []
  const publications: string[] = []
  const users: string[] = []

  async function makePublication() {
    const { id } = await payload.create({
      collection: 'publications',
      user: admin,
      data: { ...getWudaseMaryamExamplePublicationData(), slug: randomUUID() },
    })
    publications.push(id)
    return id
  }
  async function makeSection(parent?: string, pub = publication) {
    const { id } = await payload.create({
      collection: 'publication-sections',
      user: admin,
      depth: 0,
      data: {
        title: 'Section title',
        slug: randomUUID(),
        parent,
        publication: pub,
        typeKey: parent ? 'prayer' : 'day',
        order: 0,
        _status: 'published',
      },
    })
    sections.push(id)
    return id
  }
  async function passage(
    section: string,
    order: number,
    patch: Partial<RequiredDataFromCollectionSlug<'passages'>> = {},
  ) {
    const { id } = await payload.create({
      collection: 'passages',
      user: admin,
      depth: 0,
      data: { section, order, text: { english: randomUUID() }, _status: 'published', ...patch },
    })
    passages.add(id)
    return id
  }
  async function assign(day: number, patch: Partial<Entry> = {}, req?: PayloadRequest) {
    const doc = await payload.create({
      collection: 'daily-readings',
      user: admin,
      req,
      depth: 0,
      data: {
        title: 'Live assignment',
        slug: randomUUID(),
        ethiopianMonth: '11',
        ethiopianDay: day,
        order: 0,
        dateMode: 'recurring',
        readings: [{ label: 'Reading', section }],
        _status: 'published',
        ...patch,
      },
    })
    if (!req?.transactionID) assignments.push(doc.id)
    return doc
  }
  async function saint(day: number, order = 0, status: 'published' | 'draft' = 'published') {
    const doc = await payload.create({
      collection: 'synaxarium',
      user: admin,
      data: {
        title: 'Commemoration',
        summary: 'Public summary',
        slug: randomUUID(),
        ethiopianMonth: '11',
        ethiopianDay: day,
        order,
        _status: status,
      },
    })
    saints.push(doc.id)
    return doc
  }
  beforeAll(async () => {
    payload = await getPayload({ config })
    async function user(role: 'admin' | 'editor') {
      const doc = await payload.create({
        collection: 'users',
        data: {
          name: 'Resolver fixture',
          role,
          isActive: true,
          email: randomUUID() + '@example.test',
          password: randomUUID(),
        },
      })
      users.push(doc.id)
      return doc
    }
    admin = await user('admin')
    editor = await user('editor')
    publication = await makePublication()
    root = await makeSection()
    section = await makeSection(root)
  })
  afterAll(async () => {
    for (const id of assignments) await payload.delete({ collection: 'daily-readings', id })
    for (const id of saints) await payload.delete({ collection: 'synaxarium', id })
    for (const id of passages) await payload.delete({ collection: 'passages', id })
    for (const id of sections.reverse())
      await payload.delete({ collection: 'publication-sections', id })
    for (const id of publications) await payload.delete({ collection: 'publications', id })
    for (const id of users) await payload.delete({ collection: 'users', id })
  })

  it('rejects invalid dates before querying and resolves Pagumen 6 only in leap years', async () => {
    const find = vi.spyOn(payload, 'find')
    try {
      for (const invalid of [
        { year: 0 },
        { year: -1 },
        { year: 1.5 },
        { year: Number.MAX_SAFE_INTEGER + 1 },
        { month: 0 },
        { month: 14 },
        { month: 3.5 },
        { day: 0 },
        { day: 31 },
        { day: 1.5 },
        { month: 13, day: 7 },
        ...[2014, 2016, 2017, 2018].map((year) => ({ year, month: 13, day: 6 })),
      ])
        await expect(
          resolvePublicEthiopianDate(payload, { ...date(1), ...invalid }),
        ).rejects.toThrow(RangeError)
      expect(find).not.toHaveBeenCalled()
    } finally {
      find.mockRestore()
    }
    const entry = await assign(6, { ethiopianMonth: '13' })
    for (const year of [2015, 2019]) {
      const result = await resolvePublicEthiopianDate(payload, { year, month: 13, day: 6 })
      expect(result.readingSets.map((doc) => doc.id)).toContain(entry.id)
    }
    const last = { year: 2016, month: 13, day: 5 }
    expect((await resolvePublicEthiopianDate(payload, last)).date).toEqual(last)
  })

  it('pages through both assignment modes and independent commemorations in stable order', async () => {
    const a = await saint(2, 1)
    const b = await saint(2, 1)
    const c = await saint(2)
    const otherDate = await saint(3)
    const hidden = await saint(2, 0, 'draft')
    const first = await assign(2, {
      dateMode: 'specific-year',
      ethiopianYear: 2015,
      commemorations: [otherDate.id, b.id, hidden.id],
    })
    const second = await assign(2, { order: 1 })
    const third = await assign(2, { order: 1 })
    await assign(2, { dateMode: 'specific-year', ethiopianYear: 2016 })
    await assign(2, { _status: 'draft' })
    await assign(3)
    const result = await resolvePublicEthiopianDate(payload, date(2), { pageSize: 1 })
    expect(result.date).toEqual(date(2))
    expect(result.readingSets.map((doc) => doc.id)).toEqual([
      first.id,
      ...[second.id, third.id].sort(),
    ])
    expect(result.commemorations.map((doc) => doc.id)).toEqual([c.id, ...[a.id, b.id].sort()])
    expect(result.readingSets[0].commemorations.map((doc) => doc.id)).toEqual([otherDate.id, b.id])
    expect(result.readingSets[1].commemorations).toEqual([])
  })

  it('resolves whole, single and inclusive readings using passage order across page boundaries', async () => {
    const child = await makeSection(root)
    const empty = await makeSection(root)
    const text = { geez: 'ግዕዝ', amharic: 'አማርኛ', english: '  English\ntext' }
    const old = '2022-01-01T00:00:00.000Z'
    const a = await passage(child, 3, {
      number: 90,
      createdAt: old,
      text,
      notes: [{ content: 'Editorial note sentinel', visibility: 'editorial' }],
    })
    const b = await passage(child, 3, { number: 90, createdAt: old })
    const [tiedFirst, tiedLast] = [a, b].sort()
    const newest = await passage(child, 3, { createdAt: '2023-01-01T00:00:00.000Z' })
    const final = await passage(child, 5)
    await passage(child, 4, { _status: 'draft', text: { english: 'Hidden interior passage' } })
    const rows = [
      { label: 'Whole', section: child },
      { label: 'Range', section: child, startPassage: newest, endPassage: tiedLast },
      { label: 'Single', section: child, startPassage: a },
      { label: 'Empty section', section: empty },
      { label: 'Root', section: root },
    ]
    await assign(4, { readings: rows })
    const result = await resolvePublicEthiopianDate(payload, date(4), { pageSize: 1 })
    const output = result.readingSets[0].readings
    expect(output.map((r) => r.label)).toEqual(rows.map((r) => r.label))
    expect(
      output.map((r) => (r.status === 'available' ? r.passages.map((p) => p.id) : r.status)),
    ).toEqual([[newest, tiedFirst, tiedLast, final], [newest, tiedFirst, tiedLast], [a], [], []])
    expect(output[2]).toMatchObject({ section: { id: child }, passages: [{ number: 90, text }] })
    expect(JSON.stringify(result)).not.toMatch(
      /Editorial note sentinel|Hidden interior passage|"notes"/,
    )
  })

  it('keeps broken rows unavailable when endpoints move, reverse, disappear or become private', async () => {
    const from = await makeSection(root)
    const target = await makeSection(root)
    const start = await passage(from, 1)
    const end = await passage(from, 2)
    const moved = await passage(from, 3)
    const removed = await passage(from, 4)
    const hidden = await passage(from, 5)
    const keep = await passage(from, 6)
    const rows = [
      { label: 'Reordered', section: from, startPassage: start, endPassage: end },
      { label: 'Moved end', section: from, startPassage: start, endPassage: moved },
      { label: 'Deleted start', section: from, startPassage: removed },
      { label: 'Private start', section: from, startPassage: hidden },
      { label: 'Still available', section: from, startPassage: keep },
    ]
    await assign(5, { readings: rows })
    await payload.update({ collection: 'passages', id: end, user: admin, data: { order: 0 } })
    await payload.update({
      collection: 'passages',
      id: moved,
      user: admin,
      data: { section: target },
    })
    await payload.delete({ collection: 'passages', id: removed })
    passages.delete(removed)
    await payload.update({
      collection: 'passages',
      id: hidden,
      user: admin,
      draft: false,
      data: { _status: 'draft' },
    })
    const result = await resolvePublicEthiopianDate(payload, date(5), { pageSize: 2 })
    const output = result.readingSets[0].readings
    expect(output.slice(0, 4)).toEqual(rows.slice(0, 4).map((r) => unavailable(r.label)))
    expect(output[4]).toMatchObject({ status: 'available', passages: [{ id: keep }] })
    for (const id of [moved, removed, hidden, start, end, target])
      expect(JSON.stringify(result)).not.toContain(id)
  })

  it('uses only live public revisions even for staff and leaves their request untouched', async () => {
    const pub = await makePublication()
    const ancestor = await makeSection(undefined, pub)
    const leaf = await makeSection(ancestor, pub)
    const id = await passage(leaf, 1, {
      text: { english: 'Live text' },
      notes: [{ visibility: 'editorial', content: 'SECRET NOTE FIXTURE' }],
    })
    const visible = await saint(6)
    const privateSaint = await saint(6, 0, 'draft')
    const doc = await assign(6, {
      title: 'Live title',
      readings: [{ section: leaf, label: 'Live label', startPassage: id }],
      commemorations: [privateSaint.id, visible.id],
    })
    const privateSet = await assign(6, { _status: 'draft' })
    await payload.update({
      collection: 'daily-readings',
      id: doc.id,
      draft: true,
      user: admin,
      data: { _status: 'draft', title: 'DRAFT ASSIGNMENT' },
    })
    await payload.update({
      collection: 'synaxarium',
      id: visible.id,
      draft: true,
      user: admin,
      data: { _status: 'draft', title: 'DRAFT BIOGRAPHY' },
    })
    await payload.update({
      collection: 'publication-sections',
      id: leaf,
      draft: true,
      user: admin,
      data: { _status: 'draft', title: 'DRAFT SECTION' },
    })
    await payload.update({
      collection: 'passages',
      id,
      draft: true,
      user: admin,
      data: { _status: 'draft', text: { english: 'DRAFT TEXT' } },
    })
    const anon = await resolvePublicEthiopianDate(payload, date(6))
    expect(anon.readingSets).toMatchObject([
      {
        id: doc.id,
        title: 'Live title',
        commemorations: [{ id: visible.id }],
        readings: [
          {
            label: 'Live label',
            status: 'available',
            section: { title: 'Section title' },
            passages: [{ text: { english: 'Live text' } }],
          },
        ],
      },
    ])
    expect(anon.commemorations).toMatchObject([{ id: visible.id, title: 'Commemoration' }])
    const serialized = JSON.stringify(anon)
    for (const value of [privateSet.id, privateSaint.id, 'DRAFT', 'SECRET NOTE FIXTURE', '"notes"'])
      expect(serialized).not.toContain(value)
    for (const user of [admin, editor]) {
      const req = await createLocalReq(
        { user, context: { isDraftOperation: true }, locale: 'en', fallbackLocale: false },
        payload,
      )
      req.query = { draft: true, depth: 4 }
      const { context, query, user: identity, payloadDataLoader } = req
      expect(await resolvePublicEthiopianDate(payload, date(6), { req })).toEqual(anon)
      expect(req.context).toBe(context)
      expect(req.context).toEqual({ isDraftOperation: true })
      expect(req.query).toBe(query)
      expect(req.query).toEqual({ draft: true, depth: 4 })
      expect(req.payloadDataLoader).toBe(payloadDataLoader)
      expect(req.user).toBe(identity)
      expect(req.fallbackLocale).toBe(false)
      expect(req.locale).toBe('en')
    }
    async function assertUnavailable() {
      const req = await createLocalReq({ user: admin }, payload)
      const result = await resolvePublicEthiopianDate(payload, date(6), { req })
      expect(result.readingSets[0].readings).toEqual([unavailable('Live label')])
      for (const target of [leaf, id, ancestor, pub])
        expect(JSON.stringify(result)).not.toContain(target)
    }
    async function setStatus(
      collection: 'publication-sections' | 'publications',
      id: string,
      status: 'draft' | 'published',
    ) {
      await payload.update({ collection, id, user: admin, draft: false, data: { _status: status } })
    }
    await setStatus('publication-sections', leaf, 'draft')
    await assertUnavailable()
    await setStatus('publication-sections', leaf, 'published')
    await setStatus('publication-sections', ancestor, 'draft')
    await assertUnavailable()
    await setStatus('publication-sections', ancestor, 'published')
    await setStatus('publications', pub, 'draft')
    await assertUnavailable()
  })

  it('inherits locale and honors an explicit fallback override without dropping passage languages', async () => {
    const saintDoc = await saint(7)
    const text = { geez: 'ግዕዝ', amharic: 'አማርኛ', english: 'English' }
    const id = await passage(section, 5, { text })
    const doc = await assign(7, {
      introduction: 'English introduction',
      readings: [{ label: 'English label', section, startPassage: id }],
      commemorations: [saintDoc.id],
    })
    await payload.update({
      collection: 'daily-readings',
      id: doc.id,
      user: admin,
      locale: 'am',
      data: {
        title: 'የዕለቱ ምንባብ',
        readings: [{ id: doc.readings?.[0].id, label: 'ምንባብ', section, startPassage: id }],
      },
    })
    const req = await createLocalReq({ user: editor, locale: 'am', fallbackLocale: 'en' }, payload)
    const fallback = await resolvePublicEthiopianDate(payload, date(7), { req })
    expect(fallback.readingSets[0]).toMatchObject({
      title: 'የዕለቱ ምንባብ',
      introduction: 'English introduction',
      readings: [{ label: 'ምንባብ', section: { title: 'Section title' }, passages: [{ text }] }],
    })
    const strict = await resolvePublicEthiopianDate(payload, date(7), {
      req,
      fallbackLocale: false,
    })
    expect(strict.readingSets[0]).toMatchObject({
      title: 'የዕለቱ ምንባብ',
      introduction: null,
      readings: [{ section: { title: null }, passages: [{ text }] }],
      commemorations: [{ title: null, summary: null }],
    })
    expect(strict.commemorations).toMatchObject([{ id: saintDoc.id, title: null }])
    expect(
      (await resolvePublicEthiopianDate(payload, date(7), { req, locale: 'en' })).readingSets[0]
        .title,
    ).toBe('Live assignment')
  })

  it('sees transaction-local records without changing the caller or committing the transaction', async () => {
    const transactionID = await payload.db.beginTransaction()
    if (transactionID == null) throw new Error('Expected an isolated MongoDB transaction')
    try {
      const req = await createLocalReq({ user: admin, req: { transactionID } }, payload)
      const first = await assign(8, {}, req)
      const second = await assign(8, {}, req)
      expect((await resolvePublicEthiopianDate(payload, date(8))).readingSets).toEqual([])
      const resolved = await resolvePublicEthiopianDate(payload, date(8), { req, pageSize: 1 })
      expect(resolved.readingSets.map((set) => set.id)).toEqual([first.id, second.id].sort())
      expect(req.transactionID).toBe(transactionID)
      expect(req.user?.id).toBe(admin.id)
    } finally {
      await payload.db.rollbackTransaction(transactionID)
    }
    expect((await resolvePublicEthiopianDate(payload, date(8))).readingSets).toEqual([])
  })

  it('propagates a passage query failure without treating it as a missing reference', async () => {
    await assign(9)
    const err = new Error('Unexpected adapter failure')
    const find = payload.db.find.bind(payload.db)
    const spy = vi.spyOn(payload.db, 'find').mockImplementation(async (args) => {
      if (args.collection === 'passages') throw err
      return find(args)
    })
    try {
      await expect(resolvePublicEthiopianDate(payload, date(9))).rejects.toBe(err)
    } finally {
      spy.mockRestore()
    }
  })
})
