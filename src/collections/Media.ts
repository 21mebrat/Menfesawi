import {
  APIError,
  type Access,
  type CollectionConfig,
  type Where,
} from 'payload'

import {
  canAccessAdmin,
  isAdmin,
  isAuthenticated,
  isStaff,
  type UserAuth,
} from '../access'

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const CONTENT_MAX_BYTES = 10 * 1024 * 1024

const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
]

/**
 * Administrators: all images.
 * Editors: content images and their own avatars.
 * Members: their own avatars only.
 */
const canManageMedia: Access = ({ req }) => {
  const user = req.user as UserAuth | null

  if (!user || !isAuthenticated(user)) return false
  if (isAdmin(user)) return true

  const ownAvatar: Where = {
    and: [
      {
        owner: {
          equals: user.id,
        },
      },
      {
        purpose: {
          equals: 'avatar',
        },
      },
    ],
  }

  if (isStaff(user)) {
    return {
      or: [
        {
          purpose: {
            equals: 'content',
          },
        },
        ownAvatar,
      ],
    }
  }

  return ownAvatar
}

export const Media: CollectionConfig = {
  slug: 'media',

  labels: {
    singular: {
      en: 'Image',
      am: 'ምስል',
    },
    plural: {
      en: 'Media',
      am: 'ምስሎች',
    },
  },

  admin: {
    group: {
      en: 'Content',
      am: 'ይዘት',
    },
    useAsTitle: 'filename',
    defaultColumns: [
      'filename',
      'purpose',
      'alt',
      'updatedAt',
    ],
    description: {
      en: 'Profile pictures and images used in Menfesawi content.',
      am: 'በመንፈሳዊ ይዘቶች ውስጥ የሚጠቀሙ ምስሎች እና የመገለጫ ፎቶዎች።',
    },
  },

  access: {
    admin: canAccessAdmin,

    // All images in this collection are publicly readable.
    read: () => true,

    create: ({ req }) => {
      return isAuthenticated(req.user as UserAuth | null)
    },

    update: canManageMedia,
    delete: canManageMedia,
  },

  hooks: {
    beforeValidate: [
      ({ data, originalDoc, operation, req }) => {
        const user = req.user as UserAuth | null

        if (!user || !isAuthenticated(user)) {
          throw new APIError(
            'Sign in with an active account to manage images.',
            403,
          )
        }

        const next = { ...data }

        if (operation === 'create') {
          // Ownership is always assigned by the server.
          next.owner = user.id

          if (!isStaff(user)) {
            // Members can upload profile pictures only.
            next.purpose = 'avatar'
          } else {
            next.purpose = next.purpose ?? 'content'
          }
        } else {
          // Preserve ownership and purpose on updates.
          next.owner = originalDoc?.owner
          next.purpose = originalDoc?.purpose
        }

        if (
          next.purpose !== 'avatar' &&
          next.purpose !== 'content'
        ) {
          throw new APIError(
            'Select a valid image purpose.',
            400,
          )
        }

        const file = req.file

        if (file) {
          if (!allowedMimeTypes.includes(file.mimetype)) {
            throw new APIError(
              'Upload a JPEG, PNG, or WebP image.',
              400,
            )
          }

          const maxBytes =
            next.purpose === 'avatar'
              ? AVATAR_MAX_BYTES
              : CONTENT_MAX_BYTES

          if (file.size > maxBytes) {
            throw new APIError(
              next.purpose === 'avatar'
                ? 'Profile pictures must be 2 MB or smaller.'
                : 'Content images must be 10 MB or smaller.',
              400,
            )
          }
        }

        if (next.purpose === 'avatar') {
          next.isDecorative = false

          next.caption = null
          next.credit = null
          next.sourceURL = null
          next.rights = null
        } else {
          const decorative =
            next.isDecorative ??
            originalDoc?.isDecorative ??
            false

          const alt = next.alt ?? originalDoc?.alt

          if (
            !decorative &&
            (typeof alt !== 'string' || !alt.trim())
          ) {
            throw new APIError(
              'Provide alt text or mark the content image as decorative.',
              400,
            )
          }

          if (decorative) {
            next.alt = ''
          }
        }

        return next
      },
    ],
  },

  fields: [
    {
      name: 'purpose',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'content',

      label: {
        en: 'Image purpose',
        am: 'የምስሉ አጠቃቀም',
      },

      options: [
        {
          label: {
            en: 'Profile picture',
            am: 'የመገለጫ ፎቶ',
          },
          value: 'avatar',
        },
        {
          label: {
            en: 'Content image',
            am: 'የይዘት ምስል',
          },
          value: 'content',
        },
      ],

      admin: {
        position: 'sidebar',
        description: {
          en: 'Cannot be changed after upload. Member uploads are always profile pictures.',
          am: 'ከተሰቀለ በኋላ መቀየር አይቻልም። አባላት የሚሰቅሉት የመገለጫ ፎቶ ብቻ ነው።',
        },
      },
    },

    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,

      label: {
        en: 'Uploaded by',
        am: 'የሰቀለው ተጠቃሚ',
      },

      access: {
        read: ({ req }) => {
          return isStaff(req.user as UserAuth | null)
        },
      },

      admin: {
        readOnly: true,
        position: 'sidebar',
        description: {
          en: 'Assigned automatically to the uploading account.',
          am: 'ምስሉን ለሰቀለው የተጠቃሚ መለያ በራስ-ሰር ይመደባል።',
        },
      },
    },

    {
      name: 'alt',
      type: 'text',
      maxLength: 300,

      label: {
        en: 'Alt text',
        am: 'አማራጭ ጽሑፍ',
      },

      admin: {
        description: {
          en: 'Describe the meaningful visual information. Do not repeat the caption.',
          am: 'ምስሉ የሚያስተላልፈውን ጠቃሚ መረጃ ይግለጹ። የምስሉን መግለጫ አይድገሙ።',
        },
      },
    },

    {
      name: 'isDecorative',
      type: 'checkbox',
      defaultValue: false,

      label: {
        en: 'Decorative image',
        am: 'ለማስዋቢያ ብቻ የሚውል ምስል',
      },

      admin: {
        condition: (data) => data?.purpose === 'content',
        description: {
          en: 'Use only when the image adds no information to the surrounding content.',
          am: 'ምስሉ በዙሪያው ላለው ይዘት ተጨማሪ መረጃ የማይሰጥ ከሆነ ብቻ ይምረጡ።',
        },
      },
    },

    {
      name: 'caption',
      type: 'textarea',
      maxLength: 1000,

      label: {
        en: 'Caption',
        am: 'የምስል መግለጫ',
      },

      admin: {
        condition: (data) => data?.purpose === 'content',
        description: {
          en: 'Optional text displayed alongside the image.',
          am: 'ከምስሉ ጋር የሚታይ አማራጭ መግለጫ።',
        },
      },
    },

    {
      name: 'credit',
      type: 'text',
      maxLength: 200,

      label: {
        en: 'Image credit',
        am: 'የምስሉ ባለቤት ወይም አዘጋጅ',
      },

      admin: {
        condition: (data) => data?.purpose === 'content',

        placeholder: {
          en: 'Photographer, artist, or institution',
          am: 'ፎቶ አንሺ፣ ሠዓሊ ወይም ተቋም',
        },

        description: {
          en: 'Identify the person or organization credited for this image.',
          am: 'ለዚህ ምስል ዕውቅና የሚሰጠውን ሰው ወይም ድርጅት ይጥቀሱ።',
        },
      },
    },

    {
      name: 'sourceURL',
      type: 'text',
      maxLength: 2048,

      label: {
        en: 'Source URL',
        am: 'የምንጭ አገናኝ',
      },

      validate: (value: unknown) => {
        if (!value) return true

        if (typeof value !== 'string') {
          return 'Enter a valid HTTPS URL.'
        }

        try {
          const url = new URL(value)

          return (
            (url.protocol === 'https:' &&
              !url.username &&
              !url.password) ||
            'Use an HTTPS URL without embedded credentials.'
          )
        } catch {
          return 'Enter a valid HTTPS URL.'
        }
      },

      admin: {
        condition: (data) => data?.purpose === 'content',

        placeholder: {
          en: 'https://example.com/original-image',
          am: 'https://example.com/original-image',
        },

        description: {
          en: 'Link to the original source of the image.',
          am: 'ምስሉ የተገኘበትን ዋና ምንጭ አገናኝ ያስገቡ።',
        },
      },
    },

    {
      name: 'rights',
      type: 'textarea',
      maxLength: 1000,

      label: {
        en: 'Usage rights',
        am: 'የአጠቃቀም ፈቃድ',
      },

      admin: {
        condition: (data) => data?.purpose === 'content',
        description: {
          en: 'Record the license, permission, or copyright information.',
          am: 'የአጠቃቀም ፈቃዱን፣ የተሰጠውን ፈቃድ ወይም የቅጂ መብት መረጃ ይመዝግቡ።',
        },
      },
    },
  ],

  upload: {
    mimeTypes: allowedMimeTypes,
  },

  timestamps: true,
}