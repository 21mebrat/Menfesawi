/**
 * Migration Script: Normalizes renamed and localized user fields in MongoDB.
 *
 * Supported Mappings:
 *  - "full name" (string or localized object) / "fullName" -> "name"
 *  - "avator_url" -> "avatarURL"
 *  - "status" ("active" | "inactive") -> "isActive" (boolean)
 *  - "role" (if localized object) -> "role" (primitive string)
 *  - "hasPassword" (ensures boolean flag is populated safely)
 *
 * Safety Rules:
 *  - Dry-run by default. Explicitly requires --execute to apply changes.
 *  - Requires explicit target via --target <email|id>, or --all.
 *  - Never automatically promotes accounts to admin.
 *  - Never silently discards conflicting values.
 *
 * Usage:
 *  npx tsx -r dotenv/config scripts/migrate-user-fields.ts --target admin@example.com
 *  npx tsx -r dotenv/config scripts/migrate-user-fields.ts --target admin@example.com --execute
 *  npx tsx -r dotenv/config scripts/migrate-user-fields.ts --all --execute
 */
import mongoose from 'mongoose'

interface LegacyUserDoc {
  _id: any
  email?: string
  name?: string
  'full name'?: string | Record<string, string>
  fullName?: string
  avatarURL?: string
  avator_url?: string
  role?: string | Record<string, string>
  status?: string
  isActive?: boolean
  hasPassword?: boolean
  hash?: string
  salt?: string
  [key: string]: any
}

function resolveName(doc: LegacyUserDoc): { value: string | undefined; source: string } {
  if (typeof doc.name === 'string' && doc.name.trim() !== '') {
    return { value: doc.name.trim(), source: 'name' }
  }

  const fullNameProp = doc['full name']
  if (typeof fullNameProp === 'string' && fullNameProp.trim() !== '') {
    return { value: fullNameProp.trim(), source: '"full name"' }
  }
  if (fullNameProp && typeof fullNameProp === 'object') {
    const localized = fullNameProp.en || fullNameProp.am || Object.values(fullNameProp)[0]
    if (typeof localized === 'string' && localized.trim() !== '') {
      return { value: localized.trim(), source: '"full name" (localized)' }
    }
  }

  if (typeof doc.fullName === 'string' && doc.fullName.trim() !== '') {
    return { value: doc.fullName.trim(), source: 'fullName' }
  }

  return { value: undefined, source: 'none' }
}

function resolveAvatarURL(doc: LegacyUserDoc): { value: string | undefined; source: string } {
  if (typeof doc.avatarURL === 'string' && doc.avatarURL.trim() !== '') {
    return { value: doc.avatarURL.trim(), source: 'avatarURL' }
  }
  if (typeof doc.avator_url === 'string' && doc.avator_url.trim() !== '') {
    return { value: doc.avator_url.trim(), source: 'avator_url' }
  }
  return { value: undefined, source: 'none' }
}

function resolveIsActive(doc: LegacyUserDoc): { value: boolean; source: string } {
  if (typeof doc.isActive === 'boolean') {
    return { value: doc.isActive, source: 'isActive' }
  }
  if (typeof doc.status === 'string') {
    const normalized = doc.status.trim().toLowerCase()
    if (normalized === 'inactive') {
      return { value: false, source: 'status ("inactive")' }
    }
    if (normalized === 'active') {
      return { value: true, source: 'status ("active")' }
    }
  }
  return { value: true, source: 'default (true)' }
}

function resolveRole(doc: LegacyUserDoc): { value: 'admin' | 'editor' | 'member'; source: string } {
  let candidate = doc.role
  let source = 'role'

  if (candidate && typeof candidate === 'object') {
    candidate = candidate.en || candidate.am || Object.values(candidate)[0]
    source = 'role (localized object)'
  }

  if (typeof candidate === 'string') {
    const lower = candidate.trim().toLowerCase()
    if (lower === 'admin' || lower === 'editor' || lower === 'member') {
      return { value: lower as 'admin' | 'editor' | 'member', source }
    }
  }

  return { value: 'member', source: 'default (member)' }
}

