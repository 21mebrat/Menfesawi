import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { getPayload, type Payload } from 'payload'
import configPromise from '@/payload.config'
import type { User } from '@/payload-types'
import {
  biblePublicationStructure,
  wudaseMaryamPublicationStructure,
  getBibleExamplePublicationData,
  getWudaseMaryamExamplePublicationData,
} from '@/lib/server/reading/examples'
import {
  getRootSections,
  getDirectChildren,
  getBreadcrumbs,
  getOrderedPassages,
  getPreviousAndNextSection,
} from '@/lib/server/reading/navigation'

describe('Structured Reading System Integration & Validation', () => {
  let payload: Payload
  let adminUser: User
  let editorUser: User
  let memberUser: User
  let inactiveAdminUser: User

  const createdPublicationIds: (string | number)[] = []
  const createdSectionIds: (string | number)[] = []
  const createdPassageIds: (string | number)[] = []
  const createdUserIds: (string | number)[] = []

  const testPassword = 'Password123!'
  const runId = Date.now()

  async function expectValidationError(
    promise: Promise<any>,
    messagePattern: RegExp,
    fieldPath?: string,
  ) {
    let threw = false
    try {
      await promise
    } catch (err: any) {
      threw = true
      const innerMsg =
        err.data?.errors?.[0]?.message ||
        err.errors?.[0]?.message ||
        (Array.isArray(err.data?.errors)
          ? err.data.errors.map((e: any) => e.message).join('; ')
          : '') ||
        err.message ||
        ''
      expect(innerMsg).toMatch(messagePattern)
      if (fieldPath) {
        expect(err.message).toContain(fieldPath)
      }
    }
    expect(threw).toBe(true)
  }

  beforeAll(async () => {
    const config = await configPromise
    payload = await getPayload({ config })

    adminUser = await payload.create({
      collection: 'users',
      data: {
        email: `reading-admin-${runId}@example.com`,
        name: 'Reading Admin',
        role: 'admin',
        isActive: true,
        password: testPassword,
      },
      overrideAccess: true,
    })
    createdUserIds.push(adminUser.id)

    editorUser = await payload.create({
      collection: 'users',
      data: {
        email: `reading-editor-${runId}@example.com`,
        name: 'Reading Editor',
        role: 'editor',
        isActive: true,
        password: testPassword,
      },
      overrideAccess: true,
    })
    createdUserIds.push(editorUser.id)

    memberUser = await payload.create({
      collection: 'users',
      data: {
        email: `reading-member-${runId}@example.com`,
        name: 'Reading Member',
        role: 'member',
        isActive: true,
        password: testPassword,
      },
      overrideAccess: true,
    })
    createdUserIds.push(memberUser.id)

    inactiveAdminUser = await payload.create({
      collection: 'users',
      data: {
        email: `reading-inactive-${runId}@example.com`,
        name: 'Reading Inactive Admin',
        role: 'admin',
        isActive: false,
        password: testPassword,
      },
      overrideAccess: true,
    })
    createdUserIds.push(inactiveAdminUser.id)
  })

  afterAll(async () => {
    // Clean up passages
    for (const id of createdPassageIds) {
      await payload
        .delete({ collection: 'passages', id, overrideAccess: true })
        .catch(() => {})
    }
    // Clean up sections (in reverse to delete children first)
    for (const id of createdSectionIds.reverse()) {
      await payload
        .delete({ collection: 'publication-sections', id, overrideAccess: true })
        .catch(() => {})
    }
    // Clean up publications
    for (const id of createdPublicationIds) {
      await payload
        .delete({ collection: 'publications', id, overrideAccess: true })
        .catch(() => {})
    }
    // Clean up users
    for (const id of createdUserIds) {
      await payload
        .delete({ collection: 'users', id, overrideAccess: true })
        .catch(() => {})
    }
  })

  describe('1. Publication Structure Configuration & Reusability', () => {
    it('creates Bible and Wudase Maryam publications in the same collection', async () => {
      const bible = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          slug: `bible-${runId}`,
        },
        user: editorUser,
      })
      createdPublicationIds.push(bible.id)
      expect(bible.id).toBeDefined()
      expect(bible.structure.maxDepth).toBe(5)
      expect(bible.structure.sectionTypes.length).toBe(4)

      const wudase = await payload.create({
        collection: 'publications',
        data: {
          ...getWudaseMaryamExamplePublicationData(),
          slug: `wudase-maryam-${runId}`,
        },
        user: editorUser,
      })
      createdPublicationIds.push(wudase.id)
      expect(wudase.id).toBeDefined()
      expect(wudase.structure.maxDepth).toBe(3)
      expect(wudase.structure.sectionTypes.length).toBe(2)
    })

    it('rejects publication with invalid maxDepth (< 1 or > 10)', async () => {
      await expect(
        payload.create({
          collection: 'publications',
          data: {
            title: 'Invalid Depth',
            slug: `invalid-depth-${runId}`,
            structure: {
              maxDepth: 15,
              sectionTypes: biblePublicationStructure.sectionTypes,
            },
          },
          user: editorUser,
        }),
      ).rejects.toThrow()
    })

    it('rejects publication with circular section type hierarchy', async () => {
      await expectValidationError(
        payload.create({
          collection: 'publications',
          data: {
            title: 'Circular Structure',
            slug: `circular-struct-${runId}`,
            structure: {
              maxDepth: 5,
              sectionTypes: [
                {
                  key: 'type-a',
                  labels: {
                    singular: { en: 'A', am: 'ሀ' },
                    plural: { en: 'As', am: 'ሀዎች' },
                  },
                  allowedAtRoot: true,
                  allowedChildTypes: [{ typeKey: 'type-b' }],
                  allowPassages: false,
                  numberingPolicy: 'none',
                },
                {
                  key: 'type-b',
                  labels: {
                    singular: { en: 'B', am: 'ለ' },
                    plural: { en: 'Bs', am: 'ለዎች' },
                  },
                  allowedAtRoot: false,
                  allowedChildTypes: [{ typeKey: 'type-a' }], // circular cycle A -> B -> A
                  allowPassages: false,
                  numberingPolicy: 'none',
                },
              ],
            },
          },
          user: editorUser,
        }),
        /Circular section type hierarchy detected/,
        'structure.sectionTypes',
      )
    })

    it('rejects publication with no root-allowed section type', async () => {
      await expectValidationError(
        payload.create({
          collection: 'publications',
          data: {
            title: 'No Root Structure',
            slug: `no-root-${runId}`,
            structure: {
              maxDepth: 5,
              sectionTypes: [
                {
                  key: 'orphan-type',
                  labels: {
                    singular: { en: 'Orphan', am: 'ብቻ' },
                    plural: { en: 'Orphans', am: 'ብቻዎች' },
                  },
                  allowedAtRoot: false, // No root!
                  allowedChildTypes: [],
                  allowPassages: true,
                  numberingPolicy: 'optional',
                },
              ],
            },
          },
          user: editorUser,
        }),
        /At least one section type must be allowed at the root/,
        'structure.sectionTypes',
      )
    })

    it('rejects updating publication structure to remove a section type in active use', async () => {
      const pub = await payload.create({
        collection: 'publications',
        data: {
          title: 'Custom Invalidation Pub',
          slug: `custom-inval-${runId}`,
          structure: {
            maxDepth: 3,
            sectionTypes: [
              {
                key: 'root-t',
                labels: { singular: { en: 'R', am: 'ዋ' }, plural: { en: 'Rs', am: 'ዋዎች' } },
                allowedAtRoot: true,
                allowedChildTypes: [{ typeKey: 'child-t' }],
                allowPassages: false,
                numberingPolicy: 'none',
              },
              {
                key: 'child-t',
                labels: { singular: { en: 'C', am: 'ን' }, plural: { en: 'Cs', am: 'ንዎች' } },
                allowedAtRoot: false,
                allowedChildTypes: [],
                allowPassages: true,
                numberingPolicy: 'none',
              },
            ],
          },
        },
        user: adminUser,
      })
      createdPublicationIds.push(pub.id)

      const rootSec = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'root-t',
          title: 'Root Sec',
          slug: 'root-sec',
          order: 1,
        },
        user: adminUser,
      })
      createdSectionIds.push(rootSec.id)

      const childSec = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          parent: rootSec.id,
          typeKey: 'child-t',
          title: 'Child Sec',
          slug: 'child-sec',
          order: 1,
        },
        user: adminUser,
      })
      createdSectionIds.push(childSec.id)

      // Try to update publication removing child-t
      await expectValidationError(
        payload.update({
          collection: 'publications',
          id: pub.id,
          data: {
            structure: {
              maxDepth: 3,
              sectionTypes: [
                {
                  key: 'root-t',
                  labels: { singular: { en: 'R', am: 'ዋ' }, plural: { en: 'Rs', am: 'ዋዎች' } },
                  allowedAtRoot: true,
                  allowedChildTypes: [],
                  allowPassages: true,
                  numberingPolicy: 'none',
                },
              ],
            },
          },
          user: adminUser,
        }),
        /Cannot remove section type 'child-t' because existing section/i,
        'structure.sectionTypes',
      )
    })
  })

  describe('2. Section Hierarchy Integrity & Tree Validation', () => {
    let biblePub: any
    let wudasePub: any
    let testamentSection: any
    let daySection: any
    let book1Section: any
    let book2Section: any
    let ch1JohnSection: any

    beforeAll(async () => {
      biblePub = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          slug: `bible-tree-${runId}`,
        },
        user: adminUser,
      })
      createdPublicationIds.push(biblePub.id)

      wudasePub = await payload.create({
        collection: 'publications',
        data: {
          ...getWudaseMaryamExamplePublicationData(),
          slug: `wudase-tree-${runId}`,
        },
        user: adminUser,
      })
      createdPublicationIds.push(wudasePub.id)
    })

    it('rejects root section with non-root-allowed type', async () => {
      // In Bible, 'chapter' has allowedAtRoot: false
      await expectValidationError(
        payload.create({
          collection: 'publication-sections',
          data: {
            publication: biblePub.id,
            typeKey: 'chapter',
            title: 'Floating Chapter',
            slug: 'floating-chapter',
            order: 1,
          },
          user: editorUser,
        }),
        /not allowed at the publication root/,
        'typeKey',
      )
    })

    it('allows permitted root sections (testament or book in Bible, day in Wudase)', async () => {
      testamentSection = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: biblePub.id,
          typeKey: 'testament',
          title: 'New Testament / ሐዲስ ኪዳን',
          slug: 'new-testament',
          order: 2,
        },
        user: editorUser,
      })
      createdSectionIds.push(testamentSection.id)
      expect(testamentSection.depth).toBe(0)
      expect(testamentSection.ancestors).toEqual([])

      daySection = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: wudasePub.id,
          typeKey: 'day',
          title: 'Sunday Praises / የእሑድ ውዳሴ ማርያም',
          slug: 'sunday-praises',
          weekday: 'sunday',
          order: 1,
        },
        user: editorUser,
      })
      createdSectionIds.push(daySection.id)
      expect(daySection.depth).toBe(0)
    })

    it('rejects cross-publication parenting', async () => {
      // Try to create a Wudase Maryam section with a Bible parent
      await expectValidationError(
        payload.create({
          collection: 'publication-sections',
          data: {
            publication: wudasePub.id,
            parent: testamentSection.id,
            typeKey: 'prayer',
            title: 'Cross Publication Prayer',
            slug: 'cross-prayer',
            order: 1,
          },
          user: editorUser,
        }),
        /Parent section belongs to a different publication/,
        'parent',
      )
    })

    it('rejects child type not permitted under parent', async () => {
      // 'chapter' cannot be directly under 'testament' (testament allows 'division' or 'book')
      await expectValidationError(
        payload.create({
          collection: 'publication-sections',
          data: {
            publication: biblePub.id,
            parent: testamentSection.id,
            typeKey: 'chapter',
            title: 'Premature Chapter',
            slug: 'premature-chapter',
            order: 1,
          },
          user: editorUser,
        }),
        /does not permit child sections of type 'chapter'/,
        'typeKey',
      )
    })

    it('rejects sibling duplicate slugs under the same parent', async () => {
      book1Section = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: biblePub.id,
          parent: testamentSection.id,
          typeKey: 'book',
          title: 'Gospel of John / የዮሐንስ ወንጌል',
          slug: 'john',
          order: 1,
        },
        user: editorUser,
      })
      createdSectionIds.push(book1Section.id)

      // Duplicate slug under same parent
      await expectValidationError(
        payload.create({
          collection: 'publication-sections',
          data: {
            publication: biblePub.id,
            parent: testamentSection.id,
            typeKey: 'book',
            title: 'First Epistle of John / ፩ኛ የዮሐንስ መልእክት',
            slug: 'john',
            order: 2,
          },
          user: editorUser,
        }),
        /sibling section with slug 'john' already exists/i,
        'slug',
      )
    })

    it('allows identical slugs under different parents', async () => {
      // Create another book under testament
      book2Section = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: biblePub.id,
          parent: testamentSection.id,
          typeKey: 'book',
          title: 'Gospel of Matthew / የማቴዎስ ወንጌል',
          slug: 'matthew',
          order: 2,
        },
        user: editorUser,
      })
      createdSectionIds.push(book2Section.id)

      // Chapter 1 under John
      ch1JohnSection = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: biblePub.id,
          parent: book1Section.id,
          typeKey: 'chapter',
          title: 'Chapter 1 / ምዕራፍ ፩',
          slug: 'chapter-1',
          number: 1,
          order: 1,
        },
        user: editorUser,
      })
      createdSectionIds.push(ch1JohnSection.id)

      // Chapter 1 under Matthew (same slug 'chapter-1', but different parent)
      const ch1Matthew = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: biblePub.id,
          parent: book2Section.id,
          typeKey: 'chapter',
          title: 'Chapter 1 / ምዕራፍ ፩',
          slug: 'chapter-1',
          number: 1,
          order: 1,
        },
        user: editorUser,
      })
      createdSectionIds.push(ch1Matthew.id)
      expect(ch1Matthew.id).toBeDefined()
    })

    it('rejects self-parenting', async () => {
      await expectValidationError(
        payload.update({
          collection: 'publication-sections',
          id: book1Section.id,
          data: {
            parent: book1Section.id,
          },
          user: editorUser,
        }),
        /self-parenting/,
        'parent',
      )
    })

    it('rejects circular ancestry when moving a section', async () => {
      // Try to set John's parent to Chapter 1 (its descendant)
      await expectValidationError(
        payload.update({
          collection: 'publication-sections',
          id: book1Section.id,
          data: {
            parent: ch1JohnSection.id,
          },
          user: editorUser,
        }),
        /Circular ancestry detected/,
        'parent',
      )
    })

    it('rejects changing publication if section has descendants', async () => {
      await expectValidationError(
        payload.update({
          collection: 'publication-sections',
          id: book1Section.id,
          data: {
            publication: wudasePub.id,
          },
          user: editorUser,
        }),
        /Cannot move a section to a different publication while it contains child sections/,
        'publication',
      )
    })

    it('rejects duplicate sibling slugs at root level', async () => {
      await expectValidationError(
        payload.create({
          collection: 'publication-sections',
          data: {
            publication: biblePub.id,
            typeKey: 'testament',
            title: 'Another New Testament',
            slug: 'new-testament', // same slug as testamentSection at root!
            order: 3,
          },
          user: editorUser,
        }),
        /sibling section with slug 'new-testament' already exists/i,
        'slug',
      )
    })

    it('enforces maximum depth limit for sections and subtree moves', async () => {
      const pubDepth = await payload.create({
        collection: 'publications',
        data: {
          title: 'Depth Test Pub',
          slug: `depth-test-${runId}`,
          structure: {
            maxDepth: 2,
            sectionTypes: [
              {
                key: 'root-node',
                labels: { singular: { en: 'RN', am: 'ዋ' }, plural: { en: 'RNs', am: 'ዋ' } },
                allowedAtRoot: true,
                allowedChildTypes: [{ typeKey: 'branch-node' }],
                allowPassages: false,
                numberingPolicy: 'none',
              },
              {
                key: 'branch-node',
                labels: { singular: { en: 'BN', am: 'ቅርን' }, plural: { en: 'BNs', am: 'ቅርን' } },
                allowedAtRoot: true,
                allowedChildTypes: [{ typeKey: 'leaf-node' }],
                allowPassages: false,
                numberingPolicy: 'none',
              },
              {
                key: 'leaf-node',
                labels: { singular: { en: 'LN', am: 'ቅጠ' }, plural: { en: 'LNs', am: 'ቅጠ' } },
                allowedAtRoot: false,
                allowedChildTypes: [],
                allowPassages: true,
                numberingPolicy: 'none',
              },
            ],
          },
        },
        user: adminUser,
      })
      createdPublicationIds.push(pubDepth.id)

      const root1 = await payload.create({
        collection: 'publication-sections',
        data: { publication: pubDepth.id, typeKey: 'root-node', title: 'Root 1', slug: 'root-1', order: 1 },
        user: adminUser,
      })
      createdSectionIds.push(root1.id)

      const branch1 = await payload.create({
        collection: 'publication-sections',
        data: { publication: pubDepth.id, parent: root1.id, typeKey: 'branch-node', title: 'Branch 1', slug: 'branch-1', order: 1 },
        user: adminUser,
      })
      createdSectionIds.push(branch1.id)

      const leaf1 = await payload.create({
        collection: 'publication-sections',
        data: { publication: pubDepth.id, parent: branch1.id, typeKey: 'leaf-node', title: 'Leaf 1', slug: 'leaf-1', order: 1 },
        user: adminUser,
      })
      createdSectionIds.push(leaf1.id)
      expect(leaf1.depth).toBe(2)

      // Updating pubDepth to maxDepth 1 must be rejected because leaf1 is already at depth 2
      await expectValidationError(
        payload.update({
          collection: 'publications',
          id: pubDepth.id,
          data: {
            structure: {
              maxDepth: 1,
              sectionTypes: [
                {
                  key: 'root-node',
                  labels: { singular: { en: 'RN', am: 'ዋ' }, plural: { en: 'RNs', am: 'ዋ' } },
                  allowedAtRoot: true,
                  allowedChildTypes: [{ typeKey: 'branch-node' }],
                  allowPassages: false,
                  numberingPolicy: 'none',
                },
                {
                  key: 'branch-node',
                  labels: { singular: { en: 'BN', am: 'ቅርን' }, plural: { en: 'BNs', am: 'ቅርን' } },
                  allowedAtRoot: true,
                  allowedChildTypes: [{ typeKey: 'leaf-node' }],
                  allowPassages: false,
                  numberingPolicy: 'none',
                },
                {
                  key: 'leaf-node',
                  labels: { singular: { en: 'LN', am: 'ቅጠ' }, plural: { en: 'LNs', am: 'ቅጠ' } },
                  allowedAtRoot: false,
                  allowedChildTypes: [],
                  allowPassages: true,
                  numberingPolicy: 'none',
                },
              ],
            },
          },
          user: adminUser,
        }),
        /exceeds maxDepth/i,
        'structure.maxDepth',
      )
    })
  })

  describe('3. Passage Integrity & Policy Enforcement', () => {
    let biblePub: any
    let johnBook: any
    let johnCh1: any

    beforeAll(async () => {
      biblePub = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          slug: `bible-passages-${runId}`,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(biblePub.id)

      johnBook = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: biblePub.id,
          typeKey: 'book',
          title: 'Gospel of John',
          slug: 'john-passages',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(johnBook.id)

      johnCh1 = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: biblePub.id,
          parent: johnBook.id,
          typeKey: 'chapter',
          title: 'Chapter 1',
          slug: 'ch-1',
          number: 1,
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(johnCh1.id)
    })

    it('rejects attaching passages to sections where allowPassages is false', async () => {
      // In Bible, 'book' has allowPassages: false
      await expectValidationError(
        payload.create({
          collection: 'passages',
          data: {
            section: johnBook.id,
            order: 1,
            number: 1,
            text: {
              amharic: 'በመጀመሪያ ቃል ነበረ',
            },
          },
          user: editorUser,
        }),
        /do not permit passages according to the publication structure/,
        'section',
      )
    })

    it('rejects publishing passage without positive number when numbering policy is required', async () => {
      // 'chapter' has numberingPolicy: 'required'
      await expectValidationError(
        payload.create({
          collection: 'passages',
          data: {
            section: johnCh1.id,
            order: 1,
            number: undefined,
            _status: 'published',
            text: {
              amharic: 'በመጀመሪያ ቃል ነበረ',
            },
          },
          user: editorUser,
        }),
        /positive integer passage number is required/,
        'number',
      )
    })

    it('allows drafting passage without number', async () => {
      const draftPassage = await payload.create({
        collection: 'passages',
        data: {
          section: johnCh1.id,
          order: 1,
          number: undefined,
          _status: 'draft',
          text: {
            amharic: 'Draft verse without number',
          },
        },
        user: editorUser,
      })
      createdPassageIds.push(draftPassage.id)
      expect(draftPassage.id).toBeDefined()
      expect(draftPassage._status).toBe('draft')
    })

    it('rejects publishing passage with all language texts empty', async () => {
      await expectValidationError(
        payload.create({
          collection: 'passages',
          data: {
            section: johnCh1.id,
            order: 2,
            number: 2,
            _status: 'published',
            text: {
              geez: '',
              amharic: '   ',
              english: '',
            },
          },
          user: editorUser,
        }),
        /At least one passage text/,
        'text',
      )
    })

    it('allows publishing passage with single language text (e.g. Ge’ez only or Amharic only)', async () => {
      const v1 = await payload.create({
        collection: 'passages',
        data: {
          section: johnCh1.id,
          order: 1,
          number: 1,
          displayLabel: 'Verse 1 / ቁጥር ፩',
          _status: 'published',
          text: {
            geez: 'ቀዳሚሁ ቃል ውእቱ',
            amharic: 'በመጀመሪያ ቃል ነበረ',
            english: 'In the beginning was the Word',
          },
          notes: [
            {
              content: 'St. John Chrysostom Homily on John 1:1',
              visibility: 'public',
              source: 'Homilies on the Gospel of Saint John',
            },
            {
              content: 'Internal editorial note: check Geez vocalization',
              visibility: 'editorial',
            },
          ],
        },
        user: editorUser,
      })
      createdPassageIds.push(v1.id)
      expect(v1.id).toBeDefined()
      expect(v1.isPublishedEffective).toBe(true)
    })

    it('preserves existing language texts during partial passage update', async () => {
      const v1Id = createdPassageIds[createdPassageIds.length - 1]
      const updated = await payload.update({
        collection: 'passages',
        id: v1Id,
        data: {
          displayLabel: 'Updated Verse 1 Label',
        },
        user: editorUser,
      })
      expect(updated.text?.geez).toBe('ቀዳሚሁ ቃል ውእቱ')
      expect(updated.text?.amharic).toBe('በመጀመሪያ ቃል ነበረ')
      expect(updated.text?.english).toBe('In the beginning was the Word')
    })
  })

  describe('4. Ancestor Visibility Enforcement & Public Queries', () => {
    let testPub: any
    let rootSec: any
    let childSec: any
    let passage: any

    beforeAll(async () => {
      testPub = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          slug: `vis-pub-${runId}`,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(testPub.id)

      rootSec = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: testPub.id,
          typeKey: 'book',
          title: 'Genesis',
          slug: 'genesis',
          order: 1,
          _status: 'draft', // DRAFT ROOT!
        },
        user: adminUser,
      })
      createdSectionIds.push(rootSec.id)

      childSec = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: testPub.id,
          parent: rootSec.id,
          typeKey: 'chapter',
          title: 'Chapter 1',
          slug: 'ch-1',
          number: 1,
          order: 1,
          _status: 'published', // Published child, but parent is draft!
        },
        user: adminUser,
      })
      createdSectionIds.push(childSec.id)

      passage = await payload.create({
        collection: 'passages',
        data: {
          section: childSec.id,
          order: 1,
          number: 1,
          displayLabel: 'Genesis 1:1',
          _status: 'published', // Published passage!
          text: {
            amharic: 'በመጀመሪያ እግዚአብሔር ሰማይንና ምድርን ፈጠረ።',
          },
          notes: [
            {
              content: 'Public note on Genesis',
              visibility: 'public',
            },
            {
              content: 'Secret editorial note',
              visibility: 'editorial',
            },
          ],
        },
        user: adminUser,
      })
      createdPassageIds.push(passage.id)
    })

    it('denies public visibility when an ancestor section is a draft', async () => {
      // Child section and passage must have isPublishedEffective = false
      const refreshedChild = await payload.findByID({
        collection: 'publication-sections',
        id: childSec.id,
        overrideAccess: true,
      })
      expect(refreshedChild.isPublishedEffective).toBe(false)

      const refreshedPassage = await payload.findByID({
        collection: 'passages',
        id: passage.id,
        overrideAccess: true,
      })
      expect(refreshedPassage.isPublishedEffective).toBe(false)

      // Public / non-staff read query returns 0 documents
      const publicPassages = await payload.find({
        collection: 'passages',
        where: { id: { equals: passage.id } },
        user: memberUser,
        overrideAccess: false,
      })
      expect(publicPassages.totalDocs).toBe(0)

      const publicSections = await payload.find({
        collection: 'publication-sections',
        where: { id: { equals: childSec.id } },
        user: memberUser,
        overrideAccess: false,
      })
      expect(publicSections.totalDocs).toBe(0)
    })

    it('cascades effective published state when root section is published', async () => {
      // Publish the root section
      await payload.update({
        collection: 'publication-sections',
        id: rootSec.id,
        data: {
          _status: 'published',
        },
        user: adminUser,
      })

      // Child section and passage should now be effectively published
      const refreshedChild = await payload.findByID({
        collection: 'publication-sections',
        id: childSec.id,
        overrideAccess: true,
      })
      expect(refreshedChild.isPublishedEffective).toBe(true)

      const refreshedPassage = await payload.findByID({
        collection: 'passages',
        id: passage.id,
        overrideAccess: true,
      })
      expect(refreshedPassage.isPublishedEffective).toBe(true)

      // Public user can now see it
      const publicPassages = await payload.find({
        collection: 'passages',
        where: { id: { equals: passage.id } },
        user: memberUser,
        overrideAccess: false,
      })
      expect(publicPassages.totalDocs).toBe(1)
    })

    it('strips editorial notes from non-staff / public users', async () => {
      const publicPassages = await payload.find({
        collection: 'passages',
        where: { id: { equals: passage.id } },
        user: memberUser,
        overrideAccess: false,
      })

      const readPassage = publicPassages.docs[0]
      expect(readPassage.notes?.length).toBe(1)
      expect(readPassage.notes?.[0].visibility).toBe('public')

      // Staff user sees all notes
      const staffPassages = await payload.find({
        collection: 'passages',
        where: { id: { equals: passage.id } },
        user: adminUser,
        overrideAccess: false,
      })
      expect(staffPassages.docs[0].notes?.length).toBe(2)
    })

    it('hides all descendants when the publication is unpublished (draft)', async () => {
      // Unpublish publication
      await payload.update({
        collection: 'publications',
        id: testPub.id,
        data: {
          _status: 'draft',
        },
        user: adminUser,
      })

      const publicPassages = await payload.find({
        collection: 'passages',
        where: { id: { equals: passage.id } },
        user: memberUser,
        overrideAccess: false,
      })
      expect(publicPassages.totalDocs).toBe(0)
    })
  })

  describe('5. Delete Protections', () => {
    let delPub: any
    let delSec: any
    let delChildSec: any
    let delPassage: any

    beforeAll(async () => {
      delPub = await payload.create({
        collection: 'publications',
        data: {
          ...getWudaseMaryamExamplePublicationData(),
          slug: `del-pub-${runId}`,
        },
        user: adminUser,
      })
      createdPublicationIds.push(delPub.id)

      delSec = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: delPub.id,
          typeKey: 'day',
          title: 'Monday',
          slug: 'monday',
          order: 1,
        },
        user: adminUser,
      })
      createdSectionIds.push(delSec.id)

      delChildSec = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: delPub.id,
          parent: delSec.id,
          typeKey: 'prayer',
          title: 'Prayer 1',
          slug: 'p1',
          order: 1,
        },
        user: adminUser,
      })
      createdSectionIds.push(delChildSec.id)

      delPassage = await payload.create({
        collection: 'passages',
        data: {
          section: delChildSec.id,
          order: 1,
          text: { amharic: 'ጸሎት' },
        },
        user: adminUser,
      })
      createdPassageIds.push(delPassage.id)
    })

    it('rejects deleting publication that contains sections', async () => {
      await expectValidationError(
        payload.delete({
          collection: 'publications',
          id: delPub.id,
          user: adminUser,
        }),
        /Cannot delete publication because it contains/,
        'id',
      )
    })

    it('rejects deleting section that contains child sections', async () => {
      await expectValidationError(
        payload.delete({
          collection: 'publication-sections',
          id: delSec.id,
          user: adminUser,
        }),
        /Cannot delete section because it contains/,
        'id',
      )
    })

    it('rejects deleting section that contains passages', async () => {
      await expectValidationError(
        payload.delete({
          collection: 'publication-sections',
          id: delChildSec.id,
          user: adminUser,
        }),
        /Cannot delete section because it contains/,
        'id',
      )
    })

    it('allows deleting passage first, then child section, then parent section, then publication', async () => {
      await payload.delete({
        collection: 'passages',
        id: delPassage.id,
        user: adminUser,
      })

      await payload.delete({
        collection: 'publication-sections',
        id: delChildSec.id,
        user: adminUser,
      })

      await payload.delete({
        collection: 'publication-sections',
        id: delSec.id,
        user: adminUser,
      })

      const delResult = await payload.delete({
        collection: 'publications',
        id: delPub.id,
        user: adminUser,
      })
      expect(delResult.id).toBe(delPub.id)
    })
  })

  describe('6. Role & Inactive User Permissions', () => {
    let pub: any

    beforeAll(async () => {
      pub = await payload.create({
        collection: 'publications',
        data: {
          ...getWudaseMaryamExamplePublicationData(),
          slug: `perm-pub-${runId}`,
        },
        user: adminUser,
      })
      createdPublicationIds.push(pub.id)
    })

    it('denies member user write access to publications and sections', async () => {
      await expect(
        payload.create({
          collection: 'publications',
          data: {
            ...getWudaseMaryamExamplePublicationData(),
            slug: `member-pub-${runId}`,
          },
          user: memberUser,
          overrideAccess: false,
        }),
      ).rejects.toThrow()

      await expect(
        payload.create({
          collection: 'publication-sections',
          data: {
            publication: pub.id,
            typeKey: 'day',
            title: 'Member Day',
            slug: 'member-day',
            order: 1,
          },
          user: memberUser,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })

    it('denies inactive user write access', async () => {
      await expect(
        payload.create({
          collection: 'publications',
          data: {
            ...getWudaseMaryamExamplePublicationData(),
            slug: `inactive-pub-${runId}`,
          },
          user: inactiveAdminUser,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })

    it('allows editor to create and update, but denies delete to editor', async () => {
      const section = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'day',
          title: 'Editor Day',
          slug: 'editor-day',
          order: 1,
        },
        user: editorUser,
        overrideAccess: false,
      })
      createdSectionIds.push(section.id)
      expect(section.id).toBeDefined()

      // Editor update allowed
      const updated = await payload.update({
        collection: 'publication-sections',
        id: section.id,
        data: {
          title: 'Editor Day Updated',
        },
        user: editorUser,
        overrideAccess: false,
      })
      expect(updated.title).toBe('Editor Day Updated')

      // Editor delete denied
      await expect(
        payload.delete({
          collection: 'publication-sections',
          id: section.id,
          user: editorUser,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })
  })

  describe('7. Navigation Query Helpers', () => {
    let navPub: any
    let navBook1: any
    let navBook2: any
    let navCh1: any
    let navCh2: any
    let navP1: any
    let navP2: any

    beforeAll(async () => {
      navPub = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          slug: `nav-pub-${runId}`,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(navPub.id)

      navBook1 = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: navPub.id,
          typeKey: 'book',
          title: 'Genesis',
          slug: 'genesis',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(navBook1.id)

      navBook2 = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: navPub.id,
          typeKey: 'book',
          title: 'Exodus',
          slug: 'exodus',
          order: 2,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(navBook2.id)

      navCh1 = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: navPub.id,
          parent: navBook1.id,
          typeKey: 'chapter',
          title: 'Genesis Chapter 1',
          slug: 'chapter-1',
          number: 1,
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(navCh1.id)

      navCh2 = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: navPub.id,
          parent: navBook1.id,
          typeKey: 'chapter',
          title: 'Genesis Chapter 2',
          slug: 'chapter-2',
          number: 2,
          order: 2,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(navCh2.id)

      navP1 = await payload.create({
        collection: 'passages',
        data: {
          section: navCh1.id,
          order: 1,
          number: 1,
          displayLabel: 'Gen 1:1',
          _status: 'published',
          text: { amharic: 'በመጀመሪያ' },
        },
        user: adminUser,
      })
      createdPassageIds.push(navP1.id)

      navP2 = await payload.create({
        collection: 'passages',
        data: {
          section: navCh1.id,
          order: 2,
          number: 2,
          displayLabel: 'Gen 1:2',
          _status: 'published',
          text: { amharic: 'ምድርም ባዶ ነበረች' },
        },
        user: adminUser,
      })
      createdPassageIds.push(navP2.id)
    })

    it('getRootSections returns root sections in sequence', async () => {
      const roots = await getRootSections(payload, navPub.id)
      expect(roots.docs.length).toBe(2)
      expect(roots.docs[0].slug).toBe('genesis')
      expect(roots.docs[1].slug).toBe('exodus')
    })

    it('getDirectChildren returns direct child sections', async () => {
      const children = await getDirectChildren(payload, navBook1.id)
      expect(children.docs.length).toBe(2)
      expect(children.docs[0].slug).toBe('chapter-1')
      expect(children.docs[1].slug).toBe('chapter-2')
    })

    it('getBreadcrumbs builds ordered path from root to current section', async () => {
      const breadcrumbs = await getBreadcrumbs(payload, navCh1.id)
      expect(breadcrumbs.length).toBe(2)
      expect(breadcrumbs[0].slug).toBe('genesis')
      expect(breadcrumbs[0].depth).toBe(0)
      expect(breadcrumbs[1].slug).toBe('chapter-1')
      expect(breadcrumbs[1].depth).toBe(1)
    })

    it('getOrderedPassages returns passages in sequence order', async () => {
      const passagesRes = await getOrderedPassages(payload, navCh1.id)
      expect(passagesRes.docs.length).toBe(2)
      expect(passagesRes.docs[0].number).toBe(1)
      expect(passagesRes.docs[1].number).toBe(2)
    })

    it('getPreviousAndNextSection returns sibling navigation', async () => {
      const navFirst = await getPreviousAndNextSection(payload, navCh1.id)
      expect(navFirst.previous).toBeNull()
      expect(navFirst.next).not.toBeNull()
      expect(navFirst.next?.slug).toBe('chapter-2')

      const navSecond = await getPreviousAndNextSection(payload, navCh2.id)
      expect(navSecond.previous).not.toBeNull()
      expect(navSecond.previous?.slug).toBe('chapter-1')
      expect(navSecond.next).toBeNull()
    })
  })
})
