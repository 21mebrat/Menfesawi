'use client'
import { BrandLogo } from '../BrandLogo'
import { useAdminTranslation } from '@/i18n/useAdminTranslation'

import { Dialog } from '@base-ui/react/dialog'
import { Tooltip } from '@base-ui/react/tooltip'
import { Link, useConfig, useNav, usePreferences, useWindowInfo } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import { formatAdminURL, PREFERENCE_KEYS } from 'payload/shared'
import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import type { AdminGroup, AdminItem } from './navigation'
import { Icon } from './icons'

function RailTip({ children, label }: { children: ReactElement; label: string }) {
  const id = useId()
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} aria-describedby={id} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" sideOffset={8} className="mf-tip-position">
          <Tooltip.Popup id={id} role="tooltip" className="mf-tip">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function Sidebar({ groups }: { groups: AdminGroup[] }) {
  const { config } = useConfig()
  const { t } = useAdminTranslation()
  const { hydrated, navOpen, setNavOpen, navRef } = useNav()
  const { breakpoints } = useWindowInfo()
  const { getPreference, setPreference } = usePreferences()
  const pathname = usePathname()
  const [preferenceLoaded, setPreferenceLoaded] = useState(false)
  const previousOpen = useRef<boolean | undefined>(undefined)
  const mobileTrigger = useRef<HTMLButtonElement | null>(null)
  const mobile = hydrated && breakpoints.s
  const compact = !mobile && !navOpen
  const mediumDesktop = hydrated && breakpoints.l && !breakpoints.s
  const admin = config.routes.admin
  const route = (path: `/${string}`) => formatAdminURL({ adminRoute: admin, path })
  const closeMobile = () => {
    if (mobile) setNavOpen(false)
  }

  // Payload persists its toggle above 1440px. Extend that same preference to our
  // smaller desktop rail, keeping transient mobile drawer state out of storage.
  useEffect(() => {
    let current = true
    setPreferenceLoaded(false)
    if (mediumDesktop) {
      void getPreference<{ open?: boolean }>(PREFERENCE_KEYS.NAV).then((pref) => {
        if (!current) return
        previousOpen.current = pref?.open ?? true
        setNavOpen(previousOpen.current)
        setPreferenceLoaded(true)
      })
    }
    return () => {
      current = false
    }
  }, [mediumDesktop, getPreference, setNavOpen])
  useEffect(() => {
    if (mediumDesktop && preferenceLoaded && previousOpen.current !== navOpen) {
      previousOpen.current = navOpen
      void setPreference(PREFERENCE_KEYS.NAV, { open: navOpen }, true)
    }
  }, [mediumDesktop, preferenceLoaded, navOpen, setPreference])

  // 3.93 renders the original mobile header trigger with tabIndex=-1. Keep that
  // single control keyboard-accessible and use it for the sheet's focus return.
  useEffect(() => {
    if (!mobile) return
    const trigger = document.querySelector<HTMLButtonElement>('.app-header__mobile-nav-toggler')
    if (!trigger) return
    mobileTrigger.current = trigger
    const tabIndex = trigger.tabIndex
    trigger.tabIndex = 0
    trigger.setAttribute('aria-haspopup', 'dialog')
    return () => {
      trigger.tabIndex = tabIndex
      trigger.removeAttribute('aria-haspopup')
      mobileTrigger.current = null
    }
  }, [mobile, pathname])

  const link = (href: string, label: string, icon: string, active: boolean) => {
    const element = (
      <Link
        href={href}
        className="mf-menu-link"
        prefetch={false}
        onClick={closeMobile}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
      >
        <Icon name={icon} />
        {!compact && <span>{label}</span>}
      </Link>
    )
    return compact ? <RailTip label={label}>{element}</RailTip> : element
  }
  const groupLinks = (items: AdminItem[]) =>
    items.map((item) => (
      <li key={item.slug}>
        {link(
          item.href,
          item.label,
          item.slug,
          pathname === item.href || pathname.startsWith(item.href + '/'),
        )}
      </li>
    ))
  const account = route(config.admin.routes.account)
  const heading = (label: string) => !compact && <h2 className="mf-side-label">{label}</h2>
  const contents = (
    <>
      <div className="mf-brand-row">
        <Link
          className="mf-brand"
          href={admin}
          prefetch={false}
          aria-label="Menfesawi"
          title="Menfesawi"
          onClick={closeMobile}
        >
          <span className="mf-emblem">
            <BrandLogo size={29} decorative />
          </span>
          {!compact && (
            <span>
              Menfesawi<small>{t('workspaceNav:administration')}</small>
            </span>
          )}
        </Link>
        {mobile && (
          <Dialog.Close className="mf-icon-button" aria-label={t('general:close')}>
            <Icon name="close" />
          </Dialog.Close>
        )}
      </div>
      <nav className="mf-navigation" aria-label={t('workspaceNav:navigation')} ref={navRef}>
        {heading(t('workspaceNav:adminWorkspace'))}
        {link(admin, t('workspaceNav:overview'), 'dashboard', pathname === admin)}
        {groups.map(({ id, items }) => {
          const active = items.some(
            (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
          )
          const label = t(`workspaceNav:${id}`)
          return compact ? (
            <ul key={id} className="mf-rail-group" aria-label={label}>
              {groupLinks(items)}
            </ul>
          ) : (
            <Collapsible
              key={id + String(active)}
              className="mf-group"
              defaultOpen={active || id === 'library' || id === 'teachings'}
            >
              <CollapsibleTrigger
                className="mf-group-trigger"
                disabled={!hydrated || (mediumDesktop && !preferenceLoaded)}
              >
                {label}
                <Icon name="next" size={14} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul aria-label={label}>{groupLinks(items)}</ul>
              </CollapsibleContent>
            </Collapsible>
          )
        })}
        {heading(t('workspaceNav:workspace'))}
        {link(account, t('workspaceNav:settings'), 'settings', pathname === account)}
        {link(route(config.admin.routes.logout), t('authentication:logOut'), 'logout', false)}
      </nav>
      <footer className="mf-sidebar-footer" hidden={compact}>
        <strong>{t('workspaceNav:footerTitle')}</strong>
        <p>{t('workspaceNav:footerText')}</p>
      </footer>
    </>
  )
  if (mobile)
    return (
      <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="mf-backdrop" />
          <Dialog.Popup className="mf-sidebar mf-sheet" finalFocus={mobileTrigger}>
            <Dialog.Title className="mf-sr">{t('workspaceNav:navigation')}</Dialog.Title>
            {contents}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    )
  return (
    <Tooltip.Provider delay={150}>
      <aside
        className="mf-sidebar mf-desktop"
        data-compact={compact}
        aria-busy={!hydrated || (mediumDesktop && !preferenceLoaded)}
      >
        {contents}
      </aside>
    </Tooltip.Provider>
  )
}
