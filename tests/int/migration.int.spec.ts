import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import mongoose from 'mongoose'
import {
  evaluateUserRecord,
  resolveName,
  resolveAvatarURL,
  resolveIsActive,
  resolveRole,
  type LegacyUserDoc,
} from '../../scripts/migrate-user-fields'

describe('User Field Migration & Conflict Detection', () => {
  // -------------------------------------------------------------
  // 1. Name Resolution & Conflict Detection
  // -------------------------------------------------------------
  it('resolves legacy names cleanly when no conflict exists', () => {
    // Only "full name"
    const doc1: LegacyUserDoc = { _id: '1', 'full name': 'Abebe Bikila' }
    const res1 = resolveName(doc1)
    expect(res1.value).toBe('Abebe Bikila')
    expect(res1.conflict).toBeUndefined()

    // Canonical name already exists, no legacy name
    const doc2: LegacyUserDoc = { _id: '2', name: 'Haile Gebrselassie' }
    const res2 = resolveName(doc2)
    expect(res2.value).toBe('Haile Gebrselassie')
    expect(res2.conflict).toBeUndefined()

    // Canonical and legacy are identical (no conflict)
    const doc3: LegacyUserDoc = { _id: '3', name: 'Kenenisa Bekele', 'full name': 'Kenenisa Bekele' }
    const res3 = resolveName(doc3)
    expect(res3.value).toBe('Kenenisa Bekele')
    expect(res3.conflict).toBeUndefined()
  })

  it('detects conflicts between canonical name and legacy full name', () => {
    const doc: LegacyUserDoc = {
      _id: '1',
      name: 'Abebe Canonical',
      'full name': 'Abebe Legacy',
    }
    const res = resolveName(doc)
    expect(res.conflict).toBeDefined()
    expect(res.conflict).toContain('Conflicting canonical name')
  })

  it('detects conflicts in localized full names across languages', () => {
    const doc: LegacyUserDoc = {
      _id: '1',
      'full name': {
        en: 'English Name',
        am: 'Different Amharic Name',
      },
    }
    const res = resolveName(doc)
    expect(res.conflict).toBeDefined()
    expect(res.conflict).toContain('Conflicting localized full names')
  })

  // -------------------------------------------------------------
  // 2. Avatar URL Resolution & Conflict Detection
  // -------------------------------------------------------------
  it('resolves avatar URL cleanly when no conflict exists', () => {
    const doc1: LegacyUserDoc = { _id: '1', avator_url: 'https://example.com/avatar.jpg' }
    const res1 = resolveAvatarURL(doc1)
    expect(res1.value).toBe('https://example.com/avatar.jpg')
    expect(res1.conflict).toBeUndefined()

    const doc2: LegacyUserDoc = { _id: '2', avatarURL: 'https://example.com/canonical.jpg' }
    const res2 = resolveAvatarURL(doc2)
    expect(res2.value).toBe('https://example.com/canonical.jpg')
    expect(res2.conflict).toBeUndefined()
  })

  it('detects conflict between canonical avatarURL and legacy avator_url', () => {
    const doc: LegacyUserDoc = {
      _id: '1',
      avatarURL: 'https://example.com/new.jpg',
      avator_url: 'https://example.com/old.jpg',
    }
    const res = resolveAvatarURL(doc)
    expect(res.conflict).toBeDefined()
    expect(res.conflict).toContain('Conflicting canonical avatarURL')
  })

  // -------------------------------------------------------------
  // 3. Activation State Resolution & Conflict Detection
  // -------------------------------------------------------------
  it('resolves known status values and isActive booleans', () => {
    expect(resolveIsActive({ _id: '1', status: 'active' }).value).toBe(true)
    expect(resolveIsActive({ _id: '2', status: 'inactive' }).value).toBe(false)
    expect(resolveIsActive({ _id: '3', isActive: true }).value).toBe(true)
    expect(resolveIsActive({ _id: '4', isActive: false }).value).toBe(false)
  })

  it('detects unknown status values', () => {
    const res1 = resolveIsActive({ _id: '1', status: 'pending' })
    expect(res1.conflict).toBeDefined()
    expect(res1.conflict).toContain('Unknown activation status value')

    const res2 = resolveIsActive({ _id: '2', status: 'banned' })
    expect(res2.conflict).toBeDefined()
    expect(res2.conflict).toContain('Unknown activation status value')
  })

  it('detects conflict between canonical isActive and legacy status', () => {
    const doc: LegacyUserDoc = {
      _id: '1',
      isActive: true,
      status: 'inactive',
    }
    const res = resolveIsActive(doc)
    expect(res.conflict).toBeDefined()
    expect(res.conflict).toContain('Conflicting canonical isActive')
  })

  // -------------------------------------------------------------
  // 4. Role Resolution & Conflict Detection
  // -------------------------------------------------------------
  it('resolves clean roles and uniform localized roles', () => {
    expect(resolveRole({ _id: '1', role: 'admin' }).value).toBe('admin')
    expect(resolveRole({ _id: '2', role: 'editor' }).value).toBe('editor')
    expect(resolveRole({ _id: '3', role: 'member' }).value).toBe('member')

    // Uniform localized roles across locales
    const resLoc = resolveRole({ _id: '4', role: { en: 'editor', am: 'editor' } })
    expect(resLoc.value).toBe('editor')
    expect(resLoc.conflict).toBeUndefined()
  })

  it('detects conflicting localized roles across locales', () => {
    const doc: LegacyUserDoc = {
      _id: '1',
      role: {
        en: 'admin',
        am: 'member',
      },
    }
    const res = resolveRole(doc)
    expect(res.conflict).toBeDefined()
    expect(res.conflict).toContain('Conflicting localized roles across locales')
  })

  it('detects invalid role strings', () => {
    const res = resolveRole({ _id: '1', role: 'superadmin' })
    expect(res.conflict).toBeDefined()
    expect(res.conflict).toContain('Invalid role string')
  })

  // -------------------------------------------------------------
  // 5. evaluateUserRecord: Skips conflicting records & preserves legacy data
  // -------------------------------------------------------------
  it('evaluates clean records successfully for migration', () => {
    const cleanDoc: LegacyUserDoc = {
      _id: 'clean-1',
      email: 'clean@example.com',
      'full name': 'Clean User',
      avator_url: 'https://example.com/avatar.jpg',
      status: 'active',
      role: 'member',
    }

    const evalRes = evaluateUserRecord(cleanDoc)
    expect(evalRes.hasConflict).toBe(false)
    expect(evalRes.conflictReasons.length).toBe(0)
    expect(evalRes.proposedSet.name).toBe('Clean User')
    expect(evalRes.proposedSet.avatarURL).toBe('https://example.com/avatar.jpg')
    expect(evalRes.proposedSet.isActive).toBe(true)
    expect(evalRes.proposedSet.role).toBe('member')
    expect(evalRes.proposedUnset['full name']).toBe('')
    expect(evalRes.proposedUnset['avator_url']).toBe('')
    expect(evalRes.proposedUnset['status']).toBe('')
  })

  it('skips conflicting records and proposes ZERO modifications to preserve legacy data', () => {
    const conflictingDoc: LegacyUserDoc = {
      _id: 'conflict-1',
      email: 'conflict@example.com',
      name: 'Canonical Name',
      'full name': 'Different Legacy Name',
      status: 'pending',
      role: {
        en: 'admin',
        am: 'member',
      },
    }

    const evalRes = evaluateUserRecord(conflictingDoc)
    expect(evalRes.hasConflict).toBe(true)
    expect(evalRes.conflictReasons.length).toBeGreaterThanOrEqual(3)
    // CRITICAL: Proposed set and unset MUST be empty so no legacy data is touched or deleted
    expect(Object.keys(evalRes.proposedSet).length).toBe(0)
    expect(Object.keys(evalRes.proposedUnset).length).toBe(0)
  })
})
