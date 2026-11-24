/**
 * TypeScript types and interfaces for the Menfesawi Structured Reading System.
 */

export type PassageNumberingPolicy = 'required' | 'optional' | 'none'

export interface LocalizedLabel {
  en: string
  am: string
}

export interface ChildTypeKeyRef {
  typeKey: string
  id?: string | null
}

export interface SectionTypeConfig {
  /**
   * Unique, stable type key within the publication (e.g. 'testament', 'book', 'chapter', 'day', 'prayer').
   */
  key: string

  /**
   * Human-readable singular and plural labels in English and Amharic.
   */
  labels: {
    singular: LocalizedLabel
    plural: LocalizedLabel
  }

  /**
   * Optional contextual creation action labels (e.g. "Add Book" / "መጽሐፍ ጨምር", "Add Chapter" / "ምዕራፍ ጨምር").
   */
  actionLabels?: {
    en?: string | null
    am?: string | null
  }

  /**
   * Whether sections of this type can be placed at the root of the publication (parent === null).
   */
  allowedAtRoot?: boolean | null

  /**
   * Type keys of child sections permitted immediately under sections of this type.
   */
  allowedChildTypes?: ChildTypeKeyRef[] | null

  /**
   * Whether sections of this type can directly contain passages.
   */
  allowPassages?: boolean | null

  /**
   * Terminology used for passages in this section (e.g. "Verse" / "ቁጥር", "Paragraph" / "አንቀጽ").
   */
  passageTerminology?: {
    singular?: {
      en?: string | null
      am?: string | null
    }
    plural?: {
      en?: string | null
      am?: string | null
    }
  }

  /**
   * Section numbering policy: 'required' | 'optional' | 'none'.
   */
  numberingPolicy: PassageNumberingPolicy

  id?: string | null
}

export interface PublicationStructureConfig {
  /**
   * Finite maximum nesting depth permitted for sections in this publication (1 to 10).
   */
  maxDepth: number

  /**
   * Configured section types for this publication.
   */
  sectionTypes: SectionTypeConfig[]
}

export interface BreadcrumbItem {
  id: string
  title: string
  slug: string
  typeKey: string
  depth: number
}

export interface SiblingNavigationItem {
  id: string
  title: string
  slug: string
  typeKey: string
  number?: number | null
  order: number
}

import type { PayloadRequest } from 'payload'
import type { UserAuth } from '@/access'

export interface ReadingQueryOptions {
  overrideAccess?: boolean
  user?: UserAuth | null
  req?: PayloadRequest
  locale?: string
  fallbackLocale?: string
  limit?: number
  page?: number
}

export interface PreviousNextNavigation {
  previous: SiblingNavigationItem | null
  next: SiblingNavigationItem | null
}
