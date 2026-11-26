'use client'
import { useAdminTranslation } from '@/i18n/useAdminTranslation'
import { useTheme } from '@payloadcms/ui'
import { Icon } from './icons'

export function ThemeAction() {
  const { theme, setTheme } = useTheme()
  const { t } = useAdminTranslation()
  const next = theme === 'dark' ? 'light' : 'dark'
  const label = t(next === 'light' ? 'workspaceNav:light' : 'workspaceNav:dark')
  return (
    <button
      type="button"
      className="mf-theme"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      <Icon name={next} />
    </button>
  )
}
