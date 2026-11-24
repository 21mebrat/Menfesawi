import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { ValidationError } from 'payload'

import {
  canAccessAdmin,
  isAdmin,
  isStaff,
  type UserAuth,
} from '../access'

/**
 * Validates an optional HTTPS URL:
 * - Empty string, null, or undefined is valid (field is optional).
 * - Non-empty string must be a well-formed HTTPS URL without embedded credentials.
 * - Rejects raw HTML / iframe markup.
 */
export const validateOptionalHTTPSURL = (value: unknown): true | string => {
  if (value === undefined || value === null || value === '') {
    return true
  }

  if (typeof value !== 'string') {
    return 'Enter a valid HTTPS URL.'
  }

  const trimmed = value.trim()
  if (trimmed === '') {
    return true
  }

  if (trimmed.includes('<') || trimmed.includes('>')) {
    return 'Enter a valid HTTPS URL, not HTML code.'
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || url.username || url.password) {
      return 'Use an HTTPS URL without embedded credentials.'
    }
    return true
  } catch {
    return 'Enter a valid HTTPS URL.'
  }
}

/**
 * Validates a required HTTPS URL:
 * - Must be a non-empty, well-formed HTTPS URL without embedded credentials.
 * - Rejects raw HTML / iframe markup.
 */
export const validateRequiredHTTPSURL = (value: unknown): true | string => {
  if (value === undefined || value === null || value === '') {
    return 'Enter a valid HTTPS URL.'
  }

  if (typeof value !== 'string') {
    return 'Enter a valid HTTPS URL.'
  }

  const trimmed = value.trim()
  if (trimmed === '') {
    return 'Enter a valid HTTPS URL.'
  }

  if (trimmed.includes('<') || trimmed.includes('>')) {
    return 'Enter a valid HTTPS URL, not HTML code.'
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || url.username || url.password) {
      return 'Use an HTTPS URL without embedded credentials.'
    }
    return true
  } catch {
    return 'Enter a valid HTTPS URL.'
  }
}

/**
 * Helper to resolve the effective text of a lyrics language field
 * while properly considering partial updates and explicit empty-string clears.
 */
function resolveLyricsField(
  dataLyrics: Record<string, unknown> | null | undefined,
  field: 'geez' | 'amharic' | 'english',
  originalDocLyrics: Record<string, unknown> | null | undefined,
): string {
  if (dataLyrics === null) {
    return ''
  }

  if (dataLyrics !== undefined && typeof dataLyrics === 'object') {
    if (field in dataLyrics) {
      const val = dataLyrics[field]
      if (val === null || val === '') {
        return ''
      }
      if (typeof val === 'string') {
        return val
      }
      if (val === undefined) {
        const origVal = originalDocLyrics?.[field]
        return typeof origVal === 'string' ? origVal : ''
      }
    }
  }

  const origVal = originalDocLyrics?.[field]
  return typeof origVal === 'string' ? origVal : ''
}

/**
 * Extracts category IDs from array, relationship object, or single value.
 */
function extractCategoryIds(value: unknown): (string | number)[] {
  if (!value) return []
  const list = Array.isArray(value) ? value : [value]
  const ids: (string | number)[] = []
  for (const item of list) {
    if (item === null || item === undefined) continue
    if (typeof item === 'object') {
      const id = (item as any).id || (item as any)._id
      if (id) ids.push(id)
    } else if (typeof item === 'string' || typeof item === 'number') {
      ids.push(item)
    }
  }
  return ids
}

/**
 * Collection-level beforeValidate hook for Hymns:
 * 1. Allows incomplete drafts (bypasses lyrics publication requirement).
 * 2. Requires at least one non-empty lyrics field before publication.
 * 3. Handles partial updates and explicit empty-string field clears accurately.
 * 4. Validates server-side that all assigned categories have 'hymns' in contentTypes.
 */
