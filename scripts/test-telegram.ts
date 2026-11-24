/**
 * Standalone CLI test script for Telegram announcement delivery.
 *
 * Usage:
 *   npx tsx scripts/test-telegram.ts
 *   npx tsx scripts/test-telegram.ts channel
 *   npx tsx scripts/test-telegram.ts group
 *
 * Rules:
 *   - Accepts at most one argument ("channel" or "group", case-insensitive).
 *   - Defaults to "channel" if no argument is provided.
 *   - Rejects any unknown or extra arguments before making any network call.
 *   - Requires SITE_URL from environment (must be a valid HTTPS URL without credentials).
 *   - Never falls back to hardcoded domains or rewrites HTTP to HTTPS.
 *   - Uses the configured SITE_URL itself without invented subroutes.
 *   - Prints only sanitized outcomes and fixed safe error messages.
 *
 * Exit code:
 *   0 on success ('sent')
 *   1 on failure ('failed' or 'uncertain' or validation error)
 */
import 'dotenv/config'
import {
  sendTelegramAnnouncement,
  sanitizeTelegramError,
  type TelegramDestination,
} from '../src/lib/server/social/telegram'

/**
 * Validates CLI arguments strictly.
 * Accepts:
 *   - no arguments: defaults to 'telegram-channel'
 *   - ['channel']: 'telegram-channel'
 *   - ['group']: 'telegram-group'
 * Rejects any unknown or extra arguments.
 */
export function parseAndValidateCliArgs(argv: string[]): TelegramDestination {
  const args = argv.slice(2)
  if (args.length > 1) {
    throw new Error('Invalid arguments: Expected at most one argument ("channel" or "group").')
  }

  if (args.length === 0) {
    return 'telegram-channel'
  }

  const normalized = args[0].trim().toLowerCase()
  if (normalized === 'channel') {
    return 'telegram-channel'
  }
  if (normalized === 'group') {
    return 'telegram-group'
  }

  throw new Error(`Invalid destination argument: "${args[0]}". Must be "channel" or "group".`)
}

/**
 * Validates the configured SITE_URL strictly.
 * Requires non-empty string, valid URL, HTTPS protocol, and no embedded credentials.
 * Removes trailing slashes. Never silently rewrites HTTP to HTTPS or falls back to any domain.
 */
export function validateSiteUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('Missing required environment variable: SITE_URL.')
  }

  const trimmed = rawUrl.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('SITE_URL is not a valid URL.')
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('SITE_URL must use the HTTPS protocol.')
  }

  if (parsed.username || parsed.password) {
    throw new Error('SITE_URL must not contain embedded credentials.')
  }

  return parsed.toString().replace(/\/+$/, '')
}

async function run(): Promise<void> {
  // 1. Validate CLI arguments before making any network calls
  let destination: TelegramDestination
  try {
    destination = parseAndValidateCliArgs(process.argv)
  } catch (err: unknown) {
    const safeError = sanitizeTelegramError(err)
    console.error(`CLI argument error: ${safeError}`)
    process.exit(1)
  }

  // 2. Validate SITE_URL strictly from environment before making any network calls
  let siteUrl: string
  try {
    siteUrl = validateSiteUrl(process.env.SITE_URL)
  } catch (err: unknown) {
    const safeError = sanitizeTelegramError(err)
    console.error(`Configuration error: ${safeError}`)
    process.exit(1)
  }

  const testTimestamp = new Date().toISOString()
  const title = `[Test Announcement] Menfesawi Telegram Connection Test - ${testTimestamp}`
  // Use the validated SITE_URL itself without inventing nonexistent subpaths
  const teachingURL = siteUrl

  console.log('--- Menfesawi Telegram Announcement Test ---')
  console.log(`Destination: ${destination}`)
  console.log(`Title: ${title}`)
  console.log(`Teaching URL: ${teachingURL}`)
  console.log('Sending message to Telegram Bot API...')

  const result = await sendTelegramAnnouncement({
    destination,
    title,
    teachingURL,
  })

  console.log(`\nDelivery Status: ${result.status}`)

  if (result.status === 'sent') {
    console.log(`Confirmed Message ID: ${result.postId}`)
    if (result.postURL) {
      console.log(`Public Post URL: ${result.postURL}`)
    } else {
      console.log('Public Post URL: None (destination chat has no public username)')
    }
    console.log('--- Test Succeeded ---')
    process.exit(0)
  }

  if (result.status === 'failed') {
    console.error(`Delivery Failed: ${result.error}`)
    if (result.retryAfterSeconds !== undefined) {
      console.error(`Rate limited. Retry after: ${result.retryAfterSeconds}s`)
    }
    console.error('--- Test Failed ---')
    process.exit(1)
  }

  // result.status === 'uncertain'
  console.error(`Delivery Outcome Uncertain: ${result.error}`)
  console.error('--- Test Ended With Uncertain Status ---')
  process.exit(1)
}

// Only invoke run() when executed as the main CLI script
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('test-telegram.ts')

if (isMainModule) {
  run().catch((err: unknown) => {
    const safeMessage = sanitizeTelegramError(err, process.env.TELEGRAM_BOT_TOKEN)
    console.error(`Telegram test encountered an error: ${safeMessage}`)
    process.exit(1)
  })
}
