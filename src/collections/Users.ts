import { removeDeletedUsersProgress } from '../lib/server/reading-progress/service'
import { removeDeletedUsersBookmarks } from '../lib/server/bookmarks/service'
import { guardDeletion } from '../lib/server/library/catalog'
import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'
import {
  canAccessAdmin,
  canCreateUser,
  canDeleteUser,
  canReadUser,
  canUpdateUser,
  isAdminFieldAccess,
  isAdminOrSelfFieldAccess,
  type UserAuth,
} from '../access'

export const Users: CollectionConfig = {
  slug: 'users',
  labels: {
    singular: {
      en: 'User',
      am: 'ተጠቃሚ',
    },
    plural: {
      en: 'Users',
      am: 'ተጠቃሚዎች',
    },
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'email', 'role', 'isActive', 'createdAt'],
    listSearchableFields: ['name', 'email', 'role'],
    description: {
      en: 'Who can log in, write articles, and manage the application?',
      am: 'ወደ መድረኩ መግባት፣ ጽሑፎችን መጻፍ እና መተግበሪያውን ማስተዳደር የሚችሉ ተጠቃሚዎች።',
    },
  },
  auth: {
    useSessions: true,
    maxLoginAttempts: 5,
    lockTime: 5 * 60 * 1000, // 5 minutes
    tokenExpiration: 7200, // 2 hours
    useAPIKey: false,
    forgotPassword: {
      expiration: 5 * 60 * 1000,
    },
    cookies: {
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },
  access: {
    admin: canAccessAdmin,
    read: canReadUser,
    create: canCreateUser,
    update: canUpdateUser,
    delete: canDeleteUser,
  },
  hooks: {
    beforeDelete: [guardDeletion],
    afterDelete: [removeDeletedUsersBookmarks, removeDeletedUsersProgress],
    beforeLogin: [
      ({ user }) => {
        const authUser = user as unknown as UserAuth
        if (authUser.isActive === false) {
          throw new APIError('Account is inactive', 403)
        }
        return user
      },
    ],
    beforeChange: [
      ({ data, req, operation }) => {
        // Protect login-method metadata against client modification
        const isReqAdmin = Boolean(req?.user && (req.user as any).role === 'admin')
        if (!isReqAdmin && req?.data && 'hasPassword' in req.data) {
          delete (data as any).hasPassword
        }

        // If caller explicitly passed hasPassword: false (e.g. provisioning with undisclosed password)
        if ((data as any).hasPassword === false) {
          return data
        }

        // When a password is being set on create or update:
        if (data.password) {
          data.hasPassword = true
        } else if ((data as any).hasPassword === undefined && operation === 'create') {
          data.hasPassword = false
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      maxLength: 80,
      label: {
        en: 'Name',
        am: 'ስም',
      },
      admin: {
        placeholder: {
          en: 'e.g. Abebe',
          am: 'ለምሳሌ፡ አበበ',
        },
        description: {
          en: "The author's given or display name.",
          am: 'የተጠቃሚው መጠሪያ ስም።',
        },
        autoComplete: 'name',
      },
      access: {
        update: isAdminOrSelfFieldAccess,
      },
    },
    {
      name: 'role',
      type: 'select',
      label: 'Role',
      defaultValue: 'member',
      saveToJWT: true,
      index: true,
      options: [
        {
          label: 'Admin',
          value: 'admin',
        },
        {
          label: 'Editor',
          value: 'editor',
        },
        {
          label: 'Member',
          value: 'member',
        },
      ],
      access: {
        create: isAdminFieldAccess,
        update: isAdminFieldAccess,
      },
    },
    {
      name: 'avatarURL',
      type: 'text',
      label: 'Avatar URL',
      access: {
        update: isAdminOrSelfFieldAccess,
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      label: 'Active',
      defaultValue: true,
      access: {
        create: isAdminFieldAccess,
        update: isAdminFieldAccess,
      },
    },
    {
      name: 'hasPassword',
      type: 'checkbox',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Whether this account has an active usable password known to the user.',
      },
      access: {
        create: () => false,
        update: () => false,
      },
    },
    {
      name: 'avatar',
      type: 'upload',
      relationTo: 'media',
      localized: false,

      label: {
        en: 'Profile picture',
        am: 'የመገለጫ ፎቶ',
      },

      admin: {
        description: {
          en: 'Your uploaded profile picture. Displayed instead of your Google profile picture when selected.',
          am: 'የሰቀሉት የመገለጫ ፎቶ። ሲመረጥ በGoogle መገለጫ ፎቶዎ ፋንታ ይታያል።',
        },
      },

      access: {
        update: isAdminOrSelfFieldAccess,
      },
    },
  ],
  timestamps: true,
}