export const beforeValidateHymn: CollectionBeforeValidateHook = async ({
  data,
  req,
  originalDoc,
}) => {
  if (!data) return data

  const effectiveStatus = data._status ?? originalDoc?._status ?? 'draft'

  // Require at least one non-empty lyrics field before publication
  if (effectiveStatus === 'published') {
    const geez = resolveLyricsField(data.lyrics, 'geez', originalDoc?.lyrics)
    const amharic = resolveLyricsField(data.lyrics, 'amharic', originalDoc?.lyrics)
    const english = resolveLyricsField(data.lyrics, 'english', originalDoc?.lyrics)

    const hasGeez = typeof geez === 'string' && geez.trim().length > 0
    const hasAmharic = typeof amharic === 'string' && amharic.trim().length > 0
    const hasEnglish = typeof english === 'string' && english.trim().length > 0

    if (!hasGeez && !hasAmharic && !hasEnglish) {
      throw new ValidationError({
        errors: [
          {
            message:
              'At least one lyrics field (Ge’ez, Amharic, or English) must be non-empty before publication.',
            path: 'lyrics',
          },
        ],
      })
    }
  }

  // Server-side validation of category applicability
  if (data.categories !== undefined) {
    const categoryIds = extractCategoryIds(data.categories)

    if (categoryIds.length > 0 && req?.payload) {
      for (const catId of categoryIds) {
        let categoryDoc: any = null
        try {
          categoryDoc = await req.payload.findByID({
            collection: 'categories',
            id: catId,
            overrideAccess: true,
          })
        } catch {
          categoryDoc = null
        }

        if (!categoryDoc) {
          throw new ValidationError({
            errors: [
              {
                message: `Category '${catId}' not found.`,
                path: 'categories',
              },
            ],
          })
        }

        const contentTypes = Array.isArray(categoryDoc.contentTypes)
          ? categoryDoc.contentTypes
          : []

        if (!contentTypes.includes('hymns')) {
          const catName =
            typeof categoryDoc.name === 'string'
              ? categoryDoc.name
              : categoryDoc.name?.en || categoryDoc.name?.am || String(catId)

          throw new ValidationError({
            errors: [
              {
                message: `Category '${catName}' is not applicable to hymns.`,
                path: 'categories',
              },
            ],
          })
        }
      }
    }
  }

  return data
}

