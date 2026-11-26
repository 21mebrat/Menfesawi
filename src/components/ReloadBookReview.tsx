'use client'
import { useAdminTranslation } from '@/i18n/useAdminTranslation'

import { Button } from '@payloadcms/ui'

export function ReloadBookReview() {
  const { t } = useAdminTranslation()
  return (
    <Button type="button" buttonStyle="secondary" onClick={() => window.location.reload()}>
      {t('workspaceEditors:reloadReview')}
    </Button>
  )
}
