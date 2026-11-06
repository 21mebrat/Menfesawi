import type { Access, FieldAccess, PayloadRequest } from 'payload'

export type UserRole = 'admin' | 'editor' | 'member'

export interface UserAuth {
  id: string | number
  email?: string
  name?: string
  role?: UserRole
  avatarURL?: string
  isActive?: boolean
  hasPassword?: boolean | null
  collection?: string
  [key: string]: unknown
}

/**
 * Returns true if the user is authenticated and not deactivated.
 */
export const isAuthenticated = (user?: UserAuth | null): boolean => {
  return Boolean(user && user.isActive !== false)
}

/**
 * Returns true if the user is an active admin.
 */
export const isAdmin = (user?: UserAuth | null): boolean => {
  return Boolean(user && user.isActive !== false && user.role === 'admin')
}

/**
 * Returns true if the user is an active editor.
 */
export const isEditor = (user?: UserAuth | null): boolean => {
  return Boolean(user && user.isActive !== false && user.role === 'editor')
}

/**
 * Returns true if the user is staff (active admin or editor).
 */
export const isStaff = (user?: UserAuth | null): boolean => {
  return Boolean(
    user &&
    user.isActive !== false &&
    (user.role === 'admin' || user.role === 'editor'),
  )
}

/**
 * Access control for collection admin panel access.
 * Only staff (admin or editor) can enter the Payload admin panel.
 */
export const canAccessAdmin = ({
  req: { user },
}: {
  req: { user?: unknown }
}): boolean => {
  return isStaff(user as unknown as UserAuth | undefined)
}

/**
 * Collection read access for Users:
 * Admins can list and read all users.
 * Authenticated active non-admins can read only their own profile.
 * Anonymous or inactive users cannot read any user profiles.
 */
export const canReadUser: Access = ({ req: { user } }) => {
  const authUser = user as unknown as UserAuth | undefined
  if (!isAuthenticated(authUser)) {
    return false
  }
  if (isAdmin(authUser)) {
    return true
  }
  return {
    id: {
      equals: authUser!.id,
    },
  }
}

/**
 * Collection create access for Users:
 * Generic REST/GraphQL creation is restricted to administrators.
 * Public registration flows (e.g. Google provisioning) execute via dedicated,
 * server-validated Local API operations.
 */
export const canCreateUser: Access = ({ req: { user } }) => {
  return isAdmin(user as unknown as UserAuth | undefined)
}

/**
 * Collection update access for Users:
 * Admins can update any user.
 * Authenticated active non-admins can only update their own record.
 */
export const canUpdateUser: Access = ({ req: { user } }) => {
  const authUser = user as unknown as UserAuth | undefined
  if (!isAuthenticated(authUser)) {
    return false
  }
  if (isAdmin(authUser)) {
    return true
  }
  return {
    id: {
      equals: authUser!.id,
    },
  }
}

/**
 * Collection delete access for Users:
 * Admins only.
 */
export const canDeleteUser: Access = ({ req: { user } }) => {
  return isAdmin(user as unknown as UserAuth | undefined)
}

/**
 * Field-level access: Only admin can write to this field.
 */
export const isAdminFieldAccess: FieldAccess = ({ req: { user } }) => {
  return isAdmin(user as unknown as UserAuth | undefined)
}

/**
 * Field-level access: Admin or the user themselves can update this field.
 */
export const isAdminOrSelfFieldAccess: FieldAccess = ({
  req: { user },
  id,
}) => {
  const authUser = user as unknown as UserAuth | undefined
  if (!isAuthenticated(authUser)) {
    return false
  }
  if (isAdmin(authUser)) {
    return true
  }
  return authUser!.id === id
}
