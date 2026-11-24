import type {
  CollectionAfterChangeHook,
  CollectionAfterReadHook,
  CollectionBeforeDeleteHook,
  CollectionBeforeOperationHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
} from 'payload'
import { NotFound, ValidationError } from 'payload'

import {
  canAccessAdmin,
  isAdmin,
  isStaff,
  type UserAuth,
} from '../access'
import { validatePublicationStructure } from '../lib/server/reading/validation'
import {
  cascadePublicationStatus,
  acquireStructuralLocks,
  getMongoSession,
} from '../lib/server/reading/cascade'

const beforeOperationPublication: CollectionBeforeOperationHook = ({
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
  }
  return args
}

const beforeValidatePublication: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  if (!data) return data

  if (originalDoc?.id) {
    await acquireStructuralLocks(req.payload, req, { publications: [originalDoc.id] })
  }

  // Normalize allowedChildTypes rows to { typeKey: string } objects for Payload array field sanitizer
  if (data.structure && typeof data.structure === 'object') {
    const rawStructure = data.structure as any
    if (Array.isArray(rawStructure.sectionTypes)) {
      for (const st of rawStructure.sectionTypes) {
        if (Array.isArray(st.allowedChildTypes)) {
          st.allowedChildTypes = st.allowedChildTypes.map((child: any) =>
            typeof child === 'string' ? { typeKey: child } : child,
          )
        }
      }
    }
  }

  const structureToValidate = data.structure ?? originalDoc?.structure
  if (structureToValidate) {
    await validatePublicationStructure({
      structure: structureToValidate,
      existingPublicationId: originalDoc?.id,
      payload: req.payload,
      req,
    })
  }

  return data
}

const beforeDeletePublication: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const pubIdStr = String(id)
  await acquireStructuralLocks(req.payload, req, { publications: [pubIdStr] })

  const sectionCount = await req.payload.count({
    collection: 'publication-sections',
    where: {
      publication: { equals: pubIdStr },
    },
    overrideAccess: true,
    req,
  })

  if (sectionCount.totalDocs > 0) {
    throw new ValidationError({
      errors: [
        {
          message: `Cannot delete publication because it contains ${sectionCount.totalDocs} sections. Remove all sections first.`,
          path: 'id',
        },
      ],
    })
  }
}

const afterChangePublication: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  context,
}) => {
  const isDraftOp = Boolean(context?.isDraftOperation || req?.context?.isDraftOperation)
  if (isDraftOp && previousDoc?._status === 'published') {
    return
  }

  const session = await getMongoSession(req.payload, req)
  const mongoOpts = session ? { session } : {}
  const pubsModel = req.payload.db.collections?.['publications']
  const liveDoc = pubsModel
    ? await pubsModel.findById(doc.id, { _status: 1 }, mongoOpts).lean()
    : await req.payload.db.findOne({
        collection: 'publications',
        where: { id: { equals: doc.id } },
        req,
      })

  if ((liveDoc as any)?._status === 'published' && doc._status === 'draft') {
    // Draft edit of published publication: live publication remains published
    return
  }

  const isLivePublished = liveDoc
    ? (liveDoc as any)._status === 'published'
    : doc._status === 'published'

  // Determine if published state changed relative to sections
  const secModel = req.payload.db.collections?.['publication-sections']
  let shouldCascade = false

  if (isLivePublished) {
    if (previousDoc?._status !== 'published') {
      shouldCascade = true
    } else if (secModel) {
      const unpubCount = await secModel.countDocuments(
        { publication: String(doc.id), isPublicationPublished: false },
        mongoOpts,
      )
      if (unpubCount > 0) shouldCascade = true
    } else {
      const unpubSec = await req.payload.find({
        collection: 'publication-sections',
        where: {
          publication: { equals: doc.id },
          isPublicationPublished: { equals: false },
        },
        limit: 1,
        overrideAccess: true,
        req,
      })
      if (unpubSec.totalDocs > 0) shouldCascade = true
    }
  } else {
    if (previousDoc?._status === 'published') {
      shouldCascade = true
    } else if (secModel) {
      const pubCount = await secModel.countDocuments(
        { publication: String(doc.id), isPublicationPublished: true },
        mongoOpts,
      )
      if (pubCount > 0) shouldCascade = true
    } else {
      const pubSec = await req.payload.find({
        collection: 'publication-sections',
        where: {
          publication: { equals: doc.id },
          isPublicationPublished: { equals: true },
        },
        limit: 1,
        overrideAccess: true,
        req,
      })
      if (pubSec.totalDocs > 0) shouldCascade = true
    }
  }

  if (shouldCascade) {
    await cascadePublicationStatus(req.payload, doc.id, isLivePublished, { req })
  }
}

