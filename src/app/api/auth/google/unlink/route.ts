import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const config = await configPromise
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Check full user record and verify activation against current persisted database state FIRST
    const fullUser = await payload.findByID({
      collection: 'users',
      id: user.id,
      overrideAccess: true,
      showHiddenFields: true,
    })

    if (!fullUser || (fullUser as any).isActive === false) {
      return NextResponse.json(
        { error: 'Account is inactive. Please contact an administrator.' },
        { status: 403 },
      )
    }

    // Check all linked provider accounts for this user
    const linkedAccounts = await payload.find({
      collection: 'auth-accounts',
      where: {
        user: {
          equals: user.id,
        },
      },
      overrideAccess: true,
    })

    const googleAccount = linkedAccounts.docs.find((acc) => acc.provider === 'google')
    if (!googleAccount) {
      return NextResponse.json({ error: 'No linked Google account found.' }, { status: 404 })
    }

    // A usable password strictly requires hasPassword === true AND a valid hash.
    // An undisclosed random-password hash without hasPassword === true is NEVER considered usable.
    const hasUsablePassword =
      (fullUser as any).hasPassword === true && Boolean((fullUser as any).hash)
    const otherAccountsCount = linkedAccounts.docs.filter((acc) => acc.provider !== 'google').length

    if (!hasUsablePassword && otherAccountsCount === 0) {
      return NextResponse.json(
        {
          error:
            'Cannot unlink your only login method. Please set a local password or attach another provider first.',
        },
        { status: 400 },
      )
    }

    await payload.delete({
      collection: 'auth-accounts',
      id: googleAccount.id,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
      message: 'Google account successfully unlinked.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to unlink account'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
