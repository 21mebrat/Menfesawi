import type { Block } from 'payload'

/**
 * VisualMediaLayout Block
 *
 * PURPOSE:
 * Provides a 100% visual, mouse-driven WYSIWYG media grid and collage editor
 * inside the Lexical Rich Text editor without form-based configurations.
 *
 * FEATURES:
 * - Freeform visual multi-column and asymmetric grid building via mouse drag & drop.
 * - Interactive proportional column resizing by mouse cursor drag.
 * - Inline searchable media selector with thumbnails and "+ Create New Media" upload.
 * - Zero input forms or dropdowns required to configure layouts.
 */
export const VisualMediaLayout: Block = {
  slug: 'visualMediaLayout',
  labels: {
    singular: {
      en: 'Visual Media Layout',
      am: 'የምስል አቀማመጥ (Visual Grid)',
    },
    plural: {
      en: 'Visual Media Layouts',
      am: 'የምስል አቀማመጦች',
    },
  },
  admin: {
    components: {
      Block: '/components/lexical/VisualMediaLayoutBlock',
    },
  },
  fields: [
    {
      name: 'layoutData',
      type: 'json',
      admin: {
        hidden: true,
      },
    },
    {
      name: 'mediaItems',
      type: 'relationship',
      relationTo: 'media',
      hasMany: true,
      admin: {
        hidden: true,
      },
    },
    {
      name: 'caption',
      type: 'text',
      localized: true,
      admin: {
        hidden: true,
      },
    },
    {
      name: 'images',
      type: 'array',
      admin: {
        hidden: true,
      },
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
        },
        {
          name: 'caption',
          type: 'text',
        },
        {
          name: 'altText',
          type: 'text',
        },
      ],
    },
  ],
}
