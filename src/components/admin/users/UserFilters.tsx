'use client'

import { useListQuery } from '@payloadcms/ui'
import type { Where } from 'payload'
import { useEffect, useRef, type ReactNode } from 'react'
import { useAdminTranslation } from '@/i18n/useAdminTranslation'
import { Icon } from '../icons'

function filterValue(where: Where | undefined, field: string, operator: 'equals' | 'contains') {
  const condition = where?.[field]
  const value = condition && !Array.isArray(condition) ? condition[operator] : undefined
  return typeof value === 'string' || typeof value === 'boolean' ? String(value) : ''
}

export function UserFilters({ children }: { children: ReactNode }) {
  const { t } = useAdminTranslation()
  const { query, refineListData } = useListQuery()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  function apply(form: HTMLFormElement) {
    clearTimeout(timer.current)
    const values = new FormData(form)
    const where = { ...query.where }
    for (const key of ['name', 'email', 'role', 'isActive']) {
      const value = String(values.get(key) ?? '').trim()
      if (!value) delete where[key]
      else if (key === 'name' || key === 'email') where[key] = { contains: value }
      else where[key] = { equals: key === 'isActive' ? value === 'true' : value }
    }
    void refineListData({ where, sort: String(values.get('sort')), page: 1 })
  }

  return (
    <form
      className="mu-filters"
      onSubmit={(event) => {
        event.preventDefault()
        apply(event.currentTarget)
      }}
      onChange={(event) => {
        const form = event.currentTarget
        clearTimeout(timer.current)
        if (event.target instanceof HTMLInputElement && event.target.type === 'search') {
          timer.current = setTimeout(() => apply(form), 350)
        } else if (event.target instanceof HTMLSelectElement) apply(form)
      }}
    >
      <div className="mu-searches">
        {(['name', 'email'] as const).map((field) => {
          const label = t(field === 'name' ? 'usersList:searchName' : 'usersList:searchEmail')
          return (
            <label className="mu-search" key={field}>
              <Icon name="search" />
              <input
                type="search"
                name={field}
                aria-label={label}
                placeholder={label}
                defaultValue={filterValue(query.where, field, 'contains')}
              />
            </label>
          )
        })}
      </div>
      <div className="mu-tools">
        <select
          name="role"
          aria-label={t('usersList:role')}
          defaultValue={filterValue(query.where, 'role', 'equals')}
        >
          <option value="">{t('usersList:allRoles')}</option>
          {(['admin', 'editor', 'member'] as const).map((role) => (
            <option key={role} value={role}>
              {t(`usersList:${role}`)}
            </option>
          ))}
        </select>
        <select
          name="isActive"
          aria-label={t('usersList:status')}
          defaultValue={filterValue(query.where, 'isActive', 'equals')}
        >
          <option value="">{t('usersList:allStatuses')}</option>
          <option value="true">{t('usersList:active')}</option>
          <option value="false">{t('usersList:inactive')}</option>
        </select>
        <select
          name="sort"
          aria-label={t('usersList:sort')}
          defaultValue={String(query.sort || '-createdAt')}
        >
          <option value="-createdAt">{t('usersList:newest')}</option>
          <option value="createdAt">{t('usersList:oldest')}</option>
          <option value="name">{t('usersList:nameAsc')}</option>
        </select>
        {children}
      </div>
    </form>
  )
}
