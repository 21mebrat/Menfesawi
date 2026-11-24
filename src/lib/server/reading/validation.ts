import { ValidationError, type Payload, type PayloadRequest } from 'payload'
import type { LocalizedLabel, PassageNumberingPolicy, PublicationStructureConfig } from './types'
import { fetchAllDocuments } from './cascade'

export interface NormalizedSectionTypeConfig {
  key: string
  labels: {
    singular: LocalizedLabel
    plural: LocalizedLabel
  }
  actionLabels?: LocalizedLabel
  allowedAtRoot: boolean
  allowedChildTypes: string[]
  allowPassages: boolean
  passageTerminology?: {
    singular?: LocalizedLabel
    plural?: LocalizedLabel
  }
  numberingPolicy: PassageNumberingPolicy
}

/**
 * Normalizes an allowedChildTypes entry which could be an array of strings or
 * an array of objects ({ typeKey: string }).
 */
export function normalizeChildTypeKeys(raw: unknown): string[] {
  if (!raw) return []
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (typeof item === 'object' && item !== null && 'typeKey' in item) {
        return String((item as any).typeKey).trim()
      }
      return ''
    })
    .filter((k) => k.length > 0)
}

/**
 * Normalizes raw sectionTypes from Payload document into a clean NormalizedSectionTypeConfig array.
 */
export function normalizeSectionTypes(rawTypes: unknown): NormalizedSectionTypeConfig[] {
  if (!Array.isArray(rawTypes)) return []
  return rawTypes.map((t: any) => ({
    key: String(t.key || '').trim(),
    labels: {
      singular: {
        en: String(t.labels?.singular?.en || t.labels?.singular || t.key || ''),
        am: String(t.labels?.singular?.am || t.labels?.singular || t.key || ''),
      },
      plural: {
        en: String(t.labels?.plural?.en || t.labels?.plural || t.key || ''),
        am: String(t.labels?.plural?.am || t.labels?.plural || t.key || ''),
      },
    },
    actionLabels: t.actionLabels
      ? {
          en: String(t.actionLabels.en || ''),
          am: String(t.actionLabels.am || ''),
        }
      : undefined,
    allowedAtRoot: Boolean(t.allowedAtRoot),
    allowedChildTypes: normalizeChildTypeKeys(t.allowedChildTypes),
    allowPassages: Boolean(t.allowPassages),
    passageTerminology: t.passageTerminology
      ? {
          singular: t.passageTerminology.singular
            ? {
                en: String(t.passageTerminology.singular.en || ''),
                am: String(t.passageTerminology.singular.am || ''),
              }
            : undefined,
          plural: t.passageTerminology.plural
            ? {
                en: String(t.passageTerminology.plural.en || ''),
                am: String(t.passageTerminology.plural.am || ''),
              }
            : undefined,
        }
      : undefined,
    numberingPolicy: (t.numberingPolicy as any) || 'optional',
  }))
}

/**
 * Validates a publication's structure configuration:
 * 1. maxDepth between 1 and 10.
 * 2. Unique section type keys.
 * 3. At least one section type allowed at root.
 * 4. All referenced child type keys exist.
 * 5. Acyclic structure and finite maximum depth.
 * 6. Guard against invalidating existing database sections and passages.
 */
