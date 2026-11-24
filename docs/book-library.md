# Book library operations

## Configuration

Server environment names

- `DATABASE_URL`
- `PAYLOAD_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_STORAGE_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET`

Use the existing transaction-enabled MongoDB replica set. The storage ID identifies the private group or channel. Give the bot permission to post documents there. Files stores each document's Telegram message ID, file ID and unique file ID. Keep the bot identity stable because file IDs belong to the receiving bot.

Inspect the bot's existing webhook configuration before rollout. Telegram supports one webhook per bot. If another deployment handles updates for this bot, integrate routing there before switching it. Configure HTTPS delivery to `/api/telegram/webhook` for `message` and `callback_query` updates with Telegram's `secret_token` set to the configured webhook secret. The handler checks the Telegram secret header before reading the update and accepts user commands only from private chats. Outbound social announcements continue using their existing destinations. [Telegram setWebhook](https://core.telegram.org/bots/api#setwebhook)

## Staff PDF ingestion

In Payload Admin, open **Files**, select a PDF and choose **Upload to Telegram**. This uses an authenticated POST to `/api/library/upload` with the PDF as the raw body, `Content-Type: application/pdf` and a percent-encoded filename in `X-Filename`. Before uploading, the server checks the destination with Telegram, including the discussion group if a storage channel forwards posts there. The server bounds the stream, checks the filename, media type, PDF header and EOF marker, and uploads in memory. A confirmed Telegram response creates a ready record. Open it, record distribution permission and enable availability before publishing the book. File bytes and Telegram storage metadata are immutable through the ordinary editor API. The format checks do not scan for malware.

Browser uploads accept up to **4,000,000 bytes**. Vercel Hobby's function request limit is 4.5 MB. The larger opt-in body limit requires a paid plan. Telegram's hosted Bot API accepts document uploads up to 50 MB. [Vercel Functions limits](https://vercel.com/docs/functions/limitations#request-body-size) · [Telegram sendDocument](https://core.telegram.org/bots/api#senddocument)

For larger PDFs, use the staff CLI on a trusted operator machine with the server configuration and database connectivity. It authenticates the named active staff account with its website password on standard input, reads the supplied local PDF, and uploads directly to the configured Telegram storage chat. The application ceiling is **50,000,000 bytes**. For example, on Linux:

```sh
systemd-ask-password 'Menfesawi staff password' | node --import tsx scripts/ingest-book-pdf.ts /path/to/book.pdf staff@example.org
```

Both paths fingerprint the exact bytes and reserve one Files record before sending. A repeat of a ready upload reuses it. A definite Telegram rejection allows retry. An ambiguous response or a crash can leave a failed-uncertain or pending record. Inspect the storage chat and reconcile the verified message with that record under operator approval before retrying. Neither path creates temporary disk copies. Downloads go directly through Telegram.

## Website handoff and feedback

Use the existing website session or Payload JWT. Send same-origin POST requests with JSON bodies. The API returns handoff links with `Cache-Control: no-store`. Treat them as transient credentials and omit them from application logs.

1. POST `/api/library/link` with `{}`. Open the returned link in the intended private bot chat. Enter the code received there into the signed-in website session via POST `/api/library/confirm` with `{"proof":"…"}`. Challenges last ten minutes. The first Telegram claimant receives the code. If the link was forwarded, start a fresh challenge. The website must confirm using the same account that requested it.
2. POST `/api/library/ticket` with `{"book":"<public book ID>"}`. Open the returned link within five minutes. The browser session authorizes this handoff. Telegram establishes the sender's identity in its own chat and has no access to the website login.
3. The bot checks the linked identity, active website account, live book revision, primary file and distribution availability. It claims the ticket in MongoDB, then sends one document using that file's Telegram ID. The user receives the PDF in private chat with saving enabled. Earlier files can remain in chat, and recipients can share downloaded copies.

The score buttons and **Write review** action refer to the confirmed delivery. The bot rechecks the linked reader, delivery ownership and live book. A member chooses a score before writing a review. Review input must be a text reply to the specific bot prompt in the same private chat within ten minutes. A new prompt replaces the previous one. Use `/cancel` to discard it. Keep review text as plain text in clients, including when it contains markup characters.

## Moderation and public statistics

Active admins can moderate review visibility and remove abusive ratings in **Book Ratings**. Scores are integers from 1 through 5. Reviews accept up to 1,500 UTF-16 code units. Editing review text returns it to pending. Changing only the score preserves moderation status. Individual ratings and their user associations are private. Public reviews expose only the approved text and score.

The admin approval form sends the hash of the review it displayed. A conflict (HTTP 409) means the moderator must choose **Reload current review**, read the text, select **published**, and save again. REST, GraphQL, and Local API callers must read `review` and `reviewHash` together and submit that same `reviewHash` with the approval. The hash is SHA-256 of the exact UTF-8 text. It is computed on read for existing ratings and requires no backfill. Score changes alone preserve approval.

Use GET `/api/library/statistics?book=<id>` and `/api/library/reviews?book=<id>&page=1`, or the server helpers `publicBookStatistics` and `publicBookReviews`. Both check live publication before reading private records. Reviews are paginated in stable ID order, 25 per page. Statistics aggregate current rows inside a transaction. The score counts independently of pending or hidden text. Disabled accounts retain prior contributions and historical deliveries. Removing a rating removes its score and text from the aggregates immediately. An empty distribution has five zero buckets and a null average.

Label the successful count **Telegram deliveries**. Each distinct intentionally requested ticket can contribute one confirmed send. Unique recipients count distinct website accounts with a confirmed send. Neither metric measures on-device download completion. A delivery conveys no proof that the book was read.

## Recovery, retention and rollout

A pending ticket is checked for expiry on every redemption. Claiming a valid ticket atomically changes it to uncertain and commits the webhook receipt before contacting Telegram. A confirmed response changes it to sent. A definite rejection changes it to failed. Network ambiguity, a process crash or a failed database confirmation can leave it uncertain. Preserve that evidence and do not automatically resend. A member may intentionally request another ticket. Duplicate Telegram update IDs are recorded in the private `library_bot_state` collection. A lost link-code or review-prompt response can be recovered by requesting a new challenge or prompt.

Delivery history and webhook update receipts are retained. Pending review and link state has an application-enforced expiry. After an approved index rollout, an `expiresAt` TTL index on `library_bot_state` can reclaim expired challenges and prompts. Receipts have no expiry field. Category, book, file and account deletion checks use transaction write locks. Current live references and latest saved drafts block category/file deletion. Ratings, deliveries and retained Telegram links block deletion of their respective parent records. Disable accounts or withdraw file availability to suspend access. Removing a book never deletes shared Media or Files. Historical versions are retained under the existing version policy and validated again when restored or published.

Before removing a category's Books, Teachings, or Hymns applicability, remove its assignments from both live content and latest saved drafts for that collection. The category editor checks these references again when publishing a saved draft.

Before enabling this release, take a backup and run the following **read-only** checks in the intended database. The compound unique rating index belongs on `book` and `user`. Also inspect existing indexes on `book-deliveries` and `auth-accounts`, including ticket-hash uniqueness and the existing unique provider identity index. MongoDB's usual collection and field names are shown below.

```js
db.getCollection('book-ratings').aggregate([
  { $group: { _id: { book: '$book', user: '$user' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $count: 'duplicatePairs' }
])
db.getCollection('book-ratings').countDocuments({ $or: [{ book: null }, { user: null }] })
db.getCollection('book-deliveries').aggregate([
  { $group: { _id: '$ticketHash', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }, { $count: 'duplicateTicketHashes' }
])
db.categories.countDocuments({ _status: { $exists: false } })
db.books.countDocuments({ file: null, 'files.1': { $exists: true } })
db.files.countDocuments({ ingestionStatus: { $exists: false } })
```

Stop rollout if duplicates, malformed relationships, or incompatible indexes exist. Inventory the affected records privately, agree on ownership, moderation and retention with an administrator, rehearse the approved repair on a copy, then verify and build the indexes before enabling writes. No automatic record deletion or reconciliation is included. Run the preflight **before** starting a configuration that builds indexes automatically.

Existing category applicability, book languages, author rows and the legacy `books.files` list are preserved. Neither schema contains an order field. Review pre-versioned categories and explicitly publish the intended public hierarchy. A legacy book with exactly one PDF can use it as primary once its readiness is established. Publishing writes the canonical `file` reference. Books with multiple legacy files require an editor to select the primary. Legacy Files without verified ingestion state require re-ingestion or an approved, evidence-based backfill of the stored message and file metadata. Retain original records and audit their references before changing them.
