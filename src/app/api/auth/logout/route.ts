import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'
import { destroyPayloadSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const config = await configPromise
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })

    let expiredCookie: string
    if (user) {
      expiredCookie = await destroyPayloadSession({
        payload,
        user,
        sid: (user as any)._sid,
      })
    } else {
      const usersCollection = payload.collections.users
      const { generateExpiredPayloadCookie } = await import('payload/shared')
      expiredCookie = generateExpiredPayloadCookie({
        collectionAuthConfig: usersCollection.config.auth,
        cookiePrefix: payload.config.cookiePrefix || 'payload',
      }) as string
    }

    const response = NextResponse.json({
      success: true,
      message: 'Logged out successfully.',
    })

    response.headers.append('Set-Cookie', expiredCookie)
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Logout failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
