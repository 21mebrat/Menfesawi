import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'
import configPromise from '@/payload.config'
import type { User } from '@/payload-types'
import { POST as graphqlHandler } from '@/app/(payload)/api/graphql/route'
import {
  biblePublicationStructure,
  getBibleExamplePublicationData,
} from '@/lib/server/reading/examples'
import {
  getRootSections,
  getDirectChildren,
  getBreadcrumbs,
  getOrderedPassages,
  getPreviousAndNextSection,
} from '@/lib/server/reading/navigation'
import { fetchAllDocuments } from '@/lib/server/reading/cascade'

describe('Reading Fixes Regressions & Access Controls', () => {
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
        email: `fix-admin-${runId}@example.com`,
        name: 'Fix Admin',
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
        email: `fix-editor-${runId}@example.com`,
        name: 'Fix Editor',
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
        email: `fix-member-${runId}@example.com`,
        name: 'Fix Member',
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
        email: `fix-inactive-${runId}@example.com`,
        name: 'Fix Inactive Admin',
        role: 'admin',
        isActive: false,
        password: testPassword,
      },
      overrideAccess: true,
    })
    createdUserIds.push(inactiveAdminUser.id)
  })

  afterAll(async () => {
    // 1. Delete passages first
    for (const id of [...createdPassageIds].reverse()) {
      try {
        await payload.delete({ collection: 'passages', id, overrideAccess: true })
      } catch {
        // Document may have already been deleted in test cases
      }
    }

    // 2. Delete sections ordered by depth descending so children are deleted before parents
    if (createdSectionIds.length > 0) {
      try {
        const sections = await payload.find({
          collection: 'publication-sections',
          where: { id: { in: createdSectionIds } },
          limit: 500,
          overrideAccess: true,
        })
        const sorted = [...sections.docs].sort(
          (a: any, b: any) => (b.depth ?? 0) - (a.depth ?? 0),
        )
        for (const s of sorted) {
          try {
            await payload.delete({
              collection: 'publication-sections',
              id: s.id,
              overrideAccess: true,
            })
          } catch {
            // May have been deleted during tests
          }
        }
      } catch {
        // Fallback simple loop
        for (const id of [...createdSectionIds].reverse()) {
          try {
            await payload.delete({
              collection: 'publication-sections',
              id,
              overrideAccess: true,
            })
          } catch {}
        }
      }
    }

    // 3. Delete publications
    for (const id of [...createdPublicationIds].reverse()) {
      try {
        await payload.delete({ collection: 'publications', id, overrideAccess: true })
      } catch {
        // Document may have already been deleted
      }
    }

    // 4. Delete test users
    for (const id of [...createdUserIds].reverse()) {
      try {
        await payload.delete({ collection: 'users', id, overrideAccess: true })
      } catch {}
    }
  })

  describe('1. Navigation Authorization & Inactive User Protection', () => {
    it('denies inactive admin user access to unpublished/draft sections via navigation', async () => {
      const pub = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          slug: `nav-inactive-pub-${runId}`,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(pub.id)

      const draftRootSection = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'book',
          title: 'Draft Root Book',
          slug: 'draft-root-book',
          order: 1,
          _status: 'draft',
        },
        user: adminUser,
        draft: true,
      })
      createdSectionIds.push(draftRootSection.id)

      // Query root sections as inactive admin user
      const res = await getRootSections(payload, pub.id, {
        user: inactiveAdminUser,
        overrideAccess: false,
      })

      // Inactive admin must NOT see draft sections
      expect(res.docs.some((d: any) => d.id === draftRootSection.id)).toBe(false)

      // Active admin can see draft sections
      const adminRes = await getRootSections(payload, pub.id, {
        user: adminUser,
        overrideAccess: false,
      })
      expect(adminRes.docs.some((d: any) => d.id === draftRootSection.id)).toBe(true)
    })
  })

  describe('2. Editorial-Note Privacy & Field Projection', () => {
    it('fails closed when client projects notes.content without notes.visibility in REST and GraphQL', async () => {
      const pub = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          slug: `note-priv-pub-${runId}`,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(pub.id)

      const book = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'book',
          title: 'Note Book',
          slug: 'note-book',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(book.id)

      const chapter = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          parent: book.id,
          typeKey: 'chapter',
          title: 'Note Chapter',
          slug: 'note-chapter',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(chapter.id)

      const passage = await payload.create({
        collection: 'passages',
        data: {
          section: chapter.id,
          order: 1,
          number: 1,
          text: {
            amharic: 'የፈተና ጽሑፍ',
          },
          notes: [
            {
              content: 'Public commentary for everyone',
              visibility: 'public',
            },
            {
              content: 'TOP_SECRET_EDITORIAL_NOTE_12345',
              visibility: 'editorial',
            },
          ],
          _status: 'published',
        },
        user: adminUser,
      })
      createdPassageIds.push(passage.id)

      // Anonymous read with projection selecting ONLY notes.content
      const anonResult = await payload.find({
        collection: 'passages',
        where: { id: { equals: passage.id } },
        select: {
          notes: {
            content: true,
          },
        },
        overrideAccess: false,
      })

      expect(anonResult.docs.length).toBe(1)
      const notes = anonResult.docs[0].notes || []
      const contents = notes.map((n: any) => n.content)
      // The secret editorial note must NEVER be exposed to anonymous/public!
      expect(contents).not.toContain('TOP_SECRET_EDITORIAL_NOTE_12345')
      expect(contents).toContain('Public commentary for everyone')

      // Staff read with projection MUST retain editorial notes
      const staffResult = await payload.find({
        collection: 'passages',
        where: { id: { equals: passage.id } },
        select: {
          notes: {
            content: true,
          },
        },
        user: editorUser,
        overrideAccess: false,
      })
      const staffNotes = staffResult.docs[0].notes || []
      const staffContents = staffNotes.map((n: any) => n.content)
      expect(staffContents).toContain('TOP_SECRET_EDITORIAL_NOTE_12345')

      // Realistic GraphQL route handler request
      const gqlRequest = new Request('http://localhost:3000/api/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `
            query GetPassageNotes {
              Passage(id: "${passage.id}") {
                notes {
                  content
                }
              }
            }
          `,
        }),
      })

      const gqlResponse = await graphqlHandler(gqlRequest)
      expect(gqlResponse.status).toBe(200)
      const gqlJson = await gqlResponse.json()
      const gqlNotes = gqlJson.data?.Passage?.notes || []
      const gqlContents = gqlNotes.map((n: any) => n.content)
      expect(gqlContents).not.toContain('TOP_SECRET_EDITORIAL_NOTE_12345')
      expect(gqlContents).toContain('Public commentary for everyone')
    })
  })

  describe('3. Published versus Draft Visibility & Ancestor Cascades', () => {
    it('separates saving draft revisions from live unpublishing and updates', async () => {
      const pub = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          title: 'Original Published Pub',
          slug: `draft-sep-pub-${runId}`,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(pub.id)

      const book = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'book',
          title: 'Original Book',
          slug: 'orig-book',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(book.id)

      const chapter = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          parent: book.id,
          typeKey: 'chapter',
          title: 'Original Chapter',
          slug: 'orig-chapter',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(chapter.id)

      const passage = await payload.create({
        collection: 'passages',
        data: {
          section: chapter.id,
          order: 1,
          number: 1,
          text: { amharic: 'የመጀመሪያ ጽሑፍ' },
          _status: 'published',
        },
        user: adminUser,
      })
      createdPassageIds.push(passage.id)

      // Initial live state: all published
      const initBook = await payload.findByID({
        collection: 'publication-sections',
        id: book.id,
        overrideAccess: true,
      })
      const initChapter = await payload.findByID({
        collection: 'publication-sections',
        id: chapter.id,
        overrideAccess: true,
      })
      const initPassage = await payload.findByID({
        collection: 'passages',
        id: passage.id,
        overrideAccess: true,
      })
      expect(initBook.isPublishedEffective).toBe(true)
      expect(initChapter.isPublishedEffective).toBe(true)
      expect(initPassage.isPublishedEffective).toBe(true)

      // Step 1: Save an edited draft of published content (draft: true)
      await payload.update({
        collection: 'publications',
        id: pub.id,
        data: {
          title: 'Draft Modified Title',
        },
        draft: true,
        user: adminUser,
      })

      // The live document remains published and descendants remain effective!
      const livePub = await payload.findByID({
        collection: 'publications',
        id: pub.id,
        draft: false,
        overrideAccess: true,
      })
      expect(livePub._status).toBe('published')
      expect(livePub.title).toBe('Original Published Pub')

      const midBook = await payload.findByID({
        collection: 'publication-sections',
        id: book.id,
        overrideAccess: true,
      })
      const midChapter = await payload.findByID({
        collection: 'publication-sections',
        id: chapter.id,
        overrideAccess: true,
      })
      const midPassage = await payload.findByID({
        collection: 'passages',
        id: passage.id,
        overrideAccess: true,
      })
      expect(midBook.isPublishedEffective).toBe(true)
      expect(midChapter.isPublishedEffective).toBe(true)
      expect(midPassage.isPublishedEffective).toBe(true)

      // Step 2: Actually unpublish the live publication (live unpublish operation)
      await payload.update({
        collection: 'publications',
        id: pub.id,
        data: {
          _status: 'draft',
        },
        draft: false,
        user: adminUser,
      })

      // Descendants must now be effectively unpublished
      const unpubBook = await payload.findByID({
        collection: 'publication-sections',
        id: book.id,
        overrideAccess: true,
      })
      const unpubChapter = await payload.findByID({
        collection: 'publication-sections',
        id: chapter.id,
        overrideAccess: true,
      })
      const unpubPassage = await payload.findByID({
        collection: 'passages',
        id: passage.id,
        overrideAccess: true,
      })
      expect(unpubBook.isPublishedEffective).toBe(false)
      expect(unpubChapter.isPublishedEffective).toBe(false)
      expect(unpubPassage.isPublishedEffective).toBe(false)

      // Step 3: Publish the edited draft (live publish operation)
      await payload.update({
        collection: 'publications',
        id: pub.id,
        data: {
          title: 'Final Published Title',
          _status: 'published',
        },
        draft: false,
        user: adminUser,
      })

      const repubPub = await payload.findByID({
        collection: 'publications',
        id: pub.id,
        draft: false,
        overrideAccess: true,
      })
      expect(repubPub._status).toBe('published')
      expect(repubPub.title).toBe('Final Published Title')

      const repubBook = await payload.findByID({
        collection: 'publication-sections',
        id: book.id,
        overrideAccess: true,
      })
      const repubChapter = await payload.findByID({
        collection: 'publication-sections',
        id: chapter.id,
        overrideAccess: true,
      })
      const repubPassage = await payload.findByID({
        collection: 'passages',
        id: passage.id,
        overrideAccess: true,
      })
      expect(repubBook.isPublishedEffective).toBe(true)
      expect(repubChapter.isPublishedEffective).toBe(true)
      expect(repubPassage.isPublishedEffective).toBe(true)
    })

    it('historical visibility fail-closed: unpublishing ancestor revokes descendant access across draft=true, findByID, and GraphQL', async () => {
      const pub = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          slug: `hist-vis-pub-${runId}`,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(pub.id)

      const book = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'book',
          title: 'Hist Book',
          slug: 'hist-book',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(book.id)

      const chapter = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          parent: book.id,
          typeKey: 'chapter',
          title: 'Hist Chapter',
          slug: 'hist-chapter',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(chapter.id)

      const passage = await payload.create({
        collection: 'passages',
        data: {
          section: chapter.id,
          order: 1,
          number: 1,
          text: { amharic: 'የታሪክ ምንባብ' },
          _status: 'published',
        },
        user: adminUser,
      })
      createdPassageIds.push(passage.id)

      // Unpublish ancestor (book) via live operation
      await payload.update({
        collection: 'publication-sections',
        id: book.id,
        data: {
          _status: 'draft',
        },
        draft: false,
        user: adminUser,
      })

      // 1. Anonymous ordinary list query
      const anonFind = await payload.find({
        collection: 'passages',
        where: { id: { equals: passage.id } },
        overrideAccess: false,
      })
      expect(anonFind.docs.length).toBe(0)

      // 2. Anonymous list query with draft: true (forced false by beforeOperation)
      const anonDraftFind = await payload.find({
        collection: 'passages',
        where: { id: { equals: passage.id } },
        draft: true,
        overrideAccess: false,
      })
      expect(anonDraftFind.docs.length).toBe(0)

      // 3. Anonymous findByID with draft: false throws NotFound
      let findByIdThrew = false
      try {
        await payload.findByID({
          collection: 'passages',
          id: passage.id,
          draft: false,
          overrideAccess: false,
        })
      } catch (err: any) {
        findByIdThrew = true
        expect(err.name).toBe('NotFound')
      }
      expect(findByIdThrew).toBe(true)

      // 4. Anonymous findByID with draft: true must NOT reveal historical version snapshot
      let draftFindByIdThrew = false
      try {
        await payload.findByID({
          collection: 'passages',
          id: passage.id,
          draft: true,
          overrideAccess: false,
        })
      } catch (err: any) {
        draftFindByIdThrew = true
        expect(err.name).toBe('NotFound')
      }
      expect(draftFindByIdThrew).toBe(true)

      // 5. Anonymous projected query
      let projThrew = false
      try {
        await payload.findByID({
          collection: 'passages',
          id: passage.id,
          select: { id: true, number: true },
          overrideAccess: false,
        })
      } catch (err: any) {
        projThrew = true
        expect(err.name).toBe('NotFound')
      }
      expect(projThrew).toBe(true)

      // 6. Anonymous GraphQL query returns null for Passage
      const gqlReq = new Request('http://localhost:3000/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{ Passage(id: "${passage.id}") { id number } }`,
        }),
      })
      const gqlRes = await graphqlHandler(gqlReq)
      const gqlData = await gqlRes.json()
      expect(gqlData.data?.Passage).toBeNull()

      // 7. Staff user CAN still read for editorial purposes
      const staffRead = await payload.findByID({
        collection: 'passages',
        id: passage.id,
        user: editorUser,
        overrideAccess: false,
      })
      expect(staffRead.id).toBe(passage.id)
    })
  })

  describe('4. Disconnected Cycle Detection in Structure', () => {
    it('detects and rejects cycles among disconnected section types not reachable from root', async () => {
      const invalidDisconnectedCycleStructure = {
        maxDepth: 5,
        sectionTypes: [
          {
            key: 'root-item',
            labels: { singular: { en: 'Root', am: 'ሥር' }, plural: { en: 'Roots', am: 'ሥሮች' } },
            allowedAtRoot: true,
            allowedChildTypes: [],
            allowPassages: true,
            numberingPolicy: 'none' as const,
          },
          {
            key: 'disconnected-a',
            labels: { singular: { en: 'A', am: 'ሀ' }, plural: { en: 'As', am: 'ሆች' } },
            allowedAtRoot: false,
            allowedChildTypes: [{ typeKey: 'disconnected-b' }],
            allowPassages: false,
            numberingPolicy: 'none' as const,
          },
          {
            key: 'disconnected-b',
            labels: { singular: { en: 'B', am: 'ለ' }, plural: { en: 'Bs', am: 'ሎች' } },
            allowedAtRoot: false,
            allowedChildTypes: [{ typeKey: 'disconnected-a' }],
            allowPassages: false,
            numberingPolicy: 'none' as const,
          },
        ],
      }

      await expectValidationError(
        payload.create({
          collection: 'publications',
          data: {
            title: 'Disconnected Cycle Pub',
            slug: `cycle-pub-${runId}`,
            structure: invalidDisconnectedCycleStructure as any,
          },
          user: adminUser,
        }),
        /Circular section type hierarchy detected/,
      )
    })
  })

  describe('5. Section Type & Numbering Policy Tightening Validation', () => {
    it('rejects changing a section type if new type disallows passages and passages exist', async () => {
      const pub = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          slug: `change-type-pub-${runId}`,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(pub.id)

      const book = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'book',
          title: 'Book 1',
          slug: 'book-1',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(book.id)

      const chapter = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          parent: book.id,
          typeKey: 'chapter',
          title: 'Chapter 1',
          slug: 'chapter-1',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(chapter.id)

      const passage = await payload.create({
        collection: 'passages',
        data: {
          section: chapter.id,
          order: 1,
          number: 1,
          text: { amharic: 'ጽሑፍ' },
          _status: 'published',
        },
        user: adminUser,
      })
      createdPassageIds.push(passage.id)

      // Try changing chapter to 'division' which has allowPassages: false
      await expectValidationError(
        payload.update({
          collection: 'publication-sections',
          id: chapter.id,
          data: {
            typeKey: 'division',
          },
          user: adminUser,
        }),
        /passages/,
      )
    })

    it('rejects changing a section type to required numbering when existing published passages have invalid numbers', async () => {
      const customStructure = {
        maxDepth: 3,
        sectionTypes: [
          {
            key: 'optional-sec',
            labels: { singular: { en: 'Optional Sec', am: 'ክፍል' }, plural: { en: 'Optional Secs', am: 'ክፍሎች' } },
            allowedAtRoot: true,
            allowedChildTypes: [],
            allowPassages: true,
            numberingPolicy: 'optional' as const,
          },
          {
            key: 'required-sec',
            labels: { singular: { en: 'Required Sec', am: 'ክፍል' }, plural: { en: 'Required Secs', am: 'ክፍሎች' } },
            allowedAtRoot: true,
            allowedChildTypes: [],
            allowPassages: true,
            numberingPolicy: 'required' as const,
          },
        ],
      }

      const pub = await payload.create({
        collection: 'publications',
        data: {
          title: 'Section Type Numbering Pub',
          slug: `sec-type-num-pub-${runId}`,
          structure: customStructure,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(pub.id)

      const sec = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'optional-sec',
          title: 'Sec with unnumbered passage',
          slug: 'sec-opt',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(sec.id)

      const passage = await payload.create({
        collection: 'passages',
        data: {
          section: sec.id,
          order: 1,
          text: { amharic: 'ያለ ቁጥር' },
          _status: 'published',
        },
        user: adminUser,
      })
      createdPassageIds.push(passage.id)

      // Changing to 'required-sec' must be rejected because the passage lacks a positive safe integer number
      await expectValidationError(
        payload.update({
          collection: 'publication-sections',
          id: sec.id,
          data: {
            typeKey: 'required-sec',
          },
          user: adminUser,
        }),
        /requires a positive safe integer number/,
      )

      // Set valid number on passage
      await payload.update({
        collection: 'passages',
        id: passage.id,
        data: {
          number: 1,
        },
        user: adminUser,
      })

      // Now changing section type succeeds
      const updatedSec = await payload.update({
        collection: 'publication-sections',
        id: sec.id,
        data: {
          typeKey: 'required-sec',
        },
        user: adminUser,
      })
      expect(updatedSec.typeKey).toBe('required-sec')
    })

    it('rejects tightening publication numbering policy to required when published passages lack positive safe integers', async () => {
      const optionalNumberingStructure = {
        maxDepth: 3,
        sectionTypes: [
          {
            key: 'book',
            labels: { singular: { en: 'Book', am: 'መጽሐፍ' }, plural: { en: 'Books', am: 'መጻሕፍት' } },
            allowedAtRoot: true,
            allowedChildTypes: [],
            allowPassages: true,
            numberingPolicy: 'optional' as const,
          },
        ],
      }

      const pub = await payload.create({
        collection: 'publications',
        data: {
          title: 'Optional Num Pub',
          slug: `opt-num-pub-${runId}`,
          structure: optionalNumberingStructure,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(pub.id)

      const book = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'book',
          title: 'Book Without Numbers',
          slug: 'book-no-num',
          order: 1,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(book.id)

      const passage = await payload.create({
        collection: 'passages',
        data: {
          section: book.id,
          order: 1,
          text: { amharic: 'ያለ ቁጥር ጽሑፍ' },
          _status: 'published',
        },
        user: adminUser,
      })
      createdPassageIds.push(passage.id)

      const tightenedStructure = {
        maxDepth: 3,
        sectionTypes: [
          {
            key: 'book',
            labels: { singular: { en: 'Book', am: 'መጽሐፍ' }, plural: { en: 'Books', am: 'መጻሕፍት' } },
            allowedAtRoot: true,
            allowedChildTypes: [],
            allowPassages: true,
            numberingPolicy: 'required' as const,
          },
        ],
      }

      await expectValidationError(
        payload.update({
          collection: 'publications',
          id: pub.id,
          data: {
            structure: tightenedStructure,
          },
          user: adminUser,
        }),
        /Cannot tighten numbering policy to 'required'/,
      )
    })
  })

  describe('6. Bounded Neighbor Queries with Deterministic Tie-Breakers', () => {
    it('accurately resolves previous and next siblings using bounded queries', async () => {
      const pub = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          slug: `neighbor-pub-${runId}`,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(pub.id)

      const s1 = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'book',
          title: 'Book 1',
          slug: 'b1',
          order: 10,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(s1.id)

      const s2 = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'book',
          title: 'Book 2',
          slug: 'b2',
          order: 20,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(s2.id)

      const s3 = await payload.create({
        collection: 'publication-sections',
        data: {
          publication: pub.id,
          typeKey: 'book',
          title: 'Book 3',
          slug: 'b3',
          order: 30,
          _status: 'published',
        },
        user: adminUser,
      })
      createdSectionIds.push(s3.id)

      // Navigation around s2
      const nav2 = await getPreviousAndNextSection(payload, s2.id)
      expect(nav2.previous?.id).toBe(String(s1.id))
      expect(nav2.next?.id).toBe(String(s3.id))

      // Navigation around first (s1)
      const nav1 = await getPreviousAndNextSection(payload, s1.id)
      expect(nav1.previous).toBeNull()
      expect(nav1.next?.id).toBe(String(s2.id))

      // Navigation around last (s3)
      const nav3 = await getPreviousAndNextSection(payload, s3.id)
      expect(nav3.previous?.id).toBe(String(s2.id))
      expect(nav3.next).toBeNull()
    })
  })

  describe('Live ancestry and structural transactions', () => {
    async function publication(slug: string, structure = biblePublicationStructure) {
      const doc = await payload.create({
        collection: 'publications',
        data: { ...getBibleExamplePublicationData(), structure, slug: `${slug}-${runId}` },
        user: adminUser,
      })
      createdPublicationIds.push(doc.id)
      return doc.id
    }

    async function section(
      publication: string,
      typeKey: string,
      slug: string,
      parent?: string,
      published = true,
    ) {
      const doc = await payload.create({
        collection: 'publication-sections',
        data: {
          publication,
          typeKey,
          parent,
          title: slug,
          slug,
          order: 1,
          _status: published ? 'published' : 'draft',
        },
        user: adminUser,
      })
      createdSectionIds.push(doc.id)
      return doc.id
    }

    async function passage(section: string, number: number | null = 1) {
      const doc = await payload.create({
        collection: 'passages',
        data: {
          section,
          number,
          order: 1,
          text: { english: 'Test passage' },
          _status: 'published',
        },
        user: adminUser,
      })
      createdPassageIds.push(doc.id)
      return doc.id
    }

    const readSection = (id: string) =>
      payload.findByID({ collection: 'publication-sections', id, depth: 0, draft: false })
    const readPassage = (id: string) =>
      payload.findByID({ collection: 'passages', id, depth: 0, draft: false })

    it.each([
      {
        transition: 'publication move',
        typeKey: 'book',
        child: true,
        error: /different publication while it contains/,
        field: 'publication',
      },
      {
        transition: 'passages disallowed',
        typeKey: 'division',
        child: false,
        error: /type 'division' disallows passages/,
        field: 'typeKey',
      },
      {
        transition: 'incompatible child',
        typeKey: 'division',
        child: true,
        error: /'chapter'.*not permitted under 'division'/,
        field: 'typeKey',
      },
      {
        transition: 'number required',
        typeKey: 'chapter',
        child: false,
        error: /published passage.*requires a positive safe integer number/,
        field: 'typeKey',
      },
    ])(
      'revalidates a saved draft against new live content ($transition)',
      async ({ transition, typeKey, child, error, field }) => {
        const structure = structuredClone(biblePublicationStructure)
        const book = structure.sectionTypes.find((type) => type.key === 'book')!
        book.allowPassages = true
        book.numberingPolicy = 'optional'
        structure.sectionTypes
          .find((type) => type.key === 'testament')!
          .allowedChildTypes!.push({ typeKey: 'chapter' })
        const source = await publication(`staged-${transition.replaceAll(' ', '-')}`, structure)
        const root = await section(source, 'testament', 'root')
        const id = await section(source, 'book', 'subject', root)
        const moving = transition === 'publication move'
        const destination = moving ? await publication('staged-destination', structure) : source
        const parent = moving ? await section(destination, 'testament', 'new-root') : root
        const proposed = { publication: destination, parent, typeKey, title: 'Saved revision' }

        await payload.update({
          collection: 'publication-sections',
          id,
          data: { ...proposed, _status: 'draft' },
          draft: true,
          user: adminUser,
        })
        const readDraft = () =>
          payload.findByID({
            collection: 'publication-sections',
            id,
            draft: true,
            depth: 0,
            user: adminUser,
          })
        expect(await readDraft()).toMatchObject({ ...proposed, _status: 'draft' })
        const live = await readSection(id)
        expect(live).toMatchObject({
          publication: source,
          parent: root,
          ancestors: [root],
          depth: 1,
          typeKey: 'book',
          title: 'subject',
          _status: 'published',
          isPublishedEffective: true,
        })

        const contentId = child
          ? await section(source, 'chapter', 'new-child', id)
          : await passage(id, null)
        const readContent = () => (child ? readSection(contentId) : readPassage(contentId))
        const content = await readContent()
        expect(content).toMatchObject({
          publication: source,
          _status: 'published',
          isPublishedEffective: true,
          ...(child
            ? { parent: id, typeKey: 'chapter', ancestors: [root, id], depth: 2 }
            : { section: id, number: null, text: { english: 'Test passage' } }),
        })

        // Publish the persisted version with only a status change.
        const publish = () =>
          payload.update({
            collection: 'publication-sections',
            id,
            draft: false,
            user: adminUser,
            data: { _status: 'published' },
          })
        await expectValidationError(publish(), error, field)
        expect(await readSection(id)).toEqual(live)
        expect(await readContent()).toEqual(content)
        expect(await readDraft()).toMatchObject({ ...proposed, _status: 'draft' })

        // The very same draft can be published once the blocking content is removed.
        await payload.delete({
          collection: child ? 'publication-sections' : 'passages',
          id: contentId,
          user: adminUser,
        })
        await publish()
        expect(await readSection(id)).toMatchObject({
          ...proposed,
          ancestors: [parent],
          depth: 1,
          _status: 'published',
          isPublishedEffective: true,
        })
      },
    )

    it('preserves every live ancestor on a nested edit and recalculates the whole moved subtree', async () => {
      const pub = await publication('live-ancestry')
      const root = await section(pub, 'testament', 'root')
      const division = await section(pub, 'division', 'division', root)
      const book = await section(pub, 'book', 'book', division)
      const chapters = [
        await section(pub, 'chapter', 'chapter-one', book),
        await section(pub, 'chapter', 'chapter-two', book),
      ]
      const verse = await passage(chapters[0])

      async function assertSubtree(chain: string[], visible: boolean) {
        for (const [id, ancestors] of [
          [book, chain],
          ...chapters.map((id) => [id, [...chain, book]] as const),
        ] as const) {
          expect(await readSection(id)).toMatchObject({
            parent: ancestors.at(-1),
            depth: ancestors.length,
            ancestors,
            publication: pub,
            isPublicationPublished: true,
            isAncestorsPublished: visible,
            isPublishedEffective: visible,
          })
        }
        expect(await readPassage(verse)).toMatchObject({
          section: chapters[0],
          publication: pub,
          isPublishedEffective: visible,
        })
      }

      await payload.update({
        collection: 'publication-sections',
        id: division,
        user: adminUser,
        data: { title: 'Edited division', _status: 'published' },
      })
      expect(await readSection(division)).toMatchObject({
        depth: 1,
        ancestors: [root],
        publication: pub,
        isPublishedEffective: true,
      })
      await assertSubtree([root, division], true)

      const hiddenRoot = await section(pub, 'testament', 'hidden-root', undefined, false)
      await payload.update({
        collection: 'publication-sections',
        id: book,
        draft: true,
        user: adminUser,
        data: { parent: hiddenRoot, _status: 'draft' },
      })
      await assertSubtree([root, division], true)

      await payload.update({
        collection: 'publication-sections',
        id: book,
        user: adminUser,
        data: { parent: hiddenRoot, _status: 'published' },
      })
      await assertSubtree([hiddenRoot], false)
    })

    // Pause the validated transaction exactly as Payload calls its adapter to write
    // the main record. Keep its locks until the competing API request has completed.
    async function atWrite<T>(
      method: 'create' | 'updateOne',
      collection: 'publication-sections' | 'publications' | 'passages',
      first: () => Promise<T>,
      competing: () => Promise<unknown>,
    ): Promise<T> {
      let reached!: () => void
      let release!: () => void
      const atBoundary = new Promise<void>((resolve) => {
        reached = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      async function pause(actual: string) {
        expect(actual).toBe(collection)
        reached()
        await gate
      }
      const db = payload.db
      const create = db.create.bind(db)
      const update = db.updateOne.bind(db)
      const spy =
        method === 'create'
          ? vi.spyOn(db, 'create').mockImplementationOnce(async (args) => {
              await pause(args.collection)
              return create(args)
            })
          : vi.spyOn(db, 'updateOne').mockImplementationOnce(async (args) => {
              await pause(args.collection)
              return update(args)
            })
      const winner = first()
      try {
        await Promise.race([
          atBoundary,
          winner.then(() => {
            throw new Error('Write barrier was bypassed')
          }),
        ])
        await expect(competing()).rejects.toMatchObject({ code: 112 }) // MongoDB WriteConflict
      } finally {
        release()
        spy.mockRestore()
        await winner
      }
      return winner
    }

    it.each(['publication', 'section', 'passage'] as const)(
      'protects a validated child insert from deletion of its parent (%s)',
      async (kind) => {
        const pub = await publication(`delete-race-${kind}`)
        const root = kind === 'publication' ? undefined : await section(pub, 'book', 'root')
        const parent = kind === 'passage' ? await section(pub, 'chapter', 'parent', root) : root
        const collection = kind === 'passage' ? 'passages' : 'publication-sections'
        const parentCollection = parent ? 'publication-sections' : 'publications'
        const remove = () => payload.delete({ collection: parentCollection, id: parent ?? pub })
        const child = await atWrite(
          'create',
          collection,
          () =>
            kind === 'passage'
              ? passage(parent!)
              : section(pub, parent ? 'chapter' : 'book', 'child', parent),
          remove,
        )

        await expectValidationError(remove(), /Cannot delete .* because it contains/)
        expect(
          (await payload.findByID({ collection: parentCollection, id: parent ?? pub })).isDeleting,
        ).toBeFalsy()
        if (kind === 'passage') {
          expect(await readPassage(child)).toMatchObject({
            section: parent,
            publication: pub,
            isPublishedEffective: true,
          })
        } else {
          expect(await readSection(child)).toMatchObject({
            publication: pub,
            ancestors: parent ? [parent] : [],
            isPublishedEffective: true,
          })
        }
      },
    )

    function disallowPassages(id: string) {
      const structure = structuredClone(biblePublicationStructure)
      structure.sectionTypes.find((type) => type.key === 'chapter')!.allowPassages = false
      return payload.update({
        collection: 'publications',
        id,
        data: { structure, _status: 'published' },
        user: adminUser,
      })
    }

    it('serializes a validated rule change with passage creation', async () => {
      const pub = await publication('rule-wins')
      const book = await section(pub, 'book', 'book')
      const chapter = await section(pub, 'chapter', 'chapter', book)
      await atWrite(
        'updateOne',
        'publications',
        () => disallowPassages(pub),
        () => passage(chapter),
      )
      await expectValidationError(passage(chapter), /do not permit passages/)
      expect(
        (await payload.count({ collection: 'passages', where: { section: { equals: chapter } } }))
          .totalDocs,
      ).toBe(0)
      const live = await payload.findByID({ collection: 'publications', id: pub })
      expect(live.structure.sectionTypes.find((type) => type.key === 'chapter')?.allowPassages).toBe(
        false,
      )
    })

    it.each(['create', 'move-destination', 'move-source'] as const)(
      'holds the relevant publication through the passage write (%s)',
      async (kind) => {
        const dest = await publication(`passage-${kind}-dest`)
        const book = await section(dest, 'book', 'book')
        const chapter = await section(dest, 'chapter', 'chapter', book)
        let rulePublication = dest
        let sourcePassage: string | undefined
        if (kind !== 'create') {
          const source = await publication(`passage-${kind}-source`)
          const sourceBook = await section(source, 'book', 'book')
          sourcePassage = await passage(await section(source, 'chapter', 'chapter', sourceBook))
          if (kind === 'move-source') rulePublication = source
          // The latest version now points at the destination, while the live passage
          // still belongs to the source publication until the move is published.
          await payload.update({
            collection: 'passages',
            id: sourcePassage,
            draft: true,
            user: adminUser,
            data: { section: chapter, _status: 'draft' },
          })
        }
        async function write() {
          if (!sourcePassage) return passage(chapter)
          const moved = await payload.update({
            collection: 'passages',
            id: sourcePassage,
            user: adminUser,
            data: { section: chapter, _status: 'published' },
          })
          return moved.id
        }
        const id = await atWrite(sourcePassage ? 'updateOne' : 'create', 'passages', write, () =>
          disallowPassages(rulePublication),
        )
        if (kind === 'move-source') {
          await disallowPassages(rulePublication)
          expect(
            (
              await payload.count({
                collection: 'passages',
                where: { publication: { equals: rulePublication } },
              })
            ).totalDocs,
          ).toBe(0)
        } else {
          await expectValidationError(disallowPassages(dest), /Cannot disable allowPassages/)
        }
        expect(await readPassage(id)).toMatchObject({
          section: chapter,
          publication: dest,
          isPublishedEffective: true,
        })
        const live = await payload.findByID({ collection: 'publications', id: dest })
        expect(
          live.structure.sectionTypes.find((type) => type.key === 'chapter')?.allowPassages,
        ).toBe(true)
      },
    )

    it('fails structural operations explicitly without a transaction and leaves parents usable after a failed delete', async () => {
      const pub = await publication('transaction-required')
      const root = await section(pub, 'book', 'book')
      const chapter = await section(pub, 'chapter', 'chapter', root)
      const required = /require an active MongoDB transaction/
      await expect(
        payload.create({
          collection: 'passages',
          disableTransaction: true,
          data: {
            section: chapter,
            order: 1,
            number: 1,
            text: { english: 'Test passage' },
            _status: 'published',
          },
        }),
      ).rejects.toThrow(required)
      await expect(
        payload.create({
          collection: 'publication-sections',
          disableTransaction: true,
          data: { publication: pub, typeKey: 'book', title: 'Blocked', slug: 'blocked', order: 1 },
        }),
      ).rejects.toThrow(required)
      await expect(
        payload.update({
          collection: 'publications',
          id: pub,
          data: { structure: biblePublicationStructure },
          disableTransaction: true,
        }),
      ).rejects.toThrow(required)
      for (const [collection, id] of [
        ['publications', pub],
        ['publication-sections', chapter],
      ] as const) {
        await expect(payload.delete({ collection, id, disableTransaction: true })).rejects.toThrow(
          required,
        )
        expect((await payload.findByID({ collection, id })).isDeleting).toBeFalsy()
      }
      const failedWrite = vi
        .spyOn(payload.db, 'deleteOne')
        .mockRejectedValueOnce(new Error('Injected delete failure'))
      try {
        await expect(
          payload.delete({ collection: 'publication-sections', id: chapter }),
        ).rejects.toThrow('Injected delete failure')
      } finally {
        failedWrite.mockRestore()
      }
      expect((await readSection(chapter)).isDeleting).toBeFalsy()
      expect(
        (await payload.count({ collection: 'passages', where: { section: { equals: chapter } } }))
          .totalDocs,
      ).toBe(0)
      expect(await readPassage(await passage(chapter))).toMatchObject({
        section: chapter,
        publication: pub,
      })
    })
  })

  describe('8. Pagination Boundary Exhaustion', () => {
    it('exhaustively pages across internal limit boundaries without data loss or truncation', async () => {
      const pub = await payload.create({
        collection: 'publications',
        data: {
          ...getBibleExamplePublicationData(),
          slug: `page-bound-pub-${runId}`,
          _status: 'published',
        },
        user: adminUser,
      })
      createdPublicationIds.push(pub.id)

      // Create 12 sections under this publication
      for (let i = 1; i <= 12; i++) {
        const sec = await payload.create({
          collection: 'publication-sections',
          data: {
            publication: pub.id,
            typeKey: 'book',
            title: `Book ${i}`,
            slug: `book-${i}`,
            order: i,
            _status: 'published',
          },
          user: adminUser,
        })
        createdSectionIds.push(sec.id)
      }

      // Use fetchAllDocuments with a small page limit of 5 to force 3 pages (5, 5, 2)
      const allFetched = await fetchAllDocuments(payload, {
        collection: 'publication-sections',
        where: { publication: { equals: pub.id } },
        limit: 5,
        overrideAccess: true,
      })

      expect(allFetched.length).toBe(12)
      const slugs = allFetched.map((s: any) => s.slug).sort()
      for (let i = 1; i <= 12; i++) {
        expect(slugs).toContain(`book-${i}`)
      }
    })
  })
})
