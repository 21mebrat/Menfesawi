import type { PayloadRequest, TypedFallbackLocale, TypedLocale } from 'payload'
import type { Passage } from '@/payload-types'
import { fail, ref } from '../library/coordination'

export const targetTypes = [
  'books',
  'teachings',
  'hymns',
  'publications',
  'publication-sections',
  'passages',
  'synaxarium',
  'daily-readings',
] as const
export type BookmarkTargetType = (typeof targetTypes)[number]
export type BookmarkTarget = { relationTo: BookmarkTargetType; value: string }
export type BookmarkLocale = { locale?: TypedLocale; fallbackLocale?: TypedFallbackLocale }
export type PublicBookmarkContent = {
  id: string
  title: string | null
  slug?: string
  publicationId?: string
  sectionId?: string
  number?: number | null
  excerpt?: string | null
}

export function isTargetType(value: unknown): value is BookmarkTargetType {
  return targetTypes.some((type) => type === value)
}
export function isID(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)
}
export function readTarget(input: unknown): BookmarkTarget {
  if (
    !input ||
    typeof input !== 'object' ||
    !('relationTo' in input) ||
    !isTargetType(input.relationTo) ||
    !('value' in input) ||
    !isID(input.value) ||
    Object.keys(input).length !== 2
  ) {
    return fail('Select a supported bookmark target with a valid ID.')
  }
  return { relationTo: input.relationTo, value: input.value.toLowerCase() }
}

export const targetKey = (target: BookmarkTarget) => target.relationTo + '/' + target.value

// req is a new, anonymous Local API request sharing only the caller's transaction.
export async function publicSummaries(
  req: PayloadRequest,
  targets: BookmarkTarget[],
  { includePassageExcerpt = true, ...locale }: BookmarkLocale & { includePassageExcerpt?: boolean },
) {
  const result = new Map<string, PublicBookmarkContent>()
  for (const type of targetTypes) {
    const ids = [...new Set(targets.filter((t) => t.relationTo === type).map((t) => t.value))]
    if (!ids.length) continue
    const read = {
      req,
      ...locale,
      overrideAccess: false,
      depth: 0,
      pagination: false,
      limit: ids.length,
      draft: false,
      where: { id: { in: ids }, _status: { equals: 'published' } },
    } as const
    const visible = { ...read.where, isPublishedEffective: { equals: true } }
    const add = (doc: PublicBookmarkContent) =>
      result.set(targetKey({ relationTo: type, value: doc.id }), doc)
    if (type === 'passages') {
      const {
        docs,
      }: { docs: Pick<Passage, 'id' | 'displayLabel' | 'section' | 'number' | 'text'>[] } =
        await req.payload.find({
          ...read,
          collection: type,
          where: visible,
          select: {
            displayLabel: true,
            section: true,
            number: true,
            ...(includePassageExcerpt && { text: true }),
          },
        })
      for (const doc of docs) {
        const text = doc.text?.[locale.locale === 'am' ? 'amharic' : 'english'] ?? doc.text?.geez
        add({
          id: doc.id,
          title: doc.displayLabel ?? null,
          sectionId: ref(doc.section),
          number: doc.number ?? null,
          excerpt: text ? Array.from(text).slice(0, 160).join('') : null,
        })
      }
    } else if (type === 'publication-sections') {
      const { docs } = await req.payload.find({
        ...read,
        collection: type,
        where: visible,
        select: { title: true, slug: true, publication: true },
      })
      for (const doc of docs)
        add({
          id: doc.id,
          title: doc.title ?? null,
          slug: doc.slug,
          publicationId: ref(doc.publication),
        })
    } else {
      const { docs } = await req.payload.find({
        ...read,
        collection: type,
        select: { title: true, slug: true },
      })
      for (const doc of docs) add({ id: doc.id, title: doc.title ?? null, slug: doc.slug })
    }
  }
  return result
}
