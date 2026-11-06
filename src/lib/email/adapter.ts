import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import type { EmailAdapter, SendEmailOptions } from 'payload'

export type CapturedEmail = {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  headers?: Record<string, string>
  timestamp: string
}

const capturedEmails: CapturedEmail[] = []
let simulatedFailuresRemaining = 0
let simulatedFailureMessage = 'Simulated SMTP connection timeout'

/**
 * Retrieves emails captured in non-production / test mode.
 */
export function getCapturedEmails(): CapturedEmail[] {
  return [...capturedEmails]
}

/**
 * Clears in-memory captured emails.
 */
export function clearCapturedEmails(): void {
  capturedEmails.length = 0
}

/**
 * Configure transient simulated email transmission failures for regression tests.
 */
export function setSimulatedEmailFailures(
  count: number,
  errorMessage = 'Simulated SMTP connection timeout',
): void {
  simulatedFailuresRemaining = count
  simulatedFailureMessage = errorMessage
}

/**
 * Returns the trusted public site URL configured for the environment.
 * Rejects any untrusted request Host header.
 */
export function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SERVER_URL || process.env.PAYLOAD_PUBLIC_SERVER_URL
  if (envUrl && typeof envUrl === 'string') {
    return envUrl.trim().replace(/\/+$/, '')
  }
  return 'http://localhost:3000'
}

/**
 * Checks whether SMTP credentials (MAIL_FROM and MAIL_PASS) are present and validly formatted,
 * or if running under captured test mode.
 */
export function isEmailConfigured(): boolean {
  if (isTestCaptureActive()) return true
  const mailFrom = process.env.MAIL_FROM?.trim()
  const mailPass = process.env.MAIL_PASS?.trim()
  return Boolean(mailFrom && mailPass)
}

/**
 * Checks if test capture mode is currently active.
 */
export function isTestCaptureActive(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.ENABLE_TEST_EMAIL_CAPTURE === 'true'
  )
}

/**
 * Checks recipient against non-production allowlist if defined.
 */
export function isRecipientAllowed(recipient: string): boolean {
  if (process.env.NODE_ENV === 'production') return true
  const allowlistEnv = process.env.AUTHORIZED_EMAIL_ALLOWLIST
  if (!allowlistEnv) return true // No restrictive allowlist configured

  const patterns = allowlistEnv.split(',').map((p) => p.trim().toLowerCase())
  const lowerRecipient = recipient.toLowerCase()

  return patterns.some((pattern) => {
    if (pattern.startsWith('*@')) {
      const domain = pattern.slice(2)
      return lowerRecipient.endsWith(`@${domain}`)
    }
    return lowerRecipient === pattern
  })
}

/**
 * Configures the Payload Email Adapter using @payloadcms/email-nodemailer and Gmail SMTP,
 * with non-production email safeguards and captured test mode.
 */
export async function getEmailAdapter(): Promise<EmailAdapter> {
  // 1. Non-production captured mode (isolated tests)
  if (isTestCaptureActive()) {
    return () => ({
      name: 'captured-test-email-adapter',
      defaultFromAddress: 'test-sender@ethiopiatraveljournal.com',
      defaultFromName: 'Ethiopia Travel Journal (Test)',
      sendEmail: async (options: SendEmailOptions) => {
        if (simulatedFailuresRemaining > 0) {
          simulatedFailuresRemaining--
          throw new Error(simulatedFailureMessage)
        }

        const toAddress = typeof options.to === 'string' ? options.to : String(options.to || '')
        if (!isRecipientAllowed(toAddress)) {
          console.warn(`[Email Safeguard] Blocked non-allowlisted recipient in test: ${toAddress}`)
          return { accepted: [], rejected: [toAddress] }
        }

        capturedEmails.push({
          to: options.to as any,
          subject: options.subject || '',
          html: typeof options.html === 'string' ? options.html : undefined,
          text: typeof options.text === 'string' ? options.text : undefined,
          headers: options.headers as any,
          timestamp: new Date().toISOString(),
        })

        return { accepted: [toAddress], rejected: [] }
      },
    })
  }

  // 2. Production Gmail SMTP via Nodemailer
  const mailFrom = process.env.MAIL_FROM?.trim()
  const mailPass = process.env.MAIL_PASS?.trim()

  if (mailFrom && mailPass) {
    const baseAdapter = await nodemailerAdapter({
      defaultFromAddress: mailFrom,
      defaultFromName: 'Ethiopia Travel Journal',
      transportOptions: {
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: mailFrom,
          pass: mailPass,
        },
      },
    })

    // Wrap with non-production allowlist check if configured
    if (process.env.AUTHORIZED_EMAIL_ALLOWLIST) {
      return ({ payload }) => {
        const initialized = baseAdapter({ payload })
        return {
          ...initialized,
          sendEmail: async (options: SendEmailOptions) => {
            const toAddress = typeof options.to === 'string' ? options.to : String(options.to || '')
            if (!isRecipientAllowed(toAddress)) {
              console.warn(
                `[Email Safeguard] Blocked non-allowlisted recipient: ${toAddress}`,
              )
              return { accepted: [], rejected: [toAddress] }
            }
            return initialized.sendEmail(options)
          },
        }
      }
    }

    return baseAdapter
  }

  // 3. Explicit unconfigured adapter: refuses to silently simulate successful delivery
  return () => ({
    name: 'unconfigured-nodemailer-adapter',
    defaultFromAddress: 'no-reply@ethiopiatraveljournal.com',
    defaultFromName: 'Ethiopia Travel Journal',
    sendEmail: async () => {
      const err = new Error(
        'Email transmission aborted: Missing SMTP credentials. Both MAIL_FROM and MAIL_PASS environment variables must be configured with a valid Gmail address and App Password.',
      )
      console.error('[Email Configuration Error]', err.message)
      throw err
    },
  })
}
