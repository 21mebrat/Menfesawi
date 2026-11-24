import type { Payload, PayloadRequest } from 'payload'
import { APIError, ValidationError } from 'payload'
import type { ClientSession, ObjectId } from 'mongodb'

export function extractId(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'object') {
    return String((val as any).id || (val as any)._id || '') || null
  }
  return String(val)
}

export async function getMongoSession(
  payload: any,
  req?: any,
): Promise<ClientSession | null> {
  const transactionID = await req?.transactionID
  return transactionID ? payload.db.sessions?.[transactionID] ?? null : null
}

export function isReplicaSetSupported(payload: any): boolean {
  if (payload.db?.transactionOptions === false) return false
  const client = payload.db?.connection?.getClient?.()
  return Boolean(client?.options?.replicaSet)
}

function sortedIds(ids: unknown[]): string[] {
  return [...new Set(ids.map(extractId).filter((id): id is string => id !== null))].sort()
}

/** Lock sections by ID first, then their live publications and any requested publications by ID. */
export async function acquireStructuralLocks(
  payload: Payload,
  req: PayloadRequest,
  { sections = [], publications = [] }: { sections?: unknown[]; publications?: unknown[] },
): Promise<void> {
  const session = await getMongoSession(payload, req)
  if (!session?.inTransaction()) {
    throw new APIError(
      'Structured reading writes require an active MongoDB transaction. Configure Payload with a transaction-enabled replica set connection and enable transactions for this request.',
      503,
    )
  }

  const publicationIds = [...publications]
  for (const id of sortedIds(sections)) {
    // The increment takes a write lock. Its pre-image supplies the live relationship
    // in the same transaction, including when a draft has selected a different parent.
    const section = await payload.db.collections['publication-sections']
      .findOneAndUpdate(
        { _id: id },
        { $inc: { __v: 1 } },
        { session, projection: { publication: 1 }, timestamps: false },
      )
      .lean<{ publication?: ObjectId } | null>()
    if (!section) {
      throw new ValidationError({
        errors: [{ path: 'id', message: `Section '${id}' does not exist.` }],
      })
    }
    if (section.publication) publicationIds.push(String(section.publication))
  }

  for (const id of sortedIds(publicationIds)) {
    const result = await payload.db.collections.publications.updateOne(
      { _id: id },
      { $inc: { __v: 1 } },
      { session, timestamps: false },
    )
    if (!result.matchedCount) {
      throw new ValidationError({
        errors: [{ path: 'id', message: `Publication '${id}' does not exist.` }],
      })
    }
  }
}
