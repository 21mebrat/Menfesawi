import { APIError, type Payload, type PayloadRequest } from 'payload'
import { isJsonObject } from '../social/telegram'
import { REVIEW_LIMIT } from '@/collections/BookRatings'
import { active, claimTicket, proveLink, states, telegramLink } from './handoff'
import { fail, lock, ref, session, transaction } from './coordination'
import { messageId, telegram, TelegramFailure } from './telegram'

type Action =
  | { kind: 'reply'; text: string }
  | { kind: 'deliver'; id: string; fileId: string }
  | { kind: 'prompt'; delivery: string }
  | { kind: 'none' }
const reply = (text: string): Action => ({ kind: 'reply', text })
async function feedback(req: PayloadRequest, sender: string, id: string) {
  const account = await telegramLink(req, { providerAccountId: sender })
  if (!account) return fail('Link your active website account first.', 403)
  const user = ref(account.user)
  await active(req, user)
  const delivery = await req.payload.find({
    collection: 'book-deliveries',
    req,
    depth: 0,
    limit: 1,
    pagination: false,
    where: {
      id: { equals: id },
      user: { equals: user },
      telegramUser: { equals: sender },
      state: { equals: 'sent' },
    },
  })
  if (!delivery.docs.length) return fail('This feedback action is unavailable.', 403)
  const book = ref(delivery.docs[0].book)
  await lock(req, 'books', book)
  const live = await req.payload.findByID({
    collection: 'books',
    id: book,
    req,
    draft: false,
    depth: 0,
  })
  if (live._status !== 'published') return fail('Book unavailable.', 404)
  const { docs } = await req.payload.find({
    collection: 'book-ratings',
    req,
    depth: 0,
    limit: 1,
    pagination: false,
    where: { book: { equals: book }, user: { equals: user } },
  })
  return { user, book, rating: docs[0] }
}
async function act(
  req: PayloadRequest,
  sender: string,
  msg: Record<string, unknown>,
  callback: string | undefined,
  updateId: number,
): Promise<Action> {
  const p = req.payload,
    s = await session(req),
    store = states(p)
  // Private Telegram chat IDs equal the numeric Telegram user ID.
  const key = 'review:' + sender
  if (callback !== undefined) {
    const match = /^bk:([1-5w]):([0-9a-f]{24})$/.exec(callback)
    if (!match) return { kind: 'none' }
    const [, choice, id] = match
    const { book, user, rating } = await feedback(req, sender, id)
    if (choice === 'w') {
      if (!rating) return reply('Choose a score first.')
      await store.updateOne(
        { _id: key },
        {
          $set: {
            user,
            telegramId: sender,
            delivery: id,
            book,
            updateId,
            expiresAt: new Date(Date.now() + 600000),
          },
          $unset: { prompt: 1 },
        },
        { upsert: true, session: s },
      )
      return { kind: 'prompt', delivery: id }
    }
    const score = Number(choice)
    if (rating) await p.update({ collection: 'book-ratings', id: rating.id, req, data: { score } })
    else
      await p.create({
        collection: 'book-ratings',
        req,
        data: { book, user, score, reviewStatus: 'pending' },
      })
    return reply('Score saved.')
  }
  if (typeof msg.text !== 'string' || msg.document) return { kind: 'none' }
  const text = msg.text.trim()
  if (text === '/cancel') {
    await store.deleteOne({ _id: key }, { session: s })
    return reply('Review cancelled.')
  }
  const start = /^\/start (l|b)_([A-Za-z0-9_-]{32})$/.exec(text)
  if (start) {
    if (start[1] === 'l')
      return reply(
        'Enter this confirmation code in your signed-in website session: ' +
          (await proveLink(req, start[2], sender)),
      )
    return { kind: 'deliver', ...(await claimTicket(req, start[2], sender)) }
  }
  if (text.startsWith('/') || !isJsonObject(msg.reply_to_message)) return { kind: 'none' }
  const promptId = msg.reply_to_message.message_id
  if (typeof promptId !== 'number' || !Number.isSafeInteger(promptId)) return { kind: 'none' }
  const intent = await store.findOne(
    { _id: key, telegramId: sender, expiresAt: { $gt: new Date() }, prompt: promptId },
    { session: s },
  )
  if (!intent?.delivery) return { kind: 'none' }
  if (!text || text.length > REVIEW_LIMIT)
    return reply('Reply with 1 to ' + REVIEW_LIMIT + ' characters, or use /cancel.')
  const { user, book, rating } = await feedback(req, sender, intent.delivery)
  if (user !== intent.user || book !== intent.book || !rating)
    return fail('Rate this book first.', 403)
  if (text !== rating.review)
    await p.update({
      collection: 'book-ratings',
      id: rating.id,
      req,
      data: { review: text, reviewStatus: 'pending' },
    })
  await store.deleteOne({ _id: key }, { session: s })
  return reply('Review received.')
}
export async function processLibraryUpdate(p: Payload, update: unknown): Promise<void> {
  if (!isJsonObject(update) || !Number.isSafeInteger(update.update_id)) return
  const updateId = Number(update.update_id)
  const callback = isJsonObject(update.callback_query) ? update.callback_query : undefined
  const msg = callback ? callback.message : update.message
  const from = callback ? callback.from : isJsonObject(msg) ? msg.from : undefined
  if (
    !isJsonObject(msg) ||
    !isJsonObject(msg.chat) ||
    msg.chat.type !== 'private' ||
    !isJsonObject(from) ||
    from.is_bot === true ||
    !Number.isSafeInteger(from.id) ||
    Number(from.id) <= 0 ||
    msg.chat.id !== from.id
  )
    return
  if (callback && typeof callback.data !== 'string') return
  const sender = String(from.id)
  const action = await transaction(p, async (req): Promise<Action> => {
    const receipt = await states(p).updateOne(
      { _id: 'update:' + updateId },
      { $setOnInsert: { updateId } },
      { upsert: true, session: await session(req) },
    )
    if (!receipt.upsertedCount) return { kind: 'none' }
    try {
      return await act(
        req,
        sender,
        msg,
        typeof callback?.data === 'string' ? callback.data : undefined,
        updateId,
      )
    } catch (error) {
      if (error instanceof APIError && error.status >= 400 && error.status < 500)
        return reply('Action unavailable. Check your account or request a new link.')
      throw error
    }
  })
  if (action.kind === 'none') return
  if (action.kind === 'deliver') {
    const model = p.db.collections['book-deliveries']
    let sent: number
    const button = (text: string, choice: string) => ({
      text,
      callback_data: 'bk:' + choice + ':' + action.id,
    })
    try {
      const result = await telegram('sendDocument', {
        chat_id: sender,
        document: action.fileId,
        reply_markup: {
          inline_keyboard: [
            [1, 2, 3, 4, 5].map((n) => button(String(n), String(n))),
            [button('Write review', 'w')],
          ],
        },
      })
      if (
        !isJsonObject(result) ||
        !isJsonObject(result.document) ||
        !isJsonObject(result.chat) ||
        String(result.chat.id) !== sender
      )
        throw new TelegramFailure(true)
      sent = messageId(result)
    } catch (error) {
      if (!(error instanceof TelegramFailure)) throw error
      await model.updateOne(
        { _id: action.id, state: 'uncertain' },
        { $set: { state: error.uncertain ? 'uncertain' : 'failed', failure: error.message } },
      )
      return
    }
    await model.updateOne(
      { _id: action.id, state: 'uncertain' },
      { $set: { state: 'sent', messageId: sent }, $unset: { failure: 1 } },
    )
  } else if (action.kind === 'prompt') {
    const prompt = messageId(
      await telegram('sendMessage', {
        chat_id: sender,
        text: 'Reply to this message with your review (up to 1500 characters), or use /cancel.',
        reply_markup: { force_reply: true },
      }),
    )
    await states(p).updateOne(
      { _id: 'review:' + sender, delivery: action.delivery, updateId },
      { $set: { prompt } },
    )
  } else await telegram('sendMessage', { chat_id: sender, text: action.text })
  if (callback && typeof callback.id === 'string')
    await telegram('answerCallbackQuery', { callback_query_id: callback.id })
}
