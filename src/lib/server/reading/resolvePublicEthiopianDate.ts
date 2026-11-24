import {
  createLocalReq,
  type Payload,
  type PayloadRequest,
  type TypedFallbackLocale,
  type TypedLocale,
  type Where,
} from 'payload'
import { validateEthiopianDate, type EthiopianDate } from '@/lib/ethiopianDate'
import type { DailyReading, Passage, SynaxariumEntry } from '@/payload-types'
import { passageSort } from './navigation'

export interface PublicDateOptions {
  req?: PayloadRequest
  locale?: TypedLocale
  fallbackLocale?: TypedFallbackLocale
  /** Records per query, from 1 to 100. Defaults to 100. */
  pageSize?: number
}

interface PublicSection {
  id: string
  slug: string
  title: string | null
}

interface PublicPassage {
  id: string
  number: number | null
  displayLabel: string | null
  text: NonNullable<Passage['text']>
}

interface Commemoration {
  id: string
  slug: string
  title: string | null
  summary: string | null
}

type Reading =
  | { label: string | null; status: 'available'; section: PublicSection; passages: PublicPassage[] }
  // A missing, hidden, moved, or reversed reference. A readable empty section is available.
  | { label: string | null; status: 'unavailable' }

export interface PublicEthiopianDate {
  date: EthiopianDate
  readingSets: {
    id: string
    slug: string
    title: string | null
    introduction: string | null
    readings: Reading[]
    /** Public editorial links in their original order, regardless of calendar date. */
    commemorations: Commemoration[]
  }[]
  /** Independently matched by Ethiopian month and day. */
  commemorations: Commemoration[]
}

type Row = NonNullable<DailyReading['readings']>[number]
type SortKey = (typeof passageSort)[number]
const entrySort: SortKey[] = ['order', 'id']
const published = { _status: { equals: 'published' } }
const visible = { ...published, isPublishedEffective: { equals: true } }
const commemorationFields = { slug: true, title: true, summary: true } as const

function commemoration(
  doc: Pick<SynaxariumEntry, 'id' | 'slug' | 'title' | 'summary'>,
): Commemoration {
  return { id: doc.id, slug: doc.slug, title: doc.title ?? null, summary: doc.summary ?? null }
}

function idOf(ref: string | { id: string }): string {
  return typeof ref === 'string' ? ref : ref.id
}

function* batches(ids: Iterable<string>, size: number) {
  const unique = [...new Set(ids)]
  for (let i = 0; i < unique.length; i += size) yield unique.slice(i, i + size)
}

// Seek using the same keys as the database sort. Disabling count-based pagination
// avoids the Mongo adapter issuing a count and a find concurrently on one session.
async function orderedPages<T extends { id: string; order: number; createdAt?: string }>(
  base: Where,
  sort: SortKey[],
  limit: number,
  find: (args: { where: Where; sort: SortKey[]; limit: number }) => Promise<{ docs: T[] }>,
): Promise<T[]> {
  const result: T[] = []
  let where = base
  for (;;) {
    const { docs } = await find({ where, sort, limit })
    result.push(...docs)
    if (docs.length < limit) return result
    const last = docs[docs.length - 1]
    const prefix: Where = {}
    const or = sort.map((key) => {
      const field = key === '-createdAt' ? 'createdAt' : key
      const value = last[field]
      const comparison = key === '-createdAt' ? 'less_than' : 'greater_than'
      const next = { ...prefix, [field]: { [comparison]: value } }
      prefix[field] = { equals: value }
      return next
    })
    where = { and: [base, { or }] }
  }
}

interface SectionReadings {
  section: PublicSection
  passages: PublicPassage[]
  positions: Map<string, number>
}

function resolveRow(row: Row, sections: Map<string, SectionReadings>): Reading {
  const label = row.label ?? null
  const unavailable = { label, status: 'unavailable' } as const
  const group = row.section && sections.get(idOf(row.section))
  if (!group) return unavailable
  const { section, passages, positions } = group
  if (row.startPassage == null) {
    return row.endPassage == null ? { label, status: 'available', section, passages } : unavailable
  }
  const start = positions.get(idOf(row.startPassage))
  const end = row.endPassage == null ? start : positions.get(idOf(row.endPassage))
  if (start === undefined || end === undefined || end < start) return unavailable
  return { label, status: 'available', section, passages: passages.slice(start, end + 1) }
}

