import type { Block } from 'payload'

export const ImageGallery: Block = {
  slug: 'imageGallery',
  labels: {
    singular: {
      en: 'Image Gallery',
      am: 'የምስል ማዕከለ-ስዕላት (Image Gallery)',
    },
    plural: {
      en: 'Image Galleries',
      am: 'የምስል ማዕከለ-ስዕላት',
    },
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'title',
          type: 'text',
          localized: true,
          label: {
            en: 'Gallery Title',
            am: 'የማዕከለ-ስዕላት ርዕስ',
          },
          admin: {
            width: '50%',
          },
        },
        {
          name: 'layout',
          type: 'select',
          defaultValue: 'columns-3',
          label: {
            en: 'Gallery Layout',
            am: 'የማዕከለ-ስዕላት አቀማመጥ',
          },
          admin: {
            width: '50%',
          },
          options: [
            { label: { en: '3 Columns Grid', am: '3 አምዶች' }, value: 'columns-3' },
            { label: { en: '2 Columns Side-by-Side', am: '2 አምዶች (ጎን ለጎን)' }, value: 'columns-2' },
            { label: { en: 'Telegram Smart Mosaic', am: 'የቴሌግራም ሞዛይክ' }, value: 'telegram-auto' },
            { label: { en: 'Staggered Masonry', am: 'ሜሶነሪ (Masonry)' }, value: 'masonry' },
            { label: { en: 'Carousel Slider', am: 'ተንሸራታች ካሮሴል' }, value: 'carousel' },
          ],
        },
      ],
    },
    {
      name: 'images',
      type: 'array',
      required: true,
      minRows: 1,
      label: {
        en: 'Gallery Images',
        am: 'የማዕከለ-ስዕላት ምስሎች',
      },
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          required: true,
          label: {
            en: 'Image',
            am: 'ምስል',
          },
        },
        {
          name: 'caption',
          type: 'text',
          localized: true,
          label: {
            en: 'Caption',
            am: 'መግለጫ',
          },
        },
      ],
    },
  ],
}
