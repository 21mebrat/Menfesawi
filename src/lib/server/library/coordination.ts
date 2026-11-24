import {
  APIError,
  createLocalReq,
  type CollectionSlug,
  type Payload,
  type PayloadRequest,
} from 'payload'
import { getMongoSession } from '../reading/coordination'

export const fail = (message: string, status = 400): never => {
  throw new APIError(message, status)
}
export function ref(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string')
    return value.id
  return ''
}
export async function session(req: PayloadRequest) {
  const value = await getMongoSession(req.payload, req)
  if (!value?.inTransaction())
    throw new APIError(
      'Library changes require an active MongoDB transaction on a replica set.',
      503,
    )
  return value
}
export async function lock(req: PayloadRequest, collection: CollectionSlug, id: string) {
  if (!/^[a-f0-9]{24}$/i.test(id)) return fail('Invalid library reference.')
  const result = await req.payload.db.collections[collection].updateOne(
    { _id: id },
    { $inc: { __v: 1 } },
    { session: await session(req), timestamps: false },
  )
  if (!result.matchedCount) fail('Referenced ' + collection + ' record does not exist.', 404)
}
export async function transaction<T>(
  payload: Payload,
  work: (req: PayloadRequest) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const id = await payload.db.beginTransaction()
    if (id == null) return fail('A MongoDB transaction is required.', 503)
    try {
      const result = await work(await createLocalReq({ req: { transactionID: id } }, payload))
      await payload.db.commitTransaction(id)
      return result
    } catch (error) {
      await payload.db.rollbackTransaction(id)
      if (
        attempt >= 4 ||
        !(error instanceof Error) ||
        !('hasErrorLabel' in error) ||
        typeof error.hasErrorLabel !== 'function' ||
        !error.hasErrorLabel('TransientTransactionError')
      )
        throw error
      await new Promise((resolve) => setTimeout(resolve, 15 * attempt))
    }
  }
}
export function duplicate(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
}
