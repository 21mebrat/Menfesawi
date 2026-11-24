import type { Payload, PayloadRequest } from 'payload'
import {
  extractId,
  getMongoSession,
  acquireStructuralLocks,
  isReplicaSetSupported,
} from './coordination'

export { extractId, getMongoSession, acquireStructuralLocks, isReplicaSetSupported }

export interface CascadeOptions {
  req?: PayloadRequest
  currentDoc?: any
}

/**
 * Paginates exhaustively to fetch all matching documents without hitting silent limits.
 */
export async function fetchAllDocuments<T = any>(
  payload: Payload,
  findArgs: Parameters<Payload['find']>[0],
): Promise<T[]> {
  const allDocs: T[] = []
  let page = 1
  let hasNextPage = true
  const limit = findArgs.limit || 250

  while (hasNextPage) {
    const res = await payload.find({
      ...findArgs,
      page,
      limit,
    })
    allDocs.push(...(res.docs as T[]))
    hasNextPage = res.hasNextPage
    page++
  }

  return allDocs
}

/**
 * Updates all passages belonging to a specific section to reflect
 * the section's current publication and ancestor publication status.
 */
export async function updateSectionPassages(
  payload: Payload,
  sectionId: string | number,
  sectionDoc: any,
  options: CascadeOptions = {},
) {
  const secIdStr = String(sectionId)
  const isSectionPublished = Boolean(
    sectionDoc._status === 'published' && sectionDoc.isAncestorsPublished === true,
  )
  const isPublicationPublished = Boolean(sectionDoc.isPublicationPublished)
  const session = await getMongoSession(payload, options.req)
  const mongoOpts = session ? { session } : {}

  const passagesModel = payload.db.collections?.['passages']
  if (passagesModel) {
    await passagesModel.updateMany(
      { section: secIdStr },
      {
        $set: {
          isSectionPublished,
          isPublicationPublished,
        },
      },
      mongoOpts,
    )

    if (isSectionPublished && isPublicationPublished) {
      await passagesModel.updateMany(
        { section: secIdStr, _status: 'published' },
        { $set: { isPublishedEffective: true } },
        mongoOpts,
      )
      await passagesModel.updateMany(
        { section: secIdStr, _status: { $ne: 'published' } },
        { $set: { isPublishedEffective: false } },
        mongoOpts,
      )
    } else {
      await passagesModel.updateMany(
        { section: secIdStr },
        { $set: { isPublishedEffective: false } },
        mongoOpts,
      )
    }
    return
  }

  // Fallback via Payload API with exhausted pagination
  const passagesDocs = await fetchAllDocuments(payload, {
    collection: 'passages',
    where: { section: { equals: secIdStr } },
    overrideAccess: true,
    depth: 0,
    req: options.req,
  })

  for (const p of passagesDocs) {
    const isEff =
      p._status === 'published' && isSectionPublished && isPublicationPublished
    await payload.update({
      collection: 'passages',
      id: p.id,
      data: {
        isSectionPublished,
        isPublicationPublished,
        isPublishedEffective: isEff,
      } as any,
      overrideAccess: true,
      req: options.req,
    })
  }
}

/**
 * Recursively cascades status, depth, and ancestor changes down the section tree
 * to all child sections and their passages.
 */