export async function validatePublicationStructure(args: {
  structure: unknown
  existingPublicationId?: string | number
  payload?: Payload
  req?: PayloadRequest
}): Promise<{ maxDepth: number; sectionTypes: NormalizedSectionTypeConfig[] }> {
  const { structure, existingPublicationId, payload, req } = args

  if (!structure || typeof structure !== 'object') {
    throw new ValidationError({
      errors: [
        {
          message: 'Publication structure configuration is required.',
          path: 'structure',
        },
      ],
    })
  }

  const raw = structure as any
  const maxDepth = Number(raw.maxDepth)
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 10) {
    throw new ValidationError({
      errors: [
        {
          message: 'Maximum nesting depth must be an integer between 1 and 10.',
          path: 'structure.maxDepth',
        },
      ],
    })
  }

  const sectionTypes = normalizeSectionTypes(raw.sectionTypes)
  if (sectionTypes.length === 0) {
    throw new ValidationError({
      errors: [
        {
          message: 'At least one section type must be defined in the publication structure.',
          path: 'structure.sectionTypes',
        },
      ],
    })
  }

  // 1. Validate type keys format and uniqueness
  const keySet = new Set<string>()
  for (let i = 0; i < sectionTypes.length; i++) {
    const t = sectionTypes[i]
    if (!t.key || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.key)) {
      throw new ValidationError({
        errors: [
          {
            message: `Invalid section type key '${t.key}'. Use lowercase English letters, numbers, and single hyphens.`,
            path: `structure.sectionTypes.${i}.key`,
          },
        ],
      })
    }

    if (keySet.has(t.key)) {
      throw new ValidationError({
        errors: [
          {
            message: `Duplicate section type key '${t.key}'. Type keys must be unique within a publication.`,
            path: `structure.sectionTypes.${i}.key`,
          },
        ],
      })
    }
    keySet.add(t.key)
  }

  // 2. Validate at least one root type
  const rootTypes = sectionTypes.filter((t) => t.allowedAtRoot)
  if (rootTypes.length === 0) {
    throw new ValidationError({
      errors: [
        {
          message: 'At least one section type must be allowed at the root (allowedAtRoot: true).',
          path: 'structure.sectionTypes',
        },
      ],
    })
  }

  // 3. Validate all referenced child type keys exist
  for (let i = 0; i < sectionTypes.length; i++) {
    const t = sectionTypes[i]
    for (const childKey of t.allowedChildTypes) {
      if (!keySet.has(childKey)) {
        throw new ValidationError({
          errors: [
            {
              message: `Section type '${t.key}' references unknown child type key '${childKey}'.`,
              path: `structure.sectionTypes.${i}.allowedChildTypes`,
            },
          ],
        })
      }
    }
  }

  // 4. Validate graph cycles across ALL configured types (not only root-reachable ones)
  const typeMap = new Map<string, NormalizedSectionTypeConfig>()
  for (const t of sectionTypes) {
    typeMap.set(t.key, t)
  }

  const visitState = new Map<string, 0 | 1 | 2>()
  for (const t of sectionTypes) {
    visitState.set(t.key, 0)
  }

  function detectCycle(currentKey: string, path: string[]) {
    const state = visitState.get(currentKey)
    if (state === 1) {
      const cycleStart = path.indexOf(currentKey)
      const cycleStr = [...path.slice(cycleStart), currentKey].join(' -> ')
      throw new ValidationError({
        errors: [
          {
            message: `Circular section type hierarchy detected: ${cycleStr}. Hierarchy must be finite and acyclic.`,
            path: 'structure.sectionTypes',
          },
        ],
      })
    }
    if (state === 2) return

    visitState.set(currentKey, 1)
    const typeDef = typeMap.get(currentKey)
    if (typeDef) {
      for (const childKey of typeDef.allowedChildTypes) {
        detectCycle(childKey, [...path, currentKey])
      }
    }
    visitState.set(currentKey, 2)
  }

  for (const t of sectionTypes) {
    if (visitState.get(t.key) === 0) {
      detectCycle(t.key, [])
    }
  }

  // 5. Guard against configuration changes that silently invalidate existing database content
  if (existingPublicationId && payload) {
    const pubId = String(existingPublicationId)

    // Check if sections exist for this publication with exhausted pagination
    const existingSections = await fetchAllDocuments(payload, {
      collection: 'publication-sections',
      where: { publication: { equals: pubId } },
      overrideAccess: true,
      depth: 0,
      req,
    })

    if (existingSections.length > 0) {
      // a. Check all existing section types still exist
      for (const section of existingSections) {
        if (!keySet.has(section.typeKey)) {
          throw new ValidationError({
            errors: [
              {
                message: `Cannot remove section type '${section.typeKey}' because existing section '${section.slug}' (${section.id}) uses it.`,
                path: 'structure.sectionTypes',
              },
            ],
          })
        }
      }

      // b. Check root sections still allowed at root
      const rootSections = existingSections.filter((s) => !s.parent)
      for (const rootSec of rootSections) {
        const typeDef = typeMap.get(rootSec.typeKey)
        if (!typeDef || !typeDef.allowedAtRoot) {
          throw new ValidationError({
            errors: [
              {
                message: `Cannot disallow section type '${rootSec.typeKey}' at root because existing root section '${rootSec.slug}' (${rootSec.id}) is located at the root.`,
                path: 'structure.sectionTypes',
              },
            ],
          })
        }
      }

      // c. Check parent-child relationships still allowed
      const sectionById = new Map<string, any>()
      for (const s of existingSections) {
        sectionById.set(String(s.id), s)
      }

      for (const s of existingSections) {
        if (s.parent) {
          const parentId =
            typeof s.parent === 'object' && s.parent !== null
              ? String((s.parent as any).id || (s.parent as any)._id)
              : String(s.parent)

          const parentSec = sectionById.get(parentId)
          if (parentSec) {
            const parentTypeDef = typeMap.get(parentSec.typeKey)
            if (
              !parentTypeDef ||
              !parentTypeDef.allowedChildTypes.includes(s.typeKey)
            ) {
              throw new ValidationError({
                errors: [
                  {
                    message: `Parent type '${parentSec.typeKey}' no longer allows child type '${s.typeKey}', but existing section '${s.slug}' is a child of '${parentSec.slug}'.`,
                    path: 'structure.sectionTypes',
                  },
                ],
              })
            }
          }
        }
      }

      // d. Check maxDepth is not less than any existing section's depth
      for (const s of existingSections) {
        const secDepth = typeof s.depth === 'number' ? s.depth : 0
        if (secDepth > maxDepth) {
          throw new ValidationError({
            errors: [
              {
                message: `Cannot reduce maxDepth to ${maxDepth} because existing section '${s.slug}' has depth ${secDepth}, which exceeds maxDepth.`,
                path: 'structure.maxDepth',
              },
            ],
          })
        }
      }

      // e. Check that section types with existing passages still allow passages
      for (const s of existingSections) {
        const typeDef = typeMap.get(s.typeKey)
        if (typeDef && !typeDef.allowPassages) {
          const passageCount = await payload.count({
            collection: 'passages',
            where: { section: { equals: s.id } },
            overrideAccess: true,
            req,
          })
          if (passageCount.totalDocs > 0) {
            throw new ValidationError({
              errors: [
                {
                  message: `Cannot disable allowPassages on section type '${s.typeKey}' because existing section '${s.slug}' (${s.id}) contains ${passageCount.totalDocs} passage(s).`,
                  path: 'structure.sectionTypes',
                },
              ],
            })
          }
        }
      }

      // f. Validate that tightening numberingPolicy does not invalidate published passages
      for (const t of sectionTypes) {
        if (t.numberingPolicy === 'required') {
          const sectionsOfType = existingSections.filter((s) => s.typeKey === t.key)
          const secIds = sectionsOfType.map((s) => String(s.id))
          if (secIds.length > 0) {
            const publishedPassages = await fetchAllDocuments(payload, {
              collection: 'passages',
              where: {
                section: { in: secIds },
                _status: { equals: 'published' },
              },
              overrideAccess: true,
              req,
            })

            for (const p of publishedPassages) {
              if (
                typeof p.number !== 'number' ||
                !Number.isSafeInteger(p.number) ||
                p.number < 1
              ) {
                throw new ValidationError({
                  errors: [
                    {
                      message: `Cannot tighten numbering policy to 'required' for section type '${t.key}' because published passage '${p.id}' lacks a positive safe integer number.`,
                      path: 'structure.sectionTypes',
                    },
                  ],
                })
              }
            }
          }
        }
      }
    }
  }

  return {
    maxDepth,
    sectionTypes,
  }
}

