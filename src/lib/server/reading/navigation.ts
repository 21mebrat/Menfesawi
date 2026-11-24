import type { PaginatedDocs, Payload } from 'payload'
import { isStaff, type UserAuth } from '@/access'
import type { PublicationSection, Passage } from '@/payload-types'
import type {
  BreadcrumbItem,
  SiblingNavigationItem,
  PreviousNextNavigation,
  ReadingQueryOptions,
} from './types'

function extractId(val: unknown): string {
  if (typeof val === 'object' && val !== null) {
    return String((val as any).id || (val as any)._id || '')
  }
  return String(val || '')
}

function buildFindOptions(
  where: Record<string, unknown>,
  options: ReadingQueryOptions,
  extra: { sort?: any; limit?: number; page?: number } = {},
) {
  const effectiveUser = (options.req?.user ?? options.user) as UserAuth | null | undefined
  const isUserStaff = isStaff(effectiveUser)
  const overrideAccess = options.overrideAccess ?? false

  const finalWhere: any = { ...where }
  if (!overrideAccess && !isUserStaff) {
    finalWhere.isPublishedEffective = { equals: true }
    finalWhere._status = { equals: 'published' }
  }

  const findOpts: any = {
    where: finalWhere,
    depth: 0,
    overrideAccess,
  }

  if (extra.sort) findOpts.sort = extra.sort
  if (extra.limit !== undefined) findOpts.limit = extra.limit
  if (extra.page !== undefined) findOpts.page = extra.page
  if (options.req) findOpts.req = options.req
  if (options.locale) findOpts.locale = options.locale
  if (options.fallbackLocale) findOpts.fallbackLocale = options.fallbackLocale
  if (options.user && !options.req) findOpts.user = options.user

  return { findOpts, isUserStaff, overrideAccess }
}

/**
 * Retrieves the root sections (parent === null) for a given publication.
 */
export async function getRootSections(
  payload: Payload,
  publicationId: string | number,
  options: ReadingQueryOptions = {},
): Promise<PaginatedDocs<PublicationSection>> {
  const { limit = 100, page = 1 } = options
  const where: Record<string, unknown> = {
    publication: { equals: String(publicationId) },
    parent: { exists: false },
  }

  const { findOpts } = buildFindOptions(where, options, {
    sort: 'order',
    limit,
    page,
  })

  return (payload.find as any)({
    collection: 'publication-sections',
    ...findOpts,
  })
}

/**
 * Retrieves the direct child sections of a given parent section.
 */
export async function getDirectChildren(
  payload: Payload,
  sectionId: string | number,
  options: ReadingQueryOptions = {},
): Promise<PaginatedDocs<PublicationSection>> {
  const { limit = 200, page = 1 } = options
  const where: Record<string, unknown> = {
    parent: { equals: String(sectionId) },
  }

  const { findOpts } = buildFindOptions(where, options, {
    sort: 'order',
    limit,
    page,
  })

  return (payload.find as any)({
    collection: 'publication-sections',
    ...findOpts,
  })
}

/**
 * Generates an ordered breadcrumb trail from publication root to the given section.
 * Uses stored `ancestors` array for high-performance single-query retrieval without tree walking.
 */
export async function getBreadcrumbs(
  payload: Payload,
  sectionId: string | number,
  options: ReadingQueryOptions = {},
): Promise<BreadcrumbItem[]> {
  const effectiveUser = (options.req?.user ?? options.user) as UserAuth | null | undefined
  const isUserStaff = isStaff(effectiveUser)
  const overrideAccess = options.overrideAccess ?? false

  const currentSection = await payload
    .findByID({
      collection: 'publication-sections',
      id: String(sectionId),
      overrideAccess: true,
      depth: 0,
      req: options.req,
      locale: options.locale as any,
      fallbackLocale: options.fallbackLocale as any,
    })
    .catch(() => null)

  if (!currentSection) {
    return []
  }

  if (!overrideAccess && !isUserStaff && (!currentSection.isPublishedEffective || currentSection._status !== 'published')) {
    return []
  }

  const rawAncestors: any[] = Array.isArray(currentSection.ancestors)
    ? currentSection.ancestors
    : []

  const ancestorIds: string[] = rawAncestors
    .map(extractId)
    .filter(Boolean)

  const breadcrumbs: BreadcrumbItem[] = []

  if (ancestorIds.length > 0) {
    const { findOpts } = buildFindOptions(
      {
        id: { in: ancestorIds },
      },
      options,
      {
        limit: ancestorIds.length + 5,
      },
    )

    const ancestorsRes = await payload.find({
      collection: 'publication-sections',
      ...findOpts,
    })

    const ancestorMap = new Map<string, any>()
    for (const doc of ancestorsRes.docs) {
      ancestorMap.set(String(doc.id), doc)
    }

    for (const aId of ancestorIds) {
      const doc = ancestorMap.get(aId)
      if (doc) {
        if (!overrideAccess && !isUserStaff && (!doc.isPublishedEffective || doc._status !== 'published')) {
          // If any ancestor is unpublished, non-staff users cannot traverse past it
          return []
        }
        breadcrumbs.push({
          id: String(doc.id),
          title: doc.title,
          slug: doc.slug,
          typeKey: doc.typeKey,
          depth: doc.depth ?? 0,
        })
      }
    }
  }

  breadcrumbs.push({
    id: String(currentSection.id),
    title: currentSection.title,
    slug: currentSection.slug,
    typeKey: currentSection.typeKey,
    depth: currentSection.depth ?? 0,
  })

  return breadcrumbs
}

