'use client'

import { Menu } from '@base-ui/react/menu'
import { getTranslation } from '@payloadcms/translations'
import {
  DefaultListView,
  Link,
  SelectAll,
  SelectRow,
  Table,
  useAuth,
  useConfig,
  useDocumentDrawer,
  useListDrawerContext,
  useListQuery,
  useNav,
} from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { CollectionSlug, Column, ListViewClientProps, PaginatedDocs } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { useAdminTranslation } from '@/i18n/useAdminTranslation'
import { Icon } from './icons'

const statusFields = ['_status', 'reviewStatus', 'ingestionStatus', 'status', 'state']

function RecordActions({
  slug,
  id,
  title,
  onOpen,
}: {
  slug: CollectionSlug
  id: string
  title: string
  onOpen: (id: string) => void
}) {
  const { t } = useAdminTranslation()
  const { config } = useConfig()
  const { permissions } = useAuth()
  const url = formatAdminURL({
    adminRoute: config.routes.admin,
    path: `/collections/${slug}/${encodeURIComponent(id)}`,
  })
  const label = t('directory:openRecord', { title })
  return (
    <div className="mu-row-actions">
      <Link className="mu-icon" href={url} aria-label={label} title={label} prefetch={false}>
        <Icon name={permissions?.collections?.[slug]?.update ? 'edit' : 'files'} size={17} />
      </Link>
      <Menu.Root>
        <Menu.Trigger className="mu-icon" aria-label={t('directory:rowActions', { title })}>
          <Icon name="more" size={17} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="mf-popup-layer" align="end" sideOffset={6}>
            <Menu.Popup className="mu-menu">
              <Menu.Item onClick={() => onOpen(id)}>{t('directory:quickView')}</Menu.Item>
              <Menu.LinkItem render={<Link href={url} prefetch={false} />}>
                {t('directory:fullPage')}
              </Menu.LinkItem>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}

function DirectoryTable({
  columnState,
  collectionSlug,
  enableRowSelections,
  docs,
  onOpen,
}: ListViewClientProps & { docs: PaginatedDocs['docs']; onOpen: (id: string) => void }) {
  const { t } = useAdminTranslation()
  const { getEntityConfig } = useConfig()
  const titleField = getEntityConfig({ collectionSlug }).admin.useAsTitle ?? 'id'
  // Keep Payload's permission-filtered cells, relationship renderer, sort headers and row locks.
  const columns: Column[] = columnState.map((column) => {
    if (!column.active || !statusFields.includes(column.accessor)) return column
    return {
      ...column,
      renderedCells: column.renderedCells.map((cell, index) => (
        <span
          className="md-status"
          data-status={docs[index]?.[column.accessor]}
          key={docs[index]?.id}
        >
          {cell}
        </span>
      )),
    }
  })
  if (enableRowSelections)
    columns.unshift({
      accessor: '_select',
      active: true,
      field: { name: '_select', type: 'ui', admin: {} },
      Heading: <SelectAll />,
      renderedCells: docs.map((doc) => <SelectRow key={doc.id} rowData={doc} />),
    })
  columns.push({
    accessor: '_actions',
    active: true,
    field: { name: '_actions', type: 'ui', admin: {} },
    Heading: t('directory:actions'),
    renderedCells: docs.map((doc) => (
      <RecordActions
        key={doc.id}
        onOpen={onOpen}
        slug={collectionSlug}
        id={doc.id}
        title={
          typeof doc[titleField] === 'string' && doc[titleField] ? doc[titleField] : String(doc.id)
        }
      />
    )),
  })
  return <Table columns={columns} data={docs} />
}

function Summary({ columnState }: Pick<ListViewClientProps, 'columnState'>) {
  const { t, i18n } = useAdminTranslation()
  const { hydrated } = useNav()
  const { data, query, refineListData, defaultSort } = useListQuery()
  if (!data) return null
  const number = new Intl.NumberFormat(i18n.language)
  const status = columnState.find(
    (col) => statusFields.includes(col.accessor) && col.field.type === 'select',
  )
  const condition = status && query.where?.[status.accessor]
  const simple =
    !condition ||
    (!Array.isArray(condition) && Object.keys(condition).every((key) => key === 'equals'))
  const sort = String(query.sort ?? defaultSort ?? '-createdAt')
  return (
    <div className="md-summary">
      <strong aria-live="polite">
        {t(data.totalDocs === 1 ? 'directory:oneRecord' : 'directory:records', {
          count: number.format(data.totalDocs),
        })}
      </strong>
      <div className="md-summary-tools">
        {status?.field.type === 'select' && simple && (
          <select
            disabled={!hydrated}
            aria-label={t('directory:status')}
            value={String(condition && !Array.isArray(condition) ? (condition.equals ?? '') : '')}
            onChange={(event) => {
              const where = { ...query.where }
              if (event.target.value) where[status.accessor] = { equals: event.target.value }
              else delete where[status.accessor]
              void refineListData({ where, page: 1 })
            }}
          >
            <option value="">{t('directory:allStatuses')}</option>
            {status.field.options.map((opt) => {
              const value = typeof opt === 'string' ? opt : opt.value
              return (
                <option key={value} value={value}>
                  {typeof opt === 'string' ? opt : getTranslation(opt.label, i18n)}
                </option>
              )
            })}
          </select>
        )}
        <select
          disabled={!hydrated}
          aria-label={t('directory:sort')}
          value={sort}
          onChange={(event) => void refineListData({ sort: event.target.value, page: 1 })}
        >
          {!['-createdAt', 'createdAt', '-updatedAt'].includes(sort) && (
            <option value={sort}>{t('directory:columnSort')}</option>
          )}
          <option value="-createdAt">{t('directory:newest')}</option>
          <option value="createdAt">{t('directory:oldest')}</option>
          <option value="-updatedAt">{t('directory:recent')}</option>
        </select>
        <small>
          {t('directory:pages', {
            page: number.format(data.page || 1),
            pages: number.format(Math.max(1, data.totalPages)),
          })}
        </small>
      </div>
    </div>
  )
}

function Directory(props: ListViewClientProps) {
  // Keep a single document drawer outside the table. Payload replaces table rows when the query changes.
  const [selection, setSelection] = useState<{ id: string }>()
  const router = useRouter()
  const [Drawer, , { openDrawer }] = useDocumentDrawer({
    collectionSlug: props.collectionSlug,
    id: selection?.id,
  })
  useEffect(() => {
    if (selection) openDrawer()
  }, [selection, openDrawer])
  const { data, isGroupingBy, orderableFieldName } = useListQuery()
  const standardTable = !isGroupingBy && !orderableFieldName && props.viewType !== 'trash'
  return (
    <div className="md-directory">
      <DefaultListView
        {...props}
        BeforeListTable={
          <>
            {props.BeforeListTable}
            <Summary columnState={props.columnState} />
          </>
        }
        Table={
          standardTable ? (
            <DirectoryTable
              {...props}
              docs={data?.docs ?? []}
              onOpen={(id) => setSelection({ id })}
            />
          ) : (
            props.Table
          )
        }
      />
      {selection && (
        <Drawer
          onSave={() => router.refresh()}
          onDelete={() => router.refresh()}
          onDuplicate={() => router.refresh()}
        />
      )}
    </div>
  )
}

export function CollectionDirectory(props: ListViewClientProps) {
  const { isInDrawer } = useListDrawerContext()
  return isInDrawer ? (
    <DefaultListView {...props} />
  ) : (
    <Directory key={props.collectionSlug} {...props} />
  )
}
