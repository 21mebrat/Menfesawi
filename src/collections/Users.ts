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
    beforeLogin: [
      ({ user }) => {
        const authUser = user as unknown as UserAuth
        if (authUser.isActive === false) {
          throw new APIError('Account is inactive', 403)
        }
        return user
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
  ],
  timestamps: true,
}
