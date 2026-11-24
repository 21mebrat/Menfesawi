import type {
  CollectionAfterChangeHook,
  CollectionAfterReadHook,
  CollectionBeforeChangeHook,
  CollectionBeforeOperationHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  Where,
} from 'payload'
import { NotFound, ValidationError } from 'payload'
import type { Passage } from '../payload-types'

import {
  canAccessAdmin,
  isAdmin,
  isStaff,
  type UserAuth,
} from '../access'
import {
  validatePassageIntegrity,
  normalizeSectionTypes,
} from '../lib/server/reading/validation'
import {
  extractId,
  acquireStructuralLocks,
} from '../lib/server/reading/cascade'

const beforeOperationPassage: CollectionBeforeOperationHook = ({
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
    if (anyArgs.select.notes && typeof anyArgs.select.notes === 'object') {
      anyArgs.select.notes.visibility = true
    }
    for (const key of Object.keys(anyArgs.select)) {
      if (key.startsWith('notes.') || key === 'notes') {
        anyArgs.select['notes.visibility'] = true
        break
      }
    }
  }
  return args
}

const beforeValidatePassage: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  if (!data) return data

  const sectionId = extractId(data.section ?? originalDoc?.section)
  // Payload's originalDoc may be the latest unpublished version of a moved passage.
  const livePassage = originalDoc?.id
    ? await req.payload.db.findOne<Pick<Passage, 'id' | 'section'>>({
        collection: 'passages',
        where: { id: { equals: originalDoc.id } },
        select: { section: true },
        req,
      })
    : null
  await acquireStructuralLocks(req.payload, req, { sections: [sectionId, livePassage?.section] })

  if (!sectionId) return data

  const status = (data._status ?? originalDoc?._status ?? 'draft') as
    | 'draft'
    | 'published'

  const resolvedNumber =
    data.number !== undefined ? data.number : originalDoc?.number

  const resolvedText = {
    geez: data.text?.geez !== undefined ? data.text.geez : originalDoc?.text?.geez,
    amharic:
      data.text?.amharic !== undefined
        ? data.text.amharic
        : originalDoc?.text?.amharic,
    english:
      data.text?.english !== undefined
        ? data.text.english
        : originalDoc?.text?.english,
  }

  await validatePassageIntegrity({
    payload: req.payload,
    sectionId,
    number: resolvedNumber,
    text: resolvedText,
    status,
    originalDoc,
    req,
  })

  return data
}

