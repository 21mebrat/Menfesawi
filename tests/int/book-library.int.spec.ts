import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { GET as rest, PATCH as patch } from '@/app/(payload)/api/[...slug]/route'
import { POST as graphql } from '@/app/(payload)/api/graphql/route'
import type { User } from '@/payload-types'
import { POST as unlinkGoogle } from '@/app/api/auth/google/unlink/route'
import { createPayloadSessionForUser } from '@/lib/auth/session'
import { POST as webhook } from '@/app/api/telegram/webhook/route'
import { POST as website } from '@/app/api/library/[action]/route'
import { beginLink, confirmLink, issueTicket, states } from '@/lib/server/library/handoff'
import { ingestBookPDF } from '@/lib/server/library/ingest'
import { processLibraryUpdate } from '@/lib/server/library/bot'
import { publicBookStatistics, publicBookReviews } from '@/lib/server/library/statistics'

describe('Protected book library', () => {
  let p: Payload, admin: User, editor: User, member: User, other: User
  let file: string, book: string, delivery: string
  let storagePublic = false
  let mode: 'ok' | 'reject' | 'timeout' = 'ok'
  let updates = Date.now(),
    messages = 100
  const tid = 113202,
    wrong = 113203
  const run = randomUUID(),
    password = randomUUID()
  type BotBody = {
    text?: string
    upload?: boolean
    chat_id?: string
    document?: string
    reply_markup?: { force_reply?: boolean; inline_keyboard?: { callback_data: string }[][] }
  }
  const calls: { method: string; body: BotBody; message: number }[] = []
  const owned: { categories: string[]; books: string[]; files: Set<string>; users: string[] } = {
    categories: [],
    books: [],
    files: new Set(),
    users: [],
  }
  const receiptIds: string[] = []
  const idForUpdate = () => {
    const id = ++updates
    receiptIds.push('update:' + id)
    return id
  }
  function msg(text: string, who = tid, extra: Record<string, unknown> = {}) {
    return {
      update_id: idForUpdate(),
      message: { from: { id: who }, chat: { id: who, type: 'private' }, text, ...extra },
    }
  }
  function callback(choice: string, who = tid, id = delivery) {
    return {
      update_id: idForUpdate(),
      callback_query: {
        id: randomUUID(),
        data: 'bk:' + choice + ':' + id,
        from: { id: who },
        message: { chat: { id: who, type: 'private' } },
      },
    }
  }
  function start(link: string) {
    return '/start ' + new URL(link).searchParams.get('start')
  }
  function pdf(tag: string) {
    return Buffer.from('%PDF-1.7\n' + tag + '\n%%EOF')
  }
  async function createBook(name: string, fileId = file) {
    const doc = await p.create({
      collection: 'books',
      user: editor,
      data: {
        title: name,
        slug: randomUUID(),
        language: ['gez', 'am'],
        file: fileId,
        authors: [{ name: 'Test Editor' }],
        _status: 'published',
      },
      depth: 0,
    })
    owned.books.push(doc.id)
    return doc.id
  }
  async function ingest(name: string, bytes: Buffer) {
    const { id } = await ingestBookPDF(p, editor.id, name, bytes, 'application/pdf')
    owned.files.add(id)
    return id
  }
  async function category(parent?: string) {
    const doc = await p.create({
      collection: 'categories',
      user: editor,
      data: {
        name: 'Category',
        slug: randomUUID(),
        contentTypes: ['books', 'hymns'],
        parent,
        _status: 'published',
      },
      depth: 0,
    })
    owned.categories.push(doc.id)
    return doc.id
  }
  const options = { overrideAccess: false, depth: 0 } as const
  beforeAll(async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', randomUUID())
    vi.stubEnv('TELEGRAM_BOT_USERNAME', 'LibraryTestBot')
    vi.stubEnv('TELEGRAM_STORAGE_CHAT_ID', '-100123456')
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', randomUUID())
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit) => {
        if (!String(input).startsWith('https://api.telegram.org/bot'))
          throw new Error('Unexpected outbound request')
        const method = String(input).split('/').pop()!
        const upload = init.body instanceof FormData
        const body = upload ? { upload: true } : JSON.parse(String(init.body))
        const message = ++messages
        calls.push({ method, body, message })
        if (method === 'getChat')
          return Response.json({
            ok: true,
            result: {
              id: -100123456,
              type: 'channel',
              ...(storagePublic ? { username: 'PublicChannel' } : {}),
            },
          })
        if (mode === 'timeout') throw new Error('Mock timeout')
        if (mode === 'reject') return Response.json({ ok: false }, { status: 400 })
        return Response.json({
          ok: true,
          result:
            method === 'answerCallbackQuery'
              ? true
              : {
                  message_id: message,
                  chat: { id: upload ? -100123456 : Number(body.chat_id) },
                  ...(method === 'sendDocument'
                    ? {
                        document: {
                          file_id: upload ? 'private-file-' + message : body.document,
                          file_unique_id: 'private-unique-' + message,
                        },
                      }
                    : {}),
                },
        })
      }),
    )
    p = await getPayload({ config })
    async function user(role: User['role']) {
      const doc = await p.create({
        collection: 'users',
        data: {
          name: 'Test',
          email: randomUUID() + '@example.test',
          password,
          role,
          isActive: true,
        },
      })
      owned.users.push(doc.id)
      return doc
    }
    admin = await user('admin')
    editor = await user('editor')
    member = await user('member')
    other = await user('member')
    file = await ingest('fixture.pdf', pdf(run))
    await p.update({ collection: 'files', id: file, data: { isAvailable: true } })
    book = await createBook('Library fixture')
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    // Only ephemeral records belonging to this suite are removed from its isolated test database.
    if (!p) return
    for (const collection of ['book-ratings', 'book-deliveries', 'auth-accounts'] as const)
      await p.delete({ collection, where: { user: { in: owned.users } } })
    await states(p).deleteMany({
      $or: [{ user: { $in: owned.users } }, { _id: { $in: receiptIds } }],
    })
    for (const id of owned.books) await p.delete({ collection: 'books', id })
    for (const id of owned.categories.reverse()) await p.delete({ collection: 'categories', id })
    for (const id of owned.files) await p.delete({ collection: 'files', id })
    for (const id of owned.users) await p.delete({ collection: 'users', id })
  })
  it('rejects cycles, missing parents, deleting referenced categories and exposing hidden ancestors', async () => {
    const root = await category(),
      child = await category(root)
    const staged = await category(),
      destination = await category()
    await p.update({
      collection: 'categories',
      id: staged,
      user: editor,
      draft: true,
      data: { parent: destination, _status: 'draft' },
    })
    await p.update({
      collection: 'categories',
      id: destination,
      user: editor,
      data: { parent: staged },
    })
    await expect(
      p.update({
        collection: 'categories',
        id: staged,
        user: editor,
        data: { _status: 'published' },
      }),
    ).rejects.toThrow(/cycle/)
    expect(
      (await p.findByID({ collection: 'categories', id: staged, depth: 0 })).parent ?? null,
    ).toBeNull()
    await p.update({
      collection: 'categories',
      id: staged,
      user: editor,
      data: { parent: null, _status: 'published' },
    })
    await expect(
      p.update({ collection: 'categories', id: root, data: { parent: root } }),
    ).rejects.toThrow(/cycle/)
    await expect(
      p.update({ collection: 'categories', id: root, data: { parent: child } }),
    ).rejects.toThrow(/cycle/)
    await expect(
      p.update({
        collection: 'categories',
        id: child,
        data: { parent: '111111111111111111111111' },
      }),
    ).rejects.toThrow()
    await expect(p.delete({ collection: 'categories', id: root })).rejects.toThrow(/dependent/)
    const b = await createBook('Categorized')
    await p.update({
      collection: 'books',
      id: b,
      user: editor,
      draft: true,
      data: { categories: [child], _status: 'draft' },
    })
    await expect(p.delete({ collection: 'categories', id: child })).rejects.toThrow(/dependent/)
    await p.update({
      collection: 'categories',
      id: root,
      user: editor,
      draft: true,
      data: { name: 'Staged', _status: 'draft' },
    })
    expect(
      await p.findByID({ ...options, collection: 'categories', id: root, draft: true }),
    ).toMatchObject({ name: 'Category' })
    await p.update({
      collection: 'categories',
      id: root,
      user: editor,
      data: { _status: 'draft' },
      draft: false,
    })
    await expect(
      p.findByID({ ...options, collection: 'categories', id: child, draft: true }),
    ).rejects.toMatchObject({ status: 404 })
    for (const slug of ['categories', 'books'] as const)
      expect(p.collections[slug].config.flattenedFields.some((f) => f.name === 'order')).toBe(false)
  })
  it.each(['books', 'teachings', 'hymns'] as const)(
    'preserves %s applicability for live references and latest saved drafts',
    async (collection) => {
      const id = await category()
      const allTypes = [collection, 'articles'] as const
      await p.update({ collection: 'categories', id, data: { contentTypes: [...allTypes] } })
      const data = {
        title: 'Applicability fixture',
        slug: randomUUID(),
        _status: 'published' as const,
      }
      const content =
        collection === 'books'
          ? { id: await createBook(data.title) }
          : collection === 'hymns'
            ? await p.create({
                collection,
                data: { ...data, kind: 'general', lyrics: { english: 'Fixture' } },
              })
            : await p.create({
                collection,
                data: {
                  ...data,
                  content: {
                    root: {
                      type: 'root',
                      direction: null,
                      format: '',
                      indent: 0,
                      version: 1,
                      children: [
                        {
                          type: 'paragraph',
                          version: 1,
                          children: [{ type: 'text', version: 1, text: 'Fixture' }],
                        },
                      ],
                    },
                  },
                },
              })
      const contentID = content.id
      const update = (categories: string[], draft = false) =>
        p.update({
          collection,
          id: contentID,
          draft,
          data: { categories, _status: draft ? 'draft' : 'published' },
        })
      const removeType = () =>
        p.update({
          collection: 'categories',
          id,
          user: editor,
          ...options,
          data: { contentTypes: ['articles'] },
        })
      try {
        await update([id])
        await update([], true)
        await expect(removeType()).rejects.toThrow(
          new RegExp(`Cannot remove ${collection} applicability`),
        )
        expect((await p.findByID({ collection, id: contentID, depth: 0 })).categories).toEqual([id])
        await update([])
        await update([id], true)
        await expect(removeType()).rejects.toThrow(
          new RegExp(`Cannot remove ${collection} applicability`),
        )
        expect(
          (await p.findByID({ ...options, collection, id: contentID, user: editor, draft: true }))
            .categories,
        ).toEqual([id])
        await update([], true)
        expect((await removeType()).contentTypes).toEqual(['articles'])
      } finally {
        if (collection !== 'books') await p.delete({ collection, id: contentID })
      }
    },
  )

  it('rechecks a staged category restriction when publishing after a concurrent book assignment', async () => {
    const id = await category()
    const b = await createBook('New assignment')
    await p.update({
      collection: 'categories',
      id,
      draft: true,
      data: { contentTypes: ['hymns'], _status: 'draft' },
    })
    const publish = () => p.update({ collection: 'categories', id, data: { _status: 'published' } })
    const transactionID = await p.db.beginTransaction()
    if (transactionID == null) throw new Error('Transaction required')
    const req = await createLocalReq({ req: { transactionID } }, p)
    try {
      await p.update({ collection: 'books', id: b, req, data: { categories: [id] } })
      // The assignment already holds the category lock but is still invisible outside this session.
      await expect(publish()).rejects.toThrow()
      await p.db.commitTransaction(transactionID)
    } catch (error) {
      await p.db.rollbackTransaction(transactionID)
      throw error
    }
    await expect(publish()).rejects.toThrow(/books/)
    expect((await p.findByID({ collection: 'categories', id })).contentTypes).toContain('books')
    expect((await p.findByID({ collection: 'books', id: b, depth: 0 })).categories).toEqual([id])
  })

  it('validates the effective file at status-only publication and keeps storage fields private', async () => {
    const replacement = await ingest('pending-approval.pdf', pdf(run + 'second'))
    const b = await createBook('Original title')
    await p.update({
      collection: 'books',
      id: b,
      user: editor,
      draft: true,
      data: { title: 'Unpublished title', file: replacement, _status: 'draft' },
    })
    await expect(
      p.update({ collection: 'books', id: b, user: editor, data: { _status: 'published' } }),
    ).rejects.toThrow(/ready/)
    const publicBook = await p.findByID({
      collection: 'books',
      id: b,
      overrideAccess: false,
      draft: true,
      depth: 3,
    })
    expect(publicBook).toMatchObject({
      title: 'Original title',
      authors: [{ name: 'Test Editor' }],
    })
    expect(publicBook).not.toHaveProperty('file')
    expect(publicBook).not.toHaveProperty('files')
    expect(JSON.stringify(publicBook)).not.toMatch(
      /private-file|private-unique|telegram|pending-approval/,
    )
    const response = await rest(
      new Request('http://localhost/api/books/' + b + '?draft=true&depth=3'),
      { params: Promise.resolve({ slug: ['books', b] }) },
    )
    expect(response.status).toBe(200)
    const metadata = await response.json()
    expect(metadata.title).toBe('Original title')
    expect(metadata).not.toHaveProperty('file')
    expect(metadata).not.toHaveProperty('files')
    const gql = await graphql(
      new Request('http://localhost/api/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: `{ Book(id:"${b}",draft:true){ title file { originalFilename } files { originalFilename } } }`,
        }),
      }),
    )
    const graph = await gql.json()
    expect(graph.data.Book.title).toBe('Original title')
    expect(graph.data.Book.file).toBeNull()
    expect(graph.data.Book.files ?? []).toEqual([])
    await expect(
      p.findByID({ ...options, collection: 'files', id: file, user: member }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(p.delete({ collection: 'files', id: replacement })).rejects.toThrow(/dependent/)
    await expect(
      p.update({ collection: 'books', id: book, data: { cover: '111111111111111111111111' } }),
    ).rejects.toThrow()
    const avatar = await p.db.create({
      collection: 'media',
      data: { purpose: 'avatar', owner: member.id, mimeType: 'image/png', alt: 'Test' },
    })
    try {
      await expect(
        p.update({ collection: 'books', id: book, user: admin, data: { cover: avatar.id } }),
      ).rejects.toThrow(/content image/)
    } finally {
      await p.db.deleteOne({ collection: 'media', where: { id: { equals: avatar.id } } })
    }
  })
  it('validates PDF bytes, records ingestion failures and safely retries a definite rejection', async () => {
    const bytes = pdf(run + 'retry')
    await expect(
      ingestBookPDF(p, member.id, 'book.pdf', bytes, 'application/pdf'),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      ingestBookPDF(p, editor.id, 'book.pdf', Buffer.from('bad'), 'application/pdf'),
    ).rejects.toThrow(/PDF/)
    mode = 'reject'
    try {
      await expect(ingest('book.pdf', bytes)).rejects.toMatchObject({ status: 502 })
    } finally {
      mode = 'ok'
    }
    const failed = (
      await p.find({
        collection: 'files',
        where: { originalFilename: { equals: 'book.pdf' }, ingestionStatus: { equals: 'failed' } },
      })
    ).docs[0]
    expect(failed?.telegram?.fileId).toBeFalsy()
    const id = await ingest('book.pdf', bytes)
    const n = calls.length
    expect(await ingest('book.pdf', bytes)).toBe(id)
    expect(calls.length).toBe(n)
  })
  it('accepts a raw staff upload and rejects oversized bodies and uncertain retries', async () => {
    const { token } = await p.login({
      collection: 'users',
      data: { email: editor.email, password },
    })
    const headers = {
      authorization: 'JWT ' + token,
      'content-type': 'application/pdf',
      'x-filename': 'web.pdf',
    }
    const ctx = { params: Promise.resolve({ action: 'upload' }) }
    const endpoint = 'http://localhost/api/library/upload'
    const oversized = await website(
      new Request(endpoint, {
        method: 'POST',
        headers: { ...headers, 'content-length': '4000001' },
        body: 'x',
      }),
      ctx,
    )
    expect(oversized.status).toBe(413)
    const response = await website(
      new Request(endpoint, {
        method: 'POST',
        headers,
        body: new Uint8Array(pdf(run + 'browser')),
      }),
      ctx,
    )
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(Object.keys(result)).toEqual(['id'])
    owned.files.add(result.id)
    storagePublic = true
    const before = calls.filter((c) => c.method === 'sendDocument').length
    try {
      await expect(
        ingest('wrong-destination.pdf', pdf(run + 'private-storage')),
      ).rejects.toMatchObject({ status: 503 })
    } finally {
      storagePublic = false
    }
    expect(calls.filter((c) => c.method === 'sendDocument')).toHaveLength(before)
    const refused = await p.find({
      collection: 'files',
      where: { originalFilename: { equals: 'wrong-destination.pdf' } },
    })
    owned.files.add(refused.docs[0].id)
    const bytes = pdf(run + 'ambiguous')
    mode = 'timeout'
    try {
      await expect(ingest('unknown.pdf', bytes)).rejects.toMatchObject({ status: 502 })
    } finally {
      mode = 'ok'
    }
    const unknown = (
      await p.find({
        collection: 'files',
        where: {
          originalFilename: { equals: 'unknown.pdf' },
          ingestionFailure: { equals: 'uncertain' },
        },
      })
    ).docs[0]
    owned.files.add(unknown.id)
    const count = calls.length
    await expect(ingest('unknown.pdf', bytes)).rejects.toMatchObject({ status: 409 })
    expect(calls).toHaveLength(count)
  })
  it('rejects approval of a replaced Telegram review and accepts the reloaded text', async () => {
    const sender = 113204
    const b = await createBook('Review revision fixture')
    await processLibraryUpdate(p, msg(start((await beginLink(p, other.id)).link), sender))
    await confirmLink(p, other.id, String(calls.at(-1)?.body.text).split(' ').pop()!)
    await processLibraryUpdate(p, msg(start((await issueTicket(p, other.id, b)).link), sender))
    const deliveryID = calls
      .at(-1)!
      .body.reply_markup!.inline_keyboard![0][0].callback_data.split(':')[2]
    const action = (choice: string) => processLibraryUpdate(p, callback(choice, sender, deliveryID))
    const write = async (text: string) => {
      await action('w')
      const prompt = calls.filter((c) => c.body.reply_markup?.force_reply).at(-1)!.message
      await processLibraryUpdate(p, msg(text, sender, { reply_to_message: { message_id: prompt } }))
    }
    await action('4')
    await write('First text')
    const {
      docs: [inspected],
    } = await p.find({
      ...options,
      collection: 'book-ratings',
      user: admin,
      where: { book: { equals: b } },
    })
    const digest = (text: string) => createHash('sha256').update(text).digest('hex')
    const oldHash = digest(inspected.review!)
    await write('Replacement text')
    const approve = (reviewHash?: string) =>
      p.update({
        ...options,
        collection: 'book-ratings',
        id: inspected.id,
        user: admin,
        data: { reviewStatus: 'published', reviewHash },
      })
    await expect(approve(oldHash)).rejects.toThrow(/reload/i)
    await expect(approve()).rejects.toThrow(/reload/i)

    const { token } = await createPayloadSessionForUser({ payload: p, user: admin })
    const headers = { 'content-type': 'application/json', cookie: 'payload-token=' + token }
    const adminSave = async (snapshot: typeof inspected) => {
      const form = new FormData()
      form.set('_payload', JSON.stringify({ ...snapshot, reviewStatus: 'published' }))
      return patch(
        new Request('http://localhost/api/book-ratings/' + snapshot.id, {
          method: 'PATCH',
          headers: { cookie: headers.cookie },
          body: form,
        }),
        { params: Promise.resolve({ slug: ['book-ratings', snapshot.id] }) },
      )
    }
    expect(inspected.reviewHash).toBe(oldHash)
    expect((await adminSave(inspected)).status).toBe(409)
    const restApproval = (reviewHash?: string) =>
      patch(
        new Request('http://localhost/api/book-ratings/' + inspected.id, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ reviewStatus: 'published', reviewHash }),
        }),
        { params: Promise.resolve({ slug: ['book-ratings', inspected.id] }) },
      )
    const graphApproval = async (reviewHash?: string) => {
      const response = await graphql(
        new Request('http://localhost/api/graphql', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query:
              'mutation($id:String!, $hash:String){updateBookRating(id:$id, data:{reviewStatus:published,reviewHash:$hash}){reviewStatus}}',
            variables: { id: inspected.id, hash: reviewHash },
          }),
        }),
      )
      return response.json()
    }
    for (const hash of [oldHash, undefined]) {
      const rejected = await restApproval(hash)
      expect(rejected.status).toBe(409)
      expect((await rejected.json()).errors[0].message).toMatch(/reload/i)
      expect((await graphApproval(hash)).errors[0].message).toMatch(/reload/i)
    }
    expect((await publicBookReviews(p, b)).reviews).toEqual([])
    expect(await publicBookStatistics(p, b)).toMatchObject({
      ratingCount: 1,
      averageRating: 4,
      approvedReviewCount: 0,
    })
    const current = await p.findByID({
      ...options,
      collection: 'book-ratings',
      id: inspected.id,
      user: admin,
    })
    expect(current).toMatchObject({
      review: 'Replacement text',
      reviewStatus: 'pending',
      reviewHash: digest('Replacement text'),
    })
    await action('2')
    expect((await graphApproval(current.reviewHash!)).data.updateBookRating.reviewStatus).toBe(
      'published',
    )
    expect((await publicBookReviews(p, b)).reviews).toEqual([
      { score: 2, review: 'Replacement text' },
    ])
    await write('Reviewed again')
    expect((await publicBookReviews(p, b)).reviews).toEqual([])
    const reloaded = await p.findByID({
      ...options,
      collection: 'book-ratings',
      id: inspected.id,
      user: admin,
    })
    expect(reloaded.review).toBe('Reviewed again')
    expect((await adminSave(reloaded)).status).toBe(200)
    await action('5')
    expect((await publicBookReviews(p, b)).reviews).toEqual([
      { score: 5, review: 'Reviewed again' },
    ])
  })

  it('requires a website session, authentic webhook, private chat and website confirmation of Telegram proof', async () => {
    const request = new Request('http://localhost/api/library/ticket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ book }),
    })
    expect((await website(request, { params: Promise.resolve({ action: 'ticket' }) })).status).toBe(
      401,
    )
    expect(
      (
        await webhook(
          new Request('http://localhost/api/telegram/webhook', { method: 'POST', body: '{}' }),
        )
      ).status,
    ).toBe(403)
    const { link } = await beginLink(p, member.id)
    const forwarded = msg(start(link), wrong)
    await processLibraryUpdate(p, forwarded)
    const proof = String(calls.at(-1)?.body.text).split(' ').pop()!
    await expect(confirmLink(p, other.id, proof)).rejects.toMatchObject({ status: 403 })
    await expect(confirmLink(p, member.id, 'forged')).rejects.toMatchObject({ status: 403 })
    await expect(issueTicket(p, member.id, book)).rejects.toMatchObject({ status: 403 })
    const fresh = await beginLink(p, member.id)
    await processLibraryUpdate(p, msg(start(fresh.link)))
    const code = String(calls.at(-1)?.body.text).split(' ').pop()!
    await confirmLink(p, member.id, code)
    await expect(confirmLink(p, member.id, code)).rejects.toMatchObject({ status: 403 })
  })
  it('keeps Google-only website accounts accessible after linking Telegram', async () => {
    const reader = await p.create({
      collection: 'users',
      data: {
        email: randomUUID() + '@example.test',
        name: 'Linked reader',
        password: randomUUID(),
        hasPassword: false,
        role: 'member',
      },
    })
    owned.users.push(reader.id)
    await p.create({
      collection: 'auth-accounts',
      data: { user: reader.id, provider: 'google', providerAccountId: randomUUID() },
    })
    await p.create({
      collection: 'auth-accounts',
      data: { user: reader.id, provider: 'telegram', providerAccountId: 'test-' + randomUUID() },
    })
    const { token } = await createPayloadSessionForUser({ payload: p, user: reader })
    const response = await unlinkGoogle(
      new Request('http://localhost/api/auth/google/unlink', {
        method: 'POST',
        headers: { cookie: 'payload-token=' + token },
      }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('only login method')
  })

  it('delivers only the requested file once per ticket and counts only confirmed sends', async () => {
    expect(await publicBookStatistics(p, book)).toEqual({
      ratingCount: 0,
      averageRating: null,
      approvedReviewCount: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      uniqueRecipientCount: 0,
      successfulDeliveryCount: 0,
    })
    const ticket = await issueTicket(p, member.id, book)
    const count = () => calls.filter((c) => c.method === 'sendDocument' && !c.body.upload).length
    const before = count()
    await processLibraryUpdate(p, msg(start(ticket.link), wrong))
    expect(count()).toBe(before)
    const request = msg(start(ticket.link))
    await processLibraryUpdate(p, request)
    const sent = calls.at(-1)!
    const stored = await p.findByID({ collection: 'files', id: file })
    expect(sent.body).toMatchObject({ chat_id: String(tid), document: stored.telegram?.fileId })
    expect(sent.body).not.toHaveProperty('protect_content')
    delivery = String(sent.body.reply_markup!.inline_keyboard![0][0].callback_data).split(':')[2]
    await processLibraryUpdate(p, request)
    await processLibraryUpdate(p, msg(start(ticket.link)))
    expect(count()).toBe(before + 1)
    for (const outcome of ['reject', 'timeout', 'ok'] as const) {
      const next = await issueTicket(p, member.id, book)
      const update = msg(start(next.link))
      mode = outcome
      try {
        await processLibraryUpdate(p, update)
      } finally {
        mode = 'ok'
      }
      await processLibraryUpdate(p, update)
    }
    expect(await publicBookStatistics(p, book)).toMatchObject({
      successfulDeliveryCount: 2,
      uniqueRecipientCount: 1,
    })
    for (const state of ['failed', 'uncertain'] as const)
      expect(
        (
          await p.count({
            collection: 'book-deliveries',
            where: { book: { equals: book }, state: { equals: state } },
          })
        ).totalDocs,
      ).toBe(1)
    await expect(p.delete({ collection: 'users', id: member.id })).rejects.toThrow(/dependent/)
    await expect(p.delete({ collection: 'books', id: book })).rejects.toThrow(/dependent/)
  })
  it('rechecks expiry, account, book revision, publication and file availability', async () => {
    const b = await createBook('Changing')
    async function denied(change: () => Promise<unknown>) {
      const { link } = await issueTicket(p, member.id, b),
        before = calls.filter((c) => c.method === 'sendDocument').length
      await change()
      await processLibraryUpdate(p, msg(start(link)))
      expect(calls.filter((c) => c.method === 'sendDocument')).toHaveLength(before)
    }
    await denied(() =>
      p.db.collections['book-deliveries'].updateMany(
        { book: b },
        { $set: { expiresAt: new Date(0) } },
      ),
    )
    await denied(() => p.update({ collection: 'books', id: b, data: { title: 'Edited' } }))
    await denied(() => p.update({ collection: 'users', id: member.id, data: { isActive: false } }))
    await expect(issueTicket(p, member.id, b)).rejects.toMatchObject({ status: 403 })
    await p.update({ collection: 'users', id: member.id, data: { isActive: true } })
    await denied(() => p.update({ collection: 'files', id: file, data: { isAvailable: false } }))
    await p.update({ collection: 'files', id: file, data: { isAvailable: true } })
    await denied(() =>
      p.update({ collection: 'books', id: b, draft: false, data: { _status: 'draft' } }),
    )
    await expect(publicBookStatistics(p, b)).rejects.toMatchObject({ status: 404 })
    await expect(publicBookReviews(p, b)).rejects.toMatchObject({ status: 404 })
  })
  it('binds rating and review edits to the delivered book and linked account; moderates and aggregates', async () => {
    await expect(
      p.create({
        ...options,
        collection: 'book-ratings',
        user: member,
        data: { book, user: other.id, score: 5, reviewStatus: 'published' },
      }),
    ).rejects.toMatchObject({ status: 403 })
    await processLibraryUpdate(p, callback('5', wrong))
    await processLibraryUpdate(p, callback('6'))
    expect((await publicBookStatistics(p, book)).ratingCount).toBe(0)
    await Promise.all([
      processLibraryUpdate(p, callback('3')),
      processLibraryUpdate(p, callback('4')),
    ])
    const update = callback('5')
    await processLibraryUpdate(p, update)
    await processLibraryUpdate(p, update)
    const rows = await p.find({
      collection: 'book-ratings',
      depth: 0,
      where: { book: { equals: book } },
    })
    expect(rows.docs).toMatchObject([{ book, user: member.id, score: 5 }])
    const id = rows.docs[0].id
    for (const score of [0, 1.5, 6])
      await expect(
        p.create({
          collection: 'book-ratings',
          data: { book, user: other.id, score, reviewStatus: 'pending' },
        }),
      ).rejects.toThrow()
    await expect(
      p.create({
        collection: 'book-ratings',
        data: { book, user: member.id, score: 1, reviewStatus: 'pending' },
      }),
    ).rejects.toThrow()
    async function prompt() {
      await processLibraryUpdate(p, callback('w'))
      return calls.filter((c) => c.body.reply_markup?.force_reply).at(-1)!.message
    }
    const first = await prompt()
    await processLibraryUpdate(p, msg('unrelated'))
    await processLibraryUpdate(
      p,
      msg('wrong user', wrong, { reply_to_message: { message_id: first } }),
    )
    await processLibraryUpdate(
      p,
      msg('caption', tid, { document: {}, reply_to_message: { message_id: first } }),
    )
    await processLibraryUpdate(p, msg('/cancel'))
    await processLibraryUpdate(p, msg('too late', tid, { reply_to_message: { message_id: first } }))
    let next = await prompt()
    await states(p).updateOne({ _id: 'review:' + tid }, { $set: { expiresAt: new Date(0) } })
    await processLibraryUpdate(p, msg('expired', tid, { reply_to_message: { message_id: next } }))
    expect((await p.findByID({ collection: 'book-ratings', id })).review).toBeFalsy()
    next = await prompt()
    const written = 'Literal <b>review</b>'
    await processLibraryUpdate(p, msg(written, tid, { reply_to_message: { message_id: next } }))
    expect(await publicBookReviews(p, book)).toEqual({ reviews: [], hasNextPage: false })
    expect(await publicBookStatistics(p, book)).toMatchObject({
      ratingCount: 1,
      averageRating: 5,
      approvedReviewCount: 0,
    })
    await p.update({
      ...options,
      collection: 'book-ratings',
      id,
      user: admin,
      data: {
        reviewStatus: 'published',
        reviewHash: createHash('sha256').update(written).digest('hex'),
        score: 1,
        review: 'rewritten',
        user: other.id,
      },
    })
    expect(await publicBookReviews(p, book)).toEqual({
      reviews: [{ score: 5, review: written }],
      hasNextPage: false,
    })
    expect((await publicBookStatistics(p, book)).approvedReviewCount).toBe(1)
    next = await prompt()
    await processLibraryUpdate(p, msg('Edited', tid, { reply_to_message: { message_id: next } }))
    await processLibraryUpdate(p, callback('2'))
    expect(await publicBookStatistics(p, book)).toMatchObject({
      ratingCount: 1,
      averageRating: 2,
      approvedReviewCount: 0,
      distribution: { 2: 1 },
    })
    await p.delete({ ...options, collection: 'book-ratings', id, user: admin })
    expect(await publicBookStatistics(p, book)).toMatchObject({
      ratingCount: 0,
      averageRating: null,
      approvedReviewCount: 0,
    })
  })
  it('accepts a review reply only for the currently prompted book', async () => {
    async function promptFor(book: string) {
      const { link } = await issueTicket(p, member.id, book)
      await processLibraryUpdate(p, msg(start(link)))
      const id = calls.at(-1)!.body.reply_markup!.inline_keyboard![0][0].callback_data.split(':')[2]
      await processLibraryUpdate(p, callback('4', tid, id))
      await processLibraryUpdate(p, callback('w', tid, id))
      return calls.filter((c) => c.body.reply_markup?.force_reply).at(-1)!.message
    }
    const first = await createBook('First review'),
      second = await createBook('Second review')
    const oldPrompt = await promptFor(first),
      current = await promptFor(second)
    await processLibraryUpdate(
      p,
      msg('Old prompt', tid, { reply_to_message: { message_id: oldPrompt } }),
    )
    await processLibraryUpdate(
      p,
      msg('Second book only', tid, { reply_to_message: { message_id: current } }),
    )
    const review = async (book: string) =>
      (await p.find({ collection: 'book-ratings', where: { book: { equals: book } }, depth: 0 }))
        .docs[0].review
    expect(await review(first)).toBeFalsy()
    expect(await review(second)).toBe('Second book only')
  })

  it('coordinates deletion with an uncommitted child and propagates database errors', async () => {
    const parent = await category()
    const transactionID = await p.db.beginTransaction()
    if (transactionID == null) throw new Error('Transaction required')
    const req = await createLocalReq({ req: { transactionID } }, p)
    try {
      const child = await p.create({
        collection: 'categories',
        req,
        data: {
          name: 'Child',
          slug: randomUUID(),
          parent,
          contentTypes: ['books'],
          _status: 'published',
        },
      })
      owned.categories.push(child.id)
      // The child is written and holds the parent write lock, but cannot yet be seen by another session.
      await expect(p.delete({ collection: 'categories', id: parent })).rejects.toThrow()
      await p.db.commitTransaction(transactionID)
    } catch (error) {
      await p.db.rollbackTransaction(transactionID)
      throw error
    }
    await expect(p.delete({ collection: 'categories', id: parent })).rejects.toThrow(/dependent/)
    const failure = new Error('Simulated database failure')
    const spy = vi
      .spyOn(p.db.collections['book-ratings'], 'aggregate')
      .mockImplementationOnce(() => {
        throw failure
      })
    try {
      await expect(publicBookStatistics(p, book)).rejects.toBe(failure)
    } finally {
      spy.mockRestore()
    }
  })
})
