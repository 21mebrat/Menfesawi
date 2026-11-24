import type {
  CollectionAfterChangeHook,
  CollectionAfterReadHook,
  CollectionBeforeChangeHook,
  CollectionBeforeDeleteHook,
  CollectionBeforeOperationHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  Where,
} from 'payload'
import { NotFound, ValidationError } from 'payload'
import type { PublicationSection } from '../payload-types'

import {
  canAccessAdmin,
  isAdmin,
  isStaff,
  type UserAuth,
} from '../access'
import { validateSectionHierarchy, normalizeSectionTypes } from '../lib/server/reading/validation'
import {
  cascadeSectionDescendants,
  fetchAllDocuments,
  extractId,
  acquireStructuralLocks,
} from '../lib/server/reading/cascade'

const beforeOperationPublicationSection: CollectionBeforeOperationHook = ({
  args,
  operation,
  req,
  context,
}: any) => {
  const anyArgs = args as any
  const isDraft = Boolean(anyArgs?.draft)
  if (context) {
    context.isDraftOperation = isDraft
  }
  if (req) {
    req.context = req.context || {}
    req.context.isDraftOperation = isDraft
  }
  if (!isStaff(req?.user as UserAuth | null) && anyArgs) {
    anyArgs.draft = false
  }
  if (operation === 'read' && anyArgs?.select && typeof anyArgs.select === 'object') {
    anyArgs.select._status = true
    anyArgs.select.isPublishedEffective = true
  }
  return args
}

const beforeValidatePublicationSection: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
  operation,
}) => {
  if (!data) return data

  const publication = extractId(data.publication ?? originalDoc?.publication)
  const parent = data.parent !== undefined ? data.parent : originalDoc?.parent
  const typeKey = data.typeKey ?? originalDoc?.typeKey
  const slug = data.slug ?? originalDoc?.slug

  await acquireStructuralLocks(req.payload, req, {
    publications: [publication],
    sections: [parent, originalDoc?.id],
  })

  if (!publication || !typeKey || !slug) {
    // Let Payload's required field validators handle missing top-level fields
    return data
  }

  // Guard against changing publication if section has descendants or passages
  if (operation === 'update' && originalDoc) {
    // originalDoc supplies omitted values from the latest version, which may be a saved draft.
    // Compare that proposal with the main collection row in the locked transaction.
    const liveSection = await req.payload.db.findOne<
      Pick<PublicationSection, 'id' | 'publication' | 'typeKey'>
    >({
      collection: 'publication-sections',
      where: { id: { equals: originalDoc.id } },
      select: { publication: true, typeKey: true },
      req,
    })
    if (!liveSection) throw new NotFound(req.t)

    if (extractId(liveSection.publication) !== publication) {
      const childCount = await req.payload.count({
        collection: 'publication-sections',
        where: { parent: { equals: liveSection.id } },
        overrideAccess: true,
        req,
      })
      const passageCount = await req.payload.count({
        collection: 'passages',
        where: { section: { equals: liveSection.id } },
        overrideAccess: true,
        req,
      })

      if (childCount.totalDocs > 0 || passageCount.totalDocs > 0) {
        throw new ValidationError({
          errors: [
            {
              message:
                'Cannot move a section to a different publication while it contains child sections or passages.',
              path: 'publication',
            },
          ],
        })
      }
    }

    // Validate changing section type against existing children and passages
    if (typeKey !== liveSection.typeKey) {
      const publicationDoc = await req.payload.findByID({
        collection: 'publications',
        id: publication,
        overrideAccess: true,
        depth: 0,
        req,
      })

      if (publicationDoc) {
        const sectionTypes = normalizeSectionTypes(
          (publicationDoc as any).structure?.sectionTypes,
        )
        const newTypeDef = sectionTypes.find((t) => t.key === typeKey)
        if (newTypeDef) {
          // 1. Check existing passages if new type disallows passages
          if (!newTypeDef.allowPassages) {
            const passageCount = await req.payload.count({
              collection: 'passages',
              where: { section: { equals: liveSection.id } },
              overrideAccess: true,
              req,
            })
            if (passageCount.totalDocs > 0) {
              throw new ValidationError({
                errors: [
                  {
                    message: `Cannot change section type to '${typeKey}' because section contains ${passageCount.totalDocs} passages and type '${typeKey}' disallows passages.`,
                    path: 'typeKey',
                  },
                ],
              })
            }
          }

          // 2. Validate numbering policy against existing published passages
          if (newTypeDef.numberingPolicy === 'required') {
            const passages = await fetchAllDocuments(req.payload, {
              collection: 'passages',
              where: {
                section: { equals: liveSection.id },
                _status: { equals: 'published' },
              },
              overrideAccess: true,
              req,
            })
            for (const p of passages) {
              if (
                typeof p.number !== 'number' ||
                !Number.isSafeInteger(p.number) ||
                p.number < 1
              ) {
                throw new ValidationError({
                  errors: [
                    {
                      message: `Cannot change section type to '${typeKey}' because published passage '${p.id}' has invalid number (${p.number}). Section type '${typeKey}' requires a positive safe integer number.`,
                      path: 'typeKey',
                    },
                  ],
                })
              }
            }
          }

          // 3. Check existing child sections if new type does not permit their types
          const children = await fetchAllDocuments(req.payload, {
            collection: 'publication-sections',
            where: { parent: { equals: liveSection.id } },
            overrideAccess: true,
            depth: 0,
            req,
          })

          for (const child of children) {
            if (!newTypeDef.allowedChildTypes.includes(child.typeKey)) {
              throw new ValidationError({
                errors: [
                  {
                    message: `Cannot change section type to '${typeKey}' because existing child section '${child.slug}' is of type '${child.typeKey}', which is not permitted under '${typeKey}'.`,
                    path: 'typeKey',
                  },
                ],
              })
            }
          }
        }
      }
    }
  }

  await validateSectionHierarchy({
    payload: req.payload,
    publicationId: publication,
    parentId: parent,
    typeKey,
    slug,
    sectionId: originalDoc?.id,
    req,
  })

  return data
}

