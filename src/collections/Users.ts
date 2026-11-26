import { amWorkspace } from '../i18n/am'
import { enWorkspace } from '../i18n/en'
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

function label(key: keyof typeof enWorkspace.usersList) {
  return { en: enWorkspace.usersList[key], am: amWorkspace.usersList[key] }
}

export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: label('singular'), plural: label('title') },
  admin: {
    useAsTitle: 'name',
    components: { views: { list: { Component: '/components/admin/users/UsersList#UsersList' } } },
    pagination: { defaultLimit: 4, limits: [4, 10, 25, 50] },
    defaultColumns: ['name', 'email', 'role', 'isActive', 'createdAt'],
    listSearchableFields: ['name', 'email', 'role'],
    description: label('description'),
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
      label: label('name'),
      admin: {
        placeholder: label('nameExample'),
        description: label('nameHelp'),
        autoComplete: 'name',
      },
      access: {
        update: isAdminOrSelfFieldAccess,
      },
    },
    {
      name: 'role',
      type: 'select',
      label: label('role'),
      defaultValue: 'member',
      saveToJWT: true,
      index: true,
      options: [
        {
          label: label('admin'),
          value: 'admin',
        },
        {
          label: label('editor'),
          value: 'editor',
        },
        {
          label: label('member'),
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
      label: label('avatarURL'),
      access: {
        update: isAdminOrSelfFieldAccess,
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      label: label('active'),
      defaultValue: true,
      access: {
        create: isAdminFieldAccess,
        update: isAdminFieldAccess,
      },
    },
    {
      name: 'hasPassword',
      label: label('hasPassword'),
      type: 'checkbox',
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: label('passwordHelp'),
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

      label: label('avatar'),

      admin: {
        description: label('avatarHelp'),
      },

      access: {
        update: isAdminOrSelfFieldAccess,
      },
    },
  ],
  timestamps: true,
}
