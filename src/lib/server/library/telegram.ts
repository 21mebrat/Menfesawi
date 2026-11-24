import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { isJsonObject, isValidTelegramUsername } from '../social/telegram'
import { fail } from './coordination'

export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export const token = () => randomBytes(24).toString('base64url')
export function botLink(start: string) {
  const bot = process.env.TELEGRAM_BOT_USERNAME
  if (!isValidTelegramUsername(bot)) return fail('Configure TELEGRAM_BOT_USERNAME.', 503)
  return 'https://t.me/' + bot + '?start=' + start
}
export function webhookAuthorized(header: string | null) {
  const configured = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!configured) return fail('Configure Telegram webhook authentication.', 503)
  return (
    !!header &&
    timingSafeEqual(Buffer.from(hash(header), 'hex'), Buffer.from(hash(configured), 'hex'))
  )
}
export function storageChat() {
  const chat = process.env.TELEGRAM_STORAGE_CHAT_ID
  if (!chat || !/^-\d+$/.test(chat))
    return fail('Configure a private TELEGRAM_STORAGE_CHAT_ID.', 503)
  return chat
}
export class TelegramFailure extends Error {
  constructor(readonly uncertain: boolean) {
    super(uncertain ? 'Telegram outcome unknown.' : 'Telegram rejected the request.')
  }
}
export function botCredential() {
  const credential = process.env.TELEGRAM_BOT_TOKEN
  if (!credential) return fail('Configure TELEGRAM_BOT_TOKEN.', 503)
  return credential
}
export async function telegram(
  method: 'getChat' | 'sendDocument' | 'sendMessage' | 'answerCallbackQuery',
  body: FormData | Record<string, unknown>,
) {
  const credential = botCredential()
  const multipart = body instanceof FormData
  let response: Response
  let result: unknown
  try {
    response = await fetch('https://api.telegram.org/bot' + credential + '/' + method, {
      method: 'POST',
      headers: multipart ? undefined : { 'content-type': 'application/json' },
      body: multipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    })
    result = await response.json()
  } catch {
    throw new TelegramFailure(true)
  }
  if (!response.ok || !isJsonObject(result) || result.ok !== true) {
    throw new TelegramFailure(
      !(
        isJsonObject(result) &&
        result.ok === false &&
        response.status >= 400 &&
        response.status < 500
      ),
    )
  }
  return result.result
}
// A numeric channel ID can also identify a public channel. Check before any PDF leaves the server.
export async function verifyStorageChat(id: string) {
  async function inspect(chatId: string) {
    const chat = await telegram('getChat', { chat_id: chatId })
    if (
      !isJsonObject(chat) ||
      String(chat.id) !== chatId ||
      !['group', 'supergroup', 'channel'].includes(String(chat.type)) ||
      chat.username ||
      chat.location ||
      (Array.isArray(chat.active_usernames) && chat.active_usernames.length) ||
      [process.env.TELEGRAM_PUBLIC_CHANNEL_ID, process.env.TELEGRAM_PUBLIC_GROUP_ID].includes(
        chatId,
      )
    )
      return fail(
        'Telegram storage must be private and separate from announcement destinations.',
        503,
      )
    return chat
  }
  const storage = await inspect(id)
  // Channel posts are automatically forwarded to an attached discussion group.
  if (storage.type === 'channel' && storage.linked_chat_id)
    await inspect(String(storage.linked_chat_id))
}
export function messageId(result: unknown) {
  if (
    !isJsonObject(result) ||
    typeof result.message_id !== 'number' ||
    !Number.isSafeInteger(result.message_id) ||
    result.message_id <= 0
  )
    throw new TelegramFailure(true)
  return result.message_id
}