const beforeChangePublicationSection: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const pubId = extractId(data.publication ?? originalDoc?.publication)
  const parentId = extractId(
    data.parent !== undefined ? data.parent : originalDoc?.parent,
  )

  if (!pubId) return data

  const publicationDoc = await req.payload
    .findByID({
      collection: 'publications',
      id: pubId,
      overrideAccess: true,
      depth: 0,
      req,
    })
    .catch(() => null)

  if (!publicationDoc || (publicationDoc as any).isDeleting) {
    throw new ValidationError({
      errors: [
        {
          message: 'Publication does not exist or is being deleted.',
          path: 'publication',
        },
      ],
    })
  }

  const isPublicationPublished = Boolean(
    publicationDoc?._status === 'published',
  )
  data.isPublicationPublished = isPublicationPublished

  if (parentId) {
    const parentDoc = await req.payload
      .findByID({
        collection: 'publication-sections',
        id: parentId,
        overrideAccess: true,
        depth: 0,
        req,
      })
      .catch(() => null)

    if (!parentDoc || (parentDoc as any).isDeleting) {
      throw new ValidationError({
        errors: [
          {
            message: 'Parent section does not exist or is being deleted.',
            path: 'parent',
          },
        ],
      })
    }

    const rawAncestors = Array.isArray(parentDoc?.ancestors)
      ? parentDoc.ancestors.map(extractId).filter(Boolean)
      : []

    data.depth = (parentDoc?.depth ?? 0) + 1
    data.ancestors = [...rawAncestors, parentId]

    const isAncestorsPublished = Boolean(
      parentDoc?._status === 'published' &&
        parentDoc?.isAncestorsPublished === true,
    )
    data.isAncestorsPublished = isAncestorsPublished
  } else {
    data.depth = 0
    data.ancestors = []
    data.isAncestorsPublished = true
  }

  const sectionStatus = data._status ?? originalDoc?._status ?? 'draft'
  data.isPublishedEffective = Boolean(
    sectionStatus === 'published' &&
      data.isPublicationPublished &&
      data.isAncestorsPublished,
  )

  return data
}

const afterChangePublicationSection: CollectionAfterChangeHook = async ({
  doc,
  req,
}) => {
  const liveDoc = await req.payload.db.findOne<PublicationSection>({
    collection: 'publication-sections',
    where: { id: { equals: doc.id } },
    req,
  })
  if (!liveDoc) return

  if (liveDoc._status === 'published' && doc._status === 'draft') {
    // Draft edit of published section - live section remains published
    return
  }

  await cascadeSectionDescendants(req.payload, doc.id, {
    req,
    currentDoc: liveDoc,
  })
}

const afterReadPublicationSection: CollectionAfterReadHook = ({ doc, req, overrideAccess }: any) => {
  if (overrideAccess || isStaff(req?.user as UserAuth | null)) {
    return doc
  }
  if (doc._status !== undefined && doc._status !== 'published') {
    throw new NotFound(req?.t)
  }
  if (doc.isPublishedEffective !== undefined && doc.isPublishedEffective !== true) {
    throw new NotFound(req?.t)
  }
  return doc
}

