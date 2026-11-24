import fs from 'fs'
import path from 'path'
import type { Payload } from 'payload'
import type { SocialDelivery, Teaching } from '@/payload-types'
import {
  sendTelegramAnnouncement,
  type TelegramDestination,
  sanitizeTelegramError,
} from './telegram'

export interface ClaimOptions {
  supportedDestinations?: TelegramDestination[]
}

export interface RunDeliveryQueueOptions {
  payload: Payload
  batchSize?: number
  executionBudgetMs?: number
  /**
   * For testing or route mocking: override frontend route existence check.
   */
  routeExistsOverride?: boolean
  /**
   * For testing: override site URL.
   */
  siteUrlOverride?: string
}

export interface DeliveryProcessResult {
  deliveryId: string
  destination: string
  status: 'sent' | 'failed' | 'uncertain' | 'skipped'
  error?: string
  postId?: string
  postURL?: string
  linkSyncError?: string
}

export interface RunDeliveryQueueSummary {
  processed: number
  sent: number
  failed: number
  uncertain: number
  skipped: number
  results: DeliveryProcessResult[]
}

const DEFAULT_BATCH_SIZE = 5
const MAX_BATCH_SIZE = 10
const DEFAULT_BUDGET_MS = 25_000
const MIN_REMAINING_BUDGET_MS = 4_000

/**
 * Checks if the public frontend route for individual teachings (/teachings/[slug]) exists.
 * Inspects actual file existence in src/app/(frontend)/.
 */
export function checkFrontendTeachingRouteExists(): boolean {
  try {
    const cwd = process.cwd()
    const potentialPaths = [
      path.join(cwd, 'src', 'app', '(frontend)', 'teachings', '[slug]', 'page.tsx'),
      path.join(cwd, 'src', 'app', '(frontend)', 'teachings', '[slug]', 'page.jsx'),
      path.join(cwd, 'src', 'app', '(frontend)', 'teachings', '[slug]', 'page.js'),
      path.join(cwd, 'src', 'app', 'teachings', '[slug]', 'page.tsx'),
    ]
    return potentialPaths.some((p) => fs.existsSync(p))
  } catch {
    return false
  }
}

/**
 * Establishes the public HTTPS teaching URL.
 * Enforces:
 * - Valid HTTPS SITE_URL (rejects missing, HTTP, embedded credentials, or placeholders).
 * - Valid teaching slug.
 * - Confirmed public frontend route (/teachings/[slug]).
 *
 * Never invents nonexistent routes or placeholder domains.
 */
export function resolvePublicTeachingURL(args: {
  slug?: string | null
  siteUrlOverride?: string
  routeExistsOverride?: boolean
}): { ok: true; url: string } | { ok: false; error: string } {
  const { slug, siteUrlOverride, routeExistsOverride } = args

  const rawSiteUrl = (siteUrlOverride ?? process.env.SITE_URL ?? '').trim()
  if (!rawSiteUrl) {
    return { ok: false, error: 'SITE_URL is not configured.' }
  }

  let parsed: URL
  try {
    parsed = new URL(rawSiteUrl)
  } catch {
    return { ok: false, error: 'SITE_URL is an invalid URL format.' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'SITE_URL must use the HTTPS protocol.' }
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'SITE_URL must not contain embedded credentials.' }
  }

  const hostname = parsed.hostname.toLowerCase()
  if (
    hostname.includes('your-site') ||
    hostname.includes('placeholder') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
  ) {
    return {
      ok: false,
      error: `SITE_URL is set to a non-public or placeholder domain (${hostname}).`,
    }
  }

  if (!slug || typeof slug !== 'string' || !slug.trim()) {
    return { ok: false, error: 'Teaching record has no valid slug.' }
  }

  // Verify that the public frontend route exists in the application
  const hasRoute = routeExistsOverride ?? checkFrontendTeachingRouteExists()
  if (!hasRoute) {
    return {
      ok: false,
      error:
        'Public frontend route (/teachings/[slug]) is not implemented. Cannot establish a valid public URL.',
    }
  }

  const origin = parsed.origin
  const cleanSlug = encodeURIComponent(slug.trim())
  return { ok: true, url: `${origin}/teachings/${cleanSlug}` }
}

