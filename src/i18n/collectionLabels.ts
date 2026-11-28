import { getTranslation } from '@payloadcms/translations'
import type { TextFieldSingleValidation } from 'payload'
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

export function bookLabel(key: keyof typeof enWorkspace.bookEditor) {
  return { en: enWorkspace.bookEditor[key], am: amWorkspace.bookEditor[key] }
}

export const librarySlug: TextFieldSingleValidation = (value, { req }) =>
  (typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) ||
  getTranslation(bookLabel('slugError'), req.i18n)