export const Hymns: CollectionConfig = {
  slug: 'hymns',

  labels: {
    singular: {
      en: 'Hymn',
      am: 'መዝሙር',
    },
    plural: {
      en: 'Hymns',
      am: 'መዝሙሮች',
    },
  },

  admin: {
    group: {
      en: 'Content',
      am: 'ይዘት',
    },

    useAsTitle: 'title',

    defaultColumns: ['title', 'kind', '_status', 'updatedAt'],

    listSearchableFields: ['title', 'slug'],

    description: {
      en: 'Hymns, chants, and Marian praises with multilingual lyrics and supporting recordings.',
      am: 'የመዝሙር፣ የዜማ እና የእመቤታችን ምስጋና ስንኞች ከተለያዩ ቋንቋዎች እና ማጣቀሻዎች ጋር።',
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
    beforeValidate: [beforeValidateHymn],
  },

  fields: [
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
          en: 'The title of the hymn in the selected language.',
          am: 'የመዝሙሩ ርዕስ በተመረጠው ቋንቋ።',
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
        if (!value) {
          return true
        }
        return (
          (typeof value === 'string' &&
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) ||
          'Use lowercase English letters, numbers, and single hyphens.'
        )
      },

      admin: {
        description: {
          en: 'A stable identifier shared across languages. Avoid changing it after publication.',
          am: 'በሁሉም ቋንቋዎች የሚጠቀሙበት ቋሚ መለያ። ከታተመ በኋላ መቀየርን ያስወግዱ።',
        },
      },
    },

    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'general',

      label: {
        en: 'Hymn kind',
        am: 'የመዝሙር ዓይነት',
      },

      admin: {
        description: {
          en: 'Select whether this is a general hymn or Marian praise.',
          am: 'ይህ አጠቃላይ መዝሙር ወይም የእመቤታችን ምስጋና መሆኑን ይምረጡ።',
        },
      },

      options: [
        {
          label: {
            en: 'General hymn',
            am: 'አጠቃላይ መዝሙር',
          },
          value: 'general',
        },
        {
          label: {
            en: 'Marian praise',
            am: 'የእመቤታችን ምስጋና',
          },
          value: 'marian',
        },
      ],
    },

    {
      name: 'summary',
      type: 'textarea',
      localized: true,
      maxLength: 1000,

      label: {
        en: 'Summary',
        am: 'ማጠቃለያ',
      },

      admin: {
        description: {
          en: 'Brief overview or liturgical context of the hymn.',
          am: 'የመዝሙሩ አጭር ማጠቃለያ ወይም ሥርዓታዊ አውድ።',
        },
      },
    },

    {
      name: 'lyrics',
      type: 'group',

      label: {
        en: 'Lyrics',
        am: 'የመዝሙር ስንኞች',
      },

      admin: {
        description: {
          en: 'Hymn lyrics in Ge’ez, Amharic, or English. Line breaks and stanzas are preserved.',
          am: 'የመዝሙሩ ስንኞች በግዕዝ፣ በአማርኛ ወይም በእንግሊዝኛ። የስንኝ ክፍተቶች እና መስመሮች እንዳሉ ይጠበቃሉ።',
        },
      },

      fields: [
        {
          name: 'geez',
          type: 'textarea',

          label: {
            en: "Ge'ez",
            am: 'ግዕዝ',
          },

          admin: {
            description: {
              en: "Hymn lyrics in Ge'ez.",
              am: 'የመዝሙሩ ስንኞች በግዕዝ።',
            },
          },
        },
        {
          name: 'amharic',
          type: 'textarea',

          label: {
            en: 'Amharic',
            am: 'አማርኛ',
          },

          admin: {
            description: {
              en: 'Hymn lyrics in Amharic.',
              am: 'የመዝሙሩ ስንኞች በአማርኛ።',
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
              en: 'Hymn lyrics in English.',
              am: 'የመዝሙሩ ስንኞች በእንግሊዝኛ።',
            },
          },
        },
      ],
    },

    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,

      label: {
        en: 'Categories',
        am: 'ምድቦች',
      },

      filterOptions: {
        contentTypes: {
          contains: 'hymns',
        },
      },

      admin: {
        description: {
          en: 'Select categories applicable to hymns.',
          am: 'ለመዝሙር የሚመለከታቸውን ምድቦች ይምረጡ።',
        },
      },
    },

    {
      name: 'attribution',
      type: 'textarea',
      localized: true,
      maxLength: 1000,

      label: {
        en: 'Attribution',
        am: 'ዕውቅና (ደራሲ/ዜማ)',
      },

      admin: {
        description: {
          en: 'Credit the author, composer, or traditional source when known (e.g. Saint Yared).',
          am: 'የመዝሙሩ ደራሲ፣ የዜማ አቀናባሪ ወይም ባህላዊ ምንጭ ሲታወቅ እዚህ ይጠቀሱ (ለምሳሌ፦ ቅዱስ ያሬድ)።',
        },
      },
    },

    {
      name: 'sources',
      type: 'array',

      label: {
        en: 'Sources',
        am: 'ምንጮች',
      },

      admin: {
        description: {
          en: 'Liturgical sources, hymn books, or citations for this hymn.',
          am: 'የዚህ መዝሙር ሥርዓተ አምልኮ ምንጮች፣ መጻሕፍተ መዛሙር ወይም ማጣቀሻዎች።',
        },
      },

      fields: [
        {
          name: 'reference',
          type: 'text',
          required: true,
          localized: true,
          maxLength: 500,

          label: {
            en: 'Reference',
            am: 'የምንጭ ማጣቀሻ',
          },

          admin: {
            description: {
              en: 'A book title, liturgical reference, or citation.',
              am: 'የመጽሐፍ ርዕስ፣ የሥርዓት ማጣቀሻ ወይም ጥቅስ።',
            },
          },
        },
        {
          name: 'url',
          type: 'text',
          maxLength: 2048,
          validate: validateOptionalHTTPSURL,

          label: {
            en: 'Source link',
            am: 'የምንጭ አገናኝ',
          },

          admin: {
            description: {
              en: 'Optional HTTPS link to the source citation.',
              am: 'አማራጭ የHTTPS የምንጭ አገናኝ።',
            },
          },
        },
      ],
    },

    {
      name: 'resources',
      type: 'array',

      label: {
        en: 'Resources',
        am: 'ተጨማሪ መረጃዎች',
      },

      admin: {
        description: {
          en: 'Recordings, videos, and external learning links. Store URLs only; iframe HTML is not accepted.',
          am: 'የመዝሙሩ ቅጂዎች፣ ቪዲዮዎች እና ውጫዊ የትምህርት አገናኞች። አገናኞችን ብቻ ያስገቡ፤ የiframe ኮድ አይፈቀድም።',
        },
      },

      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
          localized: true,
          maxLength: 200,

          label: {
            en: 'Resource title',
            am: 'የመረጃው ርዕስ',
          },
        },
        {
          name: 'type',
          type: 'select',
          required: true,
          defaultValue: 'video',

          label: {
            en: 'Resource type',
            am: 'የመረጃው ዓይነት',
          },

          options: [
            {
              label: {
                en: 'Video',
                am: 'ቪዲዮ',
              },
              value: 'video',
            },
            {
              label: {
                en: 'External link',
                am: 'ውጫዊ አገናኝ',
              },
              value: 'link',
            },
          ],
        },
        {
          name: 'url',
          type: 'text',
          required: true,
          maxLength: 2048,
          validate: validateRequiredHTTPSURL,

          label: {
            en: 'Resource URL',
            am: 'የመረጃው አገናኝ',
          },

          admin: {
            description: {
              en: 'A YouTube, Telegram, or other supporting HTTPS link. Raw iframe HTML is rejected.',
              am: 'የYouTube፣ የTelegram ወይም ሌላ የHTTPS አገናኝ። የiframe ኮድ ተቀባይነት የለውም።',
            },
          },
        },
        {
          name: 'description',
          type: 'textarea',
          localized: true,
          maxLength: 1000,

          label: {
            en: 'Description',
            am: 'መግለጫ',
          },
        },
      ],
    },
  ],

  timestamps: true,
}