/**
 * Atomically claims the next pending Telegram delivery record directly in MongoDB.
 *
 * Concurrency Safety:
 * Uses atomic findOneAndUpdate at the database level.
 * When multiple runners invoke this concurrently, MongoDB guarantees exactly one runner
 * acquires the document and transitions status from 'pending' to 'processing'.
 */
export async function claimNextPendingDelivery(
  payload: Payload,
  supportedDestinations: TelegramDestination[] = ['telegram-channel', 'telegram-group'],
): Promise<SocialDelivery | null> {
  const model = payload.db.collections?.['social-deliveries']
  if (!model || typeof model.findOneAndUpdate !== 'function') {
    throw new Error("Mongoose collection 'social-deliveries' is not available on payload.db.")
  }

  const claimed = await model.findOneAndUpdate(
    {
      status: 'pending',
      destination: { $in: supportedDestinations },
    },
    {
      $set: {
        status: 'processing',
        claimedAt: new Date(),
      },
      $inc: {
        attempts: 1,
      },
    },
    {
      sort: { createdAt: 1 }, // FIFO
      new: true,
      lean: true,
    },
  )

  if (!claimed) {
    return null
  }

  const rawDoc = claimed as any
  const normalizedId = rawDoc._id ? String(rawDoc._id) : String(rawDoc.id)
  let normalizedTeaching = rawDoc.teaching
  if (normalizedTeaching && typeof normalizedTeaching === 'object') {
    if (typeof normalizedTeaching.toHexString === 'function') {
      normalizedTeaching = normalizedTeaching.toHexString()
    } else if (normalizedTeaching._id) {
      normalizedTeaching = String(normalizedTeaching._id)
    } else if (typeof normalizedTeaching.id === 'string') {
      normalizedTeaching = normalizedTeaching.id
    } else if (typeof normalizedTeaching.toString === 'function') {
      normalizedTeaching = normalizedTeaching.toString()
    }
  }

  return {
    ...rawDoc,
    id: normalizedId,
    teaching: normalizedTeaching,
  } as unknown as SocialDelivery
}

/**
 * Synchronizes public links into Teachings.socialPosts for a confirmed sent delivery
 * without resending messages or creating duplicate entries.
 */
export async function synchronizeTeachingSocialPost(args: {
  payload: Payload
  teachingId: string | number
  destination: string
  language: 'am' | 'en'
  postId: string
  url?: string
}): Promise<void> {
  const { payload, teachingId, destination, language, postId, url } = args

  const teachingDoc = (await payload.findByID({
    collection: 'teachings',
    id: teachingId,
    draft: false,
    overrideAccess: true,
  })) as Teaching | null

  if (!teachingDoc) {
    throw new Error(`Teaching ${teachingId} not found for link synchronization.`)
  }

  const existingPosts = Array.isArray(teachingDoc.socialPosts) ? teachingDoc.socialPosts : []

  const matchIndex = existingPosts.findIndex(
    (item) => item.destination === destination && item.language === language,
  )

  const updatedEntry = {
    destination: destination as any,
    language,
    postId,
    url: url || undefined,
    publishedAt: new Date().toISOString(),
  }

  const nextSocialPosts = [...existingPosts]
  if (matchIndex >= 0) {
    nextSocialPosts[matchIndex] = {
      ...nextSocialPosts[matchIndex],
      ...updatedEntry,
    }
  } else {
    nextSocialPosts.push(updatedEntry)
  }

  await payload.update({
    collection: 'teachings',
    id: teachingId,
    overrideAccess: true,
    data: {
      socialPosts: nextSocialPosts,
    },
    context: {
      skipAnnouncementQueue: true,
    },
  })
}

