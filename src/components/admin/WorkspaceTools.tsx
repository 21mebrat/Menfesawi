'use client'
import { useAdminTranslation } from '@/i18n/useAdminTranslation'

import { Dialog } from '@base-ui/react/dialog'
import { Popover } from '@base-ui/react/popover'
import { getTranslation } from '@payloadcms/translations'
import { Link, useConfig, useLocale } from '@payloadcms/ui'
import { useRef, useState } from 'react'
import { ThemeAction } from './ThemeAction'
import { Icon } from './icons'
import type { AdminItem } from './navigation'

import { useWorkspaceResults } from './useWorkspaceResults'

function Failures({ preview }: { preview: ReturnType<typeof useWorkspaceResults> }) {
  const { t } = useAdminTranslation()
  if (!preview.failures.length) return null
  return (
    <div role="alert">
      {(['expired', 'denied', 'failed'] as const).map((reason) => {
        const sources = preview.failures.filter((f) => f.reason === reason).map((f) => f.source)
        return sources.length ? (
          <p key={reason}>{t(`workspaceSearch:${reason}`, { sources: sources.join(', ') })}</p>
        ) : null
      })}
      <button type="button" onClick={preview.retry}>
        {t('workspaceSearch:retry')}
      </button>
    </div>
  )
}

export function WorkspaceTools({ items }: { items: AdminItem[] }) {
  const { t, languageOptions, i18n, switchLanguage } = useAdminTranslation()
  const {
    config: { localization },
  } = useConfig()
  const contentLocale = useLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const needle = query.trim().toLocaleLowerCase()
  const matches = (value: string) => value.toLocaleLowerCase().includes(needle)
  const collections = items.filter((item) => matches(item.label) || matches(item.slug))
  const [noticesOpen, setNoticesOpen] = useState(false)
  const search = useWorkspaceResults(items, open, query)
  const notices = useWorkspaceResults(items, noticesOpen)
  const loading = t('general:loading')
  const title = t('workspaceSearch:title')
  return (
    <div className="mf-tools">
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setQuery('')
        }}
      >
        <Dialog.Trigger className="mf-search-trigger" aria-label={title}>
          <Icon name="search" size={22} />
          <span>{t('workspaceSearch:trigger')}</span>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="mf-backdrop mf-search-backdrop" />
          <Dialog.Popup className="mf-search-dialog" initialFocus={input}>
            <header>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Close className="mf-tool" aria-label={t('general:close')}>
                <Icon name="close" />
              </Dialog.Close>
            </header>
            <label className="mf-search-field">
              <Icon name="search" />
              <input
                ref={input}
                type="search"
                maxLength={120}
                value={query}
                placeholder={t('workspaceSearch:placeholder')}
                aria-label={title}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="mf-result-list">
              {search.loading && <p role="status">{loading}</p>}
              <Failures preview={search} />
              {search.rows.length > 0 && (
                <>
                  <h3>{t('workspaceSearch:results')}</h3>
                  {search.rows.map((row) => (
                    <Link
                      href={row.href}
                      key={row.href}
                      className="mf-result"
                      prefetch={false}
                      onClick={() => setOpen(false)}
                    >
                      <Icon name={row.collection.slug} />
                      <div>
                        {row.title}
                        <small>{row.collection.label}</small>
                      </div>
                    </Link>
                  ))}
                </>
              )}
              {search.more.length > 0 && (
                <div>
                  <p role="status">{t('workspaceSearch:more')}</p>
                  {search.more.map((item) => (
                    <Link
                      key={item.slug}
                      className="mf-result"
                      prefetch={false}
                      onClick={() => setOpen(false)}
                      href={item.href}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
              {collections.length > 0 && (
                <>
                  <h3>{t('general:collections')}</h3>
                  {collections.map((item) => (
                    <Link
                      key={item.slug}
                      href={item.href}
                      prefetch={false}
                      className="mf-result"
                      onClick={() => setOpen(false)}
                    >
                      <Icon name={item.slug} />
                      {item.label}
                    </Link>
                  ))}
                </>
              )}
              {!search.loading &&
                !search.failures.length &&
                !search.rows.length &&
                !collections.length && <p role="status">{t('workspaceSearch:empty')}</p>}
            </div>
            <Dialog.Description>{t('workspaceSearch:description')}</Dialog.Description>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {switchLanguage && languageOptions.length > 1 && (
        <select
          className="mf-tool mf-language"
          aria-label={t('workspaceNav:interfaceLanguage')}
          value={i18n.language}
          onChange={({ currentTarget: { value } }) => {
            const language = languageOptions.find((option) => option.value === value)
            if (language) {
              void switchLanguage(language.value)
              return
            }
            const locale =
              localization && localization.locales.find(({ code }) => value === `content-${code}`)
            if (locale) {
              // Open the same editor in the selected locale, honoring its beforeunload guard.
              const url = new URL(window.location.href)
              url.searchParams.set('locale', locale.code)
              window.location.assign(url.href)
            }
          }}
        >
          <optgroup label={t('workspaceNav:interfaceLanguage')}>
            {languageOptions.map(({ label, value }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </optgroup>
          {localization && (
            <optgroup label={t('general:locale')}>
              {localization.locales.map(({ code, label }) => (
                <option
                  key={code}
                  value={`content-${code}`}
                  disabled={code === contentLocale?.code}
                >
                  {getTranslation(label, i18n)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
      <ThemeAction />
      <Popover.Root open={noticesOpen} onOpenChange={setNoticesOpen}>
        <Popover.Trigger className="mf-tool" aria-label={t('workspaceSearch:notices')}>
          <Icon name="bell" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} align="end" className="mf-popup-layer">
            <Popover.Popup className="mf-notice">
              <Popover.Title>{t('workspaceSearch:notices')}</Popover.Title>
              <Popover.Description>{t('workspaceSearch:latest')}</Popover.Description>
              {notices.loading && <p role="status">{loading}</p>}
              <Failures preview={notices} />
              {notices.rows.map((row) => (
                <Link
                  key={row.href}
                  href={row.href}
                  prefetch={false}
                  className="mf-result"
                  onClick={() => setNoticesOpen(false)}
                >
                  <Icon name={row.collection.slug} />
                  <div>
                    {row.title}
                    <small>{row.collection.label}</small>
                  </div>
                </Link>
              ))}
              {!notices.loading && !notices.failures.length && !notices.rows.length && (
                <p>{t('workspaceMetrics:empty')}</p>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
