import crypto from 'crypto'

export interface OAuthTransactionState {
  state: string
  codeVerifier: string
  nonce: string
  action: 'signin' | 'link'
  userId?: string | number
  returnTo: string
  createdAt: number
}

const COOKIE_NAME = 'menfesawi_oauth'
const STATE_MAX_AGE_SECONDS = 600 // 10 minutes

/**
 * Returns the secret used to sign and verify OAuth state transactions.
 */
function getStateSecret(): string {
  const secret = process.env.PAYLOAD_SECRET
  if (!secret) {
    throw new Error('PAYLOAD_SECRET is not configured. It is required to sign OAuth transaction state.')
  }
  return secret
}

/**
 * Signs and packages OAuth state into a tamper-proof string for an httpOnly cookie.
 */
export function signOAuthState(data: OAuthTransactionState): string {
  const secret = getStateSecret()
  const serialized = JSON.stringify(data)
  const encoded = Buffer.from(serialized, 'utf-8').toString('base64url')
  const hmac = crypto.createHmac('sha256', secret).update(encoded).digest('hex')
  return `${encoded}.${hmac}`
}

/**
 * Verifies and decodes OAuth state from the cookie value.
 * Throws or returns null if tampered, expired, or invalid.
 */
export function verifyOAuthState(cookieValue?: string | null): OAuthTransactionState | null {
  if (!cookieValue || typeof cookieValue !== 'string') {
    return null
  }

  const parts = cookieValue.split('.')
  if (parts.length !== 2) {
    return null
  }

  const [encoded, hmac] = parts
  const secret = getStateSecret()
  const expectedHmac = crypto.createHmac('sha256', secret).update(encoded).digest('hex')

  // Constant-time HMAC comparison
  const hmacBuffer = Buffer.from(hmac, 'utf-8')
  const expectedBuffer = Buffer.from(expectedHmac, 'utf-8')
  if (hmacBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(hmacBuffer, expectedBuffer)) {
    return null
  }

  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf-8')
    const state: OAuthTransactionState = JSON.parse(raw)

    // Check expiration (10 minutes max age)
    if (!state.createdAt || Date.now() - state.createdAt > STATE_MAX_AGE_SECONDS * 1000) {
      return null
    }

    return state
  } catch {
    return null
  }
}

/**
 * Generates PKCE code verifier and code challenge (S256).
 */
export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  return { codeVerifier, codeChallenge }
}

/**
 * Generates cryptographically secure random hex string.
 */
export function generateRandomHex(byteCount = 32): string {
  return crypto.randomBytes(byteCount).toString('hex')
}

export { COOKIE_NAME as OAUTH_COOKIE_NAME, STATE_MAX_AGE_SECONDS }
