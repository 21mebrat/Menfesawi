import { directoryLabel } from '../i18n/collectionLabels'
import { enWorkspace } from '../i18n/en'
import { amWorkspace } from '../i18n/am'
import type { CollectionConfig } from 'payload'
import { isAuthenticated, isAdmin, canAccessAdmin, type UserAuth } from '../access'

export const AuthAccounts: CollectionConfig = {
  slug: 'auth-accounts',
  labels: {
    singular: directoryLabel('authAccount'),
    plural: {
      en: enWorkspace.workspaceNav.authAccounts,
      am: amWorkspace.workspaceNav.authAccounts,
    },
  },
  admin: {
    useAsTitle: 'providerAccountId',
    defaultColumns: ['provider', 'providerAccountId', 'user', 'createdAt'],
  },
  access: {
    admin: canAccessAdmin,
    read: ({ req: { user } }) => {
      const authUser = user as unknown as UserAuth | undefined
      if (!isAuthenticated(authUser)) {
        return false
      }
      if (isAdmin(authUser)) {
        return true
      }
      return {
        user: {
          equals: authUser!.id,
        },
      }
    },
    // Server-managed collection: generic REST/GraphQL modifications are disabled
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  indexes: [
    {
      fields: ['provider', 'providerAccountId'],
      unique: true,
    },
  ],
  fields: [
    {
      name: 'user',
      label: directoryLabel('account'),
      type: 'relationship',
      relationTo: 'users',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'provider',
      label: directoryLabel('provider'),
      type: 'select',
      required: true,
      options: [
        {
          label: 'Google',
          value: 'google',
        },
        {
          label: 'Telegram',
          value: 'telegram',
        },
        {
          label: 'Apple',
          value: 'apple',
        },
      ],
    },
    {
      name: 'providerAccountId',
      label: directoryLabel('providerId'),
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'issuer',
      label: directoryLabel('issuer'),
      type: 'text',
      defaultValue: 'https://accounts.google.com',
    },
  ],
  timestamps: true,
}