// Preserve the Mongo adapter's descending creation-time fallback for equal orders.
export const passageSort = ['order', '-createdAt', 'id'] satisfies ('order' | '-createdAt' | 'id')[]

/**
 * Retrieves ordered passages within a section.
 */
export async function getOrderedPassages(
  payload: Payload,
  sectionId: string | number,
  options: ReadingQueryOptions = {},
): Promise<PaginatedDocs<Passage>> {
  const { limit = 500, page = 1 } = options
  const where: Record<string, unknown> = {
    section: { equals: String(sectionId) },
  }

  const { findOpts } = buildFindOptions(where, options, {
    sort: passageSort,
    limit,
    page,
  })

  return (payload.find as any)({
    collection: 'passages',
    ...findOpts,
  })
}

/**
 * Retrieves the previous and next sibling sections in reading sequence using
 * bounded neighbor queries with deterministic ordering and an ID tie-breaker.
 */
export async function getPreviousAndNextSection(
  payload: Payload,
  sectionId: string | number,
  options: ReadingQueryOptions = {},
): Promise<PreviousNextNavigation> {
  const effectiveUser = (options.req?.user ?? options.user) as UserAuth | null | undefined
  const isUserStaff = isStaff(effectiveUser)
  const overrideAccess = options.overrideAccess ?? false

  const currentSection = await payload
    .findByID({
      collection: 'publication-sections',
      id: String(sectionId),
      overrideAccess: true,
      depth: 0,
      req: options.req,
      locale: options.locale as any,
      fallbackLocale: options.fallbackLocale as any,
    })
    .catch(() => null)

  if (!currentSection) {
    return { previous: null, next: null }
  }

  if (!overrideAccess && !isUserStaff && (!currentSection.isPublishedEffective || currentSection._status !== 'published')) {
    return { previous: null, next: null }
  }

  const pubId = extractId(currentSection.publication)
  const parentId = currentSection.parent ? extractId(currentSection.parent) : null
  const currentOrder = typeof currentSection.order === 'number' ? currentSection.order : 0
  const currentId = String(currentSection.id)

  const baseWhere: Record<string, unknown> = {
    publication: { equals: pubId },
  }

  if (parentId) {
    baseWhere.parent = { equals: parentId }
  } else {
    baseWhere.parent = { exists: false }
  }

  if (!overrideAccess && !isUserStaff) {
    baseWhere.isPublishedEffective = { equals: true }
    baseWhere._status = { equals: 'published' }
  }

  // Previous sibling: (order < currentOrder) OR (order === currentOrder AND id < currentId)
  const prevWhere: any = {
    and: [
      baseWhere,
      {
        or: [
          { order: { less_than: currentOrder } },
          {
            and: [
              { order: { equals: currentOrder } },
              { id: { less_than: currentId } },
            ],
          },
        ],
      },
    ],
  }

  // Next sibling: (order > currentOrder) OR (order === currentOrder AND id > currentId)
  const nextWhere: any = {
    and: [
      baseWhere,
      {
        or: [
          { order: { greater_than: currentOrder } },
          {
            and: [
              { order: { equals: currentOrder } },
              { id: { greater_than: currentId } },
            ],
          },
        ],
      },
    ],
  }

  const findBaseOpts: any = {
    collection: 'publication-sections',
    depth: 0,
    overrideAccess: true,
  }
  if (options.req) findBaseOpts.req = options.req
  if (options.locale) findBaseOpts.locale = options.locale
  if (options.fallbackLocale) findBaseOpts.fallbackLocale = options.fallbackLocale

  const [prevRes, nextRes] = await Promise.all([
    payload.find({
      ...findBaseOpts,
      where: prevWhere,
      sort: ['-order', '-id'],
      limit: 1,
    }),
    payload.find({
      ...findBaseOpts,
      where: nextWhere,
      sort: ['order', 'id'],
      limit: 1,
    }),
  ])

  const mapToNav = (doc: any): SiblingNavigationItem => ({
    id: String(doc.id),
    title: doc.title,
    slug: doc.slug,
    typeKey: doc.typeKey,
    number: doc.number,
    order: doc.order ?? 0,
  })

  return {
    previous: prevRes.docs[0] ? mapToNav(prevRes.docs[0]) : null,
    next: nextRes.docs[0] ? mapToNav(nextRes.docs[0]) : null,
  }
}
