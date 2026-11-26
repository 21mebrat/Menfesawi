'use client'

import { Menu } from '@base-ui/react/menu'
import {
  ConfirmationModal,
  DefaultListView,
  Link,
  SetStepNav,
  toast,
  useConfig,
  useListDrawerContext,
  useListQuery,
  useModal,
  useNav,
} from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import type { ListViewClientProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { useMemo, useState } from 'react'
import { useAdminTranslation } from '@/i18n/useAdminTranslation'
import type { User } from '@/payload-types'
import { Icon } from '../icons'
import { UserFilters } from './UserFilters'

const fields = ['name', 'email', 'role', 'isActive', 'createdAt'] as const
type Field = (typeof fields)[number]
type Row = Pick<User, Field | 'id'>

function Directory({
  columnState,
  hasCreatePermission,
  hasDeletePermission,
  newDocumentURL,
  openAdvanced,
}: ListViewClientProps & { openAdvanced: () => void }) {
  const { t, i18n } = useAdminTranslation()
  const { data, refineListData } = useListQuery()
  const {
    config: { routes },
  } = useConfig()
  const router = useRouter()
  const { openModal } = useModal()
  const { hydrated } = useNav()
  const [deleting, setDeleting] = useState<Row>()
  const title = t('usersList:title')
  const nav = useMemo(() => [{ label: title }], [title])
  const number = new Intl.NumberFormat(i18n.language)
  const date = new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const visible = fields.filter((key) =>
    columnState.some((col) => col.accessor === key && col.active),
  )
  const label = (key: Field) => t(`usersList:${key === 'isActive' ? 'status' : key}`)
  const displayName = (user: Row) => user.name || user.email || user.id
  const href = (user: Row) =>
    formatAdminURL({
      adminRoute: routes.admin,
      path: `/collections/users/${encodeURIComponent(user.id)}`,
    })
  const rows: Row[] = data?.docs ?? []
  const total = data?.totalDocs ?? 0
  const page = data?.page || 1
  const pages = Math.max(1, data?.totalPages || 1)
  const changePage = (n: number) => void refineListData({ page: n })

  async function deleteUser() {
    if (!hasDeletePermission || !deleting) return
    try {
      const res = await fetch(
        formatAdminURL({ apiRoute: routes.api, path: `/users/${encodeURIComponent(deleting.id)}` }),
        {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'Accept-Language': i18n.language },
        },
      )
      if (!res.ok) {
        toast.error(t(res.status === 409 ? 'usersList:deleteConflict' : 'usersList:deleteError'))
        return
      }
      toast.success(t('usersList:deleted'))
      if (rows.length === 1 && page > 1) changePage(page - 1)
      else router.refresh()
    } catch {
      toast.error(t('usersList:deleteError'))
    }
  }

  function cell(user: Row, field: Field) {
    switch (field) {
      case 'name': {
        const name = displayName(user)
        const words = name.trim().split(/\s+/u)
        const initials = [words[0], ...(words.length > 1 ? words.slice(-1) : [])]
          .map((word) => Array.from(word)[0])
          .join('')
          .toLocaleUpperCase(i18n.language)
        return (
          <Link className="mu-person" href={href(user)}>
            <span aria-hidden="true">{initials}</span>
            {name}
          </Link>
        )
      }
      case 'email':
        return user.email || '—'
      case 'role':
        return user.role ? <span className="mu-role">{t(`usersList:${user.role}`)}</span> : '—'
      case 'isActive':
        return typeof user.isActive === 'boolean' ? (
          <span className="mu-status" data-active={user.isActive}>
            {t(user.isActive ? 'usersList:active' : 'usersList:inactive')}
          </span>
        ) : (
          '—'
        )
      case 'createdAt':
        return user.createdAt ? (
          <time dateTime={user.createdAt}>{date.format(new Date(user.createdAt))}</time>
        ) : (
          '—'
        )
    }
  }
  function pageArrow(key: 'first' | 'prev' | 'next' | 'last', target: number, disabled: boolean) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={t(`usersList:${key}`)}
        onClick={() => changePage(target)}
      >
        <Icon name={key} size={18} />
      </button>
    )
  }

  return (
    <section className="mu-list">
      <SetStepNav nav={nav} />
      <header className="mu-heading">
        <div>
          <h1>{title}</h1>
          <p>{t('usersList:description')}</p>
        </div>
        {hasCreatePermission && (
          <Link className="mu-create" href={newDocumentURL}>
            {t('usersList:create')}
          </Link>
        )}
      </header>
      <UserFilters>
        <Menu.Root>
          <Menu.Trigger disabled={!hydrated} className="mu-columns">
            {t('usersList:columns')}
            <Icon name="next" size={14} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="mf-popup-layer" align="end" sideOffset={6}>
              <Menu.Popup className="mu-menu">
                {fields.map((field) => {
                  const checked = visible.includes(field)
                  return (
                    <Menu.CheckboxItem
                      key={field}
                      checked={checked}
                      disabled={checked && visible.length === 1}
                      onCheckedChange={(active) =>
                        void refineListData({
                          columns: columnState.map((col) =>
                            (col.accessor === field ? active : col.active)
                              ? col.accessor
                              : '-' + col.accessor,
                          ),
                        })
                      }
                    >
                      <span className="mu-check" aria-hidden="true">
                        {checked ? '✓' : ''}
                      </span>
                      {label(field)}
                    </Menu.CheckboxItem>
                  )
                })}
                <Menu.Item onClick={openAdvanced}>{t('usersList:nativeList')}</Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </UserFilters>
      <div className="mu-meta">
        <strong aria-live="polite">
          {total === 1
            ? t('usersList:oneUser')
            : t('usersList:count', { count: number.format(total) })}
        </strong>
        <div>
          <select
            value={data?.limit || 4}
            aria-label={t('usersList:perPage')}
            onChange={(event) =>
              void refineListData({ limit: Number(event.target.value), page: 1 })
            }
          >
            {Array.from(new Set([4, 10, 25, 50, data?.limit || 4])).map((n) => (
              <option key={n} value={n}>
                {number.format(n)}
              </option>
            ))}
          </select>
          <span>
            {t('usersList:pages', { page: number.format(page), pages: number.format(pages) })}
          </span>
        </div>
      </div>
      <div className="mu-scroll" role="region" aria-label={title} tabIndex={0}>
        <table aria-label={title}>
          <thead>
            <tr>
              {visible.map((key) => (
                <th scope="col" key={key}>
                  {label(key)}
                </th>
              ))}
              <th scope="col">{t('usersList:actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.id}>
                {visible.map((key) => (
                  <td key={key}>{cell(user, key)}</td>
                ))}
                <td>
                  <div className="mu-row-actions">
                    <Link
                      className="mu-icon"
                      href={href(user)}
                      aria-label={t('usersList:edit', { name: displayName(user) })}
                    >
                      <Icon name="edit" size={17} />
                    </Link>
                    <Menu.Root>
                      <Menu.Trigger
                        disabled={!hydrated}
                        className="mu-icon"
                        aria-label={t('usersList:menu', { name: displayName(user) })}
                      >
                        <Icon name="more" size={17} />
                      </Menu.Trigger>
                      <Menu.Portal>
                        <Menu.Positioner className="mf-popup-layer" align="end" sideOffset={6}>
                          <Menu.Popup className="mu-menu">
                            <Menu.LinkItem render={<Link href={href(user)} />}>
                              {t('usersList:details')}
                            </Menu.LinkItem>
                            {hasDeletePermission && (
                              <Menu.Item
                                onClick={() => {
                                  setDeleting(user)
                                  openModal('mu-delete-user')
                                }}
                              >
                                {t('usersList:delete')}
                              </Menu.Item>
                            )}
                          </Menu.Popup>
                        </Menu.Positioner>
                      </Menu.Portal>
                    </Menu.Root>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="mu-empty" role="status">
            {t('usersList:empty')}
          </p>
        )}
      </div>
      <footer className="mu-footer">
        <span>
          {t('usersList:range', {
            first: number.format(rows.length ? data?.pagingCounter || 1 : 0),
            last: number.format(rows.length ? (data?.pagingCounter || 1) + rows.length - 1 : 0),
            count: number.format(total),
          })}
        </span>
        <nav aria-label={t('usersList:pages', { page, pages })}>
          {pageArrow('first', 1, page <= 1)}
          {pageArrow('prev', page - 1, page <= 1)}
          {[page - 1, page, page + 1]
            .filter((n) => n > 0 && n <= pages)
            .map((n) => (
              <button
                type="button"
                key={n}
                aria-current={n === page ? 'page' : undefined}
                aria-label={t('usersList:page', { page: n })}
                onClick={() => changePage(n)}
              >
                {number.format(n)}
              </button>
            ))}
          {pageArrow('next', page + 1, page >= pages)}
          {pageArrow('last', pages, page >= pages)}
        </nav>
      </footer>
      {deleting && hasDeletePermission && (
        <ConfirmationModal
          modalSlug="mu-delete-user"
          heading={t('usersList:delete')}
          body={t('usersList:confirmDelete', { name: displayName(deleting) })}
          confirmLabel={t('usersList:delete')}
          onConfirm={deleteUser}
        />
      )}
    </section>
  )
}

export function UsersList(props: ListViewClientProps) {
  const { isInDrawer } = useListDrawerContext()
  const [advanced, setAdvanced] = useState(false)
  const { t } = useAdminTranslation()
  if (isInDrawer) return <DefaultListView {...props} />
  if (advanced)
    return (
      <>
        <button type="button" className="mu-back" onClick={() => setAdvanced(false)}>
          {t('usersList:directory')}
        </button>
        <DefaultListView {...props} />
      </>
    )
  return <Directory {...props} openAdvanced={() => setAdvanced(true)} />
}