/**
 * Validates a section's relationship and hierarchy constraints:
 * - Parent and child belong to same publication.
 * - Root type is allowed at root.
 * - Parent permits selected child type.
 * - No self-parenting or circular ancestry.
 * - Maximum depth enforced including any descendants.
 * - Sibling slug uniqueness within publication + parent scope.
 */
export async function validateSectionHierarchy(args: {
  payload: Payload
  publicationId: string | number
  typeKey: string
  parentId?: string | number | null
  sectionId?: string | number
  slug: string
  req?: PayloadRequest
}): Promise<{
  depth: number
  ancestorIds: string[]
  publicationDoc: any
  parentDoc: any | null
}> {
  const { payload, publicationId, typeKey, parentId, sectionId, slug, req } = args

  const pubIdStr = String(publicationId)
  const currentSecIdStr = sectionId ? String(sectionId) : null
  const parentIdStr = parentId ? String(parentId) : null

  // 1. Fetch publication and its structure
  const publicationDoc = await payload
    .findByID({
      collection: 'publications',
      id: pubIdStr,
      overrideAccess: true,
      req,
    })
    .catch(() => null)

  if (!publicationDoc) {
    throw new ValidationError({
      errors: [
        {
          message: `Publication with ID '${pubIdStr}' was not found.`,
          path: 'publication',
        },
      ],
    })
  }

  const structure = publicationDoc.structure as any
  const maxDepth = Number(structure?.maxDepth || 6)
  const sectionTypes = normalizeSectionTypes(structure?.sectionTypes)
  const typeDef = sectionTypes.find((t) => t.key === typeKey)

  if (!typeDef) {
    throw new ValidationError({
      errors: [
        {
          message: `Section type '${typeKey}' is not defined in the publication structure.`,
          path: 'typeKey',
        },
      ],
    })
  }

  let parentDoc: any = null
  let depth = 0
  let ancestorIds: string[] = []

  // 2. Parent validation
  if (parentIdStr) {
    if (currentSecIdStr && parentIdStr === currentSecIdStr) {
      throw new ValidationError({
        errors: [
          {
            message: 'A section cannot be its own parent (self-parenting).',
            path: 'parent',
          },
        ],
      })
    }

    parentDoc = await payload
      .findByID({
        collection: 'publication-sections',
        id: parentIdStr,
        overrideAccess: true,
        req,
      })
      .catch(() => null)

    if (!parentDoc) {
      throw new ValidationError({
        errors: [
          {
            message: `Parent section with ID '${parentIdStr}' was not found.`,
            path: 'parent',
          },
        ],
      })
    }

    // Cross-publication parenting validation
    const parentPubId =
      typeof parentDoc.publication === 'object' && parentDoc.publication !== null
        ? String(parentDoc.publication.id || parentDoc.publication._id)
        : String(parentDoc.publication)

    if (parentPubId !== pubIdStr) {
      throw new ValidationError({
        errors: [
          {
            message: `Parent section belongs to a different publication (${parentPubId}). Parent and child must belong to the same publication.`,
            path: 'parent',
          },
        ],
      })
    }

    // Circular ancestry check
    const rawParentAncestors = Array.isArray(parentDoc.ancestors)
      ? parentDoc.ancestors.map((a: any) =>
          typeof a === 'object' && a !== null ? String(a.id || a._id) : String(a),
        )
      : []

    if (currentSecIdStr && rawParentAncestors.includes(currentSecIdStr)) {
      throw new ValidationError({
        errors: [
          {
            message: 'Circular ancestry detected: the selected parent is a descendant of this section.',
            path: 'parent',
          },
        ],
      })
    }

    // Check parent allows this child type
    const parentTypeDef = sectionTypes.find((t) => t.key === parentDoc.typeKey)
    if (!parentTypeDef || !parentTypeDef.allowedChildTypes.includes(typeKey)) {
      throw new ValidationError({
        errors: [
          {
            message: `Parent section type '${parentDoc.typeKey}' does not permit child sections of type '${typeKey}'.`,
            path: 'typeKey',
          },
        ],
      })
    }

    depth = (parentDoc.depth ?? 0) + 1
    ancestorIds = [...rawParentAncestors, parentIdStr]
  } else {
    // Root section
    if (!typeDef.allowedAtRoot) {
      throw new ValidationError({
        errors: [
          {
            message: `Section type '${typeKey}' is not allowed at the publication root. It must have a parent section.`,
            path: 'typeKey',
          },
        ],
      })
    }
    depth = 0
    ancestorIds = []
  }

  // 3. Max depth validation (including existing subtree if moving a section)
  if (depth > maxDepth) {
    throw new ValidationError({
      errors: [
        {
          message: `Section depth (${depth}) exceeds publication maximum depth (${maxDepth}).`,
          path: 'parent',
        },
      ],
    })
  }

  if (currentSecIdStr) {
    // Check descendants relative depth with exhausted pagination
    const descendantsDocs = await fetchAllDocuments(payload, {
      collection: 'publication-sections',
      where: {
        ancestors: { contains: currentSecIdStr },
      },
      overrideAccess: true,
      depth: 0,
      req,
    })

    if (descendantsDocs.length > 0) {
      const currentDoc = await payload.findByID({
        collection: 'publication-sections',
        id: currentSecIdStr,
        overrideAccess: true,
        req,
      })
      const oldDepth = currentDoc?.depth ?? 0
      let maxRelativeDepth = 0
      for (const desc of descendantsDocs) {
        const rel = (desc.depth ?? 0) - oldDepth
        if (rel > maxRelativeDepth) {
          maxRelativeDepth = rel
        }
      }

      if (depth + maxRelativeDepth > maxDepth) {
        throw new ValidationError({
          errors: [
            {
              message: `Moving this section with its descendants to depth ${depth} would cause descendants to reach depth ${depth + maxRelativeDepth}, exceeding publication maxDepth (${maxDepth}).`,
              path: 'parent',
            },
          ],
        })
      }
    }
  }

  // 4. Sibling uniqueness validation: slug unique within (publication + parent)
  const siblingQuery: any = {
    publication: { equals: pubIdStr },
    slug: { equals: slug },
  }

  if (parentIdStr) {
    siblingQuery.parent = { equals: parentIdStr }
  } else {
    siblingQuery.parent = { exists: false }
  }

  if (currentSecIdStr) {
    siblingQuery.id = { not_equals: currentSecIdStr }
  }

  const conflictingSibling = await payload.find({
    collection: 'publication-sections',
    where: siblingQuery,
    limit: 1,
    overrideAccess: true,
    depth: 0,
    req,
  })

  if (conflictingSibling.docs.length > 0) {
    throw new ValidationError({
      errors: [
        {
          message: `A sibling section with slug '${slug}' already exists in this scope. Sibling slugs must be unique within the same parent section.`,
          path: 'slug',
        },
      ],
    })
  }

  return {
    depth,
    ancestorIds,
    publicationDoc,
    parentDoc,
  }
}

