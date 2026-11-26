'use client'
import { useAdminTranslation } from '@/i18n/useAdminTranslation'

import { Link } from '@payloadcms/ui'
import { useState } from 'react'
import { Icon } from './icons'
import type { AdminItem } from './navigation'

import type { WorkspaceData } from './workspace-data'

function Activity({
  values,
  firstDay,
  scope,
}: {
  values: number[]
  firstDay: number
  scope: string
}) {
  const { t } = useAdminTranslation()
  const days = values.length
  const step = Math.max(1, Math.ceil(Math.max(...values) / 4))
  const y = (n: number) => 211 - (n / (4 * step)) * 192
  const total = values.reduce((sum, n) => sum + n, 0)
  const points = values.map((n, i) => ({ x: 27 + (i * 651) / (days - 1), y: y(n) }))
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
  const ticks = [
    0,
    Math.ceil(days / 4) - 1,
    Math.ceil(days / 2) - 1,
    Math.ceil((3 * days) / 4) - 1,
    days - 1,
  ]
  return (
    <section className="mf-panel mf-activity">
      <h2>{t('workspaceMetrics:creation')}</h2>
      <p>{scope}</p>
      <div className="mf-activity-total">
        <strong>{total}</strong>
        <small>{t('workspaceMetrics:createdTotal')}</small>
        <small>
          <i />
          {t('workspaceMetrics:created')}
        </small>
      </div>
      <svg
        className="mf-plot"
        viewBox="0 0 688 245"
        role="img"
        aria-label={t('workspaceMetrics:chartLabel')}
      >
        {[0, step, 2 * step, 3 * step, 4 * step].map((n) => (
          <g key={n}>
            <line x1="27" x2="678" y1={y(n)} y2={y(n)} />
            <text x="20" y={y(n) + 4} textAnchor="end">
              {n}
            </text>
          </g>
        ))}
        <path d={path + ' L678,211 L27,211 Z'} fill="var(--chart-1)" fillOpacity=".27" />
        <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth="2.5" />
        {ticks.map((i, k) => (
          <g key={i}>
            <circle
              cx={points[i].x}
              cy={points[i].y}
              r="3"
              fill="var(--chart-1)"
              stroke="var(--card)"
            />
            <text
              x={points[i].x}
              y="237"
              textAnchor={k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}
            >
              {new Date(firstDay + i * 86400000).toISOString().slice(5, 10)}
            </text>
          </g>
        ))}
      </svg>
      <div className="mf-sr">
        <table>
          <caption>{t('workspaceMetrics:dailyValues')}</caption>
          <thead>
            <tr>
              <th>{t('workspaceMetrics:date')}</th>
              <th>{t('workspaceMetrics:count')}</th>
            </tr>
          </thead>
          <tbody>
            {values.map((value, i) => (
              <tr key={i}>
                <th scope="row">{new Date(firstDay + i * 86400000).toISOString().slice(0, 10)}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function Overview({ items, data }: { items: AdminItem[]; data: WorkspaceData }) {
  const { t, i18n } = useAdminTranslation()
  const [days, setDays] = useState(28)
  const item = (slug: string) => items.find((entry) => entry.slug === slug)
  const visible = data.snapshot.flatMap((row) => {
    const collection = item(row.slug)
    return collection ? [{ ...row, collection }] : []
  })
  const mix = visible.filter((row) => row.slug !== 'users')
  const sources = new Intl.ListFormat(i18n.language).format(
    mix.map(({ collection }) => collection.label),
  )
  const scopeText = (key: 'scope' | 'byCollection' | 'recentDescription') =>
    sources ? t(`workspaceMetrics:${key}`, { sources }) : t('workspaceMetrics:noSources')
  const trends = mix.flatMap((row) => (row.trend ? [row.trend] : []))
  const activity =
    trends.length !== mix.length
      ? null
      : Array.from({ length: days }, (_, i) =>
          trends.reduce((sum, trend) => sum + trend[28 - days + i], 0),
        )
  const firstDay = Date.parse(data.asOf.slice(0, 10)) - (days - 1) * 86400000
  const total = mix.some((row) => row.count === null)
    ? null
    : mix.reduce((sum, row) => sum + (row.count ?? 0), 0)
  const books = item('books'),
    files = item('files'),
    teachings = item('teachings')
  const primary = books?.createLabel ? books : items.find((entry) => entry.createLabel)
  const fmt = (n: number | null) =>
    n === null ? t('workspaceStatus:unavailable') : n.toLocaleString(i18n.language)
  let offset = 0
  return (
    <main className="mf-dashboard">
      <header className="mf-intro">
        <div className="mf-eyebrow">{t('workspaceMetrics:breadcrumb')}</div>
        <div className="mf-heading">
          <div>
            <h1>{t('general:dashboard')}</h1>
            <p>{t('workspaceMetrics:intro')}</p>
          </div>
          <select
            aria-label={t('workspaceMetrics:period')}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {[7, 14, 28].map((n) => (
              <option value={n} key={n}>
                {t('workspaceMetrics:range', { days: n })}
              </option>
            ))}
          </select>
        </div>
      </header>
      <div className="mf-banner">
        <b>{t('workspaceMetrics:snapshot')}</b>
        <time dateTime={data.asOf}>
          {t('workspaceMetrics:loaded', { time: data.asOf.slice(0, 16).replace('T', ' ') })}
        </time>
      </div>
      <div className="mf-stats">
        {visible
          .filter((row) => row.slug !== 'files')
          .map((row) => (
            <Link
              key={row.slug}
              href={row.collection.href}
              prefetch={false}
              className="mf-panel mf-stat"
            >
              <span>
                {row.collection.label}
                <Icon name={row.slug} />
              </span>
              <strong>{fmt(row.count)}</strong>
              <small>
                {row.trend
                  ? t('workspaceMetrics:growth', {
                      amount: fmt(row.trend.slice(-days).reduce((sum, n) => sum + n, 0)),
                      days,
                    })
                  : t('workspaceStatus:unavailable')}
              </small>
              <svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true">
                {row.trend && (
                  <polyline
                    points={row.trend
                      .slice(-days)
                      .map(
                        (v, i) =>
                          (200 * i) / (days - 1) +
                          ',' +
                          (19 - (18 * v) / Math.max(1, ...(row.trend ?? []).slice(-days))),
                      )
                      .join(' ')}
                    fill="none"
                    stroke="var(--chart-1)"
                    strokeWidth="1.7"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
            </Link>
          ))}
      </div>
      <div className="mf-panels">
        {activity ? (
          <Activity values={activity} firstDay={firstDay} scope={scopeText('scope')} />
        ) : (
          <section className="mf-panel mf-activity">
            <h2>{t('workspaceMetrics:creation')}</h2>
            <p>{scopeText('scope')}</p>
            <p>{t('workspaceStatus:unavailable')}</p>
          </section>
        )}
        <section className="mf-panel mf-distribution">
          <h2>{t('workspaceMetrics:distribution')}</h2>
          <p>{scopeText('byCollection')}</p>
          <div className="mf-donut">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--muted)" strokeWidth="15" />
              {mix.map((row, i) => {
                if (!row.count || !total) return null
                const portion = (row.count / total) * 100,
                  start = offset
                offset += portion
                return (
                  <circle
                    key={row.slug}
                    cx="60"
                    cy="60"
                    r="50"
                    pathLength="100"
                    fill="none"
                    stroke={'var(--chart-' + (i + 1) + ')'}
                    strokeWidth="15"
                    strokeDasharray={portion + ' ' + (100 - portion)}
                    strokeDashoffset={-start}
                    transform="rotate(-90 60 60)"
                  />
                )
              })}
            </svg>
            <div>
              <strong>{fmt(total)}</strong>
              <small>{t('workspaceMetrics:items')}</small>
            </div>
          </div>
          <ul>
            {mix.map((row, i) => (
              <li key={row.slug}>
                <i style={{ background: 'var(--chart-' + (i + 1) + ')' }} />
                {row.collection.label}
                <span>{fmt(row.count)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="mf-panel mf-recent">
          <h2>{t('workspaceMetrics:recent')}</h2>
          <p>{scopeText('recentDescription')}</p>
          <div className="mf-table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    t('workspaceMetrics:content'),
                    t('workspaceMetrics:collection'),
                    t('workspaceMetrics:status'),
                    t('workspaceMetrics:updated'),
                  ].map((label) => (
                    <th scope="col" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recent.map((row) => (
                  <tr key={row.href}>
                    <td>
                      <Link href={row.href} prefetch={false}>
                        {row.title}
                      </Link>
                    </td>
                    <td>{item(row.slug)?.label}</td>
                    <td>
                      <span className="mf-status" data-status={row.status}>
                        {t(`workspaceStatus:${row.status}`)}
                      </span>
                    </td>
                    <td>
                      <time dateTime={row.updatedAt}>
                        {row.updatedAt.slice(0, 16).replace('T', ' ')} UTC
                      </time>
                    </td>
                  </tr>
                ))}
                {data.missingRecent.length > 0 && (
                  <tr>
                    <td colSpan={4} role="status">
                      {t('workspaceSearch:failed', { sources: data.missingRecent.join(', ') })}
                    </td>
                  </tr>
                )}
                {!data.missingRecent.length && !data.recent.length && (
                  <tr>
                    <td colSpan={4}>{t('workspaceMetrics:empty')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="mf-panel mf-quick">
          <h2>{t('workspaceMetrics:quick')}</h2>
          <p>{t('workspaceMetrics:shortcuts')}</p>
          {primary && (
            <Link
              className="mf-quick-primary"
              href={primary.href + '/create'}
              aria-label={primary.createLabel}
            >
              <Icon name="add" />
              {t('workspaceMetrics:add')}
            </Link>
          )}
          {files && (
            <Link href={files.href}>
              <Icon name="upload" />
              {t('workspaceMetrics:upload')}
            </Link>
          )}
          {teachings?.createLabel && (
            <Link href={teachings.href + '/create'}>
              <Icon name="teachings" />
              {t('workspaceMetrics:teach')}
            </Link>
          )}
        </section>
      </div>
    </main>
  )
}
