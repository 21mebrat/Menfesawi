/**
 * Standalone manual execution CLI for Telegram delivery queue runner.
 *
 * Usage:
 *   npx tsx scripts/run-telegram-deliveries.ts
 *   npx tsx scripts/run-telegram-deliveries.ts --batch 5
 *
 * WARNING:
 *   This script processes REAL pending deliveries in the database and
 *   publishes REAL announcements to configured Telegram destinations.
 *   DO NOT execute without explicit administrative approval.
 */
import 'dotenv/config'
import { getPayload } from 'payload'
import configPromise from '../src/payload.config'
import { runTelegramDeliveryQueue } from '../src/lib/server/social/runner'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  let batchSize = 5

  const batchArgIndex = args.indexOf('--batch')
  if (batchArgIndex !== -1 && args[batchArgIndex + 1]) {
    const parsed = parseInt(args[batchArgIndex + 1], 10)
    if (!isNaN(parsed) && parsed > 0) {
      batchSize = Math.min(parsed, 10)
    }
  }

  console.log('--- Menfesawi Telegram Delivery Runner ---')
  console.log(`Execution batch limit: ${batchSize}`)
  console.log('Connecting to database and initializing Payload...')

  const config = await configPromise
  const payload = await getPayload({ config })

  console.log('Running delivery queue for pending Telegram announcements...')
  const summary = await runTelegramDeliveryQueue({
    payload,
    batchSize,
  })

  console.log('\n--- Execution Summary ---')
  console.log(`Processed:  ${summary.processed}`)
  console.log(`Sent:       ${summary.sent}`)
  console.log(`Failed:     ${summary.failed}`)
  console.log(`Uncertain:  ${summary.uncertain}`)
  console.log(`Skipped:    ${summary.skipped}`)

  if (summary.results.length > 0) {
    console.log('\nDetails:')
    for (const r of summary.results) {
      console.log(`- Delivery ID: ${r.deliveryId} (${r.destination}) -> ${r.status}`)
      if (r.postId) console.log(`  Message ID: ${r.postId}`)
      if (r.postURL) console.log(`  Post URL: ${r.postURL}`)
      if (r.error) console.log(`  Error: ${r.error}`)
      if (r.linkSyncError) console.log(`  Link Sync Note: ${r.linkSyncError}`)
    }
  }

  process.exit(0)
}

main().catch((err: unknown) => {
  console.error('Fatal runner error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