/** Resolve manually assigned readings against live, anonymous collection access. */
export async function resolvePublicEthiopianDate(
  payload: Payload,
  date: EthiopianDate,
  options: PublicDateOptions = {},
): Promise<PublicEthiopianDate> {
  validateEthiopianDate(date)
  const { year, month, day } = date
  const limit = options.pageSize ?? 100
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError('pageSize must be an integer from 1 to 100.')

  // Payload mutates its Local API request. Carry only the session, never caller
  // authorization, headers, draft flags, hook context, or a staff data loader.
  const caller = options.req
  const read = {
    req: await createLocalReq({ req: { transactionID: caller?.transactionID } }, payload),
    locale: options.locale ?? (caller?.locale === 'all' ? undefined : caller?.locale),
    fallbackLocale:
      options.fallbackLocale === undefined ? caller?.fallbackLocale : options.fallbackLocale,
    overrideAccess: false,
    draft: false,
    depth: 0,
    pagination: false,
    limit,
  } as const
  const onDate = {
    ...published,
    ethiopianMonth: { equals: String(month) },
    ethiopianDay: { equals: day },
  }
  const sets = await orderedPages(
    {
      ...onDate,
      or: [
        { dateMode: { equals: 'recurring' } },
        { dateMode: { equals: 'specific-year' }, ethiopianYear: { equals: year } },
      ],
    },
    entrySort,
    limit,
    (args) =>
      payload.find({
        ...read,
        ...args,
        collection: 'daily-readings',
        select: {
          slug: true,
          title: true,
          introduction: true,
          order: true,
          readings: true,
          commemorations: true,
        },
      }),
  )

  const matched = await orderedPages(onDate, entrySort, limit, (args) =>
    payload.find({
      ...read,
      ...args,
      collection: 'synaxarium',
      select: { ...commemorationFields, order: true },
    }),
  )
  const commemorations = matched.map(commemoration)
  const linked = new Map(commemorations.map((doc) => [doc.id, doc]))
  const missingLinks = sets
    .flatMap((set) => (set.commemorations ?? []).map(idOf))
    .filter((id) => !linked.has(id))
  for (const ids of batches(missingLinks, limit)) {
    const { docs } = await payload.find({
      ...read,
      collection: 'synaxarium',
      where: { ...published, id: { in: ids } },
      sort: 'id',
      select: commemorationFields,
    })
    for (const doc of docs) linked.set(doc.id, commemoration(doc))
  }

  const rows = sets.flatMap((set) => set.readings ?? [])
  const groups = new Map<string, SectionReadings>()
  for (const ids of batches(
    rows.filter((row) => row.section).map((row) => idOf(row.section)),
    limit,
  )) {
    const { docs } = await payload.find({
      ...read,
      collection: 'publication-sections',
      where: { ...visible, id: { in: ids } },
      sort: 'id',
      select: { slug: true, title: true },
    })
    for (const { id, slug, title } of docs)
      groups.set(id, {
        section: { id, slug, title: title ?? null },
        passages: [],
        positions: new Map(),
      })
  }

  // Whole sections and ranges need the direct passage sequence. Single-only
  // sections can be satisfied by a batched lookup of just their start passages.
  const fullSections = new Set<string>()
  for (const row of rows) {
    if (row.section && (row.startPassage == null || row.endPassage != null)) {
      const section = idOf(row.section)
      if (groups.has(section)) fullSections.add(section)
    }
  }
  const singles = new Set<string>()
  for (const row of rows) {
    if (
      row.section &&
      row.startPassage &&
      groups.has(idOf(row.section)) &&
      !fullSections.has(idOf(row.section))
    )
      singles.add(idOf(row.startPassage))
  }
  const passageFields = {
    section: true,
    number: true,
    displayLabel: true,
    text: true,
    order: true,
    createdAt: true,
  } as const
  function addPassage(doc: Pick<Passage, 'id' | 'section' | 'number' | 'displayLabel' | 'text'>) {
    const group = groups.get(idOf(doc.section))
    if (!group || group.positions.has(doc.id)) return
    group.positions.set(doc.id, group.passages.length)
    group.passages.push({
      id: doc.id,
      number: doc.number ?? null,
      displayLabel: doc.displayLabel ?? null,
      text: doc.text ?? {},
    })
  }
  for (const ids of batches(fullSections, limit)) {
    const docs = await orderedPages(
      { ...visible, section: { in: ids } },
      passageSort,
      limit,
      (args) => payload.find({ ...read, ...args, collection: 'passages', select: passageFields }),
    )
    for (const doc of docs) addPassage(doc)
  }
  for (const ids of batches(singles, limit)) {
    const { docs } = await payload.find({
      ...read,
      collection: 'passages',
      where: { ...visible, id: { in: ids } },
      sort: passageSort,
      select: passageFields,
    })
    for (const doc of docs) addPassage(doc)
  }

  return {
    date: { year, month, day },
    readingSets: sets.map((set) => ({
      id: set.id,
      slug: set.slug,
      title: set.title ?? null,
      introduction: set.introduction ?? null,
      readings: (set.readings ?? []).map((row) => resolveRow(row, groups)),
      commemorations: (set.commemorations ?? []).flatMap((ref) => linked.get(idOf(ref)) ?? []),
    })),
    commemorations,
  }
}