const beforeDeletePublicationSection: CollectionBeforeDeleteHook = async ({
  id,
  req,
}) => {
  const secIdStr = String(id)

  await acquireStructuralLocks(req.payload, req, { sections: [secIdStr] })

  const childSectionsCount = await req.payload.count({
    collection: 'publication-sections',
    where: {
      parent: { equals: secIdStr },
    },
    overrideAccess: true,
    req,
  })

  if (childSectionsCount.totalDocs > 0) {
    throw new ValidationError({
      errors: [
        {
          message: `Cannot delete section because it contains ${childSectionsCount.totalDocs} child sections. Delete or move child sections first.`,
          path: 'id',
        },
      ],
    })
  }

  const passagesCount = await req.payload.count({
    collection: 'passages',
    where: {
      section: { equals: secIdStr },
    },
    overrideAccess: true,
    req,
  })

  if (passagesCount.totalDocs > 0) {
    throw new ValidationError({
      errors: [
        {
          message: `Cannot delete section because it contains ${passagesCount.totalDocs} passages. Delete or move passages first.`,
          path: 'id',
        },
      ],
    })
  }
}

export const PublicationSections: CollectionConfig = {
  slug: 'publication-sections',

  labels: {
    singular: {
      en: 'Section',
      am: 'ክፍል',
    },
    plural: {
      en: 'Sections',
      am: 'ክፍሎች',
    },
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'typeKey', 'publication', 'parent', '_status', 'depth'],
    group: {
      en: 'Content',
      am: 'ይዘት',
    },
  },

  access: {
    admin: canAccessAdmin,

    read: ({ req }) => {
      if (isStaff(req.user as UserAuth | null)) {
        return true
      }
      const where: Where = {
        and: [
          {
            _status: {
              equals: 'published',
            },
          },
          {
            isPublishedEffective: {
              equals: true,
            },
          },
        ],
      }
      return where
    },

    readVersions: ({ req }) => {
      return isStaff(req.user as UserAuth | null)
    },

    create: ({ req }) => {
      return isStaff(req.user as UserAuth | null)
    },

    update: ({ req }) => {
      return isStaff(req.user as UserAuth | null)
    },

    delete: ({ req }) => {
      return isAdmin(req.user as UserAuth | null)
    },
  },

  versions: {
    drafts: true,
    maxPerDoc: 30,
  },

  indexes: [
    {
      fields: ['publication', 'parent', 'slug'],
      unique: true,
    },
    {
      fields: ['publication', 'isPublishedEffective'],
    },
    {
      fields: ['parent', 'order'],
    },
  ],

  hooks: {
    beforeOperation: [beforeOperationPublicationSection],
    beforeValidate: [beforeValidatePublicationSection],
    beforeChange: [beforeChangePublicationSection],
    afterChange: [afterChangePublicationSection],
    beforeDelete: [beforeDeletePublicationSection],
    afterRead: [afterReadPublicationSection],
  },

  fields: [
    {
      name: 'publication',
      type: 'relationship',
      relationTo: 'publications',
      required: true,
      hasMany: false,
      label: {
        en: 'Publication',
        am: 'ህትመት',
      },
      admin: {
        description: {
          en: 'The publication this section belongs to.',
          am: 'ይህ ክፍል የሚካተትበት ህትመት።',
        },
      },
    },

    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'publication-sections',
      required: false,
      hasMany: false,
      label: {
        en: 'Parent Section',
        am: 'የበላይ ክፍል',
      },
      admin: {
        description: {
          en: 'Parent section in hierarchy. Leave empty for root sections.',
          am: 'የበላይ ክፍል፤ ለዋናው ደረጃ ባዶ ይተዉት።',
        },
      },
    },

    {
      name: 'typeKey',
      type: 'text',
      required: true,
      label: {
        en: 'Section Type Key',
        am: 'የክፍል አይነት መለያ',
      },
      admin: {
        description: {
          en: 'Matches a defined section type key in the publication structure (e.g. book, chapter, day).',
          am: 'በህትመቱ መዋቅር ውስጥ የተገለጸ አይነት (ለምሳሌ book, chapter, day)።',
        },
      },
    },

    {
      name: 'title',
      type: 'text',
      required: true,
      localized: true,
      maxLength: 250,
      label: {
        en: 'Title',
        am: 'ርዕስ',
      },
      admin: {
        description: {
          en: 'Name of the section (e.g. Genesis, Chapter 1, Sunday Praises).',
          am: 'የክፍሉ ስም (ለምሳሌ ኦሪት ዘፍጥረት፣ ምዕራፍ ፩፣ የእሑድ ውዳሴ ማርያም)።',
        },
      },
    },

    {
      name: 'slug',
      type: 'text',
      required: true,
      maxLength: 150,
      label: {
        en: 'Slug',
        am: 'የአገናኝ መለያ',
      },
      validate: (value: unknown) => {
        if (!value) return true
        return (
          (typeof value === 'string' &&
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) ||
          'Use lowercase English letters, numbers, and single hyphens.'
        )
      },
      admin: {
        description: {
          en: 'Identifier unique among siblings sharing the same parent.',
          am: 'በአንድ የበላይ ክፍል ሥር ባሉ ክፍሎች መካከል ልዩ የሆነ መለያ።',
        },
      },
    },

    {
      name: 'introduction',
      type: 'textarea',
      localized: true,
      maxLength: 2000,
      label: {
        en: 'Introduction',
        am: 'መግቢያ',
      },
    },

    {
      name: 'order',
      type: 'number',
      required: true,
      defaultValue: 0,
      label: {
        en: 'Sequence Order',
        am: 'ቅደም ተከተል',
      },
      admin: {
        description: {
          en: 'Numerical sort index relative to siblings.',
          am: 'ከተመሳሳይ አቻ ክፍሎች አንጻር የቅደም ተከተል ቁጥር።',
        },
      },
    },

    {
      name: 'number',
      type: 'number',
      label: {
        en: 'Section Number',
        am: 'የክፍል ቁጥር',
      },
      admin: {
        description: {
          en: 'Canonical section number (e.g., chapter number, day number).',
          am: 'ትክክለኛው የክፍል ቁጥር (ለምሳሌ የምዕራፍ ቁጥር)።',
        },
      },
    },

    {
      name: 'displayLabel',
      type: 'text',
      localized: true,
      maxLength: 150,
      label: {
        en: 'Display Label',
        am: 'የሚታይ መጠሪያ',
      },
      admin: {
        description: {
          en: 'Contextual label (e.g. "Chapter 1" / "ምዕራፍ ፩").',
          am: 'የሚታይ መጠሪያ (ለምሳሌ "ምዕራፍ ፩")።',
        },
      },
    },

    {
      name: 'weekday',
      type: 'select',
      label: {
        en: 'Liturgical Weekday',
        am: 'የዕለት ሥርዓት',
      },
      options: [
        { label: { en: 'Monday', am: 'ሰኞ' }, value: 'monday' },
        { label: { en: 'Tuesday', am: 'ማክሰኞ' }, value: 'tuesday' },
        { label: { en: 'Wednesday', am: 'ረቡዕ' }, value: 'wednesday' },
        { label: { en: 'Thursday', am: 'ሐሙስ' }, value: 'thursday' },
        { label: { en: 'Friday', am: 'ዓርብ' }, value: 'friday' },
        { label: { en: 'Saturday', am: 'ቀዳሚት' }, value: 'saturday' },
        { label: { en: 'Sunday', am: 'እሑድ' }, value: 'sunday' },
      ],
      admin: {
        description: {
          en: 'Applicable for daily prayers/readings such as Wudase Maryam.',
          am: 'እንደ ውዳሴ ማርያም ላሉ የዕለት ንባባትና ጸሎታት የሚያገለግል።',
        },
      },
    },

    // Denormalized system-managed fields
    {
      name: 'depth',
      type: 'number',
      defaultValue: 0,
      label: {
        en: 'Hierarchy Depth',
        am: 'የደረጃ ጥልቀት',
      },
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },

    {
      name: 'ancestors',
      type: 'relationship',
      relationTo: 'publication-sections',
      hasMany: true,
      label: {
        en: 'Ancestors',
        am: 'የቀደሙ ክፍሎች',
      },
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },

    {
      name: 'isPublicationPublished',
      type: 'checkbox',
      defaultValue: false,
      label: {
        en: 'Publication Is Published',
        am: 'ህትመቱ ታትሟል',
      },
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },

    {
      name: 'isAncestorsPublished',
      type: 'checkbox',
      defaultValue: true,
      label: {
        en: 'All Ancestors Published',
        am: 'ሁሉም የቀደሙ ክፍሎች ታትመዋል',
      },
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },

    {
      name: 'isPublishedEffective',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      label: {
        en: 'Effective Published State',
        am: 'ትክክለኛ የታተመ ሁኔታ',
      },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: {
          en: 'True only when this section, its publication, and all ancestor sections are published.',
          am: 'እውነተኛ የሚሆነው ይህ ክፍል፣ ህትመቱ እና ሁሉም የበላይ ክፍሎች ሲታተሙ ብቻ ነው።',
        },
      },
    },

    {
      name: 'isDeleting',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        hidden: true,
      },
    },
  ],
}
