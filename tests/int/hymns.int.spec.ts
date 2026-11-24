import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { getPayload, type Payload } from 'payload'
import configPromise from '@/payload.config'
import type { Category, Hymn, User } from '@/payload-types'
import {
  validateOptionalHTTPSURL,
  validateRequiredHTTPSURL,
} from '@/collections/Hymns'

describe('Hymns Collection Integration & Validation', () => {
  let payload: Payload
  let adminUser: User
  let editorUser: User
  let memberUser: User
  let inactiveAdminUser: User
  let inactiveEditorUser: User

  let hymnCategory: Category
  let booksOnlyCategory: Category

  const createdHymnIds: string[] = []
  const createdCategoryIds: string[] = []
  const createdUserIds: string[] = []

  const testPassword = 'Password123!'
  const runId = Date.now()

  beforeAll(async () => {
    const config = await configPromise
    payload = await getPayload({ config })

    // Create test accounts
    adminUser = await payload.create({
      collection: 'users',
      data: {
        email: `hymn-admin-${runId}@example.com`,
        name: 'Hymn Admin',
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
        email: `hymn-editor-${runId}@example.com`,
        name: 'Hymn Editor',
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
        email: `hymn-member-${runId}@example.com`,
        name: 'Hymn Member',
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
        email: `hymn-inadmin-${runId}@example.com`,
        name: 'Inactive Admin',
        role: 'admin',
        isActive: false,
        password: testPassword,
      },
      overrideAccess: true,
    })
    createdUserIds.push(inactiveAdminUser.id)

    inactiveEditorUser = await payload.create({
      collection: 'users',
      data: {
        email: `hymn-ineditor-${runId}@example.com`,
        name: 'Inactive Editor',
        role: 'editor',
        isActive: false,
        password: testPassword,
      },
      overrideAccess: true,
    })
    createdUserIds.push(inactiveEditorUser.id)

    // Create test categories
    hymnCategory = await payload.create({
      collection: 'categories',
      data: {
        name: 'Marian Praises Category',
        slug: `marian-praises-${runId}`,
        contentTypes: ['hymns'],
      },
      overrideAccess: true,
    })
    createdCategoryIds.push(hymnCategory.id)

    booksOnlyCategory = await payload.create({
      collection: 'categories',
      data: {
        name: 'Theology Books Only',
        slug: `theology-books-${runId}`,
        contentTypes: ['books', 'teachings'],
      },
      overrideAccess: true,
    })
    createdCategoryIds.push(booksOnlyCategory.id)
  })

  afterAll(async () => {
    // Clean up created hymns
    for (const id of createdHymnIds) {
      try {
        await payload.delete({ collection: 'hymns', id, overrideAccess: true })
      } catch {
        // ignore
      }
    }

    // Clean up created categories
    for (const id of createdCategoryIds) {
      try {
        await payload.delete({ collection: 'categories', id, overrideAccess: true })
      } catch {
        // ignore
      }
    }

    // Clean up created users
    for (const id of createdUserIds) {
      try {
        await payload.delete({ collection: 'users', id, overrideAccess: true })
      } catch {
        // ignore
      }
    }
  })

  // ---------------------------------------------------------------------------
  // 1. Access Control: Read & Drafts
  // ---------------------------------------------------------------------------
  describe('Access Control: Reads and Drafts', () => {
    it('allows public reads to see published hymns but hides drafts', async () => {
      const publishedHymn = await payload.create({
        collection: 'hymns',
        data: {
          title: 'Published Public Hymn',
          slug: `pub-hymn-${Date.now()}`,
          kind: 'general',
          _status: 'published',
          lyrics: {
            amharic: 'ይትባረክ እግዚአብሔር አምላከ አበዊነ',
          },
        },
        overrideAccess: true,
      })
      createdHymnIds.push(publishedHymn.id)

      const draftHymn = await payload.create({
        collection: 'hymns',
        data: {
          title: 'Incomplete Draft Hymn',
          slug: `draft-hymn-${Date.now()}`,
          kind: 'marian',
          _status: 'draft',
        },
        draft: true,
        overrideAccess: true,
      })
      createdHymnIds.push(draftHymn.id)

      // Anonymous / Visitor read
      const publicFind = await payload.find({
        collection: 'hymns',
        overrideAccess: false,
        where: {
          id: { in: [publishedHymn.id, draftHymn.id] },
        },
      })

      const foundIds = publicFind.docs.map((doc) => doc.id)
      expect(foundIds).toContain(publishedHymn.id)
      expect(foundIds).not.toContain(draftHymn.id)

      // Member read
      const memberFind = await payload.find({
        collection: 'hymns',
        user: memberUser,
        overrideAccess: false,
        where: {
          id: { in: [publishedHymn.id, draftHymn.id] },
        },
      })
      const memberFoundIds = memberFind.docs.map((doc) => doc.id)
      expect(memberFoundIds).toContain(publishedHymn.id)
      expect(memberFoundIds).not.toContain(draftHymn.id)

      // Staff (Editor) read sees both published and draft hymns
      const editorFind = await payload.find({
        collection: 'hymns',
        user: editorUser,
        overrideAccess: false,
        where: {
          id: { in: [publishedHymn.id, draftHymn.id] },
        },
      })
      const editorFoundIds = editorFind.docs.map((doc) => doc.id)
      expect(editorFoundIds).toContain(publishedHymn.id)
      expect(editorFoundIds).toContain(draftHymn.id)
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Access Control: Member Writes Denied
  // ---------------------------------------------------------------------------
  describe('Access Control: Member Writes Denied', () => {
    it('denies member role from creating, updating, or deleting hymns', async () => {
      // Member create denied
      await expect(
        payload.create({
          collection: 'hymns',
          user: memberUser,
          overrideAccess: false,
          data: {
            title: 'Member Hymn',
            slug: `member-hymn-${Date.now()}`,
            kind: 'general',
            lyrics: { english: 'Praise the Lord' },
          },
        }),
      ).rejects.toThrow()

      // Create a test hymn with override to test update and delete
      const testHymn = await payload.create({
        collection: 'hymns',
        data: {
          title: 'Hymn For Member Write Test',
          slug: `hymn-for-member-${Date.now()}`,
          kind: 'general',
          _status: 'published',
          lyrics: { amharic: 'ሃሌ ሉያ' },
        },
        overrideAccess: true,
      })
      createdHymnIds.push(testHymn.id)

      // Member update denied
      await expect(
        payload.update({
          collection: 'hymns',
          id: testHymn.id,
          user: memberUser,
          overrideAccess: false,
          data: {
            title: 'Hacked Title',
          },
        }),
      ).rejects.toThrow()

      // Member delete denied
      await expect(
        payload.delete({
          collection: 'hymns',
          id: testHymn.id,
          user: memberUser,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // 3. Access Control: Inactive Staff Writes Denied
  // ---------------------------------------------------------------------------
  describe('Access Control: Inactive Staff Writes Denied', () => {
    it('denies inactive editors and inactive admins from creating or mutating hymns', async () => {
      // Inactive Editor create denied
      await expect(
        payload.create({
          collection: 'hymns',
          user: inactiveEditorUser,
          overrideAccess: false,
          data: {
            title: 'Inactive Editor Hymn',
            slug: `inact-ed-hymn-${Date.now()}`,
            kind: 'general',
            lyrics: { english: 'Hymn text' },
          },
        }),
      ).rejects.toThrow()

      // Inactive Admin create denied
      await expect(
        payload.create({
          collection: 'hymns',
          user: inactiveAdminUser,
          overrideAccess: false,
          data: {
            title: 'Inactive Admin Hymn',
            slug: `inact-adm-hymn-${Date.now()}`,
            kind: 'general',
            lyrics: { english: 'Hymn text' },
          },
        }),
      ).rejects.toThrow()

      const targetHymn = await payload.create({
        collection: 'hymns',
        data: {
          title: 'Target For Inactive Test',
          slug: `inact-target-${Date.now()}`,
          kind: 'general',
          _status: 'published',
          lyrics: { english: 'Original text' },
        },
        overrideAccess: true,
      })
      createdHymnIds.push(targetHymn.id)

      // Inactive Admin update denied
      await expect(
        payload.update({
          collection: 'hymns',
          id: targetHymn.id,
          user: inactiveAdminUser,
          overrideAccess: false,
          data: { title: 'Updated By Inactive' },
        }),
      ).rejects.toThrow()

      // Inactive Admin delete denied
      await expect(
        payload.delete({
          collection: 'hymns',
          id: targetHymn.id,
          user: inactiveAdminUser,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })

    it('permits active staff to create and update, but only active admin can delete', async () => {
      // Active Editor creates successfully
      const createdByEditor = await payload.create({
        collection: 'hymns',
        user: editorUser,
        overrideAccess: false,
        data: {
          title: 'Editor Hymn',
          slug: `editor-hymn-${Date.now()}`,
          kind: 'marian',
          _status: 'published',
          lyrics: {
            amharic: 'ውዳሴ ማርያም',
          },
        },
      })
      createdHymnIds.push(createdByEditor.id)
      expect(createdByEditor.id).toBeDefined()

      // Active Editor updates successfully
      const updatedByEditor = await payload.update({
        collection: 'hymns',
        id: createdByEditor.id,
        user: editorUser,
        overrideAccess: false,
        data: {
          summary: 'Updated summary by editor',
        },
      })
      expect(updatedByEditor.summary).toBe('Updated summary by editor')

      // Active Editor delete is denied (Admin only)
      await expect(
        payload.delete({
          collection: 'hymns',
          id: createdByEditor.id,
          user: editorUser,
          overrideAccess: false,
        }),
      ).rejects.toThrow()

      // Active Admin delete succeeds
      const deleteResult = await payload.delete({
        collection: 'hymns',
        id: createdByEditor.id,
        user: adminUser,
        overrideAccess: false,
      })
      expect(deleteResult.id).toBe(createdByEditor.id)
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Incomplete Drafts Allowed & Published Lyrics Requirement
  // ---------------------------------------------------------------------------
  describe('Lyrics Publication Requirement & Draft Incompleteness', () => {
    it('allows incomplete drafts without any lyrics', async () => {
      const draft = await payload.create({
        collection: 'hymns',
        data: {
          title: 'Incomplete Draft Without Lyrics',
          slug: `draft-no-lyrics-${Date.now()}`,
          kind: 'general',
          _status: 'draft',
        },
        draft: true,
        overrideAccess: true,
      })
      createdHymnIds.push(draft.id)

      expect(draft.id).toBeDefined()
      expect(draft._status).toBe('draft')
      expect(draft.lyrics?.geez).toBeFalsy()
      expect(draft.lyrics?.amharic).toBeFalsy()
      expect(draft.lyrics?.english).toBeFalsy()
    })

    it('rejects publishing a hymn with empty or whitespace-only lyrics', async () => {
      // No lyrics provided on published document
      await expect(
        payload.create({
          collection: 'hymns',
          data: {
            title: 'Hymn With No Lyrics',
            slug: `empty-lyrics-${Date.now()}`,
            kind: 'general',
            _status: 'published',
          },
          overrideAccess: true,
        }),
      ).rejects.toThrow(/lyrics/)

      // Whitespace-only lyrics provided
      await expect(
        payload.create({
          collection: 'hymns',
          data: {
            title: 'Hymn With Whitespace Lyrics',
            slug: `whitespace-lyrics-${Date.now()}`,
            kind: 'general',
            _status: 'published',
            lyrics: {
              geez: '   \n  \t  ',
              amharic: '',
              english: '   ',
            },
          },
          overrideAccess: true,
        }),
      ).rejects.toThrow(/lyrics/)
    })
  })

  // ---------------------------------------------------------------------------
  // 5. Any One Available Language Permits Publication
  // ---------------------------------------------------------------------------
  describe('Single Available Lyrics Language Permits Publication', () => {
    it('permits publication with only Ge’ez lyrics and preserves line breaks', async () => {
      const geezText = 'ይትባረክ እግዚአብሔር አምላከ አበዊነ\nስቡሕ ወውዱስ ዘለዓለም።\n\nሃሌ ሉያ!'
      const hymn = await payload.create({
        collection: 'hymns',
        data: {
          title: 'Ge’ez Only Hymn',
          slug: `geez-only-${Date.now()}`,
          kind: 'general',
          _status: 'published',
          lyrics: {
            geez: geezText,
          },
        },
        overrideAccess: true,
      })
      createdHymnIds.push(hymn.id)

      expect(hymn._status).toBe('published')
      expect(hymn.lyrics?.geez).toBe(geezText)
      expect(hymn.lyrics?.amharic).toBeFalsy()
      expect(hymn.lyrics?.english).toBeFalsy()
    })

    it('permits publication with only Amharic lyrics', async () => {
      const amharicText = 'እግዚአብሔር ይመስገን በሰማይ በምድር'
      const hymn = await payload.create({
        collection: 'hymns',
        data: {
          title: 'Amharic Only Hymn',
          slug: `amharic-only-${Date.now()}`,
          kind: 'marian',
          _status: 'published',
          lyrics: {
            amharic: amharicText,
          },
        },
        overrideAccess: true,
      })
      createdHymnIds.push(hymn.id)

      expect(hymn._status).toBe('published')
      expect(hymn.lyrics?.amharic).toBe(amharicText)
    })

    it('permits publication with only English lyrics', async () => {
      const englishText = 'Holy, Holy, Holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee.'
      const hymn = await payload.create({
        collection: 'hymns',
        data: {
          title: 'English Only Hymn',
          slug: `english-only-${Date.now()}`,
          kind: 'general',
          _status: 'published',
          lyrics: {
            english: englishText,
          },
        },
        overrideAccess: true,
      })
      createdHymnIds.push(hymn.id)

      expect(hymn._status).toBe('published')
      expect(hymn.lyrics?.english).toBe(englishText)
    })
  })

  // ---------------------------------------------------------------------------
  // 6. Partial Updates and Clearing the Final Lyrics Text
  // ---------------------------------------------------------------------------
  describe('Partial Updates and Field Clearing', () => {
    it('handles partial updates without erasing omitted lyrics fields', async () => {
      const hymn = await payload.create({
        collection: 'hymns',
        data: {
          title: 'Bilingual Hymn Initial',
          slug: `bilingual-partial-${Date.now()}`,
          kind: 'general',
          _status: 'published',
          lyrics: {
            geez: 'ግዕዝ መዝሙር',
            amharic: 'አማርኛ መዝሙር',
          },
        },
        overrideAccess: true,
      })
      createdHymnIds.push(hymn.id)

      // Partial update modifying ONLY title (lyrics completely omitted)
      const updated = await payload.update({
        collection: 'hymns',
        id: hymn.id,
        data: {
          title: 'Bilingual Hymn Renamed',
        },
        overrideAccess: true,
      })

      expect(updated.title).toBe('Bilingual Hymn Renamed')
      expect(updated.lyrics?.geez).toBe('ግዕዝ መዝሙር')
      expect(updated.lyrics?.amharic).toBe('አማርኛ መዝሙር')
      expect(updated._status).toBe('published')
    })

    it('treats an explicit empty string as clearing a lyrics field and prevents replacing with old value', async () => {
      const hymn = await payload.create({
        collection: 'hymns',
        data: {
          title: 'Clearing Field Test',
          slug: `clearing-test-${Date.now()}`,
          kind: 'marian',
          _status: 'published',
          lyrics: {
            geez: 'የቀድሞ ግዕዝ ጽሑፍ',
            amharic: 'የቀድሞ አማርኛ ጽሑፍ',
          },
        },
        overrideAccess: true,
      })
      createdHymnIds.push(hymn.id)

      // Explicitly clear geez using empty string while keeping amharic intact
      const updated = await payload.update({
        collection: 'hymns',
        id: hymn.id,
        data: {
          lyrics: {
            geez: '',
          },
        },
        overrideAccess: true,
      })

      // geez is now cleared to '' or null, and not replaced by the old 'የቀድሞ ግዕዝ ጽሑፍ'
      expect(updated.lyrics?.geez || '').toBe('')
      expect(updated.lyrics?.amharic).toBe('የቀድሞ አማርኛ ጽሑፍ')
      expect(updated._status).toBe('published')

      // Now clear the remaining amharic field while published: should FAIL because no lyrics remain!
      await expect(
        payload.update({
          collection: 'hymns',
          id: hymn.id,
          data: {
            lyrics: {
              amharic: '',
            },
          },
          overrideAccess: true,
        }),
      ).rejects.toThrow(/lyrics/)

      // But clearing it as draft succeeds
      const draftUpdate = await payload.update({
        collection: 'hymns',
        id: hymn.id,
        data: {
          _status: 'draft',
          lyrics: {
            amharic: '',
          },
        },
        draft: true,
        overrideAccess: true,
      })
      expect(draftUpdate._status).toBe('draft')
      expect(draftUpdate.lyrics?.amharic || '').toBe('')
    })
  })

  // ---------------------------------------------------------------------------
  // 7. Category Applicability & Server-Side Validation
  // ---------------------------------------------------------------------------
  describe('Category Applicability Validation', () => {
    it('accepts categories applicable to hymns', async () => {
      const hymn = await payload.create({
        collection: 'hymns',
        data: {
          title: 'Hymn With Valid Category',
          slug: `valid-cat-hymn-${Date.now()}`,
          kind: 'marian',
          _status: 'published',
          categories: [hymnCategory.id],
          lyrics: {
            amharic: 'ሰላም ለኪ ማርያም',
          },
        },
        overrideAccess: true,
      })
      createdHymnIds.push(hymn.id)

      expect(hymn.id).toBeDefined()
      const categoryRefs = (hymn.categories || []).map((cat: any) =>
        typeof cat === 'object' ? cat.id : cat,
      )
      expect(categoryRefs).toContain(hymnCategory.id)
    })

    it('rejects categories not applicable to hymns', async () => {
      let caughtError: any = null
      try {
        await payload.create({
          collection: 'hymns',
          data: {
            title: 'Hymn With Inapplicable Category',
            slug: `invalid-cat-hymn-${Date.now()}`,
            kind: 'general',
            _status: 'published',
            categories: [booksOnlyCategory.id], // applies to books/teachings only
            lyrics: {
              english: 'Hymn text',
            },
          },
          overrideAccess: true,
        })
      } catch (err) {
        caughtError = err
      }

      expect(caughtError).toBeDefined()
      const detailedMessage =
        caughtError?.data?.errors?.[0]?.message || caughtError?.message || ''
      expect(detailedMessage).toMatch(/not applicable to hymns/)
    })

    it('rejects non-existent category IDs', async () => {
      let caughtError: any = null
      try {
        await payload.create({
          collection: 'hymns',
          data: {
            title: 'Hymn With Fake Category',
            slug: `fake-cat-hymn-${Date.now()}`,
            kind: 'general',
            _status: 'published',
            categories: ['600000000000000000000001'],
            lyrics: {
              english: 'Hymn text',
            },
          },
          overrideAccess: true,
        })
      } catch (err) {
        caughtError = err
      }

      expect(caughtError).toBeDefined()
      const detailedMessage =
        caughtError?.data?.errors?.[0]?.message || caughtError?.message || ''
      expect(detailedMessage).toMatch(/not found/)
    })
  })

  // ---------------------------------------------------------------------------
  // 8. HTTPS URL Validation and Embed/Iframe Rejection
  // ---------------------------------------------------------------------------
  describe('URL Validation in Sources and Resources', () => {
    it('validates optional and required HTTPS URLs properly', () => {
      // Optional URLs (sources.url)
      expect(validateOptionalHTTPSURL(undefined)).toBe(true)
      expect(validateOptionalHTTPSURL(null)).toBe(true)
      expect(validateOptionalHTTPSURL('')).toBe(true)
      expect(validateOptionalHTTPSURL('https://menfesawi.org/liturgy')).toBe(true)
      expect(validateOptionalHTTPSURL('http://insecure.org')).toContain('Use an HTTPS URL')
      expect(validateOptionalHTTPSURL('https://user:pass@example.org')).toContain('Use an HTTPS URL')
      expect(validateOptionalHTTPSURL('<iframe src="https://example.org"></iframe>')).toContain('HTML code')
      expect(validateOptionalHTTPSURL('not a url')).toContain('Enter a valid HTTPS URL')

      // Required URLs (resources.url)
      expect(validateRequiredHTTPSURL(undefined)).toContain('Enter a valid HTTPS URL')
      expect(validateRequiredHTTPSURL(null)).toContain('Enter a valid HTTPS URL')
      expect(validateRequiredHTTPSURL('')).toContain('Enter a valid HTTPS URL')
      expect(validateRequiredHTTPSURL('https://youtube.com/watch?v=123')).toBe(true)
      expect(validateRequiredHTTPSURL('http://insecure.com/video')).toContain('Use an HTTPS URL')
      expect(validateRequiredHTTPSURL('https://admin:secret@domain.com')).toContain('Use an HTTPS URL')
      expect(validateRequiredHTTPSURL('<script>alert(1)</script>')).toContain('HTML code')
    })

    it('stores resource URLs and rejects iframe HTML input when saving a hymn', async () => {
      const validHymn = await payload.create({
        collection: 'hymns',
        data: {
          title: 'Hymn With Valid Resources',
          slug: `res-valid-${Date.now()}`,
          kind: 'general',
          _status: 'published',
          lyrics: {
            english: 'Praise the Lord',
          },
          sources: [
            {
              reference: 'Deacon John Collection, Page 12',
              url: 'https://archive.org/details/hymn',
            },
          ],
          resources: [
            {
              title: 'Choir Video',
              type: 'video',
              url: 'https://youtube.com/watch?v=test1234',
              description: 'Live performance by St. Mary Choir',
            },
          ],
        },
        overrideAccess: true,
      })
      createdHymnIds.push(validHymn.id)
      expect(validHymn.resources?.[0]?.url).toBe('https://youtube.com/watch?v=test1234')

      // Reject raw iframe HTML in resource URL
      await expect(
        payload.create({
          collection: 'hymns',
          data: {
            title: 'Hymn With Iframe',
            slug: `res-iframe-${Date.now()}`,
            kind: 'general',
            _status: 'published',
            lyrics: {
              english: 'Hymn text',
            },
            resources: [
              {
                title: 'Embedded Player',
                type: 'video',
                url: '<iframe width="560" height="315" src="https://www.youtube.com"></iframe>',
              },
            ],
          },
          overrideAccess: true,
        }),
      ).rejects.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // 9. Slug Validation
  // ---------------------------------------------------------------------------
  describe('Slug Validation', () => {
    it('rejects invalid slugs with uppercase, spaces, or invalid characters', async () => {
      let caughtError1: any = null
      try {
        await payload.create({
          collection: 'hymns',
          data: {
            title: 'Bad Slug Hymn',
            slug: 'Invalid Slug With Spaces',
            kind: 'general',
            _status: 'published',
            lyrics: { english: 'text' },
          },
          overrideAccess: true,
        })
      } catch (err) {
        caughtError1 = err
      }
      expect(caughtError1).toBeDefined()
      const msg1 =
        caughtError1?.data?.errors?.[0]?.message || caughtError1?.message || ''
      expect(msg1).toMatch(/lowercase/i)

      let caughtError2: any = null
      try {
        await payload.create({
          collection: 'hymns',
          data: {
            title: 'Double Hyphen Hymn',
            slug: 'invalid--double--hyphen',
            kind: 'general',
            _status: 'published',
            lyrics: { english: 'text' },
          },
          overrideAccess: true,
        })
      } catch (err) {
        caughtError2 = err
      }
      expect(caughtError2).toBeDefined()
      const msg2 =
        caughtError2?.data?.errors?.[0]?.message || caughtError2?.message || ''
      expect(msg2).toMatch(/lowercase/i)
    })
  })
})
