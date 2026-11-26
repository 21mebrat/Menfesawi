import { amWorkspace } from './am'
import { enWorkspace } from './en'

export function statusOptions<K extends keyof typeof enWorkspace.workspaceStatus>(...values: K[]) {
  return values.map((value) => ({
    value,
    label: { en: enWorkspace.workspaceStatus[value], am: amWorkspace.workspaceStatus[value] },
  }))
}

export function directoryLabel(key: keyof typeof enWorkspace.directory) {
  return { en: enWorkspace.directory[key], am: amWorkspace.directory[key] }
}
