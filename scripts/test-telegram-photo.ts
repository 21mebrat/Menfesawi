/**
 * Standalone one-off photo test script for Telegram announcement delivery.
 * Posts an announcement test graphic with caption directly to the public Telegram group.
 * Does not touch or modify the database.
 */
import 'dotenv/config'
import sharp from 'sharp'
import { sanitizeTelegramError } from '../src/lib/server/social/telegram'

async function sendTestPhoto(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token) {
    console.error('Error: TELEGRAM_BOT_TOKEN is missing in .env')
    process.exit(1)
  }

  const chatId = process.env.TELEGRAM_PUBLIC_GROUP_ID?.trim() || '@menfesawi_community'

  console.log('Generating test graphic for Menfesawi...')

  const testDate = new Date().toUTCString()

  const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0f1d"/>
      <stop offset="50%" stop-color="#141c33"/>
      <stop offset="100%" stop-color="#0d1322"/>
    </linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="50%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#ca8a04"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Decorative Borders -->
  <rect x="30" y="30" width="1140" height="570" rx="16" fill="none" stroke="url(#gold)" stroke-width="3" opacity="0.6"/>
  <rect x="42" y="42" width="1116" height="546" rx="10" fill="none" stroke="url(#gold)" stroke-width="1" opacity="0.3"/>

  <!-- Ethiopian Cross Symbol -->
  <g transform="translate(600, 160)" stroke="url(#gold)" fill="none" stroke-width="4">
    <line x1="0" y1="-70" x2="0" y2="70"/>
    <line x1="-50" y1="-20" x2="50" y2="-20"/>
    <circle cx="0" cy="-70" r="10" fill="#eab308"/>
    <circle cx="0" cy="70" r="10" fill="#eab308"/>
    <circle cx="-50" cy="-20" r="10" fill="#eab308"/>
    <circle cx="50" cy="-20" r="10" fill="#eab308"/>
    <polygon points="0,-45 25,-20 0,5 -25,-20" stroke="url(#gold)" stroke-width="3" fill="#141c33"/>
    <polygon points="0,-60 40,-20 0,20 -40,-20" stroke="url(#gold)" stroke-width="2" fill="none" opacity="0.7"/>
  </g>

  <!-- Title -->
  <text x="600" y="320" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="bold" fill="url(#gold)" text-anchor="middle">
    መንፈሳዊ • Menfesawi
  </text>

  <!-- Subtitle -->
  <text x="600" y="380" font-family="system-ui, -apple-system, sans-serif" font-size="28" fill="#e2e8f0" text-anchor="middle" opacity="0.9">
    የኢትዮጵያ ኦርቶዶክስ ተዋሕዶ ቤተ ክርስቲያን መንፈሳዊ መተግበሪያ
  </text>

  <!-- Status Badge -->
  <rect x="380" y="430" width="440" height="50" rx="25" fill="#eab308" fill-opacity="0.15" stroke="url(#gold)" stroke-width="1.5"/>
  <text x="600" y="463" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="600" fill="#fde047" text-anchor="middle">
    Telegram Bot Connection Test
  </text>

  <!-- Footer Info -->
  <text x="600" y="530" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">
    Live Announcement Integration Verified
  </text>
</svg>
`

  const imageBuffer = await sharp(Buffer.from(svg)).png().toBuffer()

  const caption = [
    '🔔 [የሙከራ መልእክት / Connection Test]',
    'መንፈሳዊ • Menfesawi',
    '',
    'የTelegram ማስታወቂያ ግንኙነት በተሳካ ሁኔታ ተረጋግጧል!',
    'Telegram announcement delivery integration is active and working properly.',
    '',
    `📅 ${testDate}`,
  ].join('\n')

  console.log(`Sending test photo to Telegram group: ${chatId}...`)

  const formData = new FormData()
  formData.append('chat_id', chatId)
  formData.append('caption', caption)
  formData.append(
    'photo',
    new Blob([imageBuffer], { type: 'image/png' }),
    'menfesawi-test.png',
  )

  const endpoint = `https://api.telegram.org/bot${token}/sendPhoto`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(45_000),
    })

    const data = (await response.json()) as any

    if (response.ok && data.ok === true) {
      const messageId = data.result?.message_id
      const chatUsername = data.result?.chat?.username
      const publicUrl = chatUsername ? `https://t.me/${chatUsername}/${messageId}` : undefined

      console.log('\n--- Telegram Photo Test Result ---')
      console.log('Status: SUCCESS (200 OK)')
      console.log(`Confirmed Message ID: ${messageId}`)
      if (publicUrl) {
        console.log(`Public Post URL: ${publicUrl}`)
      }
      console.log('The photo and caption were posted directly to Telegram!')
      console.log('(No database records were touched or modified)')
      process.exit(0)
    } else {
      const errorMsg = sanitizeTelegramError(data.description || 'Failed to send photo', token)
      console.error(`\nTelegram API Rejection: ${errorMsg}`)
      process.exit(1)
    }
  } catch (err: unknown) {
    const errorMsg = sanitizeTelegramError(err, token)
    console.error(`\nNetwork / Delivery Error: ${errorMsg}`)
    process.exit(1)
  }
}

sendTestPhoto().catch((err) => {
  console.error('Execution error:', sanitizeTelegramError(err))
  process.exit(1)
})
