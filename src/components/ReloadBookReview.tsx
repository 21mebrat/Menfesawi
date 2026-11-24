'use client'

import { Button, useTranslation } from '@payloadcms/ui'

export function ReloadBookReview() {
  const { i18n } = useTranslation()
  return (
    <Button type="button" buttonStyle="secondary" onClick={() => window.location.reload()}>
      {i18n.language === 'am' ? 'የአሁኑን አስተያየት ዳግም ጫን' : 'Reload current review'}
    </Button>
  )
}
