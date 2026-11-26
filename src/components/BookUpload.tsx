'use client'
import { useAdminTranslation } from '@/i18n/useAdminTranslation'
import { useState, type FormEvent } from 'react'

export function BookUpload() {
  const { t } = useAdminTranslation()
  const [message, setMessage] = useState<Parameters<typeof t>[0] | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = new FormData(event.currentTarget).get('pdf')
    if (!(file instanceof File) || file.size > 4000000) {
      setMessage('workspaceEditors:size')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/library/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'x-filename': encodeURIComponent(file.name) },
        body: file,
      })
      const result = await res.json()
      if (res.ok)
        window.location.assign('/admin/collections/files/' + encodeURIComponent(result.id))
      else {
        switch (res.status) {
          case 401:
            setMessage('workspaceSearch:expired')
            break
          case 403:
            setMessage('workspaceEditors:restricted')
            break
          case 413:
            setMessage('workspaceEditors:size')
            break
          case 400:
          case 415:
            setMessage('workspaceEditors:badPDF')
            break
          case 409:
            setMessage('workspaceEditors:conflict')
            break
          default:
            setMessage('workspaceEditors:check')
        }
      }
    } catch {
      setMessage('workspaceEditors:check')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit}>
      <label>
        {t('workspaceEditors:pdf')}{' '}
        <input type="file" name="pdf" accept="application/pdf" required />
      </label>{' '}
      <button type="submit" disabled={busy}>
        {t('workspaceEditors:send')}
      </button>
      <p role="status">{message && t(message)}</p>
    </form>
  )
}
