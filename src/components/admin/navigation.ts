import 'server-only'
import { cache } from 'react'
import { getTranslation, t } from '@payloadcms/translations'
import type { PayloadRequest, SanitizedPermissions, VisibleEntities } from 'payload'
import { formatAdminURL } from 'payload/shared'

export type AdminItem = { slug: string; label: string; href: string; createLabel?: string }
export type AdminGroup = { id: GroupId; items: AdminItem[] }

const sections = {
  library: ['books', 'book-ratings'],
  teachings: ['teachings', 'hymns'],
  sacred: ['publications', 'publication-sections', 'passages'],
  calendar: ['synaxarium', 'daily-readings'],
  resources: ['media', 'files', 'categories'],
  administration: ['users', 'auth-accounts'],
  delivery: ['social-deliveries', 'book-deliveries'],
}
type GroupId = keyof typeof sections
const groupIds = Object.keys(sections) as GroupId[]

// Payload supplies visibleEntities after evaluating admin.hidden against the current user.
// Its sanitized permissions include read/create, but do not include collection access.admin.
export const navigation = cache(
  async (
    req: PayloadRequest,
    permissions?: SanitizedPermissions,
    visible?: VisibleEntities['collections'],
  ) => {
    const { config } = req.payload
    const groups = new Map<GroupId, AdminItem[]>()
    for (const collection of config.collections) {
      const { slug, admin, labels } = collection
      const access = permissions?.collections?.[slug]
      if (!visible?.includes(slug) || !access?.read || admin.group === false) continue
      if (collection.access.admin && !(await collection.access.admin({ req }))) continue

      const id = groupIds.find((key) => sections[key].includes(slug)) ?? 'administration'
      const singular = getTranslation(labels.singular, req.i18n)
      const items = groups.get(id) ?? []
      items.push({
        slug,
        label:
          slug === 'auth-accounts'
            ? t({ key: 'workspaceNav:authAccounts', translations: req.i18n.translations })
            : getTranslation(labels.plural, req.i18n),
        href: formatAdminURL({ adminRoute: config.routes.admin, path: `/collections/${slug}` }),
        createLabel: access.create
          ? req.i18n.t('general:createNewLabel', { label: singular })
          : undefined,
      })
      groups.set(id, items)
    }
    return groupIds.flatMap((id) => {
      const items = groups.get(id)
      return items ? [{ id, items }] : []
    })
  },
)
