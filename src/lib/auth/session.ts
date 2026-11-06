import type { Payload, PayloadRequest } from 'payload'
import { getFieldsToSign, jwtSign } from 'payload'
import {
  addSessionToUser,
  generateExpiredPayloadCookie,
  generatePayloadCookie,
  removeExpiredSessions,
} from 'payload/shared'

export interface SessionResult {
  token: string
  cookieString: string
  sid?: string
}

/**
 * Creates an authenticated Payload session and signed JWT cookie for the given user.
 */
export async function createPayloadSessionForUser(args: {
  payload: Payload
  user: any
  req?: PayloadRequest
}): Promise<SessionResult> {
  const { payload, user, req } = args
  const usersCollection = payload.collections.users

  if (!usersCollection) {
    throw new Error("Collection 'users' not found on Payload instance.")
  }

  const { sid } = await addSessionToUser({
    collectionConfig: usersCollection.config,
    payload,
    req: req as any,
    user,
  })

  const fieldsToSign = getFieldsToSign({
    collectionConfig: usersCollection.config,
    email: user.email,
    sid,
    user,
  })

  const tokenExpiration =
    usersCollection.config.auth.tokenExpiration || 7200

  const { token } = await jwtSign({
    fieldsToSign,
    secret: payload.secret,
    tokenExpiration,
  })

  const cookieString = generatePayloadCookie({
    collectionAuthConfig: usersCollection.config.auth,
    cookiePrefix: payload.config.cookiePrefix || 'payload',
    token,
  }) as string

  return { token, cookieString, sid }
}

/**
 * Revokes a session for the user atomically without writing whole-user snapshots.
 * Generates an expired cookie string.
 */
export async function destroyPayloadSession(args: {
  payload: Payload
  user: any
  sid?: string
  req?: PayloadRequest
}): Promise<string> {
  const { payload, user, sid, req } = args
  const usersCollection = payload.collections.users

  if (!usersCollection) {
    throw new Error("Collection 'users' not found on Payload instance.")
  }

  if (sid && user?.id) {
    // Atomic session removal directly at the database level to prevent
    // race conditions, stale snapshot rewrites, and restoring concurrent sessions.
    const userModel = payload.db.collections?.users
    const rawCollection = (payload.db as any).connection?.collection('users')

    const pullFilter = {
      $pull: {
        sessions: {
          $or: [
            { id: sid },
            { expiresAt: { $lte: new Date() } },
          ],
        },
      },
    }

    if (userModel && typeof userModel.updateOne === 'function') {
      await userModel.updateOne({ _id: user.id }, pullFilter)
    } else if (rawCollection && typeof rawCollection.updateOne === 'function') {
      await rawCollection.updateOne({ _id: user.id }, pullFilter)
    } else {
      // Fallback: update sessions array only, avoiding writing whole user doc
      const freshUser = await payload.db.findOne({
        collection: 'users',
        req: req as any,
        where: { id: { equals: user.id } },
      })
      if (freshUser && Array.isArray((freshUser as any).sessions)) {
        const remaining = removeExpiredSessions(
          (freshUser as any).sessions.filter((s: any) => s.id !== sid),
        )
        await payload.db.updateOne({
          id: user.id,
          collection: 'users',
          data: { sessions: remaining } as any,
          req: req as any,
          returning: false,
        })
      }
    }
  }

  const expiredCookie = generateExpiredPayloadCookie({
    collectionAuthConfig: usersCollection.config.auth,
    cookiePrefix: payload.config.cookiePrefix || 'payload',
  }) as string

  return expiredCookie
}
