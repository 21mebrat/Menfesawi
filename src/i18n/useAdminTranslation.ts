'use client'
import { useTranslation } from '@payloadcms/ui'
import type { NestedKeysStripped } from '@payloadcms/translations'
import type { enWorkspace } from './en'

export const useAdminTranslation = useTranslation<
  typeof enWorkspace,
  NestedKeysStripped<typeof enWorkspace>
>
