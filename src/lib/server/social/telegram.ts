export type TelegramDestination = 'telegram-channel' | 'telegram-group'

export type TelegramDeliveryResult =
  | {
      status: 'sent'
      postId: string
      postURL?: string
    }
  | {
      status: 'failed'
      error: string
      retryAfterSeconds?: number
    }
  | {
      status: 'uncertain'
      error: string
    }

export interface SendTelegramAnnouncementArgs {
  destination: TelegramDestination
  title: string
  teachingURL: string
  /**
   * Optional request timeout in milliseconds. Defaults to 10000 (10s).
   */
  timeoutMs?: number
}

const MAX_MESSAGE_LENGTH = 4000
const DEFAULT_TIMEOUT_MS = 10_000
const FALLBACK_ERROR_MESSAGE = 'Unknown Telegram delivery error.'

/**
 * Validates whether a value is a plain JSON object (non-null, non-array).
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validates whether a string is a valid Telegram username.
 * Telegram usernames contain only ASCII letters, digits, and underscores,
 * and must be between 5 and 32 characters in length.
 */
export function isValidTelegramUsername(username: unknown): username is string {
  if (typeof username !== 'string') {
    return false
  }
  return /^[A-Za-z0-9_]{5,32}$/.test(username)
}

/**
 * Sanitizes error messages by scrubbing sensitive tokens, bot API paths,
 * embedded credentials, and raw HTML error pages.
 *
 * Guarantees:
 * - Always returns a nonempty string.
 * - Handles undefined, null, functions, symbols, BigInt, circular objects, and throwing toString().
 * - Uses a fixed safe fallback if sanitization fails or input produces empty text.
 */
export function sanitizeTelegramError(error: unknown, token?: string): string {
  try {
    let rawString = ''

    if (error instanceof Error) {
      rawString = typeof error.message === 'string' ? error.message : ''
      if (!rawString.trim() && typeof error.name === 'string') {
        rawString = error.name
      }
    } else if (typeof error === 'string') {
      rawString = error
    } else if (typeof error === 'number' || typeof error === 'boolean') {
      rawString = String(error)
    } else if (typeof error === 'bigint') {
      rawString = error.toString()
    } else if (typeof error === 'symbol') {
      rawString = error.description || error.toString()
    } else if (typeof error === 'function') {
      rawString = error.name || 'function'
    } else if (error !== null && typeof error === 'object') {
      try {
        const json = JSON.stringify(error)
        if (typeof json === 'string' && json.length > 0) {
          rawString = json
        }
      } catch {
        // Circular object, throwing getter, etc.
        rawString = FALLBACK_ERROR_MESSAGE
      }
    }

    if (!rawString || typeof rawString !== 'string' || !rawString.trim() || rawString === '{}') {
      rawString = FALLBACK_ERROR_MESSAGE
    }

    let message = rawString

    // Redact explicit bot token if provided
    if (token && typeof token === 'string' && token.trim().length > 0) {
      message = message.split(token.trim()).join('[REDACTED_BOT_TOKEN]')
    }

    // Redact any Telegram bot token pattern: e.g. bot123456789:ABCdefGHIjkl... or digits:alphanumeric
    message = message.replace(/bot\d+:[A-Za-z0-9_-]+/gi, 'bot[REDACTED_BOT_TOKEN]')
    message = message.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_BOT_TOKEN]')

    // Redact credentials embedded in URLs: https://user:pass@host
    message = message.replace(/https?:\/\/[^:\s@]+:[^@\s]+@/gi, 'https://[REDACTED_CREDENTIALS]@')

    // Strip HTML tags (common in 502/504 reverse proxy error pages)
    message = message.replace(/<[^>]*>?/gm, ' ')

    // Normalize whitespace
    message = message.replace(/\s+/g, ' ').trim()

    // Cap message length to prevent database buffer bloat
    if (message.length > 500) {
      message = message.slice(0, 497) + '...'
    }

    return message || FALLBACK_ERROR_MESSAGE
  } catch {
    return FALLBACK_ERROR_MESSAGE
  }
}

/**
 * Validates the announcement title.
 */
function validateTitle(title: unknown): { ok: true; title: string } | { ok: false; error: string } {
  if (typeof title !== 'string' || !title.trim()) {
    return { ok: false, error: 'Announcement title must be a non-empty string.' }
  }

  const trimmed = title.trim()
  return { ok: true, title: trimmed }
}

/**
 * Validates the teaching URL.
 * Enforces HTTPS protocol and rejects URLs with embedded credentials.
 */
function validateTeachingURL(url: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof url !== 'string' || !url.trim()) {
    return { ok: false, error: 'Teaching URL must be a non-empty string.' }
  }

  const trimmed = url.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'Enter a valid HTTPS teaching URL.' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Teaching URL must use the HTTPS protocol.' }
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Teaching URL must not contain embedded credentials.' }
  }

  return { ok: true, url: trimmed }
}

/**
 * Sends a teaching announcement to a configured public Telegram destination (channel or group).
 *
 * Requirements:
 * - Uses plain text without Markdown/HTML parsing mode to prevent parser injection/failure.
 * - Enforces conservative character length.
 * - Scans and scrubs bot tokens and credentials from any error output.
 * - Rejects URLs with embedded credentials.
 * - Classifies network aborts/timeouts/malformed payloads as 'uncertain'.
 * - Classifies explicit API rejections as 'failed'.
 * - Captures rate-limiting retry_after parameters.
 * - Generates public post URL only when destination chat has a valid ASCII username.
 * - Treats incomplete success responses (missing/non-positive/unsafe message_id) as 'uncertain'.
 */
