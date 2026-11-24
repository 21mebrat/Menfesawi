import type { Payload, PayloadRequest } from 'payload'
import { isAuthenticated } from '@/access'
import { fail, lock, ref, session, transaction } from './coordination'
import { primaryFile, ready } from './catalog'
import { botLink, hash, token } from './telegram'

interface BotState {
  _id: string
  expiresAt?: Date
  user?: string
  telegramId?: string
  book?: string
  delivery?: string
  prompt?: number
  updateId?: number
}
export function states(p: Payload) {
  const db = p.db.connection.db
  if (!db) throw new Error('MongoDB is unavailable.')
  return db.collection<BotState>('library_bot_state')
}
export async function active(req: PayloadRequest, id: string) {
  await lock(req, 'users', id)
  const user = await req.payload.findByID({ collection: 'users', id, req, depth: 0 })
  if (!isAuthenticated(user)) return fail('Active website account required.', 403)
  return user
}
export async function telegramLink(
  req: PayloadRequest,
  where: { user: string } | { providerAccountId: string },
) {
  const { docs } = await req.payload.find({
    collection: 'auth-accounts',
    req,
    depth: 0,
    limit: 1,
    pagination: false,
    where: {
      provider: { equals: 'telegram' },
      ...('user' in where
        ? { user: { equals: where.user } }
        : { providerAccountId: { equals: where.providerAccountId } }),
    },
  })
  return docs[0]
}
export async function beginLink(p: Payload, user: string) {
  const secret = token()
  const link = botLink('l_' + secret)
  await transaction(p, async (req) => {
    await active(req, user)
    if (await telegramLink(req, { user })) return fail('Account already linked.', 409)
    await states(p).insertOne(
      { _id: 'link:' + hash(secret), user, expiresAt: new Date(Date.now() + 600000) },
      { session: await session(req) },
    )
  })
  return { link }
}
export async function proveLink(req: PayloadRequest, secret: string, telegramId: string) {
  const proof = token()
  const store = states(req.payload)
  const options = { session: await session(req) }
  const challenge = await store.findOneAndDelete(
    { _id: 'link:' + hash(secret), expiresAt: { $gt: new Date() } },
    options,
  )
  if (!challenge?.user) return fail('Start a new account link on the website.', 403)
  await store.insertOne(
    {
      _id: 'proof:' + hash(proof),
      user: challenge.user,
      expiresAt: challenge.expiresAt,
      telegramId,
    },
    options,
  )
  return proof
}
export async function confirmLink(p: Payload, user: string, proof: string) {
  return transaction(p, async (req) => {
    await active(req, user)
    const store = states(p),
      s = await session(req)
    const challenge = await store.findOne(
      { user, _id: 'proof:' + hash(proof), expiresAt: { $gt: new Date() } },
      { session: s },
    )
    if (!challenge?.telegramId) return fail('Invalid or expired confirmation.', 403)
    if (
      (await telegramLink(req, { user })) ||
      (await telegramLink(req, { providerAccountId: challenge.telegramId }))
    )
      return fail('Identity already linked.', 409)
    await p.create({
      collection: 'auth-accounts',
      req,
      data: {
        provider: 'telegram',
        issuer: 'https://telegram.org',
        user,
        providerAccountId: challenge.telegramId,
      },
    })
    await store.deleteOne({ _id: challenge._id }, { session: s })
    return { linked: true }
  })
}
export async function livePDF(req: PayloadRequest, bookId: string) {
  await lock(req, 'books', bookId)
  const book = await req.payload.findByID({
    collection: 'books',
    id: bookId,
    req,
    depth: 0,
    draft: false,
  })
  if (book._status !== 'published') return fail('Book unavailable.', 404)
  const fileId = primaryFile(book)
  if (!fileId) return fail('Book file unavailable.', 409)
  await lock(req, 'files', fileId)
  const file = await req.payload.findByID({ collection: 'files', id: fileId, req, depth: 0 })
  if (!ready(file)) return fail('Book file unavailable.', 409)
  return { file, revision: book.updatedAt }
}
export async function issueTicket(p: Payload, user: string, book: string) {
  const secret = token()
  const link = botLink('b_' + secret)
  await transaction(p, async (req) => {
    await active(req, user)
    const account = await telegramLink(req, { user })
    if (!account) return fail('Confirm a Telegram account first.', 403)
    const { file, revision } = await livePDF(req, book)
    await p.create({
      collection: 'book-deliveries',
      req,
      depth: 0,
      data: {
        book,
        file: file.id,
        bookRevision: revision,
        user,
        telegramUser: account.providerAccountId,
        ticketHash: hash(secret),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        state: 'pending',
      },
    })
  })
  return { link }
}
export async function claimTicket(req: PayloadRequest, secret: string, telegramId: string) {
  const p = req.payload
  const row = await p.db.collections['book-deliveries']
    .findOne({
      ticketHash: hash(secret),
      telegramUser: telegramId,
      state: 'pending',
      expiresAt: { $gt: new Date() },
    })
    .session(await session(req))
    .lean<{ _id: unknown; book: unknown; file: unknown; bookRevision: Date; user: unknown }>()
  if (!row) return fail('Ticket invalid, expired, or already used.', 403)
  const user = String(row.user)
  await active(req, user)
  const account = await telegramLink(req, { providerAccountId: telegramId })
  if (!account || ref(account.user) !== user) return fail('Linked account required.', 403)
  const { file, revision } = await livePDF(req, String(row.book))
  if (file.id !== String(row.file) || new Date(row.bookRevision).getTime() !== Date.parse(revision))
    return fail('The book file changed. Request it again.', 409)
  const claimed = await p.db.collections['book-deliveries'].updateOne(
    { _id: row._id, state: 'pending' },
    { $set: { state: 'uncertain', failure: 'Dispatch claimed; confirmation outstanding.' } },
    { session: await session(req) },
  )
  if (!claimed.modifiedCount) return fail('Ticket already used.', 409)
  return { id: String(row._id), fileId: file.telegram.fileId }
}
