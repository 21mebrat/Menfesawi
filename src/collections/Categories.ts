import { validateCategory, readCategories, liveOnly, guardDeletion } from '../lib/server/library/catalog'
import type { CollectionConfig } from 'payload'

import {
    canAccessAdmin,
    isAdmin,
    isStaff,
    type UserAuth,
} from '../access'

export const Categories: CollectionConfig = {
    slug: 'categories',

    labels: {
        singular: {
            en: 'Category',
            am: 'ምድብ',
        },
        plural: {
            en: 'Categories',
            am: 'ምድቦች',
        },
    },

    admin: {
        group: {
            en: 'Content',
            am: 'ይዘት',
        },
        useAsTitle: 'name',
        defaultColumns: ['name', 'slug', 'updatedAt'],
        listSearchableFields: ['name', 'slug'],

        description: {
            en: 'Organize books, teachings, hymns, and articles by topic.',
            am: 'መጻሕፍትን፣ ትምህርቶችን፣ መዝሙሮችን እና ጽሑፎችን በርዕስ ይመድቡ።',
        },
    },

    access: {
        admin: canAccessAdmin,

        read: readCategories,
        readVersions: ({ req }) => isStaff(req.user),

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

    versions: { drafts: { validate: true }, maxPerDoc: 30 },
    hooks: {
        beforeOperation: [liveOnly],
        beforeValidate: [validateCategory],
        beforeDelete: [guardDeletion],
    },
    fields: [
        {
            name: 'parent',
            type: 'relationship',
            relationTo: 'categories',
            index: true,
            label: { en: 'Parent category', am: 'ወላጅ ምድብ' },
        },
        {
            name: 'name',
            type: 'text',
            required: true,
            localized: true,
            maxLength: 100,

            label: {
                en: 'Name',
                am: 'ስም',
            },

            admin: {
                description: {
                    en: 'The category name displayed in the selected content language.',
                    am: 'በተመረጠው የይዘት ቋንቋ የሚታየው የምድቡ ስም።',
                },
            },
        },

        {
            name: 'slug',
            type: 'text',
            required: true,
            unique: true,
            index: true,
            localized: false,
            maxLength: 100,

            label: {
                en: 'Slug',
                am: 'የአገናኝ መለያ',
            },

            validate: (value: unknown) => {
                if (
                    typeof value !== 'string' ||
                    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
                ) {
                    return (
                        'Use lowercase English letters, numbers, and single hyphens. ' +
                        'Example: church-history'
                    )
                }

                return true
            },

            admin: {
                placeholder: 'church-history',

                description: {
                    en: 'A unique identifier shared across languages. Avoid changing it after publication.',
                    am: 'በሁሉም ቋንቋዎች የሚጠቀሙበት ልዩ መለያ። ከታተመ በኋላ መቀየርን ያስወግዱ።',
                },
            },
        },

        {
            name: 'description',
            type: 'textarea',
            localized: true,
            maxLength: 1000,

            label: {
                en: 'Description',
                am: 'መግለጫ',
            },

            admin: {
                description: {
                    en: 'Briefly explain which topics belong in this category.',
                    am: 'በዚህ ምድብ ውስጥ የሚካተቱትን ርዕሶች በአጭሩ ይግለጹ።',
                },
            },
        },

        {
            name: 'contentTypes',
            type: 'select',
            hasMany: true,
            required: true,

            label: {
                en: 'Applicable content',
                am: 'የሚመለከታቸው ይዘቶች',
            },

            options: [
                {
                    label: {
                        en: 'Books',
                        am: 'መጻሕፍት',
                    },
                    value: 'books',
                },
                {
                    label: {
                        en: 'Teachings',
                        am: 'ትምህርቶች',
                    },
                    value: 'teachings',
                },
                {
                    label: {
                        en: 'Hymns',
                        am: 'መዝሙሮች',
                    },
                    value: 'hymns',
                },
                {
                    label: {
                        en: 'Articles',
                        am: 'ጽሑፎች',
                    },
                    value: 'articles',
                },
            ],

            admin: {
                description: {
                    en: 'Select where this category should be available.',
                    am: 'ይህ ምድብ የሚጠቀምባቸውን የይዘት ዓይነቶች ይምረጡ።',
                },
            },
        },
    ],

    timestamps: true,
}