export async function sendTelegramAnnouncement({
  destination,
  title,
  teachingURL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: SendTelegramAnnouncementArgs): Promise<TelegramDeliveryResult> {
  // 1. Resolve Bot Token
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!botToken) {
    return {
      status: 'failed',
      error: 'Missing TELEGRAM_BOT_TOKEN environment variable.',
    }
  }

  // 2. Resolve Destination Chat ID (Channel or Group)
  // PUBLIC ANNOUNCEMENTS ONLY: Never use TELEGRAM_STORAGE_CHAT_ID (which is private book storage)
  let chatId: string | undefined
  if (destination === 'telegram-channel') {
    chatId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID?.trim()
    if (!chatId) {
      return {
        status: 'failed',
        error: 'Missing TELEGRAM_PUBLIC_CHANNEL_ID environment variable.',
      }
    }
  } else if (destination === 'telegram-group') {
    chatId = process.env.TELEGRAM_PUBLIC_GROUP_ID?.trim()
    if (!chatId) {
      return {
        status: 'failed',
        error: 'Missing TELEGRAM_PUBLIC_GROUP_ID environment variable.',
      }
    }
  } else {
    return {
      status: 'failed',
      error: `Unsupported Telegram destination: ${String(destination)}.`,
    }
  }

  // 3. Validate Inputs
  const titleValidation = validateTitle(title)
  if (!titleValidation.ok) {
    return {
      status: 'failed',
      error: titleValidation.error,
    }
  }

  const urlValidation = validateTeachingURL(teachingURL)
  if (!urlValidation.ok) {
    return {
      status: 'failed',
      error: urlValidation.error,
    }
  }

  // 4. Construct Plain Text Message
  // Do NOT use parse_mode (Markdown/HTML) to avoid parser breakage on religious titles or punctuation
  const messageText = `${titleValidation.title}\n\n${urlValidation.url}`
  if (messageText.length > MAX_MESSAGE_LENGTH) {
    return {
      status: 'failed',
      error: `Announcement message exceeds maximum limit of ${MAX_MESSAGE_LENGTH} characters.`,
    }
  }

  // 5. Send Telegram Message via Native fetch
  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`
  const requestBody = JSON.stringify({
    chat_id: chatId,
    text: messageText,
    disable_web_page_preview: false,
  })

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: requestBody,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err: unknown) {
    // Network timeouts, DNS errors, connection aborts: the message may have been delivered
    // before the socket terminated, so this outcome is uncertain.
    return {
      status: 'uncertain',
      error: sanitizeTelegramError(err, botToken),
    }
  }

  // 6. Parse and Validate Response with Runtime Type Guards
  let rawData: unknown
  try {
    rawData = await response.json()
  } catch {
    // Failed to parse JSON
    if (response.status >= 400 && response.status < 500) {
      return {
        status: 'failed',
        error: `Telegram rejected request with HTTP ${response.status}.`,
      }
    }
    return {
      status: 'uncertain',
      error: `Received non-JSON response (HTTP ${response.status}) from Telegram.`,
    }
  }

  // Response must be a valid JSON object
  if (!isJsonObject(rawData)) {
    return {
      status: 'uncertain',
      error: 'Telegram returned invalid response structure.',
    }
  }

  // 7. Handle Success
  if (response.ok && rawData.ok === true) {
    const result = rawData.result

    // Require a non-array result object
    if (isJsonObject(result)) {
      const messageId = result.message_id

      // Require a positive safe-integer message_id
      if (typeof messageId === 'number' && Number.isSafeInteger(messageId) && messageId > 0) {
        const postId = String(messageId)
        let postURL: string | undefined = undefined

        const chat = isJsonObject(result.chat) ? result.chat : undefined
        const username = chat?.username

        // Construct postURL only for a valid Telegram username containing ASCII letters, digits, and underscores
        if (isValidTelegramUsername(username)) {
          postURL = `https://t.me/${username}/${postId}`
        }

        return {
          status: 'sent',
          postId,
          ...(postURL ? { postURL } : {}),
        }
      }
    }

    // Incomplete success response (missing result, array result, or invalid message_id)
    return {
      status: 'uncertain',
      error: 'Telegram success response missing valid message_id.',
    }
  }

  // 8. Handle Rate Limiting (HTTP 429)
  if (response.status === 429) {
    let retryAfterSeconds: number | undefined = undefined
    const parameters = isJsonObject(rawData.parameters) ? rawData.parameters : undefined
    const retryAfter = parameters?.retry_after
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
      retryAfterSeconds = Math.ceil(retryAfter)
    }

    const description = typeof rawData.description === 'string' ? rawData.description : ''
    const errorMsg = sanitizeTelegramError(
      description || 'Rate limited by Telegram.',
      botToken,
    )

    return {
      status: 'failed',
      error: errorMsg,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    }
  }

  // 9. Handle Explicit Client/Permission Rejections (HTTP 4xx)
  if (response.status >= 400 && response.status < 500) {
    const description = typeof rawData.description === 'string' ? rawData.description : ''
    const errorMsg = sanitizeTelegramError(
      description || `Telegram request failed with HTTP ${response.status}.`,
      botToken,
    )
    return {
      status: 'failed',
      error: errorMsg,
    }
  }

  // 10. Handle Server Errors (HTTP 5xx)
  // Server-side gateway timeouts or crashes mean message delivery is uncertain
  const description = typeof rawData.description === 'string' ? rawData.description : ''
  const errorMsg = sanitizeTelegramError(
    description || `Telegram server error (HTTP ${response.status}).`,
    botToken,
  )
  return {
    status: 'uncertain',
    error: errorMsg,
  }
}
