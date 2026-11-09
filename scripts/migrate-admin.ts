/**
 * Server-only administrator migration CLI script.
 *
 * Targets an explicitly supplied existing user ID or email to assign the 'admin' role.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/migrate-admin.ts --email <admin-email>
 *   npx tsx -r dotenv/config scripts/migrate-admin.ts --id <admin-id>
 */
import configPromise from '../src/payload.config'
import { getPayload } from 'payload'

interface UserSummary {
  id: string | number
  email?: string
  name?: string
  role?: string
  isActive?: boolean
  hasPassword?: boolean
}

async function run() {
  const args = process.argv.slice(2)
  let targetEmail: string | undefined
  let targetId: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      targetEmail = args[i + 1].trim().toLowerCase()
      i++
    } else if (args[i] === '--id' && args[i + 1]) {
      targetId = args[i + 1].trim()
      i++
    }
  }

  if (!targetEmail && !targetId) {
    console.error('Error: Please provide --email <email> or --id <user-id>.')
    console.error('Example: npx tsx -r dotenv/config scripts/migrate-admin.ts --email admin@example.com')
    process.exit(1)
  }

  console.log('Connecting to database and initializing Payload...')
  const config = await configPromise
  const payload = await getPayload({ config })

  // Find user by email or ID
  let user: any = null

  if (targetId) {
    try {
      user = await payload.findByID({
        collection: 'users',
        id: targetId,
        overrideAccess: true, // Migration CLI requires full server access
        showHiddenFields: true,
      })
    } catch {
      user = null
    }
  } else if (targetEmail) {
    const result = await payload.find({
      collection: 'users',
      where: {
        email: {
          equals: targetEmail,
        },
      },
      limit: 1,
      overrideAccess: true, // Migration CLI requires full server access
      showHiddenFields: true,
    })
    user = result.docs[0] || null
  }

  if (!user) {
    console.error(`User not found with ${targetEmail ? `email: ${targetEmail}` : `ID: ${targetId}`}`)
    process.exit(1)
  }

  // Display user information safely without revealing credentials
  const summary: UserSummary = {
    id: user.id,
    email: user.email,
    name: user.name || '(not set)',
    role: user.role || '(not set)',
    isActive: user.isActive !== false,
    hasPassword: Boolean(user.hash),
  }

  console.log('Target account found:')
  console.log(`  ID:           ${summary.id}`)
  console.log(`  Email:        ${summary.email}`)
  console.log(`  Name:         ${summary.name}`)
  console.log(`  Current Role: ${summary.role}`)
  console.log(`  Active:       ${summary.isActive}`)
  console.log(`  Has Password: ${summary.hasPassword}`)

  if (user.role === 'admin' && user.isActive === true) {
    console.log(`\nAccount ${user.email} already has the 'admin' role and is active. No changes made.`)
    process.exit(0)
  }

  console.log(`\nPromoting account ${user.email} to 'admin'...`)
  const updated = await payload.update({
    collection: 'users',
    id: user.id,
    data: {
      role: 'admin',
      isActive: true,
    },
    overrideAccess: true,
  })

  console.log(`Successfully assigned 'admin' role to ${updated.email} (ID: ${updated.id}).`)
  process.exit(0)
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
