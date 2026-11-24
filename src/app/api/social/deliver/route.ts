import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'
import { isAdmin, type UserAuth } from '@/access'
import { runTelegramDeliveryQueue } from '@/lib/server/social/runner'

export const dynamic = 'force-dynamic'

/**
 * Validates same-origin / CSRF for state-changing requests.
 * Checks Sec-Fetch-Site and compares Origin/Referer against Host.
 */
function validateSameOrigin(request: Request): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site')
  if (secFetchSite === 'cross-site') {
    return false
  }

  const origin = request.headers.get('origin')
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host')

  if (origin && host) {
    try {
      const parsedOrigin = new URL(origin)
      if (parsedOrigin.host !== host) {
        return false
      }
    } catch {
      return false
    }
  }

  return true
}

/**
 * Explicitly invoked POST endpoint to process pending Telegram deliveries.
 * Protected by:
 * - Same-origin / CSRF validation.
 * - Active administrator verification against persisted database state.
 * - Server-controlled destinations (never accepts arbitrary destinations or bot tokens from request input).
 */
export async function POST(request: Request) {
  // 1. Same-Origin / CSRF enforcement
  if (!validateSameOrigin(request)) {
    return NextResponse.json(
      { error: 'Forbidden: Cross-site requests are rejected.' },
      { status: 403 },
    )
  }

  // 2. Authentication via Payload session
  const config = await configPromise
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })

  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    )
  }

  // 3. Verify user active status and admin role against persisted database state
  const fullUser = await payload.findByID({
    collection: 'users',
    id: user.id,
    overrideAccess: true,
  })

  if (!fullUser || (fullUser as any).isActive === false) {
    return NextResponse.json(
      { error: 'Account is inactive. Please contact an administrator.' },
      { status: 403 },
    )
  }

  if (!isAdmin(fullUser as unknown as UserAuth)) {
    return NextResponse.json(
      { error: 'Forbidden: Administrator privileges required.' },
      { status: 403 },
    )
  }

  // 4. Parse execution options safely (never accept bot tokens or arbitrary destinations)
  let batchSize = 5
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (
      typeof body?.batchSize === 'number' &&
      Number.isInteger(body.batchSize) &&
      body.batchSize > 0
    ) {
      batchSize = Math.min(body.batchSize, 10)
    }
  } catch {
    // Keep default batch size
  }

  // 5. Execute bounded delivery queue
  const summary = await runTelegramDeliveryQueue({
    payload,
    batchSize,
  })

  return NextResponse.json({
    success: true,
    ...summary,
  })
}