/**
 * Processes a single claimed delivery record:
 * 1. Verifies supported destination (leaves unsupported providers untouched).
 * 2. Fetches published teaching in the delivery record's language.
 * 3. Validates published status and non-placeholder public URL.
 * 4. Calls sendTelegramAnnouncement.
 * 5. On success: records delivery status 'sent' BEFORE synchronizing public links.
 * 6. Handles failures safely, persisting sanitized errors.
 */
export async function processSingleDelivery(args: {
  payload: Payload
  delivery: SocialDelivery
  routeExistsOverride?: boolean
  siteUrlOverride?: string
}): Promise<DeliveryProcessResult> {
  const { payload, delivery, routeExistsOverride, siteUrlOverride } = args
  const deliveryId = String(delivery.id)
  const destination = delivery.destination

  // 1. Guard supported providers
  if (destination !== 'telegram-channel' && destination !== 'telegram-group') {
    return {
      deliveryId,
      destination,
      status: 'skipped',
      error: `Destination '${destination}' is not supported by Telegram runner.`,
    }
  }

  const teachingRef = delivery.teaching
  let teachingId: string | number | undefined
  if (typeof teachingRef === 'string' || typeof teachingRef === 'number') {
    teachingId = teachingRef
  } else if (teachingRef && typeof teachingRef === 'object') {
    if (typeof (teachingRef as any).toHexString === 'function') {
      teachingId = (teachingRef as any).toHexString()
    } else if ('_id' in teachingRef && (teachingRef as any)._id) {
      teachingId = String((teachingRef as any)._id)
    } else if ('id' in teachingRef && typeof (teachingRef as any).id === 'string') {
      teachingId = (teachingRef as any).id
    } else if (typeof (teachingRef as any).toString === 'function') {
      teachingId = (teachingRef as any).toString()
    }
  }

  if (!teachingId) {
    const error = 'Delivery record has no associated teaching ID.'
    await payload.update({
      collection: 'social-deliveries',
      id: deliveryId,
      overrideAccess: true,
      data: {
        status: 'failed',
        lastError: error,
      },
    })
    return { deliveryId, destination, status: 'failed', error }
  }

  // 2. Fetch the published teaching in the target language (draft: false)
  let teachingDoc: any = null
  try {
    teachingDoc = await payload.findByID({
      collection: 'teachings',
      id: teachingId,
      locale: delivery.language,
      draft: false,
      overrideAccess: true,
    })
  } catch {
    teachingDoc = null
  }

  if (!teachingDoc) {
    const error = 'Teaching record was deleted or not found.'
    await payload.update({
      collection: 'social-deliveries',
      id: deliveryId,
      overrideAccess: true,
      data: {
        status: 'failed',
        lastError: error,
      },
    })
    return { deliveryId, destination, status: 'failed', error }
  }

  if (teachingDoc._status !== 'published') {
    const error = `Teaching is in '${teachingDoc._status || 'draft'}' status, not published.`
    await payload.update({
      collection: 'social-deliveries',
      id: deliveryId,
      overrideAccess: true,
      data: {
        status: 'failed',
        lastError: error,
      },
    })
    return { deliveryId, destination, status: 'failed', error }
  }

  const title = typeof teachingDoc.title === 'string' ? teachingDoc.title.trim() : ''
  if (!title) {
    const error = `Teaching has no title in '${delivery.language}' language.`
    await payload.update({
      collection: 'social-deliveries',
      id: deliveryId,
      overrideAccess: true,
      data: {
        status: 'failed',
        lastError: error,
      },
    })
    return { deliveryId, destination, status: 'failed', error }
  }

  // 3. Establish public teaching URL without inventing nonexistent routes
  const urlResolution = resolvePublicTeachingURL({
    slug: teachingDoc.slug,
    siteUrlOverride,
    routeExistsOverride,
  })

  if (!urlResolution.ok) {
    const error = urlResolution.error
    await payload.update({
      collection: 'social-deliveries',
      id: deliveryId,
      overrideAccess: true,
      data: {
        status: 'failed',
        lastError: error,
      },
    })
    return { deliveryId, destination, status: 'failed', error }
  }

  const teachingURL = urlResolution.url

  // 4. Send announcement to Telegram
  const sendResult = await sendTelegramAnnouncement({
    destination,
    title,
    teachingURL,
  })

  // 5. Handle send outcome
  if (sendResult.status === 'sent') {
    // Record successful delivery FIRST
    await payload.update({
      collection: 'social-deliveries',
      id: deliveryId,
      overrideAccess: true,
      data: {
        status: 'sent',
        platformPostId: sendResult.postId,
        postURL: sendResult.postURL || null,
        sentAt: new Date().toISOString(),
        lastError: null,
      },
    })

    // Synchronize public links in Teachings.socialPosts
    let linkSyncError: string | undefined = undefined
    try {
      await synchronizeTeachingSocialPost({
        payload,
        teachingId,
        destination,
        language: delivery.language,
        postId: sendResult.postId,
        url: sendResult.postURL,
      })
    } catch (err: unknown) {
      linkSyncError = sanitizeTelegramError(err)
      console.error(
        `Delivery ${deliveryId} sent, but failed to sync Teachings.socialPosts: ${linkSyncError}`,
      )
    }

    return {
      deliveryId,
      destination,
      status: 'sent',
      postId: sendResult.postId,
      postURL: sendResult.postURL,
      linkSyncError,
    }
  }

  if (sendResult.status === 'failed') {
    await payload.update({
      collection: 'social-deliveries',
      id: deliveryId,
      overrideAccess: true,
      data: {
        status: 'failed',
        lastError: sendResult.error,
      },
    })
    return {
      deliveryId,
      destination,
      status: 'failed',
      error: sendResult.error,
    }
  }

  // sendResult.status === 'uncertain'
  // Uncertain outcomes are NEVER automatically reset to pending
  await payload.update({
    collection: 'social-deliveries',
    id: deliveryId,
    overrideAccess: true,
    data: {
      status: 'uncertain',
      lastError: sendResult.error,
    },
  })

  return {
    deliveryId,
    destination,
    status: 'uncertain',
    error: sendResult.error,
  }
}

