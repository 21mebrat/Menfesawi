import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'
import configPromise from '@/payload.config'
import {
  claimNextPendingDelivery,
  processSingleDelivery,
  runTelegramDeliveryQueue,
  resolvePublicTeachingURL,
} from '@/lib/server/social/runner'
import { POST as handleDeliverRoute } from '@/app/api/social/deliver/route'
import { createPayloadSessionForUser } from '@/lib/auth/session'

let payload: Payload
const testRunId = Date.now()

const adminEmail = `runner-admin-${testRunId}@menfesawi.test`
const memberEmail = `runner-member-${testRunId}@menfesawi.test`
const inactiveEmail = `runner-inactive-${testRunId}@menfesawi.test`
const commonPassword = 'RunnerPassword123!'

let adminUser: any
let memberUser: any
let inactiveUser: any
let adminToken: string
let memberToken: string
let inactiveToken: string

const testLexicalContent = {
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [
          {
            type: 'text',
            version: 1,
            text: 'Test teaching content paragraph',
          },
        ],
      },
    ],
    direction: 'ltr' as const,
    format: '' as const,
    indent: 0,
    version: 1,
  },
}

describe('Telegram Delivery Runner & Endpoint Protection', () => {
  const originalEnv = { ...process.env }

  beforeAll(async () => {
    const config = await configPromise
    payload = await getPayload({ config })

    // Clean up any leftover deliveries from prior aborted test runs
    try {
      const deliveryModel = payload.db.collections?.['social-deliveries']
      if (deliveryModel) {
        await deliveryModel.deleteMany({})
      }
    } catch {
      // ignore
    }

    // Create Admin User
    adminUser = await payload.create({
      collection: 'users',
      data: {
        email: adminEmail,
        name: 'Delivery Admin',
        role: 'admin',
        isActive: true,
        password: commonPassword,
      },
      overrideAccess: true,
    })
    const adminSession = await createPayloadSessionForUser({ payload, user: adminUser })
    adminToken = adminSession.token

    // Create Member User
    memberUser = await payload.create({
      collection: 'users',
      data: {
        email: memberEmail,
        name: 'Regular Member',
        role: 'member',
        isActive: true,
        password: commonPassword,
      },
      overrideAccess: true,
    })
    const memberSession = await createPayloadSessionForUser({ payload, user: memberUser })
    memberToken = memberSession.token

    // Create Inactive User
    inactiveUser = await payload.create({
      collection: 'users',
      data: {
        email: inactiveEmail,
        name: 'Inactive Admin',
        role: 'admin',
        isActive: false,
        password: commonPassword,
      },
      overrideAccess: true,
    })
    const inactiveSession = await createPayloadSessionForUser({ payload, user: inactiveUser })
    inactiveToken = inactiveSession.token
  })

  afterAll(async () => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()

    // Clean up created test users and deliveries
    try {
      const deliveryModel = payload.db.collections?.['social-deliveries']
      if (deliveryModel) {
        await deliveryModel.deleteMany({})
      }
      await payload.delete({
        collection: 'users',
        where: {
          email: {
            in: [adminEmail, memberEmail, inactiveEmail],
          },
        },
      })
    } catch {
      // ignore cleanup errors
    }
  })

  // ---------------------------------------------------------------------------
  // 1. Protected Execution: POST /api/social/deliver
  // ---------------------------------------------------------------------------
  describe('Endpoint Protection (POST /api/social/deliver)', () => {
    it('rejects cross-site requests with 403 Forbidden', async () => {
      const req = new Request('http://localhost:3000/api/social/deliver', {
        method: 'POST',
        headers: {
          'sec-fetch-site': 'cross-site',
          cookie: `payload-token=${adminToken}`,
        },
      })

      const res = await handleDeliverRoute(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('Cross-site')
    })

    it('rejects cross-origin requests with mismatching origin host', async () => {
      const req = new Request('http://localhost:3000/api/social/deliver', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'https://malicious-external-site.com',
          cookie: `payload-token=${adminToken}`,
        },
      })

      const res = await handleDeliverRoute(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('Cross-site')
    })

    it('rejects unauthenticated calls with 401 Unauthorized', async () => {
      const req = new Request('http://localhost:3000/api/social/deliver', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
        },
      })

      const res = await handleDeliverRoute(req)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toContain('Authentication required')
    })

    it('rejects inactive users with 403 Forbidden even with valid token', async () => {
      const req = new Request('http://localhost:3000/api/social/deliver', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          cookie: `payload-token=${inactiveToken}`,
        },
      })

      const res = await handleDeliverRoute(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('inactive')
    })

    it('rejects non-admin members with 403 Forbidden', async () => {
      const req = new Request('http://localhost:3000/api/social/deliver', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          cookie: `payload-token=${memberToken}`,
        },
      })

      const res = await handleDeliverRoute(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('Administrator privileges required')
    })

    it('allows active administrators with valid session and origin', async () => {
      const req = new Request('http://localhost:3000/api/social/deliver', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          cookie: `payload-token=${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batchSize: 1 }),
      })

      const res = await handleDeliverRoute(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(typeof data.processed).toBe('number')
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Atomic Claim Concurrency in MongoDB
  // ---------------------------------------------------------------------------
  describe('Atomic Claim Concurrency', () => {
    it('guarantees that concurrent runners cannot claim the same record', async () => {
      // Create 2 test pending delivery records
      const deliveryKey1 = `test:concurrency:1:${Date.now()}`
      const deliveryKey2 = `test:concurrency:2:${Date.now()}`

      // Create a temporary teaching
      const teaching = await payload.create({
        collection: 'teachings',
        data: {
          title: 'Concurrency Test Teaching',
          slug: `concurrency-test-${Date.now()}`,
          _status: 'published',
          content: testLexicalContent,
        },
        overrideAccess: true,
      })

      const d1 = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: deliveryKey1,
          teaching: teaching.id,
          destination: 'telegram-channel',
          language: 'am',
          status: 'pending',
          attempts: 0,
        },
        overrideAccess: true,
      })

      const d2 = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: deliveryKey2,
          teaching: teaching.id,
          destination: 'telegram-group',
          language: 'am',
          status: 'pending',
          attempts: 0,
        },
        overrideAccess: true,
      })

      // Simulate 5 simultaneous workers racing to claim pending records
      const claimPromises = Array.from({ length: 5 }, () =>
        claimNextPendingDelivery(payload, ['telegram-channel', 'telegram-group']),
      )

      const claimedResults = await Promise.all(claimPromises)

      // Filter non-null claims
      const successfulClaims = claimedResults.filter((doc): doc is NonNullable<typeof doc> => doc !== null)

      // Exactly 2 records could be claimed
      expect(successfulClaims.length).toBe(2)

      const claimedIds = successfulClaims.map((doc) => String(doc.id))
      // IDs must be distinct (no two runners claimed the same record)
      expect(new Set(claimedIds).size).toBe(2)
      expect(claimedIds).toContain(String(d1.id))
      expect(claimedIds).toContain(String(d2.id))

      // Both records must now be 'processing' with claimedAt set and attempts incremented
      for (const id of claimedIds) {
        const doc = await payload.findByID({
          collection: 'social-deliveries',
          id,
          overrideAccess: true,
        })
        expect(doc.status).toBe('processing')
        expect(doc.attempts).toBe(1)
        expect(doc.claimedAt).toBeDefined()
      }

      // Any subsequent claim finds no more pending records
      const nextClaim = await claimNextPendingDelivery(payload, ['telegram-channel', 'telegram-group'])
      expect(nextClaim).toBeNull()

      // Cleanup
      await payload.delete({ collection: 'social-deliveries', id: d1.id, overrideAccess: true })
      await payload.delete({ collection: 'social-deliveries', id: d2.id, overrideAccess: true })
      await payload.delete({ collection: 'teachings', id: teaching.id, overrideAccess: true })
    })
  })

  // ---------------------------------------------------------------------------
  // 3. Unsupported Destinations Untouched
  // ---------------------------------------------------------------------------
  describe('Unsupported Destinations', () => {
    it('leaves facebook and instagram delivery records completely untouched', async () => {
      const teaching = await payload.create({
        collection: 'teachings',
        data: {
          title: 'Facebook Untouched Teaching',
          slug: `fb-untouched-${Date.now()}`,
          _status: 'published',
          content: testLexicalContent,
        },
        overrideAccess: true,
      })

      const fbDelivery = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `fb:untouched:${Date.now()}`,
          teaching: teaching.id,
          destination: 'facebook',
          language: 'am',
          status: 'pending',
          attempts: 0,
        },
        overrideAccess: true,
      })

      const instaDelivery = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `insta:untouched:${Date.now()}`,
          teaching: teaching.id,
          destination: 'instagram',
          language: 'am',
          status: 'pending',
          attempts: 0,
        },
        overrideAccess: true,
      })

      // Run telegram claim
      const claimed = await claimNextPendingDelivery(payload, ['telegram-channel', 'telegram-group'])
      expect(claimed).toBeNull()

      // Verify records are still pending and untouched
      const checkedFb = await payload.findByID({
        collection: 'social-deliveries',
        id: fbDelivery.id,
        overrideAccess: true,
      })
      expect(checkedFb.status).toBe('pending')
      expect(checkedFb.attempts).toBe(0)

      const checkedInsta = await payload.findByID({
        collection: 'social-deliveries',
        id: instaDelivery.id,
        overrideAccess: true,
      })
      expect(checkedInsta.status).toBe('pending')
      expect(checkedInsta.attempts).toBe(0)

      // Test processSingleDelivery guard if an unsupported record were passed directly
      const skipResult = await processSingleDelivery({
        payload,
        delivery: checkedFb,
      })
      expect(skipResult.status).toBe('skipped')

      // Cleanup
      await payload.delete({ collection: 'social-deliveries', id: fbDelivery.id, overrideAccess: true })
      await payload.delete({ collection: 'social-deliveries', id: instaDelivery.id, overrideAccess: true })
      await payload.delete({ collection: 'teachings', id: teaching.id, overrideAccess: true })
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Draft & Deleted Teachings Validation
  // ---------------------------------------------------------------------------
  describe('Draft & Deleted Teachings Validation', () => {
    it('marks delivery as failed when teaching record is deleted or not found', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      const delivery = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `deleted:teaching:${Date.now()}`,
          teaching: '600000000000000000000001', // Nonexistent ID
          destination: 'telegram-channel',
          language: 'am',
          status: 'processing',
          attempts: 1,
        },
        overrideAccess: true,
      })

      const result = await processSingleDelivery({
        payload,
        delivery,
        routeExistsOverride: true,
        siteUrlOverride: 'https://example-test.org',
      })

      expect(result.status).toBe('failed')
      expect(result.error).toContain('deleted or not found')
      expect(fetchSpy).not.toHaveBeenCalled()

      const updated = await payload.findByID({
        collection: 'social-deliveries',
        id: delivery.id,
        overrideAccess: true,
      })
      expect(updated.status).toBe('failed')
      expect(updated.lastError).toContain('deleted or not found')

      await payload.delete({ collection: 'social-deliveries', id: delivery.id, overrideAccess: true })
    })

    it('marks delivery as failed when teaching is in draft status', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      const draftTeaching = await payload.create({
        collection: 'teachings',
        data: {
          title: 'Draft Teaching',
          slug: `draft-teaching-${Date.now()}`,
          _status: 'draft',
          content: testLexicalContent,
        },
        draft: true,
        overrideAccess: true,
      })

      const delivery = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `draft:teaching:${Date.now()}`,
          teaching: draftTeaching.id,
          destination: 'telegram-channel',
          language: 'en',
          status: 'processing',
          attempts: 1,
        },
        overrideAccess: true,
      })

      const result = await processSingleDelivery({
        payload,
        delivery,
        routeExistsOverride: true,
        siteUrlOverride: 'https://example-test.org',
      })

      expect(result.status).toBe('failed')
      expect(result.error).toContain('not published')
      expect(fetchSpy).not.toHaveBeenCalled()

      const updated = await payload.findByID({
        collection: 'social-deliveries',
        id: delivery.id,
        overrideAccess: true,
      })
      expect(updated.status).toBe('failed')
      expect(updated.lastError).toContain('not published')

      await payload.delete({ collection: 'social-deliveries', id: delivery.id, overrideAccess: true })
      await payload.delete({ collection: 'teachings', id: draftTeaching.id, overrideAccess: true })
    })
  })

  // ---------------------------------------------------------------------------
  // 5. Public Teaching URL Establishment & Blocker Reporting
  // ---------------------------------------------------------------------------
  describe('Public Teaching URL Resolution', () => {
    it('fails when SITE_URL is missing', () => {
      const res = resolvePublicTeachingURL({
        slug: 'fasting',
        siteUrlOverride: '',
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toContain('SITE_URL is not configured')
    })

    it('fails when SITE_URL is HTTP instead of HTTPS', () => {
      const res = resolvePublicTeachingURL({
        slug: 'fasting',
        siteUrlOverride: 'http://insecure.example.com',
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toContain('HTTPS')
    })

    it('fails when SITE_URL is a placeholder domain', () => {
      const res = resolvePublicTeachingURL({
        slug: 'fasting',
        siteUrlOverride: 'https://your-site.vercel.app',
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toContain('placeholder domain')
    })

    it('fails when public frontend route is not implemented', () => {
      const res = resolvePublicTeachingURL({
        slug: 'fasting',
        siteUrlOverride: 'https://production.menfesawi.org',
        routeExistsOverride: false, // route does not exist in src/app/(frontend)/
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toContain('not implemented')
    })

    it('successfully establishes public URL when valid HTTPS URL and route are confirmed', () => {
      const res = resolvePublicTeachingURL({
        slug: 'prayer-and-fasting',
        siteUrlOverride: 'https://menfesawi.org',
        routeExistsOverride: true,
      })
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.url).toBe('https://menfesawi.org/teachings/prayer-and-fasting')
    })
  })

  // ---------------------------------------------------------------------------
  // 6. Language Selection & Published Content
  // ---------------------------------------------------------------------------
  describe('Language Selection & Published Content', () => {
    it('delivers the announcement in the delivery record language (Amharic)', async () => {
      const teaching = await payload.create({
        collection: 'teachings',
        data: {
          title: 'አስኳላ እና ሃይማኖት',
          slug: `bilingual-teaching-${Date.now()}`,
          _status: 'published',
          content: testLexicalContent,
        },
        locale: 'am',
        overrideAccess: true,
      })

      // Add English title
      await payload.update({
        collection: 'teachings',
        id: teaching.id,
        data: {
          title: 'School and Faith',
          content: testLexicalContent,
        },
        locale: 'en',
        overrideAccess: true,
      })

      const delivery = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `bilingual:delivery:${Date.now()}`,
          teaching: teaching.id,
          destination: 'telegram-channel',
          language: 'am',
          status: 'processing',
          attempts: 1,
        },
        overrideAccess: true,
      })

      process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token'
      process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '@test_channel'

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: 1234,
            chat: { username: 'test_channel' },
          },
        }),
      } as unknown as Response)

      const result = await processSingleDelivery({
        payload,
        delivery,
        siteUrlOverride: 'https://menfesawi.org',
        routeExistsOverride: true,
      })

      expect(result.status).toBe('sent')
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
      // Must contain Amharic title
      expect(requestBody.text).toContain('አስኳላ እና ሃይማኖት')
      expect(requestBody.text).not.toContain('School and Faith')

      await payload.delete({ collection: 'social-deliveries', id: delivery.id, overrideAccess: true })
      await payload.delete({ collection: 'teachings', id: teaching.id, overrideAccess: true })
    })
  })

  // ---------------------------------------------------------------------------
  // 7. Successful Delivery & Teachings.socialPosts Synchronization
  // ---------------------------------------------------------------------------
  describe('Successful Delivery & Link Synchronization', () => {
    it('persists sent delivery and synchronizes Teachings.socialPosts without duplicates', async () => {
      const teaching = await payload.create({
        collection: 'teachings',
        data: {
          title: 'St. Mary Praise',
          slug: `st-mary-praise-${Date.now()}`,
          _status: 'published',
          content: testLexicalContent,
          socialPosts: [
            // Existing post on Facebook should be preserved
            {
              destination: 'facebook',
              language: 'am',
              postId: 'fb-post-123',
              url: 'https://facebook.com/posts/123',
              publishedAt: new Date().toISOString(),
            },
          ],
        },
        overrideAccess: true,
      })

      const delivery = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `mary:sync:${Date.now()}`,
          teaching: teaching.id,
          destination: 'telegram-channel',
          language: 'am',
          status: 'processing',
          attempts: 1,
        },
        overrideAccess: true,
      })

      process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token'
      process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '@test_channel'

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: 8888,
            chat: { username: 'test_channel' },
          },
        }),
      } as unknown as Response)

      const result = await processSingleDelivery({
        payload,
        delivery,
        siteUrlOverride: 'https://menfesawi.org',
        routeExistsOverride: true,
      })

      expect(result.status).toBe('sent')
      expect(result.postId).toBe('8888')
      expect(result.postURL).toBe('https://t.me/test_channel/8888')

      // Verify SocialDelivery record is updated
      const updatedDelivery = await payload.findByID({
        collection: 'social-deliveries',
        id: delivery.id,
        overrideAccess: true,
      })
      expect(updatedDelivery.status).toBe('sent')
      expect(updatedDelivery.platformPostId).toBe('8888')
      expect(updatedDelivery.postURL).toBe('https://t.me/test_channel/8888')
      expect(updatedDelivery.sentAt).toBeDefined()

      // Verify Teachings.socialPosts synchronized
      const updatedTeaching = await payload.findByID({
        collection: 'teachings',
        id: teaching.id,
        overrideAccess: true,
      })
      const posts = updatedTeaching.socialPosts || []

      // Preserved existing Facebook post + added new Telegram post
      expect(posts.length).toBe(2)
      const fbPost = posts.find((p) => p.destination === 'facebook')
      expect(fbPost).toBeDefined()
      expect(fbPost?.postId).toBe('fb-post-123')

      const telegramPost = posts.find((p) => p.destination === 'telegram-channel')
      expect(telegramPost).toBeDefined()
      expect(telegramPost?.postId).toBe('8888')
      expect(telegramPost?.url).toBe('https://t.me/test_channel/8888')

      // Verify no duplicate deliveries were queued by the hook during update
      const allDeliveries = await payload.find({
        collection: 'social-deliveries',
        where: {
          teaching: { equals: teaching.id },
        },
        overrideAccess: true,
      })
      expect(allDeliveries.docs.length).toBe(1)

      await payload.delete({ collection: 'social-deliveries', id: delivery.id, overrideAccess: true })
      await payload.delete({ collection: 'teachings', id: teaching.id, overrideAccess: true })
    })

    it('persists status sent even if Teachings.socialPosts update fails', async () => {
      const teaching = await payload.create({
        collection: 'teachings',
        data: {
          title: 'Sync Error Teaching',
          slug: `sync-err-${Date.now()}`,
          _status: 'published',
          content: testLexicalContent,
        },
        overrideAccess: true,
      })

      const delivery = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `sync:err:${Date.now()}`,
          teaching: teaching.id,
          destination: 'telegram-channel',
          language: 'am',
          status: 'processing',
          attempts: 1,
        },
        overrideAccess: true,
      })

      process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token'
      process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '@test_channel'

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: 9999,
            chat: { username: 'test_channel' },
          },
        }),
      } as unknown as Response)

      // Spy on payload.update and simulate error ONLY when updating 'teachings' collection
      const originalUpdate = payload.update.bind(payload)
      const updateSpy = vi.spyOn(payload, 'update').mockImplementation((async (args: any): Promise<any> => {
        if (args.collection === 'teachings') {
          throw new Error('Database write collision on teaching')
        }
        return originalUpdate(args)
      }) as any)

      const result = await processSingleDelivery({
        payload,
        delivery,
        siteUrlOverride: 'https://menfesawi.org',
        routeExistsOverride: true,
      })

      // Delivery must STILL be recorded as 'sent'
      expect(result.status).toBe('sent')
      expect(result.linkSyncError).toContain('Database write collision')

      const updatedDelivery = await payload.findByID({
        collection: 'social-deliveries',
        id: delivery.id,
        overrideAccess: true,
      })
      expect(updatedDelivery.status).toBe('sent')
      expect(updatedDelivery.platformPostId).toBe('9999')

      updateSpy.mockRestore()

      await payload.delete({ collection: 'social-deliveries', id: delivery.id, overrideAccess: true })
      await payload.delete({ collection: 'teachings', id: teaching.id, overrideAccess: true })
    })
  })

  // ---------------------------------------------------------------------------
  // 8. Failure & Uncertain Outcome Handling
  // ---------------------------------------------------------------------------
  describe('Failure & Uncertain Outcomes', () => {
    it('records Telegram rejection as failed with sanitized error', async () => {
      const teaching = await payload.create({
        collection: 'teachings',
        data: {
          title: 'Rejection Teaching',
          slug: `rejection-${Date.now()}`,
          _status: 'published',
          content: testLexicalContent,
        },
        overrideAccess: true,
      })

      const delivery = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `rejection:test:${Date.now()}`,
          teaching: teaching.id,
          destination: 'telegram-channel',
          language: 'am',
          status: 'processing',
          attempts: 1,
        },
        overrideAccess: true,
      })

      process.env.TELEGRAM_BOT_TOKEN = 'secret-token-123'
      process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '@test_channel'

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          ok: false,
          error_code: 403,
          description: 'Forbidden: bot was kicked from channel using secret-token-123',
        }),
      } as unknown as Response)

      const result = await processSingleDelivery({
        payload,
        delivery,
        siteUrlOverride: 'https://menfesawi.org',
        routeExistsOverride: true,
      })

      expect(result.status).toBe('failed')
      expect(result.error).not.toContain('secret-token-123')
      expect(result.error).toContain('[REDACTED_BOT_TOKEN]')

      const updated = await payload.findByID({
        collection: 'social-deliveries',
        id: delivery.id,
        overrideAccess: true,
      })
      expect(updated.status).toBe('failed')
      expect(updated.lastError).toContain('[REDACTED_BOT_TOKEN]')

      await payload.delete({ collection: 'social-deliveries', id: delivery.id, overrideAccess: true })
      await payload.delete({ collection: 'teachings', id: teaching.id, overrideAccess: true })
    })

    it('records network timeout as uncertain and never automatically resets to pending', async () => {
      const teaching = await payload.create({
        collection: 'teachings',
        data: {
          title: 'Uncertain Teaching',
          slug: `uncertain-${Date.now()}`,
          _status: 'published',
          content: testLexicalContent,
        },
        overrideAccess: true,
      })

      const delivery = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `uncertain:test:${Date.now()}`,
          teaching: teaching.id,
          destination: 'telegram-channel',
          language: 'am',
          status: 'processing',
          attempts: 1,
        },
        overrideAccess: true,
      })

      process.env.TELEGRAM_BOT_TOKEN = 'token'
      process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '@channel'

      const timeoutError = new Error('The operation was aborted due to timeout')
      timeoutError.name = 'TimeoutError'
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(timeoutError)

      const result = await processSingleDelivery({
        payload,
        delivery,
        siteUrlOverride: 'https://menfesawi.org',
        routeExistsOverride: true,
      })

      expect(result.status).toBe('uncertain')

      const updated = await payload.findByID({
        collection: 'social-deliveries',
        id: delivery.id,
        overrideAccess: true,
      })
      expect(updated.status).toBe('uncertain')

      // Try running the queue again: uncertain records must NOT be claimed
      const nextClaim = await claimNextPendingDelivery(payload, ['telegram-channel', 'telegram-group'])
      expect(nextClaim).toBeNull()

      await payload.delete({ collection: 'social-deliveries', id: delivery.id, overrideAccess: true })
      await payload.delete({ collection: 'teachings', id: teaching.id, overrideAccess: true })
    })
  })

  // ---------------------------------------------------------------------------
  // 9. Bounded Batch Limits & Execution Budget
  // ---------------------------------------------------------------------------
  describe('Batch Limits & Execution Budget', () => {
    it('strictly respects the configured batchSize limit', async () => {
      // Clean up any lingering delivery records before batch test
      const deliveryModel = payload.db.collections?.['social-deliveries']
      if (deliveryModel) {
        await deliveryModel.deleteMany({})
      }

      const teaching = await payload.create({
        collection: 'teachings',
        data: {
          title: 'የቡድን ትምህርት',
          slug: `batch-teaching-${Date.now()}`,
          _status: 'published',
          content: testLexicalContent,
        },
        locale: 'am',
        overrideAccess: true,
      })

      await payload.update({
        collection: 'teachings',
        id: teaching.id,
        data: {
          title: 'Batch Teaching',
          content: testLexicalContent,
        },
        locale: 'en',
        overrideAccess: true,
      })

      const d1 = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `batch:1:${Date.now()}`,
          teaching: teaching.id,
          destination: 'telegram-channel',
          language: 'am',
          status: 'pending',
          attempts: 0,
        },
        overrideAccess: true,
      })

      const d2 = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `batch:2:${Date.now()}`,
          teaching: teaching.id,
          destination: 'telegram-group',
          language: 'am',
          status: 'pending',
          attempts: 0,
        },
        overrideAccess: true,
      })

      const d3 = await payload.create({
        collection: 'social-deliveries',
        data: {
          deliveryKey: `batch:3:${Date.now()}`,
          teaching: teaching.id,
          destination: 'telegram-group',
          language: 'en',
          status: 'pending',
          attempts: 0,
        },
        overrideAccess: true,
      })

      process.env.TELEGRAM_BOT_TOKEN = 'token'
      process.env.TELEGRAM_PUBLIC_CHANNEL_ID = '@chan'
      process.env.TELEGRAM_PUBLIC_GROUP_ID = '@group'

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: 111,
            chat: { username: 'chan' },
          },
        }),
      } as unknown as Response)

      // Run with batchSize = 2 on 3 pending items
      const summary = await runTelegramDeliveryQueue({
        payload,
        batchSize: 2,
        routeExistsOverride: true,
        siteUrlOverride: 'https://menfesawi.org',
      })

      expect(summary.processed).toBe(2)
      expect(summary.sent).toBe(2)

      // 1 item must still remain pending in the database
      const remainingDoc = await payload.findByID({
        collection: 'social-deliveries',
        id: d3.id,
        overrideAccess: true,
      })
      expect(remainingDoc.status).toBe('pending')

      await payload.delete({ collection: 'social-deliveries', id: d1.id, overrideAccess: true })
      await payload.delete({ collection: 'social-deliveries', id: d2.id, overrideAccess: true })
      await payload.delete({ collection: 'social-deliveries', id: d3.id, overrideAccess: true })
      await payload.delete({ collection: 'teachings', id: teaching.id, overrideAccess: true })
    })
  })
})
