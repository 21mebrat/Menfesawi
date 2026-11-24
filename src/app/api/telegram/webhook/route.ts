import { getPayload } from 'payload'
import config from '@/payload.config'
import { webhookAuthorized } from '@/lib/server/library/telegram'
import { processLibraryUpdate } from '@/lib/server/library/bot'

export async function POST(request: Request) {
  if (!webhookAuthorized(request.headers.get('x-telegram-bot-api-secret-token')))
    return new Response(null, { status: 403 })
  let update: unknown
  try {
    update = await request.json()
  } catch {
    return new Response(null, { status: 400 })
  }
  await processLibraryUpdate(await getPayload({ config }), update)
  return new Response(null, { status: 200 })
}
