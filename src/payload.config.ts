import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { BlocksFeature, FixedToolbarFeature, lexicalEditor, UploadFeature } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, type CollectionConfig } from 'payload'
import { deepMergeSimple } from 'payload/shared'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { brandLogoPath } from './components/BrandLogo'
import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { AuthAccounts } from './collections/AuthAccounts'
import { am, amLexical, amLocaleNames, amWorkspace } from './i18n/am'
import { enLexical, enLocaleNames, enWorkspace } from './i18n/en'
import { en } from '@payloadcms/translations/languages/en'
import { getEmailAdapter } from './lib/email/adapter'
import { ImageGallery } from './blocks/ImageGallery'
import { VisualMediaLayout } from './blocks/VisualMediaLayout'
import { createCloudinaryStorageAdapter, isCloudinaryConfigured } from './lib/media/cloudinary'
import { cloudStoragePlugin } from '@payloadcms/plugin-cloud-storage'
import { Categories } from './collections/Categories'
import { Files } from './collections/Files'
import { BookRatings } from './collections/BookRatings'
import { BookDeliveries } from './collections/BookDeliveries'
import { ReadingProgress, ensureReadingProgressIndexes } from './collections/ReadingProgress'
import { Bookmarks, ensureBookmarkIndexes } from './collections/Bookmarks'
import { Books } from './collections/Books'
import { Teachings } from './collections/Teachings'
import { Hymns } from './collections/Hymns'
import { SocialDeliveries } from './collections/SocialDeliveries'
import { Publications } from './collections/Publications'
import { PublicationSections } from './collections/PublicationSections'
import { Passages } from './collections/Passages'
import { DailyReadings } from './collections/DailyReadings'
import { Synaxarium } from './collections/Synaxarium'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const configuredEditor = lexicalEditor({
  features: ({ defaultFeatures }) => [
    ...defaultFeatures.filter((f) => f.key !== 'upload'),
    UploadFeature(),
    FixedToolbarFeature(),
    BlocksFeature({
      blocks: [ImageGallery, VisualMediaLayout],
    }),
  ],
})

const supportedLanguages = { en, am }
const editorOverrides = { en: { lexical: enLexical }, am: { lexical: amLexical } }
const translations = { en: enWorkspace, am: amWorkspace }

// Payload 3.93 installs Lexical feature translations during sanitization.
// Apply our wording afterwards without replacing the other native feature keys.
const editor: typeof configuredEditor = async (args) => {
  const result = await configuredEditor(args)
  const { i18n } = args.config
  i18n.translations = deepMergeSimple(i18n.translations, editorOverrides)
  return result
}

export const getDatabaseURL = (): string => {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    if (process.env.TEST_DATABASE_URL) {
      return process.env.TEST_DATABASE_URL
    }
    const defaultUrl = process.env.DATABASE_URL || 'mongodb://127.0.0.1/menfesawi'
    try {
      const parsed = new URL(defaultUrl)
      const pathname = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '/menfesawi'
      parsed.pathname = `${pathname.replace(/\/$/, '')}_test`
      return parsed.toString()
    } catch {
      return `${defaultUrl}_test`
    }
  }
  return process.env.DATABASE_URL || ''
}

function withDirectory(collection: CollectionConfig): CollectionConfig {
  const admin = collection.admin
  if (admin?.hidden === true || admin?.components?.views?.list?.Component) return collection
  return {
    ...collection,
    admin: {
      ...admin,
      components: {
        ...admin?.components,
        views: {
          ...admin?.components?.views,
          list: { ...admin?.components?.views?.list, Component: '/components/admin/CollectionDirectory#CollectionDirectory' },
        },
      },
    },
  }
}

export default buildConfig({
  admin: {
    user: Users.slug,
    meta: { icons: { icon: brandLogoPath }, titleSuffix: '– Menfesawi' },
    avatar: { Component: '/components/admin/Workspace#WorkspaceAvatar' },
    components: {
      graphics: {
        Icon: '/components/BrandLogo#BrandIcon',
        Logo: '/components/BrandLogo#BrandLogo',
      },
      Nav: '/components/admin/Workspace#AdminNav',
      actions: ['/components/admin/Workspace#HeaderActions'],
      views: { dashboard: { Component: '/components/admin/Workspace#Dashboard' } },
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [
    Users,
    Media,
    AuthAccounts,
    Categories,
    Files,
    Books,
    BookRatings,
    BookDeliveries,
    Teachings,
    Hymns,
    SocialDeliveries,
    Publications,
    PublicationSections,
    Passages,
    Synaxarium,
    DailyReadings,
    Bookmarks,
    ReadingProgress,
  ].map(withDirectory),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  localization: {
    locales: [
      {
        label: { en: enLocaleNames.en, am: amLocaleNames.en },
        code: "en",
      },
      {
        label: { en: enLocaleNames.am, am: amLocaleNames.am },
        code: "am",
        fallbackLocale: "en"
      }
    ],
    defaultLocale: "en",
    fallback: true
  },
  i18n: {
    fallbackLanguage: 'en',
    supportedLanguages,
    translations,
  },
  editor,
  email: getEmailAdapter(),
  db: mongooseAdapter({
    url: getDatabaseURL(),
    afterOpenConnection: async (adapter) => {
      await ensureBookmarkIndexes(adapter)
      await ensureReadingProgressIndexes(adapter)
    },
  }),
  sharp,
  plugins: [
    cloudStoragePlugin({
      enabled: isCloudinaryConfigured(),
      collections: {
        media: {
          adapter: createCloudinaryStorageAdapter(),
          disableLocalStorage: true,
          disablePayloadAccessControl: true,
        },
      },
    }),
  ],
})