const beforeChangePassage: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const sectionId = extractId(data.section ?? originalDoc?.section)
  if (!sectionId) return data

  const sectionDoc = await req.payload
    .findByID({
      collection: 'publication-sections',
      id: sectionId,
      overrideAccess: true,
      depth: 0,
      req,
    })
    .catch(() => null)

  if (!sectionDoc || (sectionDoc as any).isDeleting) {
    throw new ValidationError({
      errors: [
        {
          message: 'Parent section does not exist or is being deleted.',
          path: 'section',
        },
      ],
    })
  }

  const pubId = extractId(sectionDoc.publication)
  if (!pubId) {
    throw new ValidationError({
      errors: [
        {
          message: 'Parent section does not belong to a valid publication.',
          path: 'section',
        },
      ],
    })
  }

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
          path: 'section',
        },
      ],
    })
  }

  const sectionTypes = normalizeSectionTypes(
    (publicationDoc as any).structure?.sectionTypes,
  )
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

  if (typeDef.numberingPolicy === 'required') {
    const resolvedNumber =
      data.number !== undefined ? data.number : originalDoc?.number
    const passageStatus = data._status ?? originalDoc?._status ?? 'draft'
    if (passageStatus === 'published') {
      if (
        typeof resolvedNumber !== 'number' ||
        !Number.isSafeInteger(resolvedNumber) ||
        resolvedNumber < 1
      ) {
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

  data.publication = pubId

  const isSectionPublished = Boolean(sectionDoc.isPublishedEffective)
  const isPublicationPublished = Boolean(sectionDoc.isPublicationPublished)

  data.isSectionPublished = isSectionPublished
  data.isPublicationPublished = isPublicationPublished

  const passageStatus = data._status ?? originalDoc?._status ?? 'draft'
  data.isPublishedEffective = Boolean(
    passageStatus === 'published' &&
      isSectionPublished &&
      isPublicationPublished,
  )

  return data
}

const afterChangePassage: CollectionAfterChangeHook = async ({
  context,
  previousDoc,
}) => {
  if (context?.isDraftOperation && previousDoc?._status === 'published') {
    return
  }
}

const afterReadPassage: CollectionAfterReadHook = ({ doc, req, overrideAccess }: any) => {
  if (overrideAccess || isStaff(req?.user as UserAuth | null)) {
    return doc
  }
  if (doc._status !== undefined && doc._status !== 'published') {
    throw new NotFound(req?.t)
  }
  if (doc.isPublishedEffective !== undefined && doc.isPublishedEffective !== true) {
    throw new NotFound(req?.t)
  }
  if (Array.isArray(doc.notes)) {
    // Fail closed: only explicit 'public' notes are visible to non-staff.
    // If visibility is omitted or undefined, or anything other than 'public', it is excluded.
    doc.notes = doc.notes.filter((note: any) => note?.visibility === 'public')
  }
  return doc
}

export const Passages: CollectionConfig = {
  slug: 'passages',

  labels: {
    singular: {
      en: 'Passage',
      am: 'ምንባብ',
    },
    plural: {
      en: 'Passages',
      am: 'ምንባባት',
    },
  },

  admin: {
    useAsTitle: 'displayLabel',
    defaultColumns: ['displayLabel', 'number', 'section', 'order', '_status'],
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
      fields: ['section', 'order'],
    },
    {
      fields: ['publication', 'isPublishedEffective'],
    },
  ],

  hooks: {
    beforeOperation: [beforeOperationPassage],
    beforeValidate: [beforeValidatePassage],
    beforeChange: [beforeChangePassage],
    afterChange: [afterChangePassage],
    afterRead: [afterReadPassage],
  },

  fields: [
    {
      name: 'section',
      type: 'relationship',
      relationTo: 'publication-sections',
      required: true,
      hasMany: false,
      label: {
        en: 'Parent Section',
        am: 'የበላይ ክፍል',
      },
      admin: {
        description: {
          en: 'The section this passage belongs to (e.g. Chapter 1, Sunday Prayer).',
          am: 'ይህ ምንባብ የሚካተትበት ክፍል (ለምሳሌ ምዕራፍ ፩፣ የእሑድ ጸሎት)።',
        },
      },
    },

    {
      name: 'publication',
      type: 'relationship',
      relationTo: 'publications',
      hasMany: false,
      label: {
        en: 'Publication',
        am: 'ህትመት',
      },
      admin: {
        readOnly: true,
        description: {
          en: 'Derived automatically from the parent section.',
          am: 'ከበላይ ክፍሉ በራስ-ሰር የተገኘ።',
        },
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
          en: 'Relative sort order within the section.',
          am: 'በክፍሉ ውስጥ ያለው የቅደም ተከተል ቁጥር።',
        },
      },
    },

    {
      name: 'number',
      type: 'number',
      label: {
        en: 'Passage Number',
        am: 'የምንባብ ቁጥር',
      },
      admin: {
        description: {
          en: 'Verse or paragraph number (required when configured in publication structure).',
          am: 'የቁጥር ወይም የአንቀጽ ቁጥር።',
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
          en: 'Custom label (e.g., "Verse 1" / "ቁጥር ፩").',
          am: 'የሚታይ መጠሪያ (ለምሳሌ "ቁጥር ፩")።',
        },
      },
    },

    {
      name: 'text',
      type: 'group',
      label: {
        en: 'Passage Text',
        am: 'የምንባብ ጽሑፍ',
      },
      fields: [
        {
          name: 'geez',
          type: 'textarea',
          label: {
            en: 'Ge’ez / ግዕዝ',
            am: 'ግዕዝ',
          },
          admin: {
            description: {
              en: 'Classical Ge’ez liturgical / biblical text with preserved spacing.',
              am: 'የግዕዝ ሥርዓታዊ ወይም መጽሐፍ ቅዱሳዊ ጽሑፍ።',
            },
          },
        },
        {
          name: 'amharic',
          type: 'textarea',
          label: {
            en: 'Amharic / አማርኛ',
            am: 'አማርኛ',
          },
          admin: {
            description: {
              en: 'Amharic translation or commentary text.',
              am: 'የአማርኛ ትርጉም ወይም ማብራሪያ።',
            },
          },
        },
        {
          name: 'english',
          type: 'textarea',
          label: {
            en: 'English',
            am: 'እንግሊዝኛ',
          },
          admin: {
            description: {
              en: 'English translation with preserved formatting.',
              am: 'የእንግሊዝኛ ትርጉም።',
            },
          },
        },
      ],
    },

    {
      name: 'notes',
      type: 'array',
      label: {
        en: 'Notes & Commentary',
        am: 'ማስታወሻዎች እና ማብራሪያዎች',
      },
      fields: [
        {
          name: 'content',
          type: 'textarea',
          required: true,
          label: {
            en: 'Content',
            am: 'ይዘት',
          },
        },
        {
          name: 'visibility',
          type: 'select',
          required: true,
          defaultValue: 'public',
          label: {
            en: 'Visibility',
            am: 'ተደራሽነት',
          },
          options: [
            {
              label: { en: 'Public Commentary', am: 'የሕዝብ ማብራሪያ' },
              value: 'public',
            },
            {
              label: { en: 'Editorial Note', am: 'የአዘጋጅ ማስታወሻ' },
              value: 'editorial',
            },
          ],
        },
        {
          name: 'source',
          type: 'text',
          maxLength: 300,
          label: {
            en: 'Source / Citation',
            am: 'ምንጭ / ጥቅስ',
          },
        },
      ],
    },

    // Denormalized system-managed fields
    {
      name: 'isSectionPublished',
      type: 'checkbox',
      defaultValue: false,
      label: {
        en: 'Parent Section Effectively Published',
        am: 'የበላይ ክፍል በትክክል ታትሟል',
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
        en: 'Publication Published',
        am: 'ህትመቱ ታትሟል',
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
          en: 'True only when this passage, its parent section (and ancestors), and the publication are all published.',
          am: 'እውነተኛ የሚሆነው ይህ ምንባብ፣ የበላይ ክፍሉ እና ህትመቱ ሁሉም ሲታተሙ ብቻ ነው።',
        },
      },
    },
  ],
}
