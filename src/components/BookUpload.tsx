'use client'
import { useState, type FormEvent } from 'react'
import { useTranslation } from '@payloadcms/ui'

export function BookUpload() {
  const { i18n } = useTranslation()
  const am = i18n.language === 'am'
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = new FormData(event.currentTarget).get('pdf')
    if (!(file instanceof File) || file.size > 4000000) {
      setMessage(am ? 'ከ4 MB በላይ ለሆነ ፋይል CLI ይጠቀሙ።' : 'For PDFs above 4 MB use the staff CLI.')
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
      else setMessage(result.error ?? 'Upload failed')
    } catch {
      setMessage(am ? 'የፋይሉን ሁኔታ ያረጋግጡ።' : 'Check the Files list for the upload status.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit}>
      <label>
        {am ? 'የመጽሐፍ ፒዲኤፍ (4 MB)' : 'Book PDF (up to 4 MB)'}{' '}
        <input type="file" name="pdf" accept="application/pdf" required />
      </label>{' '}
      <button type="submit" disabled={busy}>
        {am ? 'ወደ Telegram ላክ' : 'Upload to Telegram'}
      </button>
      <p role="status">{message}</p>
    </form>
  )
}
