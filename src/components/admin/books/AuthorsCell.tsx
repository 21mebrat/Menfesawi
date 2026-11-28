'use client'

import { Link, useConfig } from '@payloadcms/ui'
import type { ArrayFieldClient, DefaultCellComponentProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import type { Book } from '@/payload-types'

export function AuthorsCell({
  cellData,
  collectionSlug,
  link,
  linkURL,
  onClick,
  rowData,
}: DefaultCellComponentProps<ArrayFieldClient, Book['authors']>) {
  const { config } = useConfig()
  const names = cellData
    ?.map((author) => author.name)
    .filter(Boolean)
    .join(', ')
  if (!names) return null
  if (onClick)
    return (
      <button type="button" onClick={() => onClick({ cellData, collectionSlug, rowData })}>
        {names}
      </button>
    )
  if (link)
    return (
      <Link
        href={
          linkURL ??
          formatAdminURL({
            adminRoute: config.routes.admin,
            path: `/collections/books/${encodeURIComponent(rowData.id)}`,
          })
        }
      >
        {names}
      </Link>
    )
  return <span>{names}</span>
}
