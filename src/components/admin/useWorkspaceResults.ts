'use client'

import { useConfig, useLocale } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import type { AdminItem } from './navigation'

const titleFields: Record<string, string> = {
  books: 'title',
  teachings: 'title',
  media: 'filename',
  files: 'originalFilename',
}

type Result = { id: string; title: string; collection: AdminItem; href: string; updatedAt: string }
type Failure = { source: string; reason: 'failed' | 'denied' | 'expired' }
type ResponseState = { key: string; rows: Result[]; failures: Failure[]; more: AdminItem[] }

async function candidates(
  api: string,
  collection: AdminItem,
  locale: string,
  term: string | undefined,
  limit: number,
  signal: AbortSignal,
) {
  const field = titleFields[collection.slug]
  const params = new URLSearchParams({
    depth: '0',
    limit: String(limit),
    sort: '-updatedAt,-id',
    ['select[' + field + ']']: 'true',
    'select[updatedAt]': 'true',
  })
  if (locale) params.set('locale', locale)
  if (term) params.set('where[' + field + '][contains]', term)
  if (collection.slug === 'books' || collection.slug === 'teachings') params.set('draft', 'true')
  const response = await fetch(api + '/' + collection.slug + '?' + params, {
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!response.ok) throw response.status
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || !('docs' in body) || !Array.isArray(body.docs))
    throw new Error('Invalid workspace response')
  const rows = body.docs.map((doc: unknown): Result => {
    if (
      !doc ||
      typeof doc !== 'object' ||
      !('id' in doc) ||
      typeof doc.id !== 'string' ||
      !('updatedAt' in doc) ||
      typeof doc.updatedAt !== 'string'
    )
      throw new Error('Invalid workspace record')
    const title: unknown = Reflect.get(doc, field)
    return {
      id: doc.id,
      title: typeof title === 'string' && title ? title : doc.id,
      collection,
      href: collection.href + '/' + encodeURIComponent(doc.id),
      updatedAt: doc.updatedAt,
    }
  })
  return { rows, hasNext: 'hasNextPage' in body && body.hasNextPage === true }
}

export function useWorkspaceResults(items: AdminItem[], open: boolean, query?: string) {
  const { config } = useConfig()
  const locale = useLocale()?.code
  const api = config.routes.api
  const term = query?.trim()
  const key = JSON.stringify([api, locale, term, items])
  const enabled = open && (term === undefined || !!term)
  const [response, setResponse] = useState<ResponseState>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) {
      setResponse(undefined)
      return
    }
    const controller = new AbortController()
    async function load() {
      // A global top N needs at most the first N candidates from each source,
      // sorted by the same timestamp and document ID as the final merge.
      const limit = term ? 12 : 4
      const sources = items.filter((item) => titleFields[item.slug])
      const batches = await Promise.allSettled(
        sources.map((source) => candidates(api, source, locale, term, limit, controller.signal)),
      )
      if (controller.signal.aborted) return
      const failures: Failure[] = []
      const rows: Result[] = []
      const overflow = new Set<AdminItem>()
      batches.forEach((batch, i) => {
        if (batch.status === 'fulfilled') {
          rows.push(...batch.value.rows)
          if (batch.value.hasNext) overflow.add(sources[i])
        } else {
          failures.push({
            source: sources[i].label,
            reason: batch.reason === 401 ? 'expired' : batch.reason === 403 ? 'denied' : 'failed',
          })
        }
      })
      rows.sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) ||
          b.id.localeCompare(a.id) ||
          a.collection.slug.localeCompare(b.collection.slug),
      )
      for (const row of rows.slice(limit)) overflow.add(row.collection)
      setResponse({
        key,
        rows: rows.slice(0, limit),
        failures,
        more: [...overflow].map((item) => {
          // Native list search also matches fields such as slug. Use its editable
          // WhereBuilder filter so the destination searches exactly the preview field.
          const params = new URLSearchParams({
            [`where[or][0][and][0][${titleFields[item.slug]}][contains]`]: term ?? '',
          })
          if (locale) params.set('locale', locale)
          return { ...item, href: item.href + '?' + params }
        }),
      })
    }
    const timer = window.setTimeout(load, term ? 250 : 0)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [api, items, locale, key, term, enabled, attempt])
  const current = enabled && response?.key === key ? response : undefined
  return {
    rows: current?.rows ?? [],
    failures: current?.failures ?? [],
    more: current?.more ?? [],
    loading: enabled && !current,
    retry: () => setAttempt((n) => n + 1),
  }
}
