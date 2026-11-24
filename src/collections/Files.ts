import { guardDeletion } from '../lib/server/library/catalog'
import type { CollectionConfig } from 'payload'

import {
    canAccessAdmin,
    isAdmin,
    isStaff,
    type UserAuth,
} from '../access'

export const Files: CollectionConfig = {
    slug: 'files',

    labels: {
        singular: {
            en: 'File',
            am: 'ፋይል',
        },
        plural: {
            en: 'Files',
            am: 'ፋይሎች',
        },
    },

    admin: {
        components: { beforeListTable: ['/components/BookUpload#BookUpload'] },
        group: {
            en: 'Content',
            am: 'ይዘት',
        },

        useAsTitle: 'originalFilename',

        defaultColumns: [
            'originalFilename',
            'mimeType',
            'sizeBytes',
            'ingestionStatus',
            'isAvailable',
            'updatedAt',
        ],

        listSearchableFields: ['originalFilename'],

        description: {
            en: 'Private Telegram file records. Members receive files through the bot after signing in.',
            am: 'በግል የTelegram ቡድን ውስጥ የተቀመጡ ፋይሎች መዝገብ። አባላት ከገቡ በኋላ ፋይሎችን በቦቱ ይቀበላሉ።',
        },
    },

    access: {
        admin: canAccessAdmin,

        // Raw storage records are accessible to staff only.
        read: ({ req }) => {
            return isStaff(req.user as UserAuth | null)
        },

        create: () => false,

        update: ({ req }) => {
            return isStaff(req.user as UserAuth | null)
        },

        delete: ({ req }) => {
            return isAdmin(req.user as UserAuth | null)
        },
    },

    hooks: { beforeDelete: [guardDeletion] },
    fields: [
        {
            name: 'ingestionStatus',
            type: 'select',
            label: { en: 'Upload status', am: 'የሰቀላ ሁኔታ' },
            options: ['pending', 'ready', 'failed'],
            access: { update: () => false },
            admin: { readOnly: true },
        },
        {
            name: 'ingestionFailure',
            type: 'select',
            label: { en: 'Upload outcome', am: 'የሰቀላ ውጤት' },
            options: ['rejected', 'uncertain'],
            access: { update: () => false },
            admin: { readOnly: true },
        },
        {
            name: 'ingestKey',
            type: 'text',
            access: { update: () => false },
            admin: { hidden: true },
        },
        {
            name: 'originalFilename',
            access: { update: () => false },
            type: 'text',
            required: true,
            maxLength: 255,

            label: {
                en: 'Original filename',
                am: 'የመጀመሪያው የፋይል ስም',
            },

            admin: {
                placeholder: 'book.pdf',

                description: {
                    en: 'The filename reported by Telegram. Store the book title separately in the library.',
                    am: 'በTelegram የተመዘገበው የፋይል ስም። የመጽሐፉን ርዕስ በቤተ መጻሕፍቱ በተለየ ያስቀምጡ።',
                },
            },
        },

        {
            name: 'mimeType',
            access: { update: () => false },
            type: 'text',
            required: true,
            maxLength: 150,

            label: {
                en: 'MIME type',
                am: 'የፋይል ዓይነት',
            },

            admin: {
                placeholder: 'application/pdf',

                description: {
                    en: 'The document MIME type, such as application/pdf.',
                    am: 'የሰነዱ MIME ዓይነት፣ ለምሳሌ application/pdf።',
                },
            },
        },

        {
            name: 'sizeBytes',
            access: { update: () => false },
            type: 'number',
            min: 1,

            label: {
                en: 'File size in bytes',
                am: 'የፋይል መጠን በባይት',
            },

            validate: (value: unknown) => {
                if (value === undefined || value === null) {
                    return true
                }

                return (
                    (typeof value === 'number' &&
                        Number.isSafeInteger(value) &&
                        value > 0) ||
                    'Enter a positive whole-number size in bytes.'
                )
            },

            admin: {
                description: {
                    en: 'Use the size reported by Telegram. Leave empty if unknown.',
                    am: 'በTelegram የተመዘገበውን መጠን ያስገቡ። ካልታወቀ ባዶ ይተዉት።',
                },
            },
        },

        {
            name: 'isAvailable',
            type: 'checkbox',
            required: true,
            defaultValue: false,

            label: {
                en: 'Available for delivery',
                am: 'ለመላክ ዝግጁ',
            },

            admin: {
                position: 'sidebar',

                description: {
                    en: 'Enable only after successful test delivery and confirmation of distribution permission.',
                    am: 'የሙከራ መላክ ከተሳካ እና የማሰራጨት ፈቃድ ከተረጋገጠ በኋላ ብቻ ያንቁ።',
                },
            },
        },

        {
            name: 'telegram',
            access: { update: () => false },
            type: 'group',

            label: {
                en: 'Telegram storage',
                am: 'የTelegram ማከማቻ',
            },

            admin: {
                description: {
                    en: 'Private file identifiers. Configure the storage group and bot credentials in environment variables.',
                    am: 'የግል ፋይል መለያዎች። የማከማቻ ቡድኑን እና የቦት ማረጋገጫ መረጃን በአካባቢ ተለዋዋጮች ያዋቅሩ።',
                },
            },

            fields: [
                {
                    name: 'fileId',
                    type: 'text',
                    required: false,

                    label: {
                        en: 'Telegram file ID',
                        am: 'የTelegram ፋይል መለያ',
                    },

                    validate: (value: unknown) => {
                        return value == null || (
                            (typeof value === 'string' &&
                                value.trim().length > 0 &&
                                value === value.trim()) ||
                            'Enter a Telegram file ID without surrounding whitespace.'
                        )
                    },

                    admin: {
                        description: {
                            en: 'Use the file ID received by the same bot that delivers the document.',
                            am: 'ሰነዱን በሚልከው ቦት የተቀበለውን የፋይል መለያ ያስገቡ።',
                        },
                    },
                },

                { name: 'messageId', type: 'number', min: 1, label: { en: 'Storage message ID', am: 'የማከማቻ መልእክት መለያ' } },
                {
                    name: 'fileUniqueId',
                    type: 'text',
                    index: true,

                    label: {
                        en: 'Telegram unique file ID',
                        am: 'የTelegram ልዩ ፋይል መለያ',
                    },

                    admin: {
                        description: {
                            en: 'For identifying duplicate files only. Not used for delivery.',
                            am: 'ተደጋጋሚ ፋይሎችን ለመለየት ብቻ። ለመላክ አይጠቅምም።',
                        },
                    },
                },
            ],
        },

        {
            name: 'rights',
            type: 'textarea',
            maxLength: 2000,

            label: {
                en: 'Distribution permission',
                am: 'የማሰራጨት ፈቃድ',
            },

            admin: {
                description: {
                    en: 'Record the license or permission allowing this file to be distributed.',
                    am: 'ይህን ፋይል ለማሰራጨት የሚያስችለውን ፈቃድ ይመዝግቡ።',
                },
            },
        },
    ],

    timestamps: true,
}