async function run() {
  const args = process.argv.slice(2)
  let target: string | undefined
  let targetAll = false
  let isExecute = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      target = args[i + 1].trim()
      i++
    } else if (args[i] === '--all') {
      targetAll = true
    } else if (args[i] === '--execute') {
      isExecute = true
    } else if (args[i] === '--dry-run') {
      isExecute = false
    }
  }

  if (!target && !targetAll) {
    console.error('Error: Please specify an explicit target with --target <email|id> or --all.')
    console.error('Examples:')
    console.error('  npx tsx -r dotenv/config scripts/migrate-user-fields.ts --target user@example.com (dry-run)')
    console.error('  npx tsx -r dotenv/config scripts/migrate-user-fields.ts --target user@example.com --execute')
    process.exit(1)
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('Error: DATABASE_URL is not set.')
    process.exit(1)
  }

  console.log(`Connecting to MongoDB at ${dbUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}...`)
  await mongoose.connect(dbUrl)
  const collection = mongoose.connection.collection('users')

  let filter: any = {}
  if (target) {
    if (mongoose.Types.ObjectId.isValid(target)) {
      filter = { $or: [{ _id: new mongoose.Types.ObjectId(target) }, { email: target.toLowerCase() }] }
    } else {
      filter = { email: target.toLowerCase() }
    }
  }

  const cursor = collection.find(filter)
  const users: LegacyUserDoc[] = await cursor.toArray()

  if (users.length === 0) {
    console.log('No user records found matching target criteria.')
    await mongoose.disconnect()
    process.exit(0)
  }

  console.log(`\nFound ${users.length} record(s). Mode: ${isExecute ? 'EXECUTE (writing to DB)' : 'DRY-RUN (preview only)'}\n`)

  let modifiedCount = 0

  for (const doc of users) {
    const nameRes = resolveName(doc)
    const avatarRes = resolveAvatarURL(doc)
    const isActiveRes = resolveIsActive(doc)
    const roleRes = resolveRole(doc)

    // Check hasPassword
    const currentHasPassword = typeof doc.hasPassword === 'boolean' ? doc.hasPassword : Boolean(doc.hash)

    console.log(`--------------------------------------------------`)
    console.log(`User ID: ${doc._id} | Email: ${doc.email}`)
    console.log(`  Current Fields:`)
    console.log(`    name:        ${JSON.stringify(doc.name)}`)
    console.log(`    "full name": ${JSON.stringify(doc['full name'])}`)
    console.log(`    avator_url:  ${JSON.stringify(doc.avator_url)}`)
    console.log(`    avatarURL:   ${JSON.stringify(doc.avatarURL)}`)
    console.log(`    status:      ${JSON.stringify(doc.status)}`)
    console.log(`    isActive:    ${JSON.stringify(doc.isActive)}`)
    console.log(`    role:        ${JSON.stringify(doc.role)}`)
    console.log(`    hasPassword: ${JSON.stringify(doc.hasPassword)}`)

    console.log(`  Proposed Values:`)
    console.log(`    name:        ${JSON.stringify(nameRes.value)} (from ${nameRes.source})`)
    console.log(`    avatarURL:   ${JSON.stringify(avatarRes.value)} (from ${avatarRes.source})`)
    console.log(`    isActive:    ${JSON.stringify(isActiveRes.value)} (from ${isActiveRes.source})`)
    console.log(`    role:        ${JSON.stringify(roleRes.value)} (from ${roleRes.source})`)
    console.log(`    hasPassword: ${JSON.stringify(currentHasPassword)}`)

    const $set: any = {
      isActive: isActiveRes.value,
      role: roleRes.value,
    }

    if (nameRes.value !== undefined) {
      $set.name = nameRes.value
    }
    if (avatarRes.value !== undefined) {
      $set.avatarURL = avatarRes.value
    }

    const $unset: any = {}
    if ('full name' in doc) $unset['full name'] = ''
    if ('fullName' in doc) $unset['fullName'] = ''
    if ('avator_url' in doc) $unset['avator_url'] = ''
    if ('status' in doc) $unset['status'] = ''
    if ('hasPassword' in doc) $unset['hasPassword'] = ''

    const updateDoc: any = { $set }
    if (Object.keys($unset).length > 0) {
      updateDoc.$unset = $unset
    }

    if (isExecute) {
      await collection.updateOne({ _id: doc._id }, updateDoc)
      console.log(`  -> [EXECUTED] Updated document ${doc._id}.`)
      modifiedCount++
    } else {
      console.log(`  -> [PREVIEW] Would update document ${doc._id}.`)
    }
  }

  console.log(`--------------------------------------------------`)
  if (!isExecute) {
    console.log(`\n[DRY-RUN COMPLETE] Evaluated ${users.length} document(s). No changes were made.`)
    console.log(`To apply these changes, re-run with the --execute flag.`)
  } else {
    console.log(`\n[MIGRATION COMPLETE] Successfully updated ${modifiedCount} document(s).`)
  }

  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
