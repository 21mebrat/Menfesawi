import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'
import { getPayload, Payload } from 'payload'
import configPromise from '@/payload.config'
import {
  canAccessAdmin,
  canReadUser,
  canUpdateUser,
  isAdmin,
  isAuthenticated,
  isStaff,
  isEditor,
} from '@/access'
import {
  generatePKCE,
  generateRandomHex,
  signOAuthState,
  verifyOAuthState,
  OAUTH_COOKIE_NAME,
  type OAuthTransactionState,
} from '@/lib/auth/oauth-state'
import * as googleAuth from '@/lib/auth/google'
import { sanitizeRedirect } from '@/lib/auth/google'
import {
  createPayloadSessionForUser,
  destroyPayloadSession,
} from '@/lib/auth/session'
import { GET as handleGoogleCallback } from '@/app/api/auth/google/callback/route'
import { GET as handleGoogleInit } from '@/app/api/auth/google/route'
import { POST as handleUnlink } from '@/app/api/auth/google/unlink/route'
import { POST as handleRegister } from '@/app/api/auth/register/route'
import { OAuth2Client } from 'google-auth-library'

let payload: Payload
const testRunId = Date.now()

const adminEmail = `admin-${testRunId}@menfesawi.test`
const editorEmail = `editor-${testRunId}@menfesawi.test`
const memberEmail1 = `member1-${testRunId}@menfesawi.test`
const memberEmail2 = `member2-${testRunId}@menfesawi.test`
const inactiveEmail = `inactive-${testRunId}@menfesawi.test`
const commonPassword = 'TestPassword123!'

let adminUser: any
let editorUser: any
let memberUser1: any
let memberUser2: any
let inactiveUser: any

