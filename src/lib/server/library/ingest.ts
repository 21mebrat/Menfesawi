import type { Payload } from 'payload'
import { isStaff } from '@/access'
import { isJsonObject } from '../social/telegram'
import { duplicate, fail } from './coordination'
import {
  hash,
  telegram,
  botCredential,
  storageChat,
  verifyStorageChat,
  messageId,
  TelegramFailure,
} from './telegram'

export const WEB_PDF_LIMIT = 4_000_000
export const STAFF_PDF_LIMIT = 50_000_000
export async function ingestBookPDF(
  payload: Payload,
  userId: string,
  filename: string,
  bytes: Buffer,
  mime: string,
) {
  const user = await payload.findByID({ collection: 'users', id: userId, depth: 0 })
  if (!isStaff(user)) return fail('Active staff account required.', 403)
  if (bytes.length > STAFF_PDF_LIMIT)
    return fail('PDF exceeds the 50 MB Telegram upload limit.', 413)
  if (
    !/^[^/\\\x00-\x1f]{1,250}\.pdf$/i.test(filename) ||
    mime !== 'application/pdf' ||
    !/^%PDF-(1\.\d|2\.0)/.test(bytes.subarray(0, 9).toString('ascii')) ||
    !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))
  )
    return fail('Select a PDF document with a valid header and EOF marker.')
  botCredential()
  const chat = storageChat()
  const digest = hash(bytes),
    id = digest.slice(0, 24)
  const model = payload.db.collections.files
  let claimed = false
  try {
    const inserted = await model.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          originalFilename: filename,
          mimeType: mime,
          sizeBytes: bytes.length,
          isAvailable: false,
          ingestionStatus: 'pending',
          ingestKey: digest,
        },
      },
      { upsert: true },
    )
    claimed = !!inserted.upsertedCount
  } catch (error) {
    if (!duplicate(error)) throw error
  }
  if (!claimed) {
    const existing = await payload.findByID({ collection: 'files', id, depth: 0 })
    if (existing.ingestKey !== digest) return fail('File identity conflict.', 409)
    if (existing.ingestionStatus === 'ready') return { id }
    const result = await model.updateOne(
      { _id: id, ingestKey: digest, ingestionStatus: 'failed', ingestionFailure: 'rejected' },
      { $set: { ingestionStatus: 'pending' }, $unset: { ingestionFailure: 1 } },
    )
    if (!result.modifiedCount)
      return fail(
        'Upload already claimed. Check the storage message before retrying an unknown outcome.',
        409,
      )
  }
  try {
    await verifyStorageChat(chat)
  } catch (error) {
    // getChat is read-only. No upload has been attempted, so retry is safe.
    await model.updateOne(
      { _id: id, ingestionStatus: 'pending' },
      { $set: { ingestionStatus: 'failed', ingestionFailure: 'rejected' } },
    )
    if (error instanceof TelegramFailure)
      return fail('Could not verify private Telegram storage.', 502)
    throw error
  }
  const form = new FormData()
  form.set('chat_id', chat)
  form.set('document', new Blob([new Uint8Array(bytes)], { type: mime }), filename)
  try {
    const sent = await telegram('sendDocument', form)
    const msg = messageId(sent)
    const doc = isJsonObject(sent) && sent.document
    if (
      !isJsonObject(sent) ||
      !isJsonObject(sent.chat) ||
      String(sent.chat.id) !== chat ||
      !isJsonObject(doc) ||
      typeof doc.file_id !== 'string' ||
      typeof doc.file_unique_id !== 'string' ||
      !doc.file_id ||
      !doc.file_unique_id
    )
      throw new TelegramFailure(true)
    const stored = await model.updateOne(
      { _id: id, ingestionStatus: 'pending' },
      {
        $set: {
          ingestionStatus: 'ready',
          telegram: { messageId: msg, fileId: doc.file_id, fileUniqueId: doc.file_unique_id },
        },
      },
    )
    if (!stored.modifiedCount) return fail('Upload record changed before confirmation.', 409)
    return { id }
  } catch (error) {
    if (!(error instanceof TelegramFailure)) throw error
    await model.updateOne(
      { _id: id, ingestionStatus: 'pending' },
      {
        $set: {
          ingestionStatus: 'failed',
          ingestionFailure: error.uncertain ? 'uncertain' : 'rejected',
        },
      },
    )
    return fail(error.message, 502)
  }
}
