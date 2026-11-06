import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'
import {
  generatePKCE,
  generateRandomHex,
  OAUTH_COOKIE_NAME,
  signOAuthState,
  STATE_MAX_AGE_SECONDS,
  type OAuthTransactionState,
} from '@/lib/auth/oauth-state'
import { getGoogleAuthURL, sanitizeRedirect } from '@/lib/auth/google'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const returnTo = sanitizeRedirect(url.searchParams.get('redirect'), '/account')
    const action = url.searchParams.get('action') === 'link' ? 'link' : 'signin'

    const config = await configPromise
    const payload = await getPayload({ config })

    let currentUserId: string | number | undefined

    if (action === 'link') {
      const { user } = await payload.auth({ headers: request.headers })
      if (!user) {
        return NextResponse.redirect(
          new URL('/login?error=auth_required_for_linking', request.url),
        )
      }
      currentUserId = user.id
    }

    const { codeVerifier, codeChallenge } = generatePKCE()
    const state = generateRandomHex(32)
    const nonce = generateRandomHex(32)

    const transactionState: OAuthTransactionState = {
      state,
      codeVerifier,
      nonce,
      action,
      userId: currentUserId,
      returnTo,
      createdAt: Date.now(),
    }

    const cookieValue = signOAuthState(transactionState)
    const googleURL = getGoogleAuthURL({
      state,
      codeChallenge,
      nonce,
    })

    const response = NextResponse.redirect(googleURL)

    response.cookies.set(OAUTH_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: STATE_MAX_AGE_SECONDS,
    })

    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, request.url),
    )
  }
}
