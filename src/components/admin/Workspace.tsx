import { t } from '@payloadcms/translations'
import type { AdminViewServerProps, PayloadRequest, ServerProps } from 'payload'
import { Sidebar } from './Sidebar'
import { Overview } from './Overview'
import { WorkspaceTools } from './WorkspaceTools'
import { workspaceData } from './workspace-data'
import { navigation } from './navigation'
import './workspace.css'

type TemplateProps = ServerProps & { req?: PayloadRequest }

async function menu({ req, permissions, visibleEntities }: TemplateProps) {
  // Payload also renders the not-found boundary without a request.
  return req ? navigation(req, permissions, visibleEntities?.collections) : []
}

export async function AdminNav(props: TemplateProps) {
  return <Sidebar groups={await menu(props)} />
}

export async function HeaderActions(props: TemplateProps) {
  return <WorkspaceTools items={(await menu(props)).flatMap((group) => group.items)} />
}

export function WorkspaceAvatar({ user, i18n }: ServerProps) {
  const name = user?.name || user?.email || i18n?.t('authentication:account') || ''
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
  return (
    <span className="mf-account">
      <b>{initials}</b>
      <span>
        {name}
        <small>{t({ key: 'workspaceNav:workspace', translations: i18n.translations })}</small>
      </span>
    </span>
  )
}

export async function Dashboard({
  initPageResult: { req, visibleEntities, permissions },
}: AdminViewServerProps) {
  const groups = await navigation(req, permissions, visibleEntities.collections)
  const items = groups.flatMap((group) => group.items)
  return <Overview items={items} data={await workspaceData(req, items)} />
}
