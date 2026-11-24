import { validateBook, categoryReferences, liveOnly, guardDeletion } from '../lib/server/library/catalog'
import type { CollectionConfig } from 'payload'

import {
    canAccessAdmin,
    isAdmin,
    isStaff,
    type UserAuth,
} from '../access'

export const Books: CollectionConfig = {
    slug: 'books',

    labels: {
        singular: {
            en: 'Book',
            am: 'መጽሐፍ',
        },
        plural: {
            en: 'Books',
            am: 'መጻሕፍት',
        },
    },

    admin: {
        group: {
            en: 'Library',
            am: 'ቤተ መጻሕፍት',
        },

        useAsTitle: 'title',

        defaultColumns: [
            'title',
            'language',
            '_status',
            'updatedAt',
        ],

        listSearchableFields: ['title', 'slug'],

        description: {
            en: 'Book details displayed in the library. Downloadable files are managed separately.',
            am: 'በቤተ መጻሕፍቱ የሚታዩ የመጻሕፍት ዝርዝሮች። የሚወርዱ ፋይሎች በተለየ ይተዳደራሉ።',
        },
    },

    access: {
        admin: canAccessAdmin,

        read: ({ req }) => {
            if (isStaff(req.user as UserAuth | null)) {
                return true
            }

            return {
                _status: {
                    equals: 'published',
                },
            }
        },

        readVersions: ({ req }) => {
            return isStaff(req.user as UserAuth | null)
        },

        create: ({ req }) => {
            return isStaff(req.user as UserAuth | null)
        },

        update: ({ req }) => {
            return isStaff(req.user as UserAuth | null)
        },

        delete: ({ req }) => {
            return isAdmin(req.user as UserAuth | null)
        },
    },

    hooks: {
        beforeOperation: [liveOnly],
        beforeValidate: [categoryReferences, validateBook],
        beforeDelete: [guardDeletion],
    },
    versions: {
        drafts: true,
        maxPerDoc: 30,
    },

    fields: [
        {
            name: 'title',
            type: 'text',
            required: true,
            localized: true,
            maxLength: 250,

            label: {
                en: 'Title',
                am: 'ርዕስ',
            },
        },

        {
            name: 'slug',
            type: 'text',
            required: true,
            unique: true,
            index: true,
            maxLength: 150,

            label: {
                en: 'Slug',
                am: 'የአገናኝ መለያ',
            },

            validate: (value: unknown) => {
                return (
                    (typeof value === 'string' &&
                        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) ||
                    'Use lowercase English letters, numbers, and single hyphens.'
                )
            },

            admin: {
                description: {
                    en: 'A stable identifier shared across languages. Avoid changing it after publication.',
                    am: 'በሁሉም ቋንቋዎች የሚጠቀሙበት ቋሚ መለያ። ከታተመ በኋላ መቀየርን ያስወግዱ።',
                },
            },
        },

        {
            name: 'description',
            type: 'textarea',
            localized: true,
            maxLength: 5000,

            label: {
                en: 'Description',
                am: 'መግለጫ',
            },

            admin: {
                description: {
                    en: 'Describe the book and its subject without copying the full text.',
                    am: 'ሙሉ ጽሑፉን ሳይቀዱ መጽሐፉን እና ርዕሰ ጉዳዩን ይግለጹ።',
                },
            },
        },

        {
            name: 'cover',
            type: 'upload',
            relationTo: 'media',

            label: {
                en: 'Book cover',
                am: 'የመጽሐፍ ሽፋን',
            },

            filterOptions: {
                purpose: {
                    equals: 'content',
                },
            },
        },

        {
            name: 'authors',
            type: 'array',

            label: {
                en: 'Authors',
                am: 'ደራሲዎች',
            },

            fields: [
                {
                    name: 'name',
                    type: 'text',
                    required: true,
                    maxLength: 200,

                    label: {
                        en: 'Author name',
                        am: 'የደራሲ ስም',
                    },
                },
            ],
        },

        {
            name: 'language',
            type: 'select',
            required: true,
            hasMany: true,

            label: {
                en: 'Book languages',
                am: 'የመጽሐፉ ቋንቋዎች',
            },

            options: [
                {
                    label: {
                        en: 'Amharic',
                        am: 'አማርኛ',
                    },
                    value: 'am',
                },
                {
                    label: {
                        en: "Ge'ez",
                        am: 'ግዕዝ',
                    },
                    value: 'gez',
                },
                {
                    label: {
                        en: 'English',
                        am: 'እንግሊዝኛ',
                    },
                    value: 'en',
                },
            ],

            admin: {
                description: {
                    en: 'Languages inside the book, independent of the interface language.',
                    am: 'ከመገናኛ ቋንቋው የተለዩ፣ በመጽሐፉ ውስጥ የሚገኙ ቋንቋዎች።',
                },
            },
        },

        {
            name: 'categories',
            type: 'relationship',
            relationTo: 'categories',
            hasMany: true,

            label: {
                en: 'Categories',
                am: 'ምድቦች',
            },

            filterOptions: {
                contentTypes: {
                    contains: 'books',
                },
            },
        },

        {
            name: 'file',
            type: 'relationship',
            relationTo: 'files',
            label: { en: 'Primary PDF', am: 'ዋና ፒዲኤፍ' },
            access: { read: ({ req }) => isStaff(req.user) },
            filterOptions: { mimeType: { equals: 'application/pdf' } },
        },
        {
            name: 'files',
            type: 'relationship',
            relationTo: 'files',
            hasMany: true,

            label: {
                en: 'Downloadable files',
                am: 'የሚወርዱ ፋይሎች',
            },

            access: {
                read: ({ req }) => {
                    return isStaff(req.user as UserAuth | null)
                },
            },

            admin: {
                description: {
                    en: 'Private file records for this book. Delivery must separately check login and file availability.',
                    am: 'የዚህ መጽሐፍ የግል ፋይል መዝገቦች። መላክ ከመፈቀዱ በፊት መግባት እና የፋይሉ ተደራሽነት መረጋገጥ አለባቸው።',
                },
            },
        },
    ],

    timestamps: true,
}