import type { CollectionConfig } from 'payload'
import { isAuthenticated, isAdmin, canAccessAdmin, type UserAuth } from '../access'

export const AuthAccounts: CollectionConfig = {
  slug: 'auth-accounts',
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
      type: 'relationship',
      relationTo: 'users',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: [
        {
          label: 'Google',
          value: 'google',
        },
      ],
    },
    {
      name: 'providerAccountId',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'issuer',
      type: 'text',
      defaultValue: 'https://accounts.google.com',
    },
  ],
  timestamps: true,
}