export async function cascadeSectionDescendants(
  payload: Payload,
  sectionId: string | number,
  options: CascadeOptions = {},
) {
  const secIdStr = String(sectionId)
  const parentDoc =
    options.currentDoc && extractId(options.currentDoc) === secIdStr
      ? options.currentDoc
      : await payload
          .findByID({
            collection: 'publication-sections',
            id: secIdStr,
            overrideAccess: true,
            depth: 0,
            req: options.req,
          })
          .catch(() => null)

  if (!parentDoc) return

  // 1. Update passages of this parent section
  await updateSectionPassages(payload, secIdStr, parentDoc, options)

  // 2. Fetch direct children of this section with exhausted pagination
  const childrenDocs = await fetchAllDocuments(payload, {
    collection: 'publication-sections',
    where: { parent: { equals: secIdStr } },
    overrideAccess: true,
    depth: 0,
    req: options.req,
  })

  const rawAncestors = Array.isArray(parentDoc.ancestors)
    ? parentDoc.ancestors.map(extractId)
    : []
  const childAncestors = [...rawAncestors, secIdStr]
  const childDepth = (parentDoc.depth ?? 0) + 1
  const isAncestorsPublished = Boolean(
    parentDoc._status === 'published' && parentDoc.isAncestorsPublished === true,
  )
  const isPublicationPublished = Boolean(parentDoc.isPublicationPublished)

  const session = await getMongoSession(payload, options.req)
  const mongoOpts = session ? { session } : {}
  const sectionsModel = payload.db.collections?.['publication-sections']

  for (const child of childrenDocs) {
    const childPublishedEffective = Boolean(
      child._status === 'published' &&
        isAncestorsPublished &&
        isPublicationPublished,
    )

    if (sectionsModel) {
      await sectionsModel.updateOne(
        { _id: child.id },
        {
          $set: {
            depth: childDepth,
            ancestors: childAncestors,
            isPublicationPublished,
            isAncestorsPublished,
            isPublishedEffective: childPublishedEffective,
          },
        },
        mongoOpts,
      )
    } else {
      await payload.update({
        collection: 'publication-sections',
        id: child.id,
        data: {
          depth: childDepth,
          ancestors: childAncestors,
          isPublicationPublished,
          isAncestorsPublished,
          isPublishedEffective: childPublishedEffective,
        } as any,
        overrideAccess: true,
        req: options.req,
      })
    }

    const updatedChildDoc = {
      ...child,
      depth: childDepth,
      ancestors: childAncestors,
      isPublicationPublished,
      isAncestorsPublished,
      isPublishedEffective: childPublishedEffective,
    }

    // Recursively cascade to child's own descendants
    await cascadeSectionDescendants(payload, child.id, {
      req: options.req,
      currentDoc: updatedChildDoc,
    })
  }
}

/**
 * Cascades publication status changes to all root sections and their descendants.
 */
export async function cascadePublicationStatus(
  payload: Payload,
  publicationId: string | number,
  isPublished: boolean,
  options: CascadeOptions = {},
) {
  const pubIdStr = String(publicationId)

  // Find all root sections of this publication with exhausted pagination
  const rootSectionsDocs = await fetchAllDocuments(payload, {
    collection: 'publication-sections',
    where: {
      publication: { equals: pubIdStr },
      parent: { exists: false },
    },
    overrideAccess: true,
    depth: 0,
    req: options.req,
  })

  const session = await getMongoSession(payload, options.req)
  const mongoOpts = session ? { session } : {}
  const sectionsModel = payload.db.collections?.['publication-sections']

  for (const root of rootSectionsDocs) {
    const rootEffective = Boolean(root._status === 'published' && isPublished)

    if (sectionsModel) {
      await sectionsModel.updateOne(
        { _id: root.id },
        {
          $set: {
            isPublicationPublished: isPublished,
            isAncestorsPublished: true,
            isPublishedEffective: rootEffective,
          },
        },
        mongoOpts,
      )
    } else {
      await payload.update({
        collection: 'publication-sections',
        id: root.id,
        data: {
          isPublicationPublished: isPublished,
          isAncestorsPublished: true,
          isPublishedEffective: rootEffective,
        } as any,
        overrideAccess: true,
        req: options.req,
      })
    }

    const updatedRootDoc = {
      ...root,
      isPublicationPublished: isPublished,
      isAncestorsPublished: true,
      isPublishedEffective: rootEffective,
    }

    // Cascade down from this root
    await cascadeSectionDescendants(payload, root.id, {
      req: options.req,
      currentDoc: updatedRootDoc,
    })
  }
}
