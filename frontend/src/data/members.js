import { all, get, insert, patch, table, blankToNull, byText } from './collection'
import { nowStamp } from './time'
import { THEMES } from '../lib/theme.js'
import { scryptAsync } from '@noble/hashes/scrypt.js'
import { randomBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

const T = 'members'
export const AVATAR_COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#264653', '#8e7dbe', '#f4a261', '#4d5faf', '#d62828']
// The bottom menu on a phone has four slots (DashboardLayout.vue's slotCount).
export const NAV_SLOT_LIMIT = 4
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
  if ('theme_preference' in clean && clean.theme_preference !== null && !THEMES.includes(clean.theme_preference)) {
    throw new Error('Unknown theme')
  }
  if (clean.role === 'member' && current.role === 'admin' && listMembers(doc).filter((m) => m.role === 'admin').length === 1) {
    throw new Error('The family needs at least one admin')
  }
  patch(doc, T, id, clean)
}

// Changes a member's role. Only an admin can do it; the last admin can't demote themselves.
export function setMemberRole(doc, actor, memberId, role) {
  requireAdmin(doc, actor)
  updateMember(doc, memberId, { role })
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

// Admin PINs. Six digits, stored only as an scrypt hash with its own random salt on
// the admin's member record. A PIN is not a password: it keeps family members from
// opening an admin profile on a shared device, and it's checked before sensitive
// changes. The wrong-PIN lockout lives on the device (stores/adminLock.js).
export const PIN_LENGTH = 6
const PIN_SCRYPT = { N: 2 ** 14, r: 8, p: 1, dkLen: 32 }

export function isValidPin(pin) {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(String(pin ?? ''))
}

export function hasAdminPin(doc, memberId) {
  return Boolean(getMember(doc, memberId)?.pin_hash)
}

async function pinHash(pin, salt) {
  return scryptAsync(new TextEncoder().encode(String(pin)), salt, PIN_SCRYPT)
}

// Sets (or replaces) an admin's own PIN.
export async function setAdminPin(doc, memberId, pin) {
  const member = getMember(doc, memberId)
  if (!member) throw new Error('Member not found')
  if (member.role !== 'admin') throw new Error('Only an admin has a PIN')
  if (!isValidPin(pin)) throw new Error(`The PIN is ${PIN_LENGTH} digits`)
  const salt = randomBytes(16)
  const hash = await pinHash(pin, salt)
  patch(doc, T, memberId, { pin_salt: bytesToHex(salt), pin_hash: bytesToHex(hash), pin_set_at: nowStamp() })
}

// True when `pin` is this admin's PIN. Always false for members, and for admins with no PIN.
export async function verifyAdminPin(doc, memberId, pin) {
  const member = getMember(doc, memberId)
  if (!member || member.role !== 'admin' || !member.pin_salt || !member.pin_hash || !isValidPin(pin)) return false
  const hash = await pinHash(pin, hexToBytes(member.pin_salt))
  return sameBytes(hash, hexToBytes(member.pin_hash))
}

// Compares every byte, so a wrong guess takes as long as a near-right one.
function sameBytes(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export function reorderPinned(doc, memberId, keys) {
  patch(doc, T, memberId, { nav_pinned: [...keys] })
}
