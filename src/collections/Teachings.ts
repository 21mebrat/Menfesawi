import type { CollectionConfig } from 'payload'

import {
  canAccessAdmin,
  isAdmin,
  isStaff,
  type UserAuth,
} from '../access'
import { queueTeachingAnnouncements } from '@/hooks/queueTeachingAnnouncements'

/**
 * Validate optional external links.
 * Required fields also use Payload's required validation.
 */
const validateHTTPSURL = (value: unknown): true | string => {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return true
  }

  if (typeof value !== 'string') {
    return 'Enter a valid HTTPS URL.'
  }

  try {
    const url = new URL(value)

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password
    ) {
      return 'Use an HTTPS URL without embedded credentials.'
    }

    return true
  } catch {
    return 'Enter a valid HTTPS URL.'
  }
}

export const Teachings: CollectionConfig = {
  slug: 'teachings',

  labels: {
    singular: {
      en: 'Teaching',
      am: 'ትምህርት',
    },
    plural: {
      en: 'Teachings',
      am: 'ትምህርቶች',
    },
  },

  admin: {
    group: {
      en: 'Content',
      am: 'ይዘት',
    },

    useAsTitle: 'title',

    defaultColumns: [
      'title',
      '_status',
      'updatedAt',
    ],

    listSearchableFields: ['title', 'slug'],

    description: {
      en: 'Religious teachings with optional videos and external resources.',
      am: 'ከአማራጭ ቪዲዮዎች እና ውጫዊ ምንጮች ጋር የሚቀርቡ ሃይማኖታዊ ትምህርቶች።',
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
  hooks: {
    afterChange: [queueTeachingAnnouncements]
  },

  versions: {
    drafts: true,
    maxPerDoc: 30,
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
      name: 'cover',
      type: 'upload',
      relationTo: 'media',

      label: {
        en: 'Cover image',
        am: 'የሽፋን ምስል',
      },

      filterOptions: {
        purpose: {
          equals: 'content',
        },
      },

      admin: {
        description: {
          en: 'The teaching cover, also available for social announcements.',
          am: 'ለትምህርቱ ሽፋን እና ለማኅበራዊ ሚዲያ ማስታወቂያዎች የሚጠቅም ምስል።',
        },
      },
    },

    {
      name: 'content',
      type: 'richText',
      required: true,
      localized: true,

      label: {
        en: 'Teaching content',
        am: 'የትምህርቱ ይዘት',
      },

      admin: {
        description: {
          en: 'Write the teaching using headings, paragraphs, lists, and source references.',
          am: 'ትምህርቱን በርዕሶች፣ አንቀጾች፣ ዝርዝሮች እና የምንጭ ማጣቀሻዎች ያዘጋጁ።',
        },
      },
    },

    {
      name: 'resources',
      type: 'array',

      label: {
        en: 'Videos and external links',
        am: 'ቪዲዮዎች እና ውጫዊ አገናኞች',
      },

      admin: {
        description: {
          en: 'Optional supporting resources. These are not social publishing destinations.',
          am: 'አማራጭ ተጨማሪ ምንጮች። እነዚህ በራስ-ሰር ማስታወቂያ የሚላክባቸው ቦታዎች አይደሉም።',
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
            am: 'የምንጩ ርዕስ',
          },
        },

        {
          name: 'type',
          type: 'select',
          required: true,
          defaultValue: 'link',

          label: {
            en: 'Resource type',
            am: 'የምንጩ ዓይነት',
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
          validate: validateHTTPSURL,

          label: {
            en: 'Resource URL',
            am: 'የምንጩ አገናኝ',
          },

          admin: {
            description: {
              en: 'A YouTube video, Telegram post, or another supporting HTTPS link.',
              am: 'የYouTube ቪዲዮ፣ የTelegram መልዕክት ወይም ሌላ ተጨማሪ የHTTPS አገናኝ።',
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
          contains: 'teachings',
        },
      },
    },

    {
      name: 'attribution',
      type: 'textarea',
      localized: true,
      maxLength: 1000,

      label: {
        en: 'Author or teacher attribution',
        am: 'የደራሲ ወይም የመምህር ዕውቅና',
      },

      admin: {
        description: {
          en: 'Credit the original author or teacher, where known.',
          am: 'የመጀመሪያው ደራሲ ወይም መምህር ከታወቀ ይጥቀሱ።',
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

      fields: [
        {
          name: 'reference',
          type: 'text',
          required: true,
          localized: true,
          maxLength: 500,

          label: {
            en: 'Source reference',
            am: 'የምንጭ ማጣቀሻ',
          },

          admin: {
            description: {
              en: 'A book title, scripture reference, or other source citation.',
              am: 'የመጽሐፍ ርዕስ፣ የመጽሐፍ ቅዱስ ማጣቀሻ ወይም ሌላ የምንጭ መግለጫ።',
            },
          },
        },

        {
          name: 'url',
          type: 'text',
          maxLength: 2048,
          validate: validateHTTPSURL,

          label: {
            en: 'Source link',
            am: 'የምንጭ አገናኝ',
          },
        },
      ],
    },

    /**
     * Public links to successfully published social posts.
     *
     * These are results, not manually entered destinations.
     * The trusted publishing service will populate this array.
     * Keep retries, credentials, and private errors elsewhere.
     */
    {
      name: 'socialPosts',
      type: 'array',

      label: {
        en: 'Published social posts',
        am: 'የታተሙ የማኅበራዊ ሚዲያ ልጥፎች',
      },

      access: {
        create: () => false,
        update: () => false,
      },

      admin: {
        readOnly: true,

        description: {
          en: 'Automatically recorded after successful posting. No destination links need to be entered here.',
          am: 'ልጥፉ በተሳካ ሁኔታ ከታተመ በኋላ በራስ-ሰር ይመዘገባል። እዚህ የመዳረሻ አገናኞችን ማስገባት አያስፈልግም።',
        },
      },

      fields: [
        {
          name: 'destination',
          type: 'select',
          required: true,

          label: {
            en: 'Destination',
            am: 'መዳረሻ',
          },

          options: [
            {
              label: {
                en: 'Telegram channel',
                am: 'የTelegram ቻናል',
              },
              value: 'telegram-channel',
            },
            {
              label: {
                en: 'Telegram group',
                am: 'የTelegram ቡድን',
              },
              value: 'telegram-group',
            },
            {
              label: {
                en: 'Facebook Page',
                am: 'የFacebook ገጽ',
              },
              value: 'facebook',
            },
            {
              label: {
                en: 'Instagram',
                am: 'Instagram',
              },
              value: 'instagram',
            },
          ],
        },

        {
          name: 'language',
          type: 'select',
          required: true,

          label: {
            en: 'Post language',
            am: 'የልጥፉ ቋንቋ',
          },

          options: [
            {
              label: {
                en: 'Amharic',
                am: 'አማርኛ',
              },
              value: 'am',
            },
            {
              label: {
                en: 'English',
                am: 'እንግሊዝኛ',
              },
              value: 'en',
            },
          ],
        },

        {
          name: 'postId',
          type: 'text',
          required: true,

          label: {
            en: 'Platform post ID',
            am: 'የመድረኩ ልጥፍ መለያ',
          },

          access: {
            read: ({ req }) => {
              return isStaff(req.user as UserAuth | null)
            },
          },
        },

        {
          name: 'url',
          type: 'text',
          maxLength: 2048,
          validate: validateHTTPSURL,

          label: {
            en: 'Post link',
            am: 'የልጥፉ አገናኝ',
          },

          admin: {
            description: {
              en: 'The direct post link, when available. The website can display a platform label for it.',
              am: 'ሲገኝ ወደ ልጥፉ በቀጥታ የሚወስድ አገናኝ። ድረ ገጹ የመድረኩን ስም እንደ አገናኝ ሊያሳይ ይችላል።',
            },
          },
        },

        {
          name: 'publishedAt',
          type: 'date',
          required: true,

          label: {
            en: 'Published at',
            am: 'የታተመበት ጊዜ',
          },
        },
      ],
    },
  ],

  timestamps: true,
}