/**
 * Validates passage constraints:
 * - Parent section permits passages.
 * - Numbering policy enforced.
 * - At least one non-empty language text if published.
 */
export async function validatePassageIntegrity(args: {
  payload: Payload
  sectionId: string | number
  number?: number | null
  text?: {
    geez?: string | null
    amharic?: string | null
    english?: string | null
  } | null
  status: 'draft' | 'published'
  originalDoc?: any
  req?: PayloadRequest
}): Promise<{
  publicationId: string
  sectionDoc: any
  numberingPolicy: string
}> {
  const { payload, sectionId, number, text, status, originalDoc, req } = args
  const sectionIdStr = String(sectionId)

  const sectionDoc = await payload
    .findByID({
      collection: 'publication-sections',
      id: sectionIdStr,
      overrideAccess: true,
      req,
    })
    .catch(() => null)

  if (!sectionDoc) {
    throw new ValidationError({
      errors: [
        {
          message: `Parent section with ID '${sectionIdStr}' was not found.`,
          path: 'section',
        },
      ],
    })
  }

  const pubVal = sectionDoc.publication as any
  const pubIdStr =
    typeof pubVal === 'object' && pubVal !== null
      ? String(pubVal.id || pubVal._id)
      : String(pubVal)

  const publicationDoc = await payload
    .findByID({
      collection: 'publications',
      id: pubIdStr,
      overrideAccess: true,
      req,
    })
    .catch(() => null)

  if (!publicationDoc) {
    throw new ValidationError({
      errors: [
        {
          message: `Publication for section '${sectionIdStr}' was not found.`,
          path: 'section',
        },
      ],
    })
  }

  const sectionTypes = normalizeSectionTypes(publicationDoc.structure?.sectionTypes)
  const typeDef = sectionTypes.find((t) => t.key === sectionDoc.typeKey)

  if (!typeDef || !typeDef.allowPassages) {
    throw new ValidationError({
      errors: [
        {
          message: `Sections of type '${sectionDoc.typeKey}' do not permit passages according to the publication structure.`,
          path: 'section',
        },
      ],
    })
  }

  // Numbering policy
  const policy = typeDef.numberingPolicy || 'optional'
  const resolvedNumber =
    number !== undefined ? number : originalDoc?.number ?? null

  if (policy === 'required') {
    if (
      resolvedNumber === null ||
      resolvedNumber === undefined ||
      typeof resolvedNumber !== 'number' ||
      !Number.isSafeInteger(resolvedNumber) ||
      resolvedNumber < 1
    ) {
      if (status === 'published') {
        throw new ValidationError({
          errors: [
            {
              message: `A positive integer passage number is required for sections of type '${sectionDoc.typeKey}'.`,
              path: 'number',
            },
          ],
        })
      }
    }
  }

  // Text validation before publication
  if (status === 'published') {
    const geez = text?.geez !== undefined ? text.geez : originalDoc?.text?.geez
    const amharic =
      text?.amharic !== undefined ? text.amharic : originalDoc?.text?.amharic
    const english =
      text?.english !== undefined ? text.english : originalDoc?.text?.english

    const hasGeez = typeof geez === 'string' && geez.trim().length > 0
    const hasAmharic = typeof amharic === 'string' && amharic.trim().length > 0
    const hasEnglish = typeof english === 'string' && english.trim().length > 0

    if (!hasGeez && !hasAmharic && !hasEnglish) {
      throw new ValidationError({
        errors: [
          {
            message:
              'At least one passage text (Ge’ez, Amharic, or English) must be non-empty before publication.',
            path: 'text',
          },
        ],
      })
    }
  }

  return {
    publicationId: pubIdStr,
    sectionDoc,
    numberingPolicy: policy,
  }
}
