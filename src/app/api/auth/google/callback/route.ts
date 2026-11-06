import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'
import {
  OAUTH_COOKIE_NAME,
  verifyOAuthState,
} from '@/lib/auth/oauth-state'
import {
  exchangeAndVerifyGoogleCode,
  getAppBaseURL,
  sanitizeRedirect,
} from '@/lib/auth/google'
import { createPayloadSessionForUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

function clearOAuthCookie(res: NextResponse) {
  res.cookies.set(OAUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const googleError = url.searchParams.get('error')

  // Handle Google user cancellation or error
  if (googleError) {
    const res = NextResponse.redirect(new URL('/login?error=google_cancelled', getAppBaseURL()))
    clearOAuthCookie(res)
    return res
  }

  if (!code || !state) {
    const res = NextResponse.redirect(new URL('/login?error=missing_code_or_state', getAppBaseURL()))
    clearOAuthCookie(res)
    return res
  }

  // Retrieve and verify transaction state cookie
  const cookieHeader = request.headers.get('cookie') || ''
  const cookies = new Map<string, string>()
  cookieHeader.split(';').forEach((c) => {
    const [k, v] = c.trim().split('=')
    if (k && v) cookies.set(k, decodeURIComponent(v))
  })

  const oauthCookie = cookies.get(OAUTH_COOKIE_NAME)
  const transactionState = verifyOAuthState(oauthCookie)

  if (!transactionState) {
    const res = NextResponse.redirect(new URL('/login?error=invalid_state', getAppBaseURL()))
    clearOAuthCookie(res)
    return res
  }

  // Verify state matches
  if (transactionState.state !== state) {
    const res = NextResponse.redirect(new URL('/login?error=state_mismatch', getAppBaseURL()))
    clearOAuthCookie(res)
    return res
  }

  const config = await configPromise
  const payload = await getPayload({ config })

  let identity
  try {
    identity = await exchangeAndVerifyGoogleCode({
      code,
      codeVerifier: transactionState.codeVerifier,
      expectedNonce: transactionState.nonce,
    })
  } catch {
    // Never leak token or raw verification errors to the browser
    const res = NextResponse.redirect(
      new URL('/login?error=token_verification_failed', getAppBaseURL()),
    )
    clearOAuthCookie(res)
    return res
  }

  const { sub, email, name, picture, issuer } = identity

  // -------------------------------------------------------------
  // Flow A: Linking Google account to currently authenticated user
  // -------------------------------------------------------------
  if (transactionState.action === 'link') {
    const { user: currentUser } = await payload.auth({ headers: request.headers })

    if (!currentUser || String(currentUser.id) !== String(transactionState.userId)) {
      const res = NextResponse.redirect(
        new URL('/login?error=invalid_session_for_linking', getAppBaseURL()),
      )
      clearOAuthCookie(res)
      return res
    }

    // Check if this provider account is already linked
    const existingAccounts = await payload.find({
      collection: 'auth-accounts',
      where: {
        and: [
          { provider: { equals: 'google' } },
          { providerAccountId: { equals: sub } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existingAccounts.docs.length > 0) {
      const linkedAccount = existingAccounts.docs[0]
      const linkedUserId =
        typeof linkedAccount.user === 'object' && linkedAccount.user !== null
          ? linkedAccount.user.id
          : linkedAccount.user

      if (String(linkedUserId) !== String(currentUser.id)) {
        const res = NextResponse.redirect(
          new URL('/account?error=account_already_linked_different_user', getAppBaseURL()),
        )
        clearOAuthCookie(res)
        return res
      }

      // Already linked to this user
      const res = NextResponse.redirect(
        new URL('/account?info=already_linked', getAppBaseURL()),
      )
      clearOAuthCookie(res)
      return res
    }

    // Link provider account to current user
    try {
      await payload.create({
        collection: 'auth-accounts',
        data: {
          user: currentUser.id,
          provider: 'google',
          providerAccountId: sub,
          issuer: issuer || 'https://accounts.google.com',
        },
        overrideAccess: true,
      })
    } catch {
      const res = NextResponse.redirect(
        new URL('/account?error=linking_failed', getAppBaseURL()),
      )
      clearOAuthCookie(res)
      return res
    }

    const res = NextResponse.redirect(
      new URL('/account?success=google_linked', getAppBaseURL()),
    )
    clearOAuthCookie(res)
    return res
  }

  // -------------------------------------------------------------
  // Flow B: Sign-in / Sign-up for public website
  // -------------------------------------------------------------
  const existingAccounts = await payload.find({
    collection: 'auth-accounts',
    where: {
      and: [
        { provider: { equals: 'google' } },
        { providerAccountId: { equals: sub } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  // Returning Google provider identity
  if (existingAccounts.docs.length > 0) {
    const linkedAccount = existingAccounts.docs[0]
    const userId =
      typeof linkedAccount.user === 'object' && linkedAccount.user !== null
        ? linkedAccount.user.id
        : linkedAccount.user

    let user: any = null
    try {
      user = await payload.findByID({
        collection: 'users',
        id: userId,
        overrideAccess: true,
      })
    } catch {
      user = null
    }

    if (!user) {
      const res = NextResponse.redirect(
        new URL('/login?error=account_not_found', getAppBaseURL()),
      )
      clearOAuthCookie(res)
      return res
    }

    if (user.isActive === false) {
      const res = NextResponse.redirect(
        new URL('/login?error=account_inactive', getAppBaseURL()),
      )
      clearOAuthCookie(res)
      return res
    }

    // Establish authenticated Payload session
    const { cookieString } = await createPayloadSessionForUser({
      payload,
      user,
    })

    const returnUrl = sanitizeRedirect(transactionState.returnTo, '/account')
    const res = NextResponse.redirect(new URL(returnUrl, getAppBaseURL()))
    clearOAuthCookie(res)
    res.headers.append('Set-Cookie', cookieString)
    return res
  }

  // New provider identity: check if email is already registered
  const existingUsersByEmail = await payload.find({
    collection: 'users',
    where: {
      email: {
        equals: email,
      },
    },
    limit: 1,
    overrideAccess: true,
  })

  // Explicit policy: do not automatically merge accounts based on email
  if (existingUsersByEmail.docs.length > 0) {
    const res = NextResponse.redirect(
      new URL('/login?error=account_conflict', getAppBaseURL()),
    )
    clearOAuthCookie(res)
    return res
  }

  // Provision new user as a passwordless 'member'
  let newUser: any = null

  try {
    const UserModel = payload.db.collections?.users
    if (UserModel && typeof UserModel.create === 'function') {
      const doc = await UserModel.create({
        email,
        name: name || email.split('@')[0],
        role: 'member',
        avatarURL: picture || '',
        isActive: true,
      })
      newUser = await payload.findByID({
        collection: 'users',
        id: doc._id.toString(),
        overrideAccess: true,
      })
    } else {
      const randomPassword = crypto.randomBytes(32).toString('hex')
      newUser = await payload.create({
        collection: 'users',
        data: {
          email,
          name: name || email.split('@')[0],
          role: 'member',
          avatarURL: picture || '',
          isActive: true,
          password: randomPassword,
        },
        overrideAccess: true,
      })
    }
  } catch {
    const res = NextResponse.redirect(
      new URL('/login?error=provisioning_failed', getAppBaseURL()),
    )
    clearOAuthCookie(res)
    return res
  }

  // Attach auth-account to newly created user
  try {
    await payload.create({
      collection: 'auth-accounts',
      data: {
        user: newUser.id,
        provider: 'google',
        providerAccountId: sub,
        issuer: issuer || 'https://accounts.google.com',
      },
      overrideAccess: true,
    })
  } catch {
    // Avoid leaving orphaned user if concurrent callback race occurred
    try {
      await payload.delete({
        collection: 'users',
        id: newUser.id,
        overrideAccess: true,
      })
    } catch {
      // Best effort cleanup
    }
    const res = NextResponse.redirect(
      new URL('/login?error=account_link_conflict', getAppBaseURL()),
    )
    clearOAuthCookie(res)
    return res
  }

  // Establish session for the new member
  const { cookieString } = await createPayloadSessionForUser({
    payload,
    user: newUser,
  })

  const returnUrl = sanitizeRedirect(transactionState.returnTo, '/account')
  const res = NextResponse.redirect(new URL(returnUrl, getAppBaseURL()))
  clearOAuthCookie(res)
  res.headers.append('Set-Cookie', cookieString)
  return res
}
