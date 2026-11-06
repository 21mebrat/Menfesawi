import crypto from 'crypto'
import type { Payload } from 'payload'

/**
 * Generates a cryptographically secure random token.
 * 32 bytes hex encoded = 64 characters of high-entropy randomness.
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Computes SHA-256 hash of a raw token.
 * Only the hash is stored in the database.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex')
}

/**
 * Derives a deterministic, high-entropy raw unsubscribe bearer token for a subscriber
 * using HMAC-SHA256 with the server-side PAYLOAD_SECRET.
 *
 * Properties:
 * 1. Plaintext token is never stored in the database (only hashToken(token) is stored).
 * 2. Unguessable without the secret key.
 * 3. Does not authenticate raw subscriber IDs.
 * 4. Enables durable email links without needing to store reversible plaintext tokens.
 */
export function getSubscriberUnsubscribeToken(subscriber: {
  id: string | number
  email: string
  createdAt?: string | Date
}): string {
  const secret = process.env.PAYLOAD_SECRET || 'ethiopia-travel-secret-fallback'
  const createdStr = subscriber.createdAt
    ? new Date(subscriber.createdAt).toISOString()
    : 'default_epoch'
  return crypto
    .createHmac('sha256', secret)
    .update(`unsub_v2:${String(subscriber.id)}:${subscriber.email.trim().toLowerCase()}:${createdStr}`)
    .digest('hex')
}

/**
 * Verifies a raw token against a stored SHA-256 hash in constant time
 * to prevent timing side-channel attacks.
 */
export function verifyTokenHash(rawToken: string, storedHash: string): boolean {
  if (!rawToken || !storedHash) return false
  const calculatedHash = hashToken(rawToken)
  const a = Buffer.from(calculatedHash, 'utf8')
  const b = Buffer.from(storedHash, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * Validates that an incoming token string matches high-entropy cryptographic hex formatting
 * (at least 32 characters of hex) and rejects arbitrary short IDs or invalid formats.
 */
export function isValidTokenFormat(token: unknown): token is string {
  if (typeof token !== 'string') return false
  const trimmed = token.trim()
  return /^[a-fA-F0-9]{32,128}$/.test(trimmed)
}

/**
 * Generates a token expiration date.
 * Default is 48 hours from now.
 */
export function getConfirmationExpiration(hours = 48): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

/**
 * Checks if a token date is expired.
 */
export function isTokenExpired(expiresAt: Date | string | null | undefined): boolean {
  if (!expiresAt) return true
  const expiry = new Date(expiresAt).getTime()
  return Date.now() > expiry
}

/**
 * Safe migration for existing legacy subscribers:
 * Re-hashes any existing legacy unsubscribe token hashes so that:
 * 1. Existing links distributed in earlier emails continue to work seamlessly.
 * 2. Stored hashes can NEVER be presented as bearer tokens.
 * 3. Existing opt-outs ('unsubscribed') are strictly preserved and never reversed.
 */
export async function migrateLegacySubscribers(payload: Payload): Promise<{ migrated: number }> {
  const legacySubscribers = await (payload.find as any)({
    collection: 'subscribers',
    where: {
      or: [
        { tokenVersion: { not_equals: 2 } },
        { tokenVersion: { exists: false } },
      ],
    },
    pagination: false,
    overrideAccess: true,
  })

  let migrated = 0

  for (const sub of (legacySubscribers.docs as any[])) {
    const updateData: Record<string, unknown> = {
      tokenVersion: 2,
    }

    if (sub.unsubscribeTokenHash) {
      // Re-hash the legacy stored hash so an old link containing token=oldHash
      // matches when hashToken(oldHash) is queried against the database.
      updateData.unsubscribeTokenHash = hashToken(sub.unsubscribeTokenHash)
    } else {
      const derivedToken = getSubscriberUnsubscribeToken({
        id: sub.id,
        email: sub.email,
        createdAt: sub.createdAt,
      })
      updateData.unsubscribeTokenHash = hashToken(derivedToken)
    }

    // CRITICAL: Preserve existing opt-outs! Do NOT modify sub.status.
    await (payload.update as any)({
      collection: 'subscribers',
      id: sub.id,
      data: updateData,
      overrideAccess: true,
    })
    migrated++
  }

  return { migrated }
}
