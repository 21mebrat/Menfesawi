// Run on a trusted staff machine with the application's server configuration.
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { ingestBookPDF, STAFF_PDF_LIMIT } from '../src/lib/server/library/ingest'
async function main() {
  const [path, email] = process.argv.slice(2)
  if (!path || !email || process.stdin.isTTY)
    throw new Error('Pass the file and email as arguments and the password on standard input.')
  let password = ''
  for await (const chunk of process.stdin) password += chunk.toString()
  const p = await getPayload({ config })
  try {
    const { user } = await p.login({
      collection: 'users',
      data: { email, password: password.replace(/\r?\n$/, '') },
    })
    if (!user) throw new Error('Staff sign-in required.')
    const handle = await open(path, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > STAFF_PDF_LIMIT)
        throw new Error('Select a PDF of at most 50 MB.')
      const { id } = await ingestBookPDF(
        p,
        user.id,
        basename(path),
        await handle.readFile(),
        'application/pdf',
      )
      console.log('Files record', id)
    } finally {
      await handle.close()
    }
  } finally {
    await p.destroy()
  }
}
main().catch(() => {
  console.error(
    'Upload did not complete. Check staff access, size, configuration and the Files record.',
  )
  process.exitCode = 1
})
