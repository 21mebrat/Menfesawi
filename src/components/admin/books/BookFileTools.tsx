'use client'

import { useAuth, useConfig, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useEffect, useState } from 'react'
import { useAdminTranslation } from '@/i18n/useAdminTranslation'
import type { File as LibraryFile } from '@/payload-types'

type Status = 'lookup' | 'enabled' | 'disabled' | 'notReady' | 'lookupFailed'

function FileStatus({ id }: { id: string }) {
  const { t } = useAdminTranslation()
  const { config } = useConfig()
  const [status, setStatus] = useState<Status>('lookup')
  const [attempt, setAttempt] = useState(0)
  const api = config.routes.api
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const url = formatAdminURL({ apiRoute: api, path: `/files/${encodeURIComponent(id)}` })
        const res = await fetch(
          url + '?depth=0&select[ingestionStatus]=true&select[isAvailable]=true',
          {
            cache: 'no-store',
            signal: controller.signal,
          },
        )
        if (!res.ok) throw new Error()
        const file: Pick<LibraryFile, 'isAvailable' | 'ingestionStatus'> = await res.json()
        if (!controller.signal.aborted)
          setStatus(
            file.ingestionStatus !== 'ready'
              ? 'notReady'
              : file.isAvailable
                ? 'enabled'
                : 'disabled',
          )
      } catch {
        if (!controller.signal.aborted) setStatus('lookupFailed')
      }
    }
    void load()
    return () => controller.abort()
  }, [api, id, attempt])
  return (
    <div className="book-tools__links">
      <span role="status">{t(`bookEditor:${status}`)}</span>
      <button
        type="button"
        disabled={status === 'lookup'}
        onClick={() => {
          setStatus('lookup')
          setAttempt((n) => n + 1)
        }}
      >
        {t('bookEditor:refresh')}
      </button>
    </div>
  )
}

export function BookFileTools() {
  const { t } = useAdminTranslation()
  const { config } = useConfig()
  const { permissions } = useAuth()
  const { id } = useDocumentInfo()
  const file = useFormFields(([fields]) => fields.file?.value)
  const legacy = useFormFields(([fields]) => fields.files?.value)
  const primary = file || (Array.isArray(legacy) && legacy.length === 1 ? legacy[0] : undefined)
  const list = (slug: string) =>
    formatAdminURL({ adminRoute: config.routes.admin, path: `/collections/${slug}` })
  const bookFilter = new URLSearchParams()
  if (id) bookFilter.set('where[or][0][and][0][book][equals]', String(id))
  const reviews = new URLSearchParams(bookFilter)
  reviews.set('where[or][0][and][1][reviewStatus][equals]', 'pending')
  reviews.set('where[or][0][and][2][review][exists]', 'true')
  reviews.set('where[or][0][and][3][review][not_equals]', '')
  const sends = new URLSearchParams(bookFilter)
  sends.set('where[or][0][and][1][state][equals]', 'sent')
  const ratings = permissions?.collections?.['book-ratings']?.read
  const deliveries = permissions?.collections?.['book-deliveries']?.read
  return (
    <div className="book-tools">
      {permissions?.collections?.files?.read && (
        <>
          {typeof primary === 'string' && primary && <FileStatus key={primary} id={primary} />}
          <a href={list('files')} target="_blank" rel="noopener noreferrer">
            {t('bookEditor:filesLink')}
          </a>
        </>
      )}
      {id && (ratings || deliveries) && (
        <nav aria-label={t('bookEditor:activity')} className="book-tools__links">
          <strong>{t('bookEditor:activity')}</strong>
          {ratings && (
            <>
              <a href={list('book-ratings') + '?' + bookFilter}>{t('bookEditor:ratings')}</a>
              <a href={list('book-ratings') + '?' + reviews}>{t('bookEditor:pending')}</a>
            </>
          )}
          {deliveries && <a href={list('book-deliveries') + '?' + sends}>{t('bookEditor:sent')}</a>}
        </nav>
      )}
    </div>
  )
}
