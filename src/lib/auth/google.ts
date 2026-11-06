import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library'

export interface VerifiedGoogleIdentity {
  sub: string
  email: string
  name?: string
  picture?: string
  issuer?: string
}

/**
 * Resolves the application public base URL.
 */
export function getAppBaseURL(): string {
  const url =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_SERVER_URL ||
    'http://localhost:3000'
  return url.replace(/\/+$/, '')
}

/**
 * Returns the exact Google OAuth redirect URI.
 */
export function getGoogleCallbackURI(): string {
  return `${getAppBaseURL()}/api/auth/google/callback`
}

/**
 * Returns a configured Google OAuth2Client.
 */
export function getGoogleOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables.',
    )
  }
  return new OAuth2Client(clientId, clientSecret, getGoogleCallbackURI())
}

/**
 * Sanitizes open redirects to ensure same-origin relative paths only.
 */
export function sanitizeRedirect(
  redirectPath?: string | null,
  fallback = '/account',
): string {
  if (!redirectPath || typeof redirectPath !== 'string') {
    return fallback
  }

  const trimmed = redirectPath.trim()

  // Must begin with a single slash, not double slash or backslash
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\')
  ) {
    return fallback
  }

  // Prevent scheme injection or CRLF
  if (/[\r\n\t]/.test(trimmed) || /^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback
  }

  return trimmed
}

/**
 * Generates the Google OAuth authorization URL.
 */
export function getGoogleAuthURL(params: {
  state: string
  codeChallenge: string
  nonce: string
}): string {
  const client = getGoogleOAuthClient()
  return client.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
    prompt: 'select_account',
    // Google supports nonce as a custom parameter in the authorization request
    ...({ nonce: params.nonce } as Record<string, unknown>),
  })
}

/**
 * Exchanges authorization code for tokens and verifies the Google ID token.
 */
export async function exchangeAndVerifyGoogleCode(params: {
  code: string
  codeVerifier: string
  expectedNonce: string
}): Promise<VerifiedGoogleIdentity> {
  const client = getGoogleOAuthClient()
  const clientId = process.env.GOOGLE_CLIENT_ID!

  const { tokens } = await client.getToken({
    code: params.code,
    codeVerifier: params.codeVerifier,
  })

  if (!tokens.id_token) {
    throw new Error('Google token response did not contain an ID token.')
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: clientId,
  })

  const payload = ticket.getPayload()
  if (!payload) {
    throw new Error('Google ID token verification failed: empty payload.')
  }

  // Issuer validation
  const validIssuers = ['https://accounts.google.com', 'accounts.google.com']
  if (!payload.iss || !validIssuers.includes(payload.iss)) {
    throw new Error(`Invalid ID token issuer: ${payload.iss}`)
  }

  // Nonce validation: expected nonce must be provided, present in ID token, and match exactly
  if (!params.expectedNonce || !payload.nonce || payload.nonce !== params.expectedNonce) {
    throw new Error('Google ID token nonce is missing or mismatch.')
  }

  // Verified email check
  if (!payload.email || payload.email_verified !== true) {
    throw new Error('Google email is missing or unverified.')
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase().trim(),
    name: payload.name || undefined,
    picture: payload.picture || undefined,
    issuer: payload.iss,
  }
}
