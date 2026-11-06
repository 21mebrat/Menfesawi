import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'
import { createPayloadSessionForUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, email, password } = body

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'A valid email address is required.' },
        { status: 400 },
      )
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long.' },
        { status: 400 },
      )
    }

    const trimmedName = typeof name === 'string' && name.trim() ? name.trim() : email.split('@')[0]
    const normalizedEmail = email.trim().toLowerCase()

    const config = await configPromise
    const payload = await getPayload({ config })

    // Check if user already exists
    const existing = await payload.find({
      collection: 'users',
      where: {
        email: {
          equals: normalizedEmail,
        },
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      return NextResponse.json(
        { error: 'An account with this email address already exists. Please sign in instead.' },
        { status: 409 },
      )
    }

    // Create new member user using Payload's built-in password authentication
    // Payload automatically salts and hashes the password into the database
    const newUser = await payload.create({
      collection: 'users',
      data: {
        name: trimmedName,
        email: normalizedEmail,
        password,
        role: 'member',
        isActive: true,
      },
      overrideAccess: true,
    })

    // Establish immediate authenticated session
    const { cookieString } = await createPayloadSessionForUser({
      payload,
      user: newUser,
    })

    const response = NextResponse.json({
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: (newUser as any).name,
        role: (newUser as any).role,
      },
    })

    response.headers.append('Set-Cookie', cookieString)
    return response
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to create account.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
