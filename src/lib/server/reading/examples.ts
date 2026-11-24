import type { PublicationStructureConfig } from './types'

/**
 * Bible configuration template:
 * Allows both Testament -> Division -> Book -> Chapter -> Verse
 * and direct Book -> Chapter -> Verse hierarchies.
 */
export const biblePublicationStructure: PublicationStructureConfig = {
  maxDepth: 5,
  sectionTypes: [
    {
      key: 'testament',
      labels: {
        singular: { en: 'Testament', am: 'ኪዳን' },
        plural: { en: 'Testaments', am: 'ኪዳናት' },
      },
      actionLabels: { en: 'Add Testament', am: 'ኪዳን ጨምር' },
      allowedAtRoot: true,
      allowedChildTypes: [{ typeKey: 'division' }, { typeKey: 'book' }],
      allowPassages: false,
      numberingPolicy: 'none',
    },
    {
      key: 'division',
      labels: {
        singular: { en: 'Division', am: 'ክፍል' },
        plural: { en: 'Divisions', am: 'ክፍሎች' },
      },
      actionLabels: { en: 'Add Division', am: 'ክፍል ጨምር' },
      allowedAtRoot: false,
      allowedChildTypes: [{ typeKey: 'book' }],
      allowPassages: false,
      numberingPolicy: 'none',
    },
    {
      key: 'book',
      labels: {
        singular: { en: 'Book', am: 'መጽሐፍ' },
        plural: { en: 'Books', am: 'መጻሕፍት' },
      },
      actionLabels: { en: 'Add Book', am: 'መጽሐፍ ጨምር' },
      allowedAtRoot: true,
      allowedChildTypes: [{ typeKey: 'chapter' }],
      allowPassages: false,
      numberingPolicy: 'none',
    },
    {
      key: 'chapter',
      labels: {
        singular: { en: 'Chapter', am: 'ምዕራፍ' },
        plural: { en: 'Chapters', am: 'ምዕራፎች' },
      },
      actionLabels: { en: 'Add Chapter', am: 'ምዕራፍ ጨምር' },
      allowedAtRoot: false,
      allowedChildTypes: [],
      allowPassages: true,
      passageTerminology: {
        singular: { en: 'Verse', am: 'ቁጥር' },
        plural: { en: 'Verses', am: 'ቁጥሮች' },
      },
      numberingPolicy: 'required',
    },
  ],
}

/**
 * Wudase Maryam configuration template:
 * Structure: Day -> Named Prayer -> Paragraphs / Stanzas
 */
export const wudaseMaryamPublicationStructure: PublicationStructureConfig = {
  maxDepth: 3,
  sectionTypes: [
    {
      key: 'day',
      labels: {
        singular: { en: 'Day', am: 'ዕለት' },
        plural: { en: 'Days', am: 'ዕለታት' },
      },
      actionLabels: { en: 'Add Day', am: 'ዕለት ጨምር' },
      allowedAtRoot: true,
      allowedChildTypes: [{ typeKey: 'prayer' }],
      allowPassages: false,
      numberingPolicy: 'none',
    },
    {
      key: 'prayer',
      labels: {
        singular: { en: 'Named Prayer', am: 'ጸሎት' },
        plural: { en: 'Named Prayers', am: 'ጸሎታት' },
      },
      actionLabels: { en: 'Add Prayer', am: 'ጸሎት ጨምር' },
      allowedAtRoot: false,
      allowedChildTypes: [],
      allowPassages: true,
      passageTerminology: {
        singular: { en: 'Paragraph', am: 'አንቀጽ' },
        plural: { en: 'Paragraphs', am: 'አንቀጾች' },
      },
      numberingPolicy: 'optional',
    },
  ],
}

/**
 * Returns complete sample publication payload data for Bible.
 */
export function getBibleExamplePublicationData() {
  return {
    title: 'The Holy Bible / መጽሐፍ ቅዱስ',
    slug: 'holy-bible',
    description: 'Canonical Holy Scriptures of the Ethiopian Orthodox Tewahedo Church.',
    rights: 'Public Domain / Free for liturgical and personal spiritual use',
    structure: biblePublicationStructure,
    _status: 'published' as const,
  }
}

/**
 * Returns complete sample publication payload data for Wudase Maryam.
 */
export function getWudaseMaryamExamplePublicationData() {
  return {
    title: 'Wudase Maryam / ውዳሴ ማርያም',
    slug: 'wudase-maryam',
    description: 'Daily praises of St. Mary composed by St. Ephrem the Syrian.',
    rights: 'Ethiopian Orthodox Tewahedo Church Liturgical Heritage',
    structure: wudaseMaryamPublicationStructure,
    _status: 'published' as const,
  }
}
