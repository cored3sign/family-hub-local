import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { newFamilyDoc, forkDoc, syncDocs } from './testing'
import { listMembers, addMember, updateMember, requireAdmin, pinModule, unpinModule, reorderPinned, getMember, actorFor } from './members'
import { insert } from './collection'

describe('members', () => {
  it('lists members in creation order with actorFor', () => {
    const { doc, admin, kid } = newFamilyDoc()
    expect(listMembers(doc).map((m) => m.name).sort()).toEqual(['Kit Kid', 'Pat Parent'])
    expect(actorFor(doc, kid.id)).toEqual({ id: kid.id, name: 'Kit Kid', role: 'member' })
    expect(actorFor(doc, 'missing')).toBe(null)
    expect(() => requireAdmin(doc, kid)).toThrow('Only an admin can do that')
    expect(() => requireAdmin(doc, admin)).not.toThrow()
  })

  it('keeps at least one admin and requires a name', () => {
    const { doc, admin } = newFamilyDoc()
    expect(() => updateMember(doc, admin.id, { role: 'member' })).toThrow('The family needs at least one admin')
    expect(() => addMember(doc, { name: '' })).toThrow('name is required')
    expect(() => updateMember(doc, admin.id, { email: 'x@y.z' })).not.toThrow() // unknown keys ignored
    expect(getMember(doc, admin.id).email).toBeUndefined()
  })

  it('pins, unpins and reorders nav modules with a 5-slot limit', () => {
    const { doc, admin } = newFamilyDoc()
    pinModule(doc, admin.id, 'calendar')
    pinModule(doc, admin.id, 'calendar')
    expect(getMember(doc, admin.id).nav_pinned).toEqual(['todos', 'shopping', 'calendar'])
    pinModule(doc, admin.id, 'goals')
    pinModule(doc, admin.id, 'wishlist')
    expect(() => pinModule(doc, admin.id, 'library')).toThrow('All 5 nav slots are full')
    unpinModule(doc, admin.id, 'todos')
    reorderPinned(doc, admin.id, ['wishlist', 'goals', 'calendar', 'shopping'])
    expect(getMember(doc, admin.id).nav_pinned).toEqual(['wishlist', 'goals', 'calendar', 'shopping'])
  })

  it('sorts deterministically across synced devices when members share a created_at second', () => {
    const a = forkDoc(new Y.Doc())
    const b = forkDoc(new Y.Doc())
    // Both devices add members with identical timestamps
    insert(a, 'members', { name: 'Zed', role: 'member', avatar_color: '#e76f51', avatar_asset_id: null, nav_pinned: ['todos', 'shopping'], theme_preference: null, todo_default_view: null, has_seen_onboarding: false, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' })
    insert(b, 'members', { name: 'Alice', role: 'member', avatar_color: '#e76f51', avatar_asset_id: null, nav_pinned: ['todos', 'shopping'], theme_preference: null, todo_default_view: null, has_seen_onboarding: false, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' })
    // Sync both docs
    syncDocs(a, b)
    // Both should show the same deterministic order (alphabetical by name as tiebreaker)
    const aOrder = listMembers(a).map((m) => m.name)
    const bOrder = listMembers(b).map((m) => m.name)
    expect(aOrder).toEqual(bOrder)
    expect(aOrder).toEqual(['Alice', 'Zed'])
  })
})
