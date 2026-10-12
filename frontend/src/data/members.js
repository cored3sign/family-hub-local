import { all, get, insert, patch, table, blankToNull, byText } from './collection'

const T = 'members'
export const AVATAR_COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#264653', '#8e7dbe', '#f4a261', '#4d5faf', '#d62828']
export const NAV_SLOT_LIMIT = 5
const EDITABLE = ['name', 'role', 'avatar_color', 'avatar_asset_id', 'theme_preference', 'todo_default_view', 'has_seen_onboarding']

export function listMembers(doc) {
  return all(doc, T).sort((a, b) => a.created_at.localeCompare(b.created_at) || byText(a.name, b.name))
}

export function getMember(doc, id) {
  return get(doc, T, id)
}

export function memberName(doc, id) {
  return getMember(doc, id)?.name ?? null
}

export function actorFor(doc, id) {
  const m = getMember(doc, id)
  return m ? { id: m.id, name: m.name, role: m.role } : null
}

// Roles are advisory (no server to enforce them): anyone with the room
// token can write to the doc. These checks keep the UI honest, nothing more.
export function isAdmin(doc, actor) {
  return getMember(doc, actor?.id)?.role === 'admin'
}

export function requireAdmin(doc, actor) {
  if (!isAdmin(doc, actor)) throw new Error('Only an admin can do that')
}

export function addMember(doc, { name, role = 'member', avatar_color } = {}, id) {
  const cleanName = blankToNull(name)
  if (!cleanName) throw new Error('name is required')
  if (!['admin', 'member'].includes(role)) throw new Error('role must be admin or member')
  return insert(doc, T, {
    name: cleanName,
    role,
    avatar_color: avatar_color || AVATAR_COLORS[table(doc, T).size % AVATAR_COLORS.length],
    avatar_asset_id: null,
    nav_pinned: ['todos', 'shopping'],
    theme_preference: null,
    todo_default_view: null,
    has_seen_onboarding: false,
  }, id)
}

export function updateMember(doc, id, fields) {
  const current = getMember(doc, id)
  if (!current) throw new Error('Member not found')
  const clean = Object.fromEntries(Object.entries(fields).filter(([k]) => EDITABLE.includes(k)))
  if ('name' in clean) {
    clean.name = blankToNull(clean.name)
    if (!clean.name) throw new Error('name is required')
  }
  if ('role' in clean && !['admin', 'member'].includes(clean.role)) throw new Error('role must be admin or member')
  if (clean.role === 'member' && current.role === 'admin' && listMembers(doc).filter((m) => m.role === 'admin').length === 1) {
    throw new Error('The family needs at least one admin')
  }
  patch(doc, T, id, clean)
}

export function pinModule(doc, memberId, key) {
  const pinned = getMember(doc, memberId)?.nav_pinned ?? []
  if (pinned.includes(key)) return
  if (pinned.length >= NAV_SLOT_LIMIT) throw new Error(`All ${NAV_SLOT_LIMIT} nav slots are full`)
  patch(doc, T, memberId, { nav_pinned: [...pinned, key] })
}

export function unpinModule(doc, memberId, key) {
  const pinned = getMember(doc, memberId)?.nav_pinned ?? []
  patch(doc, T, memberId, { nav_pinned: pinned.filter((k) => k !== key) })
}

export function reorderPinned(doc, memberId, keys) {
  patch(doc, T, memberId, { nav_pinned: [...keys] })
}
