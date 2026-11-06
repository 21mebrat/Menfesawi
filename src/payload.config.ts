import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { BlocksFeature, FixedToolbarFeature, lexicalEditor, UploadFeature } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { AuthAccounts } from './collections/AuthAccounts'
import { am } from './i18n/am'
import { en } from '@payloadcms/translations/languages/en'
import { getEmailAdapter } from './lib/email/adapter'
import { ImageGallery } from './blocks/ImageGallery'
import { VisualMediaLayout } from './blocks/VisualMediaLayout'
import { createCloudinaryStorageAdapter, isCloudinaryConfigured } from './lib/media/cloudinary'
import { cloudStoragePlugin } from '@payloadcms/plugin-cloud-storage'

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

// Ensures that Payload 3.91 preserves human-readable labels for all slash menu commands
// across both English and Amharic admin locales
const editor: typeof configuredEditor = async (args) => {
  const result = await configuredEditor(args)
  if (!args.config.i18n) args.config.i18n = {} as any
  if (!args.config.i18n.translations) args.config.i18n.translations = {}
  const translations = args.config.i18n.translations as Record<string, any>
  if (!translations.en) translations.en = {}
  if (!translations.am) translations.am = {}

  const enLexical = (translations.en.lexical ??= {})
  enLexical.checklist = { label: 'Checklist' }
  enLexical.blockquote = { label: 'Quote' }

  translations.am.lexical = {
    ...enLexical,
    checklist: { label: 'Checklist' },
    heading: { label: 'ርዕስ {{headingLevel}}' },
    paragraph: { label: 'አንቀጽ', label2: 'መደበኛ ጽሑፍ' },
    blockquote: { label: 'ጥቅስ (Quote)' },
    orderedList: { label: 'ቁጥር ያለው ዝርዝር (Ordered List)' },
    unorderedList: { label: 'ነጥብ ያለው ዝርዝር (Unordered List)' },
    upload: { label: 'ፋይል ስቀል (Upload)' },
    relationship: { label: 'ዝምድና (Relationship)' },
    link: { label: 'አገናኝ (Link)', loadingWithEllipsis: 'በመጫን ላይ...' },
    horizontalRule: { label: 'አግድም መስመር (Divider)' },
    blocks: {
      label: 'ብሎኮች (Blocks)',
      inlineBlocks: { label: 'የመስመር ውስጥ ብሎኮች' },
    },
    general: {
      placeholder: "መጻፍ ይጀምሩ፣ ወይም ለትዕዛዞች '/' ይጫኑ...",
      slashMenuBasicGroupLabel: 'መሰረታዊ (Basic)',
      slashMenuListGroupLabel: 'ዝርዝሮች (Lists)',
      toolbarItemsActive: '{{count}} ንቁ',
    },
  }

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

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, AuthAccounts],
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  localization: {
    locales: [
      {
        label: "English",
        code: "en",
      },
      {
        label: "Amharic",
        code: "am",
        fallbackLocale: "en"
      }
    ],
    defaultLocale: "en",
    fallback: true
  },
  i18n: {
    fallbackLanguage: 'en',
    supportedLanguages: {
      en,
      am,
    } as any,
    translations: {
      en: {
        lexical: {
          checklist: {
            label: 'Checklist',
          },
          blockquote: {
            label: 'Quote',
          },
          heading: {
            label: 'Heading {{headingLevel}}',
          },
          paragraph: {
            label: 'Paragraph',
            label2: 'Normal Text',
          },
          orderedList: {
            label: 'Ordered List',
          },
          unorderedList: {
            label: 'Unordered List',
          },
          upload: {
            label: 'Upload',
          },
          relationship: {
            label: 'Relationship',
          },
          link: {
            label: 'Link',
            loadingWithEllipsis: 'Loading...',
          },
          horizontalRule: {
            label: 'Horizontal Rule',
          },
          blocks: {
            label: 'Blocks',
            inlineBlocks: {
              label: 'Inline Blocks',
            },
          },
        },
      },
      am: {
        lexical: {
          checklist: {
            label: 'Checklist',
          },
          heading: {
            label: 'ርዕስ {{headingLevel}}',
          },
          paragraph: {
            label: 'አንቀጽ',
            label2: 'መደበኛ ጽሑፍ',
          },
          blockquote: {
            label: 'ጥቅስ (Quote)',
          },
          orderedList: {
            label: 'ቁጥር ያለው ዝርዝር (Ordered List)',
          },
          unorderedList: {
            label: 'ነጥብ ያለው ዝርዝር (Unordered List)',
          },
          upload: {
            label: 'ፋይል ስቀል (Upload)',
          },
          relationship: {
            label: 'ዝምድና (Relationship)',
          },
          link: {
            label: 'አገናኝ (Link)',
            loadingWithEllipsis: 'በመጫን ላይ...',
          },
          horizontalRule: {
            label: 'አግድም መስመር (Divider)',
          },
          blocks: {
            label: 'ብሎኮች (Blocks)',
            inlineBlocks: {
              label: 'የመስመር ውስጥ ብሎኮች',
            },
          },
          general: {
            placeholder: "መጻፍ ይጀምሩ፣ ወይም ለትዕዛዞች '/' ይጫኑ...",
            slashMenuBasicGroupLabel: 'መሰረታዊ (Basic)',
            slashMenuListGroupLabel: 'ዝርዝሮች (Lists)',
            toolbarItemsActive: '{{count}} ንቁ',
          },
        },
      },
    } as any,
  },
  editor,
  email: getEmailAdapter(),
  db: mongooseAdapter({
    url: getDatabaseURL(),
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
