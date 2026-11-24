import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  sendTelegramAnnouncement,
  sanitizeTelegramError,
  isValidTelegramUsername,
  isJsonObject,
  type TelegramDestination,
} from '../../src/lib/server/social/telegram'
import {
  parseAndValidateCliArgs,
  validateSiteUrl,
} from '../../scripts/test-telegram'

describe('Telegram Announcement Sender', () => {
  const originalEnv = { ...process.env }

  const MOCK_BOT_TOKEN = '123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ'
  const MOCK_CHANNEL_ID = '@menfesawi_official'
  const MOCK_GROUP_ID = '-1009876543210'

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = {
      ...originalEnv,
      TELEGRAM_BOT_TOKEN: MOCK_BOT_TOKEN,
      TELEGRAM_PUBLIC_CHANNEL_ID: MOCK_CHANNEL_ID,
      TELEGRAM_PUBLIC_GROUP_ID: MOCK_GROUP_ID,
      SITE_URL: 'https://menfesawi.org',
    }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // 1. Environment & Credential Configuration Checks
  // ---------------------------------------------------------------------------
  describe('Environment Configuration', () => {
    it('fails when TELEGRAM_BOT_TOKEN is missing', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'New Teaching: Fasting and Prayer',
        teachingURL: 'https://menfesawi.org/teachings/fasting',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).toContain('TELEGRAM_BOT_TOKEN')
      }
    })

    it('fails when TELEGRAM_PUBLIC_CHANNEL_ID is missing for channel destination', async () => {
      delete process.env.TELEGRAM_PUBLIC_CHANNEL_ID

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'New Teaching: Fasting and Prayer',
        teachingURL: 'https://menfesawi.org/teachings/fasting',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).toContain('TELEGRAM_PUBLIC_CHANNEL_ID')
      }
    })

    it('fails when TELEGRAM_PUBLIC_GROUP_ID is missing for group destination', async () => {
      delete process.env.TELEGRAM_PUBLIC_GROUP_ID

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-group',
        title: 'New Teaching: Fasting and Prayer',
        teachingURL: 'https://menfesawi.org/teachings/fasting',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).toContain('TELEGRAM_PUBLIC_GROUP_ID')
      }
    })

    it('fails when an unsupported destination is provided', async () => {
      const result = await sendTelegramAnnouncement({
        destination: 'facebook' as unknown as TelegramDestination,
        title: 'New Teaching',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).toContain('Unsupported Telegram destination')
      }
    })

    it('never uses TELEGRAM_STORAGE_CHAT_ID for announcements', async () => {
      process.env.TELEGRAM_STORAGE_CHAT_ID = '-1009999999999'
      delete process.env.TELEGRAM_PUBLIC_CHANNEL_ID

      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'New Teaching',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('failed')
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Input Validation Checks
  // ---------------------------------------------------------------------------
  describe('Input Validation', () => {
    it('fails when title is empty or only whitespace', async () => {
      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: '   ',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).toContain('title')
      }
    })

    it('fails when teachingURL is invalid', async () => {
      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'not-a-valid-url',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).toContain('valid HTTPS')
      }
    })

    it('fails when teachingURL is HTTP instead of HTTPS', async () => {
      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'http://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).toContain('HTTPS')
      }
    })

    it('fails when teachingURL contains embedded credentials', async () => {
      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://admin:secret123@menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).toContain('embedded credentials')
      }
    })

    it('fails when formatted message exceeds conservative length limit', async () => {
      const hugeTitle = 'A'.repeat(4005)
      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: hugeTitle,
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).toContain('exceeds maximum limit')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 3. Successful Delivery & Payload Construction
  // ---------------------------------------------------------------------------
  describe('Successful Delivery', () => {
    it('sends plain text without parse_mode and formats public postURL for channel with username', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: 4567,
            chat: {
              id: -100123456789,
              title: 'Menfesawi Official',
              username: 'menfesawi_official',
              type: 'channel',
            },
            date: 1700000000,
            text: 'Fasting in the Orthodox Church\n\nhttps://menfesawi.org/teachings/fasting',
          },
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Fasting in the Orthodox Church',
        teachingURL: 'https://menfesawi.org/teachings/fasting',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [calledUrl, options] = fetchSpy.mock.calls[0]
      expect(calledUrl).toBe(`https://api.telegram.org/bot${MOCK_BOT_TOKEN}/sendMessage`)
      expect(options?.method).toBe('POST')

      const body = JSON.parse(options?.body as string)
      expect(body.chat_id).toBe(MOCK_CHANNEL_ID)
      expect(body.text).toBe('Fasting in the Orthodox Church\n\nhttps://menfesawi.org/teachings/fasting')
      expect(body.disable_web_page_preview).toBe(false)
      expect(body.parse_mode).toBeUndefined()

      expect(result.status).toBe('sent')
      if (result.status === 'sent') {
        expect(result.postId).toBe('4567')
        expect(result.postURL).toBe('https://t.me/menfesawi_official/4567')
      }
    })

    it('sends successfully to a group without username and leaves postURL undefined', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: 8899,
            chat: {
              id: -1009876543210,
              title: 'Menfesawi Discussion Group',
              type: 'supergroup',
            },
            date: 1700000000,
            text: 'Daily Prayer\n\nhttps://menfesawi.org/teachings/prayer',
          },
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-group',
        title: 'Daily Prayer',
        teachingURL: 'https://menfesawi.org/teachings/prayer',
      })

      expect(result.status).toBe('sent')
      if (result.status === 'sent') {
        expect(result.postId).toBe('8899')
        expect(result.postURL).toBeUndefined()
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Success Response Message ID & Username Validation
  // ---------------------------------------------------------------------------
  describe('Success Response Message ID Validation', () => {
    it.each([
      ['zero message_id', 0],
      ['negative message_id', -5],
      ['fractional message_id', 12.34],
      ['string message_id', '12345'],
      ['unsafe integer message_id', Number.MAX_SAFE_INTEGER + 100],
      ['null message_id', null],
      ['undefined message_id', undefined],
    ])('classifies %s as uncertain', async (_, invalidId) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: invalidId,
            chat: { username: 'valid_channel' },
          },
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('uncertain')
      if (result.status === 'uncertain') {
        expect(result.error).toContain('missing valid message_id')
      }
    })

    it('classifies result as array as uncertain', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: [{ message_id: 123 }],
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('uncertain')
    })

    it('classifies result as null as uncertain', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: null,
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('uncertain')
    })
  })

  describe('Telegram Username Validation', () => {
    it.each([
      ['contains space', 'my channel'],
      ['contains hyphen', 'my-channel'],
      ['contains at symbol', '@channel'],
      ['contains exclamation mark', 'channel!'],
      ['contains dot', 'channel.link'],
      ['contains non-ASCII Amharic', 'የቴሌግራም'],
      ['too short (< 5 chars)', 'abc'],
      ['too long (> 32 chars)', 'a'.repeat(33)],
      ['empty string', ''],
      ['whitespace string', '   '],
      ['null', null],
      ['undefined', undefined],
      ['number', 12345],
    ])('rejects invalid username (%s) and leaves postURL undefined', async (_, invalidUsername) => {
      expect(isValidTelegramUsername(invalidUsername)).toBe(false)

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: 1001,
            chat: { username: invalidUsername },
          },
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('sent')
      if (result.status === 'sent') {
        expect(result.postId).toBe('1001')
        expect(result.postURL).toBeUndefined()
      }
    })

    it.each([
      ['standard lowercase', 'menfesawi_official'],
      ['mixed case and numbers', 'Menfesawi2026_News'],
      ['minimum length 5 chars', 'group'],
      ['maximum length 32 chars', 'a'.repeat(32)],
    ])('accepts valid username (%s) and constructs postURL', async (_, validUsername) => {
      expect(isValidTelegramUsername(validUsername)).toBe(true)

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: 5005,
            chat: { username: validUsername },
          },
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('sent')
      if (result.status === 'sent') {
        expect(result.postURL).toBe(`https://t.me/${validUsername}/5005`)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 5. Explicit API Rejections (classified as 'failed')
  // ---------------------------------------------------------------------------
  describe('Explicit API Rejections', () => {
    it('classifies HTTP 400 Bad Request as failed with sanitized description', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          ok: false,
          error_code: 400,
          description: 'Bad Request: chat not found',
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).toContain('chat not found')
      }
    })

    it('classifies HTTP 403 Forbidden as failed', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          ok: false,
          error_code: 403,
          description: 'Forbidden: bot was kicked from the channel chat',
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).toContain('bot was kicked')
      }
    })

    it('classifies HTTP 429 Rate Limit as failed with retryAfterSeconds', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          ok: false,
          error_code: 429,
          description: 'Too Many Requests: retry after 42',
          parameters: {
            retry_after: 42,
          },
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.retryAfterSeconds).toBe(42)
        expect(result.error).toContain('Too Many Requests')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 6. Uncertain Outcomes (timeouts, network errors, malformed responses)
  // ---------------------------------------------------------------------------
  describe('Uncertain Outcomes', () => {
    it('classifies network abort or timeout as uncertain', async () => {
      const abortError = new Error('The operation was aborted due to timeout')
      abortError.name = 'TimeoutError'
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('uncertain')
      if (result.status === 'uncertain') {
        expect(result.error).toContain('aborted')
      }
    })

    it('classifies network connection failure as uncertain', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('fetch failed (ECONNRESET)'))

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('uncertain')
      if (result.status === 'uncertain') {
        expect(result.error).toContain('ECONNRESET')
      }
    })

    it('classifies HTTP 200 with malformed non-JSON body as uncertain', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0')
        },
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('uncertain')
      if (result.status === 'uncertain') {
        expect(result.error).toContain('non-JSON')
      }
    })

    it('classifies HTTP 502 Bad Gateway as uncertain', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({
          ok: false,
          error_code: 502,
          description: 'Bad Gateway from upstream proxy',
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('uncertain')
      if (result.status === 'uncertain') {
        expect(result.error).toContain('Bad Gateway')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 7. Exactly One Fetch Call Verification (No Automatic Retries)
  // ---------------------------------------------------------------------------
  describe('Single Fetch Call Verification', () => {
    it('executes exactly one fetch call on successful send', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { message_id: 1, chat: {} },
        }),
      } as unknown as Response)

      await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('executes exactly one fetch call on HTTP 400 rejection', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, error_code: 400, description: 'Bad Request' }),
      } as unknown as Response)

      await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('executes exactly one fetch call on HTTP 429 rate limit', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ ok: false, error_code: 429, description: 'Rate limit' }),
      } as unknown as Response)

      await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('executes exactly one fetch call on network failure', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

      await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('executes exactly one fetch call on malformed non-JSON response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Malformed')
        },
      } as unknown as Response)

      await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  // ---------------------------------------------------------------------------
  // 8. Error Sanitizer Safety & Secret Scrubbing
  // ---------------------------------------------------------------------------
  describe('Error Sanitizer Safety', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['function', () => {}],
      ['symbol with description', Symbol('custom_error')],
      ['symbol without description', Symbol()],
      ['BigInt primitive', BigInt(9007199254740991)],
      ['object containing BigInt', { num: BigInt(12345) }],
      ['empty Error instance', new Error('')],
      ['whitespace string', '    '],
      ['empty string', ''],
    ])('always returns a nonempty string for %s without throwing', (_, input) => {
      const result = sanitizeTelegramError(input)
      expect(typeof result).toBe('string')
      expect(result.trim().length).toBeGreaterThan(0)
    })

    it('handles circular object structures safely without throwing', () => {
      const circular: Record<string, unknown> = { key: 'value' }
      circular.self = circular

      const result = sanitizeTelegramError(circular)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('handles objects with throwing toString methods without crashing', () => {
      const throwingObj = {
        toString() {
          throw new Error('Exploding toString')
        },
      }

      const result = sanitizeTelegramError(throwingObj)
      expect(typeof result).toBe('string')
      expect(result.trim().length).toBeGreaterThan(0)
    })

    it('falls back to safe message if both serialization and stringification fail', () => {
      const explodingObj = {
        get explode() {
          throw new Error('Exploding getter')
        },
      }

      const result = sanitizeTelegramError(explodingObj)
      expect(typeof result).toBe('string')
      expect(result.trim().length).toBeGreaterThan(0)
      expect(result).toBe('Unknown Telegram delivery error.')
    })

    it('scrubs the active bot token from network errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new Error(`fetch failed to https://api.telegram.org/bot${MOCK_BOT_TOKEN}/sendMessage`),
      )

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('uncertain')
      if (result.status === 'uncertain') {
        expect(result.error).not.toContain(MOCK_BOT_TOKEN)
        expect(result.error).toContain('[REDACTED_BOT_TOKEN]')
      }
    })

    it('scrubs bot tokens returned in provider error descriptions', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          ok: false,
          error_code: 401,
          description: `Unauthorized: bot token ${MOCK_BOT_TOKEN} is revoked`,
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('failed')
      if (result.status === 'failed') {
        expect(result.error).not.toContain(MOCK_BOT_TOKEN)
        expect(result.error).toContain('[REDACTED_BOT_TOKEN]')
      }
    })

    it('scrubs credential-bearing URLs in provider error descriptions and strips HTML', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({
          ok: false,
          error_code: 502,
          description: '<p>Proxy error at https://admin:superSecret@internal.cluster/telegram</p>',
        }),
      } as unknown as Response)

      const result = await sendTelegramAnnouncement({
        destination: 'telegram-channel',
        title: 'Title',
        teachingURL: 'https://menfesawi.org/teachings/test',
      })

      expect(result.status).toBe('uncertain')
      if (result.status === 'uncertain') {
        expect(result.error).not.toContain('superSecret')
        expect(result.error).not.toContain('<p>')
        expect(result.error).toContain('[REDACTED_CREDENTIALS]')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 9. CLI Argument Safety & Validation (scripts/test-telegram.ts)
  // ---------------------------------------------------------------------------
  describe('CLI Argument Safety', () => {
    it('accepts no arguments and defaults to telegram-channel', () => {
      const destination = parseAndValidateCliArgs(['node', 'test-telegram.ts'])
      expect(destination).toBe('telegram-channel')
    })

    it('accepts "channel" case-insensitively', () => {
      expect(parseAndValidateCliArgs(['node', 'test-telegram.ts', 'channel'])).toBe('telegram-channel')
      expect(parseAndValidateCliArgs(['node', 'test-telegram.ts', 'CHANNEL'])).toBe('telegram-channel')
      expect(parseAndValidateCliArgs(['node', 'test-telegram.ts', '  channel  '])).toBe('telegram-channel')
    })

    it('accepts "group" case-insensitively', () => {
      expect(parseAndValidateCliArgs(['node', 'test-telegram.ts', 'group'])).toBe('telegram-group')
      expect(parseAndValidateCliArgs(['node', 'test-telegram.ts', 'GROUP'])).toBe('telegram-group')
      expect(parseAndValidateCliArgs(['node', 'test-telegram.ts', '  group  '])).toBe('telegram-group')
    })

    it.each([
      ['unknown argument', ['node', 'test.ts', 'invalid']],
      ['typo argument', ['node', 'test.ts', 'groups']],
      ['silent redirect attempt', ['node', 'test.ts', 'random-string']],
      ['extra argument after channel', ['node', 'test.ts', 'channel', 'extra']],
      ['extra argument after group', ['node', 'test.ts', 'group', 'extra']],
      ['multiple extra arguments', ['node', 'test.ts', 'arg1', 'arg2', 'arg3']],
    ])('rejects %s before making any network calls', (_, argv) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      expect(() => parseAndValidateCliArgs(argv)).toThrow()
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // 10. SITE_URL Validation Safety (scripts/test-telegram.ts)
  // ---------------------------------------------------------------------------
  describe('SITE_URL Safety', () => {
    it.each([
      ['undefined', undefined],
      ['empty string', ''],
      ['whitespace only', '   '],
    ])('rejects missing or empty SITE_URL (%s) without hardcoded fallback', (_, urlInput) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      expect(() => validateSiteUrl(urlInput)).toThrow(/Missing required environment variable: SITE_URL/)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('rejects HTTP URLs without silently rewriting to HTTPS', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      expect(() => validateSiteUrl('http://insecure.example.com')).toThrow(/HTTPS/)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('rejects URLs containing embedded credentials', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      expect(() => validateSiteUrl('https://user:pass@example.com')).toThrow(/credentials/)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('rejects completely invalid URL strings', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      expect(() => validateSiteUrl('not-a-valid-url')).toThrow(/not a valid URL/)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('accepts valid HTTPS URL and strips trailing slashes', () => {
      expect(validateSiteUrl('https://app.menfesawi.org')).toBe('https://app.menfesawi.org')
      expect(validateSiteUrl('https://app.menfesawi.org/')).toBe('https://app.menfesawi.org')
      expect(validateSiteUrl('https://app.menfesawi.org///')).toBe('https://app.menfesawi.org')
    })
  })
})
