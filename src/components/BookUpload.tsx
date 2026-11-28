'use client'

import { useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState, type FormEvent } from 'react'
import { useAdminTranslation } from '@/i18n/useAdminTranslation'
import { WEB_PDF_LIMIT } from '@/lib/library/pdfLimits'

export function BookUpload() {
  const { t } = useAdminTranslation()
  const { config } = useConfig()
  const router = useRouter()
  const help = useId()
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Parameters<typeof t>[0] | null>(null)
  const [readyId, setReadyId] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current) return
    const form = event.currentTarget
    const file = new FormData(form).get('pdf')
    setReadyId('')
    if (!(file instanceof File) || !file.size || !/\.pdf$/i.test(file.name)) {
      setError('workspaceEditors:badPDF')
      return
    }
    if (file.size > WEB_PDF_LIMIT) {
      setError('workspaceEditors:size')
      return
    }
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/library/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'x-filename': encodeURIComponent(file.name) },
        body: file,
      })
      if (res.ok) {
        const result = await res.json()
        if (typeof result?.id !== 'string' || !result.id) throw new Error()
        setReadyId(result.id)
        form.reset()
        router.refresh()
      } else {
        switch (res.status) {
          case 401:
            setError('workspaceSearch:expired')
            break
          case 403:
            setError('workspaceEditors:restricted')
            break
          case 413:
            setError('workspaceEditors:size')
            break
          case 400:
          case 415:
            setError('workspaceEditors:badPDF')
            break
          case 502: {
            const result = await res.json()
            setError(
              result?.outcome === 'rejected' ? 'bookEditor:rejected' : 'bookEditor:uncertain',
            )
            break
          }
          case 409:
            setError('workspaceEditors:conflict')
            break
          default:
            setError('bookEditor:uncertain')
        }
      }
    } catch {
      setError('bookEditor:uncertain')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <form className="book-upload" onSubmit={submit}>
      <label>
        {t('workspaceEditors:pdf')}
        <input
          type="file"
          name="pdf"
          accept="application/pdf"
          required
          disabled={busy}
          aria-describedby={help}
          onChange={() => {
            setReadyId('')
            setError(null)
          }}
        />
      </label>
      <p className="book-upload__help" id={help}>
        {t('bookEditor:limits')}
      </p>
      <div className="book-upload__actions">
        <button type="submit" disabled={busy}>
          {t('workspaceEditors:send')}
        </button>
        {readyId && (
          <a
            href={formatAdminURL({
              adminRoute: config.routes.admin,
              path: `/collections/files/${encodeURIComponent(readyId)}`,
            })}
          >
            {t('bookEditor:openFile')}
          </a>
        )}
      </div>
      <p role="status">{busy ? t('bookEditor:uploading') : readyId && t('bookEditor:uploaded')}</p>
      {error && <p role="alert">{t(error)}</p>}
    </form>
  )
}
