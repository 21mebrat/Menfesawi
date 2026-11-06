import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'
import { generatePayloadCookie } from 'payload/shared'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 },
      )
    }

    const config = await configPromise
    const payload = await getPayload({ config })

    const result = await payload.login({
      collection: 'users',
      data: {
        email: email.trim().toLowerCase(),
        password,
      },
    })

    if (!result.user || (result.user as any).isActive === false) {
      return NextResponse.json(
        { error: 'Account is inactive. Please contact an administrator.' },
        { status: 403 },
      )
    }

    const cookieString = generatePayloadCookie({
      collectionAuthConfig: payload.collections.users.config.auth,
      cookiePrefix: payload.config.cookiePrefix || 'payload',
      token: result.token!,
    }) as string

    const response = NextResponse.json({
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: (result.user as any).name,
        role: (result.user as any).role,
      },
    })

    response.headers.append('Set-Cookie', cookieString)
    return response
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid email or password.'
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
