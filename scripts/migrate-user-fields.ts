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
 *  - Detects conflicts between canonical and legacy values.
 *  - Detects conflicting localized roles across locales.
 *  - Detects unknown or conflicting activation states.
 *  - Skips affected records without modifying or unsetting their legacy data.
 *
 * Usage:
 *  npx tsx -r dotenv/config scripts/migrate-user-fields.ts --target user@example.com (dry-run)
 *  npx tsx -r dotenv/config scripts/migrate-user-fields.ts --target user@example.com --execute
 *  npx tsx -r dotenv/config scripts/migrate-user-fields.ts --all (dry-run all)
 *  npx tsx -r dotenv/config scripts/migrate-user-fields.ts --all --execute
 */
import mongoose from 'mongoose'

export interface LegacyUserDoc {
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

export interface FieldResolution<T> {
  value: T
  source: string
  conflict?: string
}

export interface MigrationEvaluation {
  docId: string
  email: string
  hasConflict: boolean
  conflictReasons: string[]
  proposedSet: Record<string, any>
  proposedUnset: Record<string, string>
}

/**
 * Resolves the user's name, checking for conflicts between canonical and legacy names.
 */
export function resolveName(doc: LegacyUserDoc): FieldResolution<string | undefined> {
  const canonicalName = typeof doc.name === 'string' && doc.name.trim() !== '' ? doc.name.trim() : undefined

  let legacyFullName: string | undefined
  let legacySource: string | undefined

  const fnProp = doc['full name']
  if (typeof fnProp === 'string' && fnProp.trim() !== '') {
    legacyFullName = fnProp.trim()
    legacySource = '"full name"'
  } else if (fnProp && typeof fnProp === 'object') {
    const values = Object.entries(fnProp)
      .map(([lang, val]) => ({ lang, val: typeof val === 'string' ? val.trim() : '' }))
      .filter((v) => v.val !== '')

    if (values.length > 0) {
      // Check if localized full names conflict across locales
      const uniqueVals = Array.from(new Set(values.map((v) => v.val)))
      if (uniqueVals.length > 1) {
        return {
          value: undefined,
          source: '"full name" (localized)',
          conflict: `Conflicting localized full names: ${JSON.stringify(fnProp)}`,
        }
      }
      legacyFullName = values[0].val
      legacySource = `"full name" (${values[0].lang})`
    }
  }

  if (!legacyFullName && typeof doc.fullName === 'string' && doc.fullName.trim() !== '') {
    legacyFullName = doc.fullName.trim()
    legacySource = 'fullName'
  }

  // Conflict detection: both canonical and legacy exist and differ
  if (canonicalName && legacyFullName && canonicalName !== legacyFullName) {
    return {
      value: canonicalName,
      source: 'name',
      conflict: `Conflicting canonical name (${JSON.stringify(canonicalName)}) vs legacy ${legacySource} (${JSON.stringify(legacyFullName)})`,
    }
  }

  if (canonicalName) {
    return { value: canonicalName, source: 'name' }
  }

  if (legacyFullName) {
    return { value: legacyFullName, source: legacySource || 'legacy' }
  }

  return { value: undefined, source: 'none' }
}

/**
 * Resolves avatar URL, checking for conflicts between avatarURL and avator_url.
 */
export function resolveAvatarURL(doc: LegacyUserDoc): FieldResolution<string | undefined> {
  const canonical = typeof doc.avatarURL === 'string' && doc.avatarURL.trim() !== '' ? doc.avatarURL.trim() : undefined
  const legacy = typeof doc.avator_url === 'string' && doc.avator_url.trim() !== '' ? doc.avator_url.trim() : undefined

  if (canonical && legacy && canonical !== legacy) {
    return {
      value: canonical,
      source: 'avatarURL',
      conflict: `Conflicting canonical avatarURL (${JSON.stringify(canonical)}) vs legacy avator_url (${JSON.stringify(legacy)})`,
    }
  }

  if (canonical) {
    return { value: canonical, source: 'avatarURL' }
  }
  if (legacy) {
    return { value: legacy, source: 'avator_url' }
  }
  return { value: undefined, source: 'none' }
}

/**
 * Resolves isActive, detecting unknown status values and conflicts between isActive and status.
 */
export function resolveIsActive(doc: LegacyUserDoc): FieldResolution<boolean | undefined> {
  const hasIsActive = typeof doc.isActive === 'boolean'
  const canonicalActive = hasIsActive ? doc.isActive : undefined

  let legacyActive: boolean | undefined
  let legacyStatusStr: string | undefined

  if (typeof doc.status === 'string') {
    legacyStatusStr = doc.status.trim().toLowerCase()
    if (legacyStatusStr === 'active') {
      legacyActive = true
    } else if (legacyStatusStr === 'inactive') {
      legacyActive = false
    } else {
      // Unknown status string
      return {
        value: undefined,
        source: 'status',
        conflict: `Unknown activation status value: "${doc.status}" (expected "active" or "inactive")`,
      }
    }
  }

  // Conflict check: both canonical isActive and legacy status are present and conflict
  if (canonicalActive !== undefined && legacyActive !== undefined && canonicalActive !== legacyActive) {
    return {
      value: canonicalActive,
      source: 'isActive',
      conflict: `Conflicting canonical isActive (${canonicalActive}) vs legacy status ("${doc.status}")`,
    }
  }

  if (canonicalActive !== undefined) {
    return { value: canonicalActive, source: 'isActive' }
  }

  if (legacyActive !== undefined) {
    return { value: legacyActive, source: `status ("${legacyStatusStr}")` }
  }

  return { value: true, source: 'default (true)' }
}

/**
 * Resolves user role, detecting conflicting localized roles and invalid role values.
 */
export function resolveRole(doc: LegacyUserDoc): FieldResolution<'admin' | 'editor' | 'member' | undefined> {
  const candidate = doc.role

  if (candidate && typeof candidate === 'object') {
    const rolesByLang = Object.entries(candidate).map(([lang, val]) => ({
      lang,
      val: typeof val === 'string' ? val.trim().toLowerCase() : '',
    }))

    const validRoles = rolesByLang.filter((r) => ['admin', 'editor', 'member'].includes(r.val))
    const uniqueRoles = Array.from(new Set(validRoles.map((r) => r.val)))

    if (uniqueRoles.length > 1) {
      return {
        value: undefined,
        source: 'role (localized object)',
        conflict: `Conflicting localized roles across locales: ${JSON.stringify(candidate)}`,
      }
    }

    if (uniqueRoles.length === 1) {
      return {
        value: uniqueRoles[0] as 'admin' | 'editor' | 'member',
        source: `role (localized object: ${uniqueRoles[0]})`,
      }
    }

    return {
      value: undefined,
      source: 'role (localized object)',
      conflict: `No valid role found in localized role object: ${JSON.stringify(candidate)}`,
    }
  }

  if (typeof candidate === 'string') {
    const lower = candidate.trim().toLowerCase()
    if (lower === 'admin' || lower === 'editor' || lower === 'member') {
      return { value: lower as 'admin' | 'editor' | 'member', source: 'role' }
    }
    return {
      value: undefined,
      source: 'role',
      conflict: `Invalid role string: "${candidate}" (expected "admin", "editor", or "member")`,
    }
  }

  // Default to member if no role is declared
  return { value: 'member', source: 'default (member)' }
}

/**
 * Evaluates a single user record for migration.
 * Identifies any conflicts, computes proposed $set and $unset, or skips if conflicts exist.
 */
export function evaluateUserRecord(doc: LegacyUserDoc): MigrationEvaluation {
  const nameRes = resolveName(doc)
  const avatarRes = resolveAvatarURL(doc)
  const isActiveRes = resolveIsActive(doc)
  const roleRes = resolveRole(doc)

  const conflicts: string[] = []
  if (nameRes.conflict) conflicts.push(nameRes.conflict)
  if (avatarRes.conflict) conflicts.push(avatarRes.conflict)
  if (isActiveRes.conflict) conflicts.push(isActiveRes.conflict)
  if (roleRes.conflict) conflicts.push(roleRes.conflict)

  const evaluation: MigrationEvaluation = {
    docId: String(doc._id),
    email: doc.email || '(no email)',
    hasConflict: conflicts.length > 0,
    conflictReasons: conflicts,
    proposedSet: {},
    proposedUnset: {},
  }

  if (evaluation.hasConflict) {
    // If conflict detected, DO NOT propose any sets or unsets. Preserve all data intact.
    return evaluation
  }

  if (nameRes.value !== undefined) {
    evaluation.proposedSet.name = nameRes.value
  }
  if (avatarRes.value !== undefined) {
    evaluation.proposedSet.avatarURL = avatarRes.value
  }
  if (isActiveRes.value !== undefined) {
    evaluation.proposedSet.isActive = isActiveRes.value
  }
  if (roleRes.value !== undefined) {
    evaluation.proposedSet.role = roleRes.value
  }

  // Preserve hasPassword flag if present, or determine from hash
  const hasPasswordVal = typeof doc.hasPassword === 'boolean' ? doc.hasPassword : Boolean(doc.hash)
  evaluation.proposedSet.hasPassword = hasPasswordVal

  // Clean up legacy fields only on clean, non-conflicting records
  if ('full name' in doc) evaluation.proposedUnset['full name'] = ''
  if ('fullName' in doc) evaluation.proposedUnset['fullName'] = ''
  if ('avator_url' in doc) evaluation.proposedUnset['avator_url'] = ''
  if ('status' in doc) evaluation.proposedUnset['status'] = ''

  return evaluation
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
    console.error('  npx tsx -r dotenv/config scripts/migrate-user-fields.ts --all (dry-run all)')
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

  let updatedCount = 0
  let skippedCount = 0

  for (const doc of users) {
    const evaluation = evaluateUserRecord(doc)

    console.log(`--------------------------------------------------`)
    console.log(`User ID: ${evaluation.docId} | Email: ${evaluation.email}`)

    if (evaluation.hasConflict) {
      console.log(`  -> [SKIPPED DUE TO CONFLICTS]:`)
      for (const reason of evaluation.conflictReasons) {
        console.log(`     * ${reason}`)
      }
      console.log(`  -> Document was NOT modified. Legacy data preserved untouched.`)
      skippedCount++
      continue
    }

    console.log(`  Proposed Updates:`)
    console.log(`    $set:   ${JSON.stringify(evaluation.proposedSet)}`)
    console.log(`    $unset: ${JSON.stringify(evaluation.proposedUnset)}`)

    if (isExecute) {
      const updateDoc: any = { $set: evaluation.proposedSet }
      if (Object.keys(evaluation.proposedUnset).length > 0) {
        updateDoc.$unset = evaluation.proposedUnset
      }
      await collection.updateOne({ _id: doc._id }, updateDoc)
      console.log(`  -> [EXECUTED] Updated document ${doc._id}.`)
      updatedCount++
    } else {
      console.log(`  -> [PREVIEW] Would update document ${doc._id}.`)
      updatedCount++
    }
  }

  console.log(`--------------------------------------------------`)
  console.log(`\nSummary:`)
  console.log(`  Total Evaluated: ${users.length}`)
  console.log(`  Clean Records:   ${updatedCount}`)
  console.log(`  Skipped/Conflict: ${skippedCount}`)

  if (!isExecute) {
    console.log(`\n[DRY-RUN COMPLETE] No changes were made to the database.`)
    console.log(`To apply changes to clean records, re-run with explicit approval flag: --execute`)
  } else {
    console.log(`\n[MIGRATION COMPLETE] Successfully updated ${updatedCount} document(s).`)
  }

  await mongoose.disconnect()
}

// Only execute CLI runner if executed directly
if (process.argv[1] && process.argv[1].endsWith('migrate-user-fields.ts')) {
  run().catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
}