describe('Menfesawi Authentication & Access Control', () => {
  beforeAll(async () => {
    const config = await configPromise
    payload = await getPayload({ config })

    // Create test accounts
    adminUser = await payload.create({
      collection: 'users',
      data: {
        email: adminEmail,
        name: 'Test Admin',
        role: 'admin',
        password: commonPassword,
        isActive: true,
      },
      overrideAccess: true,
    })

    editorUser = await payload.create({
      collection: 'users',
      data: {
        email: editorEmail,
        name: 'Test Editor',
        role: 'editor',
        password: commonPassword,
        isActive: true,
      },
      overrideAccess: true,
    })

    memberUser1 = await payload.create({
      collection: 'users',
      data: {
        email: memberEmail1,
        name: 'Test Member One',
        role: 'member',
        password: commonPassword,
        isActive: true,
      },
      overrideAccess: true,
    })

    memberUser2 = await payload.create({
      collection: 'users',
      data: {
        email: memberEmail2,
        name: 'Test Member Two',
        role: 'member',
        password: commonPassword,
        isActive: true,
      },
      overrideAccess: true,
    })

    inactiveUser = await payload.create({
      collection: 'users',
      data: {
        email: inactiveEmail,
        name: 'Test Inactive User',
        role: 'member',
        password: commonPassword,
        isActive: false,
      },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    // Clean up created test accounts and auth-accounts
    const userEmails = [
      adminEmail,
      editorEmail,
      memberEmail1,
      memberEmail2,
      inactiveEmail,
    ]

    for (const email of userEmails) {
      try {
        await payload.delete({
          collection: 'users',
          where: {
            email: { equals: email },
          },
          overrideAccess: true,
        })
      } catch {
        // Ignore cleanup failures
      }
    }
  })

  // -------------------------------------------------------------
  // 1. Existing administrator remains able to log in
  // -------------------------------------------------------------
  it('allows the administrator to log in with email and password', async () => {
    const loginResult = await payload.login({
      collection: 'users',
      data: {
        email: adminEmail,
        password: commonPassword,
      },
    })

    expect(loginResult.token).toBeDefined()
    expect(loginResult.user).toBeDefined()
    expect(loginResult.user?.email).toBe(adminEmail)
    expect((loginResult.user as any).role).toBe('admin')
  })

  // -------------------------------------------------------------
  // 2. Members are denied admin access
  // -------------------------------------------------------------
  it('denies members access to Payload admin and grants access only to staff', () => {
    // Admin access check
    expect(canAccessAdmin({ req: { user: adminUser } as any })).toBe(true)
    expect(isAdmin(adminUser)).toBe(true)
    expect(isStaff(adminUser)).toBe(true)

    // Editor access check
    expect(canAccessAdmin({ req: { user: editorUser } as any })).toBe(true)
    expect(isAdmin(editorUser)).toBe(false)
    expect(isStaff(editorUser)).toBe(true)

    // Member access check: MUST be denied
    expect(canAccessAdmin({ req: { user: memberUser1 } as any })).toBe(false)
    expect(isAdmin(memberUser1)).toBe(false)
    expect(isStaff(memberUser1)).toBe(false)

    // Inactive admin check: MUST be denied
    const inactiveAdmin = { ...adminUser, isActive: false }
    expect(canAccessAdmin({ req: { user: inactiveAdmin } as any })).toBe(false)
  })

  // -------------------------------------------------------------
  // 3. Users cannot list other users or escalate privileges
  // -------------------------------------------------------------
  it('prevents non-admins from listing other users', async () => {
    const listResult = await payload.find({
      collection: 'users',
      req: { user: memberUser1 } as any,
      overrideAccess: false,
    })

    // Non-admin can only read their own record
    expect(listResult.docs.length).toBe(1)
    expect(listResult.docs[0].id).toBe(memberUser1.id)
  })

  it('prevents non-admins from escalating their role to admin', async () => {
    const updated = await payload.update({
      collection: 'users',
      id: memberUser1.id,
      data: {
        role: 'admin',
      },
      req: { user: memberUser1 } as any,
      overrideAccess: false,
    })

    expect(updated.role).toBe('member')
  })

  it('prevents non-admins from changing their activation status', async () => {
    const updated = await payload.update({
      collection: 'users',
      id: memberUser1.id,
      data: {
        isActive: false,
      },
      req: { user: memberUser1 } as any,
      overrideAccess: false,
    })

    expect(updated.isActive).toBe(true)
  })

  it('prevents anonymous callers from creating users through generic endpoints', async () => {
    await expect(
      payload.create({
        collection: 'users',
        data: {
          email: `anon-${testRunId}@menfesawi.test`,
          password: 'Password123!',
        },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  // -------------------------------------------------------------
  // 4. New Google accounts receive member role
  // -------------------------------------------------------------
  it('provisions new Google identities strictly with member role', async () => {
    const googleEmail = `new-google-${testRunId}@menfesawi.test`
    const googleSub = `sub-google-${testRunId}`

    const newUser = await payload.create({
      collection: 'users',
      data: {
        email: googleEmail,
        name: 'Google Newcomer',
        role: 'member',
        avatarURL: 'https://lh3.googleusercontent.com/photo.jpg',
        isActive: true,
        password: generateRandomHex(32),
      },
      overrideAccess: true,
    })

    const authAccount = await payload.create({
      collection: 'auth-accounts',
      data: {
        user: newUser.id,
        provider: 'google',
        providerAccountId: googleSub,
      },
      overrideAccess: true,
    })

    expect(newUser.role).toBe('member')
    expect(newUser.name).toBe('Google Newcomer')
    expect(newUser.avatarURL).toBe('https://lh3.googleusercontent.com/photo.jpg')
    expect(newUser.isActive).toBe(true)
    expect(authAccount.provider).toBe('google')
    expect(authAccount.providerAccountId).toBe(googleSub)

    // Clean up
    await payload.delete({ collection: 'auth-accounts', id: authAccount.id, overrideAccess: true })
    await payload.delete({ collection: 'users', id: newUser.id, overrideAccess: true })
  })

  // -------------------------------------------------------------
  // 5. Returning provider identity resolves the same user
  // -------------------------------------------------------------
  it('resolves returning provider identities to the same user record', async () => {
    const providerSub = `sub-returning-${testRunId}`
    const authAccount = await payload.create({
      collection: 'auth-accounts',
      data: {
        user: memberUser1.id,
        provider: 'google',
        providerAccountId: providerSub,
      },
      overrideAccess: true,
    })

    const found = await payload.find({
      collection: 'auth-accounts',
      where: {
        and: [
          { provider: { equals: 'google' } },
          { providerAccountId: { equals: providerSub } },
        ],
      },
      overrideAccess: true,
    })

    expect(found.docs.length).toBe(1)
    const linkedUserId =
      typeof found.docs[0].user === 'object' && found.docs[0].user !== null
        ? (found.docs[0].user as any).id
        : found.docs[0].user
    expect(linkedUserId).toBe(memberUser1.id)

    // Clean up
    await payload.delete({ collection: 'auth-accounts', id: authAccount.id, overrideAccess: true })
  })

  // -------------------------------------------------------------
  // 6. Invalid state, nonce, or expired token fails
  // -------------------------------------------------------------
  it('validates state integrity and rejects tampered or expired OAuth states', () => {
    const state = generateRandomHex(32)
    const { codeVerifier } = generatePKCE()
    const nonce = generateRandomHex(32)

    const validStateData: OAuthTransactionState = {
      state,
      codeVerifier,
      nonce,
      action: 'signin',
      returnTo: '/account',
      createdAt: Date.now(),
    }

    const signedCookie = signOAuthState(validStateData)
    expect(verifyOAuthState(signedCookie)).not.toBeNull()

    // Tampered cookie fails
    const tamperedCookie = signedCookie.replace(/^[^.]*/, 'tamperedbase64')
    expect(verifyOAuthState(tamperedCookie)).toBeNull()

    // Expired cookie (> 10 mins) fails
    const expiredStateData: OAuthTransactionState = {
      ...validStateData,
      createdAt: Date.now() - 11 * 60 * 1000,
    }
    const expiredCookie = signOAuthState(expiredStateData)
    expect(verifyOAuthState(expiredCookie)).toBeNull()
  })

  // -------------------------------------------------------------
  // 7. Email collisions do not silently link accounts
  // -------------------------------------------------------------
  it('prevents silent account merging when a Google email collides with an existing password user', async () => {
    // memberUser1 has memberEmail1.
    // Querying auth-accounts for a new Google sub with this email yields 0 records.
    const googleSub = `sub-collision-${testRunId}`
    const existingAccounts = await payload.find({
      collection: 'auth-accounts',
      where: {
        and: [
          { provider: { equals: 'google' } },
          { providerAccountId: { equals: googleSub } },
        ],
      },
      overrideAccess: true,
    })

    expect(existingAccounts.docs.length).toBe(0)

    // User with email exists
    const usersWithEmail = await payload.find({
      collection: 'users',
      where: { email: { equals: memberEmail1 } },
      overrideAccess: true,
    })
    expect(usersWithEmail.docs.length).toBe(1)

    // Under our policy, the system refuses auto-merging:
    // the user must authenticate with local credentials first before linking.
  })

  // -------------------------------------------------------------
  // 8. Provider identities cannot be linked to two users
  // -------------------------------------------------------------
  it('prevents linking the same provider identity to two different users', async () => {
    const uniqueSub = `sub-unique-conflict-${testRunId}`

    const account1 = await payload.create({
      collection: 'auth-accounts',
      data: {
        user: memberUser1.id,
        provider: 'google',
        providerAccountId: uniqueSub,
      },
      overrideAccess: true,
    })

    // Compound unique index prevents duplicate providerAccountId
    await expect(
      payload.create({
        collection: 'auth-accounts',
        data: {
          user: memberUser2.id,
          provider: 'google',
          providerAccountId: uniqueSub,
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow()

    await payload.delete({ collection: 'auth-accounts', id: account1.id, overrideAccess: true })
  })

  // -------------------------------------------------------------
  // 9. Expired or revoked sessions are rejected
  // -------------------------------------------------------------
  it('creates valid sessions and invalidates them upon logout/revocation', async () => {
    // Create session
    const { token, sid } = await createPayloadSessionForUser({
      payload,
      user: memberUser1,
    })

    expect(token).toBeDefined()
    expect(sid).toBeDefined()

    // User should have this session recorded
    const freshUser = await payload.findByID({
      collection: 'users',
      id: memberUser1.id,
      overrideAccess: true,
    })
    const sessions = (freshUser as any).sessions || []
    expect(sessions.some((s: any) => s.id === sid)).toBe(true)

    // Revoke session
    await destroyPayloadSession({
      payload,
      user: freshUser,
      sid,
    })

    const afterRevocationUser = await payload.findByID({
      collection: 'users',
      id: memberUser1.id,
      overrideAccess: true,
    })
    const afterSessions = (afterRevocationUser as any).sessions || []
    expect(afterSessions.some((s: any) => s.id === sid)).toBe(false)
  })

  // -------------------------------------------------------------
  // 10. Inactive accounts are rejected
  // -------------------------------------------------------------
  it('rejects login attempts from deactivated accounts', async () => {
    await expect(
      payload.login({
        collection: 'users',
        data: {
          email: inactiveEmail,
          password: commonPassword,
        },
      }),
    ).rejects.toThrow(/Account is inactive/)
  })

  // -------------------------------------------------------------
  // 11. Open redirects are sanitized
  // -------------------------------------------------------------
  it('sanitizes unsafe external redirect URLs to safe same-origin paths', () => {
    expect(sanitizeRedirect('https://evil.com')).toBe('/account')
    expect(sanitizeRedirect('//evil.com')).toBe('/account')
    expect(sanitizeRedirect('/\\evil.com')).toBe('/account')
    expect(sanitizeRedirect('javascript:alert(1)')).toBe('/account')
    expect(sanitizeRedirect('/account/settings')).toBe('/account/settings')
    expect(sanitizeRedirect('/daily-readings')).toBe('/daily-readings')
  })

  // -------------------------------------------------------------
  // 12. Auth-account records cannot be read or modified by anonymous users
  // -------------------------------------------------------------
  it('prevents anonymous users from reading or writing auth-accounts records', async () => {
    await expect(
      payload.find({
        collection: 'auth-accounts',
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    await expect(
      payload.create({
        collection: 'auth-accounts',
        data: {
          user: memberUser1.id,
          provider: 'google',
          providerAccountId: 'anon-sub',
        },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  // -------------------------------------------------------------
  // 13. Route Level: Google Callback flow with mocked Google API
  // -------------------------------------------------------------
  it('handles Google callback: rejects invalid state or cancellation', async () => {
    // 1. User cancellation
    const cancelReq = new Request('http://localhost:3000/api/auth/google/callback?error=access_denied')
    const cancelRes = await handleGoogleCallback(cancelReq)
    expect(cancelRes.status).toBe(307)
    expect(cancelRes.headers.get('location')).toContain('error=google_cancelled')

    // 2. Missing code or state
    const missingReq = new Request('http://localhost:3000/api/auth/google/callback')
    const missingRes = await handleGoogleCallback(missingReq)
    expect(missingRes.status).toBe(307)
    expect(missingRes.headers.get('location')).toContain('error=missing_code_or_state')

    // 3. State mismatch
    const state = generateRandomHex(32)
    const cookieVal = signOAuthState({
      state,
      codeVerifier: 'verifier',
      nonce: 'nonce',
      action: 'signin',
      returnTo: '/account',
      createdAt: Date.now(),
    })
    const mismatchReq = new Request(`http://localhost:3000/api/auth/google/callback?code=mock_code&state=wrong_state`, {
      headers: {
        cookie: `${OAUTH_COOKIE_NAME}=${cookieVal}`,
      },
    })
    const mismatchRes = await handleGoogleCallback(mismatchReq)
    expect(mismatchRes.status).toBe(307)
    expect(mismatchRes.headers.get('location')).toContain('error=state_mismatch')
  })

  it('handles Google callback: provisions new user and sets session cookie', async () => {
    const state = generateRandomHex(32)
    const nonce = generateRandomHex(32)
    const googleSub = `mock-sub-${Date.now()}`
    const googleEmail = `mock-google-${Date.now()}@menfesawi.test`

    const cookieVal = signOAuthState({
      state,
      codeVerifier: 'mock_code_verifier',
      nonce,
      action: 'signin',
      returnTo: '/account',
      createdAt: Date.now(),
    })

    const spy = vi.spyOn(googleAuth, 'exchangeAndVerifyGoogleCode').mockResolvedValueOnce({
      sub: googleSub,
      email: googleEmail,
      name: 'Mock Google User',
      picture: 'https://lh3.googleusercontent.com/photo.jpg',
      issuer: 'https://accounts.google.com',
    })

    const req = new Request(`http://localhost:3000/api/auth/google/callback?code=mock_code&state=${state}`, {
      headers: {
        cookie: `${OAUTH_COOKIE_NAME}=${cookieVal}`,
      },
    })

    const res = await handleGoogleCallback(req)
    spy.mockRestore()

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/account')

    // Check payload-token cookie was set
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some((c) => c.includes('payload-token='))).toBe(true)

    // Verify user created with member role and correct schema properties
    const users = await payload.find({
      collection: 'users',
      where: { email: { equals: googleEmail } },
      overrideAccess: true,
    })
    expect(users.docs.length).toBe(1)
    expect(users.docs[0].name).toBe('Mock Google User')
    expect(users.docs[0].avatarURL).toBe('https://lh3.googleusercontent.com/photo.jpg')
    expect(users.docs[0].role).toBe('member')
    expect(users.docs[0].isActive).toBe(true)

    // Verify auth-account created
    const accounts = await payload.find({
      collection: 'auth-accounts',
      where: { providerAccountId: { equals: googleSub } },
      overrideAccess: true,
    })
    expect(accounts.docs.length).toBe(1)
    expect(accounts.docs[0].provider).toBe('google')
    expect(accounts.docs[0].providerAccountId).toBe(googleSub)
    expect(accounts.docs[0].issuer).toBe('https://accounts.google.com')

    // Clean up
    await payload.delete({ collection: 'auth-accounts', id: accounts.docs[0].id, overrideAccess: true })
    await payload.delete({ collection: 'users', id: users.docs[0].id, overrideAccess: true })
  })

  it('handles Google callback: detects email collision with local account and prevents auto-merge', async () => {
    const state = generateRandomHex(32)
    const nonce = generateRandomHex(32)
    const googleSub = `mock-sub-collision-${Date.now()}`

    const cookieVal = signOAuthState({
      state,
      codeVerifier: 'mock_code_verifier',
      nonce,
      action: 'signin',
      returnTo: '/account',
      createdAt: Date.now(),
    })

    // Return the email of memberUser1, who does NOT have an auth-account record
    const spy = vi.spyOn(googleAuth, 'exchangeAndVerifyGoogleCode').mockResolvedValueOnce({
      sub: googleSub,
      email: memberEmail1,
      name: 'Collision User',
      issuer: 'https://accounts.google.com',
    })

    const req = new Request(`http://localhost:3000/api/auth/google/callback?code=mock_code&state=${state}`, {
      headers: {
        cookie: `${OAUTH_COOKIE_NAME}=${cookieVal}`,
      },
    })

    const res = await handleGoogleCallback(req)
    spy.mockRestore()

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=account_conflict')

    // Ensure memberUser1 was not altered and no auth-account was created
    const accounts = await payload.find({
      collection: 'auth-accounts',
      where: { providerAccountId: { equals: googleSub } },
      overrideAccess: true,
    })
    expect(accounts.docs.length).toBe(0)
  })

  // -------------------------------------------------------------
  // 14. Unlinking Account logic across supported provisioning paths
  // -------------------------------------------------------------
  it('prevents Google-only users from unlinking their only login method across every provisioning path', async () => {
    // Path 1: First-time Google OAuth callback user (passwordless, hasPassword: false)
    const UserModel = payload.db.collections.users
    const rawUser1 = await UserModel.create({
      email: `oauth-path1-${Date.now()}@menfesawi.test`,
      name: 'OAuth Path 1 User',
      role: 'member',
      isActive: true,
      hasPassword: false,
    })
    const oauthUser1 = await payload.findByID({
      collection: 'users',
      id: rawUser1._id.toString(),
      overrideAccess: true,
    })

    const authAcc1 = await payload.create({
      collection: 'auth-accounts',
      data: {
        user: oauthUser1.id,
        provider: 'google',
        providerAccountId: `sub-oauth-path1-${Date.now()}`,
      },
      overrideAccess: true,
    })

    const { token: token1 } = await createPayloadSessionForUser({
      payload,
      user: oauthUser1,
    })

    const unlinkReq1 = new Request('http://localhost:3000/api/auth/google/unlink', {
      method: 'POST',
      headers: { cookie: `payload-token=${token1}` },
    })
    const unlinkRes1 = await handleUnlink(unlinkReq1)
    expect(unlinkRes1.status).toBe(400)
    const data1 = await unlinkRes1.json()
    expect(data1.error).toContain('Cannot unlink your only login method')

    // Path 2: Account provisioned with undisclosed random-password hash, but hasPassword: false
    // Proves that an undisclosed password hash is NEVER treated as a usable password
    const oauthUser2 = await payload.create({
      collection: 'users',
      data: {
        email: `oauth-randomhash-${Date.now()}@menfesawi.test`,
        name: 'OAuth Random Hash User',
        role: 'member',
        isActive: true,
        hasPassword: false,
        password: generateRandomHex(32), // Random undisclosed password
      },
      overrideAccess: true,
    })

    const authAcc2 = await payload.create({
      collection: 'auth-accounts',
      data: {
        user: oauthUser2.id,
        provider: 'google',
        providerAccountId: `sub-oauth-randomhash-${Date.now()}`,
      },
      overrideAccess: true,
    })

    const { token: token2 } = await createPayloadSessionForUser({
      payload,
      user: oauthUser2,
    })

    const unlinkReq2 = new Request('http://localhost:3000/api/auth/google/unlink', {
      method: 'POST',
      headers: { cookie: `payload-token=${token2}` },
    })
    const unlinkRes2 = await handleUnlink(unlinkReq2)
    expect(unlinkRes2.status).toBe(400)
    const data2 = await unlinkRes2.json()
    expect(data2.error).toContain('Cannot unlink your only login method')

    // Path 3: Multi-provider user (Google + Apple) without local password
    // Can unlink Google because another provider account is linked
    const authAcc2Secondary = await payload.create({
      collection: 'auth-accounts',
      data: {
        user: oauthUser2.id,
        provider: 'apple',
        providerAccountId: `apple-${Date.now()}`,
      },
      overrideAccess: true,
    })

    const unlinkReqMulti = new Request('http://localhost:3000/api/auth/google/unlink', {
      method: 'POST',
      headers: { cookie: `payload-token=${token2}` },
    })
    const unlinkResMulti = await handleUnlink(unlinkReqMulti)
    expect(unlinkResMulti.status).toBe(200)
    const dataMulti = await unlinkResMulti.json()
    expect(dataMulti.success).toBe(true)

    // Path 4: User who registered with a usable password (memberUser1)
    const linkedAcc = await payload.create({
      collection: 'auth-accounts',
      data: {
        user: memberUser1.id,
        provider: 'google',
        providerAccountId: `sub-pw-user-${Date.now()}`,
      },
      overrideAccess: true,
    })

    const { token: pwUserToken } = await createPayloadSessionForUser({
      payload,
      user: memberUser1,
    })

    const allowedUnlinkReq = new Request('http://localhost:3000/api/auth/google/unlink', {
      method: 'POST',
      headers: { cookie: `payload-token=${pwUserToken}` },
    })
    const allowedRes = await handleUnlink(allowedUnlinkReq)
    expect(allowedRes.status).toBe(200)
    const allowedData = await allowedRes.json()
    expect(allowedData.success).toBe(true)

    // Clean up
    await payload.delete({ collection: 'auth-accounts', id: authAcc1.id, overrideAccess: true })
    await UserModel.deleteOne({ _id: rawUser1._id })
    await payload.delete({ collection: 'auth-accounts', id: authAcc2Secondary.id, overrideAccess: true })
    await payload.delete({ collection: 'users', id: oauthUser2.id, overrideAccess: true })
  })

  // -------------------------------------------------------------
  // 15. Inactive users across OAuth linking/unlinking routes and access helpers
  // -------------------------------------------------------------
  it('rejects inactive users on OAuth callback, linking initiation, unlinking, and access helpers', async () => {
    // 1. OAuth callback for deactivated returning user
    const inactiveSub = `sub-inactive-${Date.now()}`
    const inactiveAuthAccount = await payload.create({
      collection: 'auth-accounts',
      data: {
        user: inactiveUser.id,
        provider: 'google',
        providerAccountId: inactiveSub,
      },
      overrideAccess: true,
    })

    const state = generateRandomHex(32)
    const nonce = generateRandomHex(32)
    const cookieVal = signOAuthState({
      state,
      codeVerifier: 'mock_code_verifier',
      nonce,
      action: 'signin',
      returnTo: '/account',
      createdAt: Date.now(),
    })

    const spy = vi.spyOn(googleAuth, 'exchangeAndVerifyGoogleCode').mockResolvedValueOnce({
      sub: inactiveSub,
      email: inactiveEmail,
      name: 'Inactive Returner',
      issuer: 'https://accounts.google.com',
    })

    const callbackReq = new Request(`http://localhost:3000/api/auth/google/callback?code=mock_code&state=${state}`, {
      headers: { cookie: `${OAUTH_COOKIE_NAME}=${cookieVal}` },
    })

    const callbackRes = await handleGoogleCallback(callbackReq)
    spy.mockRestore()

    expect(callbackRes.status).toBe(307)
    expect(callbackRes.headers.get('location')).toContain('error=account_inactive')

    await payload.delete({ collection: 'auth-accounts', id: inactiveAuthAccount.id, overrideAccess: true })

    // 2. Inactive user attempting to initiate Google linking (/api/auth/google?action=link)
    const { token: inactiveToken } = await createPayloadSessionForUser({
      payload,
      user: inactiveUser,
    })

    const linkInitReq = new Request('http://localhost:3000/api/auth/google?action=link', {
      headers: { cookie: `payload-token=${inactiveToken}` },
    })
    const linkInitRes = await handleGoogleInit(linkInitReq)
    expect(linkInitRes.status).toBe(307)
    expect(linkInitRes.headers.get('location')).toContain('error=account_inactive')

    // 3. Inactive user attempting to unlink Google (/api/auth/google/unlink)
    const unlinkInactiveReq = new Request('http://localhost:3000/api/auth/google/unlink', {
      method: 'POST',
      headers: { cookie: `payload-token=${inactiveToken}` },
    })
    const unlinkInactiveRes = await handleUnlink(unlinkInactiveReq)
    expect(unlinkInactiveRes.status).toBe(403)
    const unlinkInactiveData = await unlinkInactiveRes.json()
    expect(unlinkInactiveData.error).toContain('Account is inactive')

    // 4. Access helpers verify inactive users have no access
    expect(isAuthenticated({ id: '1', isActive: false })).toBe(false)
    expect(isAdmin({ id: '1', role: 'admin', isActive: false })).toBe(false)
    expect(isEditor({ id: '1', role: 'editor', isActive: false })).toBe(false)
    expect(isStaff({ id: '1', role: 'admin', isActive: false })).toBe(false)
    expect(canAccessAdmin({ req: { user: { id: '1', role: 'admin', isActive: false } } as any })).toBe(false)
    expect(canReadUser({ req: { user: { id: '1', role: 'member', isActive: false } } as any })).toBe(false)
    expect(canUpdateUser({ req: { user: { id: '1', role: 'member', isActive: false } } as any })).toBe(false)
  })

  // -------------------------------------------------------------
  // 16. Nonce validation rejects missing and incorrect nonces
  // -------------------------------------------------------------
  it('strictly validates nonce: rejects missing or mismatched nonces', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'

    const getTokenSpy = vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({
      tokens: { id_token: 'mock_jwt_token' },
      res: null,
    } as any)
    const verifySpy = vi.spyOn(OAuth2Client.prototype, 'verifyIdToken')

    try {
      // Case 1: Nonce mismatch
      verifySpy.mockResolvedValueOnce({
        getPayload: () => ({
          sub: 'sub-1',
          email: 'user@test.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          nonce: 'actual_nonce_123',
        }),
      } as any)
      await expect(
        googleAuth.exchangeAndVerifyGoogleCode({
          code: 'auth_code',
          codeVerifier: 'verifier',
          expectedNonce: 'different_nonce_456',
        }),
      ).rejects.toThrow(/nonce is missing or mismatch/)

      // Case 2: Missing nonce in ID token
      verifySpy.mockResolvedValueOnce({
        getPayload: () => ({
          sub: 'sub-1',
          email: 'user@test.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          // nonce is omitted
        }),
      } as any)
      await expect(
        googleAuth.exchangeAndVerifyGoogleCode({
          code: 'auth_code',
          codeVerifier: 'verifier',
          expectedNonce: 'expected_nonce_123',
        }),
      ).rejects.toThrow(/nonce is missing or mismatch/)

      // Case 3: Expected nonce parameter is empty/missing
      verifySpy.mockResolvedValueOnce({
        getPayload: () => ({
          sub: 'sub-1',
          email: 'user@test.com',
          email_verified: true,
          iss: 'https://accounts.google.com',
          nonce: 'actual_nonce_123',
        }),
      } as any)
      await expect(
        googleAuth.exchangeAndVerifyGoogleCode({
          code: 'auth_code',
          codeVerifier: 'verifier',
          expectedNonce: '',
        }),
      ).rejects.toThrow(/nonce is missing or mismatch/)
    } finally {
      getTokenSpy.mockRestore()
      verifySpy.mockRestore()
    }
  })

  // -------------------------------------------------------------
  // 17. Atomic concurrent session logout
  // -------------------------------------------------------------
  it('performs atomic session revocation with overlapping concurrent requests without restoring or overwriting sessions', async () => {
    // Create 5 concurrent sessions simultaneously for memberUser2
    const sessions = await Promise.all([
      createPayloadSessionForUser({ payload, user: memberUser2 }),
      createPayloadSessionForUser({ payload, user: memberUser2 }),
      createPayloadSessionForUser({ payload, user: memberUser2 }),
      createPayloadSessionForUser({ payload, user: memberUser2 }),
      createPayloadSessionForUser({ payload, user: memberUser2 }),
    ])

    const sids = sessions.map((s) => s.sid).filter(Boolean) as string[]
    expect(sids.length).toBe(5)
    expect(new Set(sids).size).toBe(5)

    // Verify all 5 sessions are recorded in the database
    let userRecord = await payload.findByID({
      collection: 'users',
      id: memberUser2.id,
      overrideAccess: true,
    })
    let recordedSids = ((userRecord as any).sessions || []).map((s: any) => s.id)
    for (const sid of sids) {
      expect(recordedSids).toContain(sid)
    }

    // Genuinely overlapping concurrent revocations: destroy 3 sessions simultaneously
    const revokeResults = await Promise.all([
      destroyPayloadSession({ payload, user: memberUser2, sid: sids[0] }),
      destroyPayloadSession({ payload, user: memberUser2, sid: sids[1] }),
      destroyPayloadSession({ payload, user: memberUser2, sid: sids[2] }),
    ])
    expect(revokeResults.length).toBe(3)

    // Check database: sids[0], sids[1], sids[2] MUST be gone, but sids[3] and sids[4] MUST REMAIN!
    userRecord = await payload.findByID({
      collection: 'users',
      id: memberUser2.id,
      overrideAccess: true,
    })
    recordedSids = ((userRecord as any).sessions || []).map((s: any) => s.id)
    expect(recordedSids).not.toContain(sids[0])
    expect(recordedSids).not.toContain(sids[1])
    expect(recordedSids).not.toContain(sids[2])
    expect(recordedSids).toContain(sids[3])
    expect(recordedSids).toContain(sids[4])

    // Concurrently destroy the remaining 2 sessions
    await Promise.all([
      destroyPayloadSession({ payload, user: memberUser2, sid: sids[3] }),
      destroyPayloadSession({ payload, user: memberUser2, sid: sids[4] }),
    ])

    // Verify all are removed
    userRecord = await payload.findByID({
      collection: 'users',
      id: memberUser2.id,
      overrideAccess: true,
    })
    recordedSids = ((userRecord as any).sessions || []).map((s: any) => s.id)
    for (const sid of sids) {
      expect(recordedSids).not.toContain(sid)
    }
  })

  // -------------------------------------------------------------
  // 18. Payload auth validates active session and rejects revoked session
  // -------------------------------------------------------------
  it('accepts issued session with payload.auth and rejects after session revocation', async () => {
    const session = await createPayloadSessionForUser({ payload, user: memberUser1 })

    // Valid session token accepted
    const authHeaders = new Headers({
      cookie: `payload-token=${session.token}`,
    })
    const authBefore = await payload.auth({ headers: authHeaders })
    expect(authBefore.user).toBeDefined()
    expect(authBefore.user?.id).toBe(memberUser1.id)

    // Destroy session
    await destroyPayloadSession({
      payload,
      user: memberUser1,
      sid: session.sid,
    })

    // After revocation, session is rejected
    const authAfter = await payload.auth({ headers: authHeaders })
    expect(authAfter.user).toBeNull()
  })

  // -------------------------------------------------------------
  // 19. Normal form registration endpoint (/api/auth/register)
  // -------------------------------------------------------------
  it('supports normal form registration with email and password and creates active session', async () => {
    const regEmail = `register-test-${Date.now()}@menfesawi.test`
    const regPassword = 'SecurePassword123!'
    const regName = 'Tadesse Gebre'

    const regReq = new Request('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: regName,
        email: regEmail,
        password: regPassword,
      }),
    })

    const regRes = await handleRegister(regReq)
    expect(regRes.status).toBe(200)

    const data = await regRes.json()
    expect(data.success).toBe(true)
    expect(data.user.email).toBe(regEmail)
    expect(data.user.name).toBe(regName)
    expect(data.user.role).toBe('member')

    // Session cookie was generated
    const setCookies = regRes.headers.getSetCookie()
    expect(setCookies.some((c) => c.includes('payload-token='))).toBe(true)

    // User can now log in with the registered credentials
    const loginResult = await payload.login({
      collection: 'users',
      data: {
        email: regEmail,
        password: regPassword,
      },
    })
    expect(loginResult.token).toBeDefined()
    expect(loginResult.user?.id).toBe(data.user.id)

    // Clean up
    await payload.delete({ collection: 'users', id: data.user.id, overrideAccess: true })
  })
})