const afterReadPublication: CollectionAfterReadHook = ({ doc, req, overrideAccess }: any) => {
  if (overrideAccess || isStaff(req?.user as UserAuth | null)) {
    return doc
  }
  if (doc._status !== undefined && doc._status !== 'published') {
    throw new NotFound(req?.t)
  }
  return doc
}

export const Publications: CollectionConfig = {
  slug: 'publications',

  labels: {
    singular: {
      en: 'Publication',
      am: 'ህትመት',
    },
    plural: {
      en: 'Publications',
      am: 'ህትመቶች',
    },
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
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
      return {
        _status: {
          equals: 'published',
        },
      }
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

  hooks: {
    beforeOperation: [beforeOperationPublication],
    beforeValidate: [beforeValidatePublication],
    beforeDelete: [beforeDeletePublication],
    afterChange: [afterChangePublication],
    afterRead: [afterReadPublication],
  },

  fields: [
    {
      name: 'isDeleting',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        hidden: true,
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
          en: 'Publication title (e.g., The Holy Bible, Wudase Maryam).',
          am: 'የህትመቱ ርዕስ (ለምሳሌ መጽሐፍ ቅዱስ፣ ውዳሴ ማርያም)።',
        },
      },
    },

    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
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
          en: 'URL-friendly identifier unique across publications.',
          am: 'በህትመቶች መካከል ልዩ የሆነ የአገናኝ መለያ።',
        },
      },
    },

    {
      name: 'description',
      type: 'textarea',
      localized: true,
      maxLength: 2000,
      label: {
        en: 'Description',
        am: 'መግለጫ',
      },
      admin: {
        description: {
          en: 'Overview or historical context of this publication.',
          am: 'ስለ ህትመቱ አጠቃላይ መግለጫ ወይም ታሪካዊ ይዘት።',
        },
      },
    },

    {
      name: 'attribution',
      type: 'text',
      localized: true,
      maxLength: 300,
      label: {
        en: 'Attribution / Author',
        am: 'ደራሲ / ምንጭ',
      },
      admin: {
        description: {
          en: 'Traditional or historical author/translator attribution.',
          am: 'ባህላዊ ወይም ታሪካዊ ደራሲ / ተርጓሚ።',
        },
      },
    },

    {
      name: 'rights',
      type: 'text',
      localized: true,
      maxLength: 300,
      label: {
        en: 'Rights / Heritage Note',
        am: 'መብቶች / የቅርስ ማስታወሻ',
      },
      admin: {
        description: {
          en: 'Rights, copyright, or liturgical heritage information.',
          am: 'የመብት ወይም የሥርዓተ ቤተ ክርስቲያን ቅርስ ማስታወሻ።',
        },
      },
    },

    {
      name: 'structure',
      type: 'group',
      label: {
        en: 'Hierarchy Structure Configuration',
        am: 'የመዋቅር ውቅር',
      },
      fields: [
        {
          name: 'maxDepth',
          type: 'number',
          required: true,
          defaultValue: 6,
          min: 1,
          max: 10,
          label: {
            en: 'Maximum Nesting Depth',
            am: 'ከፍተኛው የደረጃ ጥልቀት',
          },
          admin: {
            description: {
              en: 'Maximum hierarchy depth (1 to 10) permitted for sections.',
              am: 'ለክፍሎች የተፈቀደው ከፍተኛው የደረጃ ጥልቀት (ከ1 እስከ 10)።',
            },
          },
        },
        {
          name: 'sectionTypes',
          type: 'array',
          required: true,
          label: {
            en: 'Configured Section Types',
            am: 'የተዋቀሩ የክፍል አይነቶች',
          },
          fields: [
            {
              name: 'key',
              type: 'text',
              required: true,
              label: {
                en: 'Type Key',
                am: 'የአይነት መለያ',
              },
              admin: {
                description: {
                  en: 'Stable identifier (e.g., testament, book, chapter, day, prayer).',
                  am: 'የማይለወጥ መለያ (ለምሳሌ testament, book, chapter, day, prayer)።',
                },
              },
            },
            {
              name: 'labels',
              type: 'group',
              label: {
                en: 'Display Labels',
                am: 'የመጠሪያ ስሞች',
              },
              fields: [
                {
                  name: 'singular',
                  type: 'group',
                  label: { en: 'Singular Label', am: 'ነጠላ መጠሪያ' },
                  fields: [
                    { name: 'en', type: 'text', required: true, label: 'English' },
                    { name: 'am', type: 'text', required: true, label: 'Amharic / አማርኛ' },
                  ],
                },
                {
                  name: 'plural',
                  type: 'group',
                  label: { en: 'Plural Label', am: 'ብዙ መጠሪያ' },
                  fields: [
                    { name: 'en', type: 'text', required: true, label: 'English' },
                    { name: 'am', type: 'text', required: true, label: 'Amharic / አማርኛ' },
                  ],
                },
              ],
            },
            {
              name: 'actionLabels',
              type: 'group',
              label: {
                en: 'Contextual Action Labels',
                am: 'የድርጊት መጠሪያዎች',
              },
              fields: [
                { name: 'en', type: 'text', label: 'English (e.g. Add Book)' },
                { name: 'am', type: 'text', label: 'Amharic / አማርኛ (ለምሳሌ መጽሐፍ ጨምር)' },
              ],
            },
            {
              name: 'allowedAtRoot',
              type: 'checkbox',
              defaultValue: false,
              label: {
                en: 'Allowed at Root',
                am: 'በዋናው ደረጃ የተፈቀደ',
              },
            },
            {
              name: 'allowedChildTypes',
              type: 'array',
              label: {
                en: 'Permitted Child Types',
                am: 'የተፈቀዱ የንዑስ ክፍል አይነቶች',
              },
              fields: [
                {
                  name: 'typeKey',
                  type: 'text',
                  required: true,
                  label: { en: 'Child Type Key', am: 'የንዑስ አይነት መለያ' },
                },
              ],
            },
            {
              name: 'allowPassages',
              type: 'checkbox',
              defaultValue: false,
              label: {
                en: 'Allows Direct Passages',
                am: 'ምንባባትን በቀጥታ ይይዛል',
              },
            },
            {
              name: 'passageTerminology',
              type: 'group',
              label: {
                en: 'Passage Terminology',
                am: 'የምንባብ መጠሪያ',
              },
              fields: [
                {
                  name: 'singular',
                  type: 'group',
                  fields: [
                    { name: 'en', type: 'text', label: 'English (e.g. Verse, Paragraph)' },
                    { name: 'am', type: 'text', label: 'Amharic / አማርኛ (ለምሳሌ ቁጥር፣ አንቀጽ)' },
                  ],
                },
                {
                  name: 'plural',
                  type: 'group',
                  fields: [
                    { name: 'en', type: 'text', label: 'English (e.g. Verses, Paragraphs)' },
                    { name: 'am', type: 'text', label: 'Amharic / አማርኛ' },
                  ],
                },
              ],
            },
            {
              name: 'numberingPolicy',
              type: 'select',
              defaultValue: 'optional',
              required: true,
              label: {
                en: 'Passage Numbering Policy',
                am: 'የምንባብ ቁጥር ደንብ',
              },
              options: [
                {
                  label: { en: 'Required', am: 'አስፈላጊ' },
                  value: 'required',
                },
                {
                  label: { en: 'Optional', am: 'አማራጭ' },
                  value: 'optional',
                },
                {
                  label: { en: 'None', am: 'ምንም' },
                  value: 'none',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
