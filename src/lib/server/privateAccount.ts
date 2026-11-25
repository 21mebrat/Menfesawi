import { Types } from 'mongoose'
import {
  createLocalReq,
  type PayloadRequest,
  type TypedFallbackLocale,
  type TypedLocale,
} from 'payload'
import { isAuthenticated } from '@/access'
import { fail, lock, session, transaction } from './library/coordination'

export type PrivateLocale = { locale?: TypedLocale; fallbackLocale?: TypedFallbackLocale }
export type PrivateAccountOptions = PrivateLocale & { req: PayloadRequest }

export async function withOwner<T>(
  options: PrivateAccountOptions,
  write: boolean,
  work: (req: PayloadRequest, user: Types.ObjectId, locale: PrivateLocale) => Promise<T>,
) {
  const { req: caller } = options
  const identity = caller.user
  if (!identity) return fail('Sign in to access your account data.', 401)
  if (identity.collection !== 'users' || !isAuthenticated(identity))
    return fail('Active account required.', 403)
  if ('user' in options || 'target' in options)
    return fail('Ownership and target cannot be overridden.')
  if (!/^[a-f0-9]{24}$/i.test(identity.id)) return fail('Invalid account identifier.')
  const user = new Types.ObjectId(identity.id)
  const locale = {
    locale: options.locale ?? (caller.locale === 'all' ? undefined : caller.locale),
    fallbackLocale:
      options.fallbackLocale === undefined ? caller.fallbackLocale : options.fallbackLocale,
  }
  const run = async (req: PayloadRequest) => {
    // Serialize saves with account deletion. All reads also check persisted activation.
    if (write) await lock(req, 'users', identity.id)
    const active = await req.payload.db.collections.users
      .exists({ _id: user, isActive: { $ne: false } })
      .session(await session(req))
    if (!active) return fail('Active account required.', 403)
    return work(req, user, locale)
  }
  if (await caller.transactionID)
    return run(
      await createLocalReq({ req: { transactionID: caller.transactionID } }, caller.payload),
    )
  return transaction(caller.payload, run)
}