/**
 * Runs a bounded execution of the Telegram delivery queue.
 * Claims pending records one by one up to batchSize or until time budget expires.
 */
export async function runTelegramDeliveryQueue(
  options: RunDeliveryQueueOptions,
): Promise<RunDeliveryQueueSummary> {
  const {
    payload,
    batchSize = DEFAULT_BATCH_SIZE,
    executionBudgetMs = DEFAULT_BUDGET_MS,
    routeExistsOverride,
    siteUrlOverride,
  } = options

  const effectiveBatch = Math.min(Math.max(1, batchSize), MAX_BATCH_SIZE)
  const startTime = Date.now()

  const summary: RunDeliveryQueueSummary = {
    processed: 0,
    sent: 0,
    failed: 0,
    uncertain: 0,
    skipped: 0,
    results: [],
  }

  while (summary.processed < effectiveBatch) {
    const elapsed = Date.now() - startTime
    if (elapsed >= executionBudgetMs - MIN_REMAINING_BUDGET_MS) {
      break
    }

    const delivery = await claimNextPendingDelivery(payload, [
      'telegram-channel',
      'telegram-group',
    ])

    if (!delivery) {
      break // No more pending Telegram deliveries to claim
    }

    summary.processed++

    const result = await processSingleDelivery({
      payload,
      delivery,
      routeExistsOverride,
      siteUrlOverride,
    })

    summary.results.push(result)

    if (result.status === 'sent') summary.sent++
    else if (result.status === 'failed') summary.failed++
    else if (result.status === 'uncertain') summary.uncertain++
    else if (result.status === 'skipped') summary.skipped++
  }

  return summary
}
