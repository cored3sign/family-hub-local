// This device's hub config, sync problem flag and last-synced stamp.
// The hub URL, room id and token live only here in localStorage, never in
// a Y.Doc.
//
// Every function takes `{ storage }` (defaults to globalThis.localStorage)
// so Node tests can inject an in-memory Storage. Reads treat anything
// invalid, unparseable or blocked as "nothing stored".
import { nowStamp } from '../time'
import { isValidRoomId, isValidToken } from './protocol.js'

export const HUB_KEY = 'fh.hub'
export const PROBLEM_KEY = 'fh.sync.problem'
export const LAST_SYNCED_KEY = 'fh.sync.lastSyncedAt'

export const ROLES = ['device', 'hub-machine']
// protocol: the hub closed with 4400 (this app and the hub disagree on the
// sync protocol -- e.g. an old hub and a newer app, or the other way round).
export const PROBLEM_KINDS = ['revoked', 'room-gone', 'protocol']

const STAMP = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/

function storageOf(opts) {
  return opts?.storage ?? globalThis.localStorage
}

function read(key, opts) {
  try {
    return storageOf(opts)?.getItem(key) ?? null
  } catch {
    return null
  }
}

function readJson(key, opts) {
  const text = read(key, opts)
  if (text == null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Config writes must not silently fail (pairing would look done but be
// lost on reload), so they throw; the flag writes below swallow errors.
function write(key, value, opts) {
  storageOf(opts).setItem(key, value)
}

function remove(key, opts) {
  try {
    storageOf(opts)?.removeItem(key)
  } catch {
    // storage blocked: nothing to remove
  }
}

function isHttpUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.host
  } catch {
    return false
  }
}

export function isValidHubConfig(cfg) {
  return (
    cfg !== null &&
    typeof cfg === 'object' &&
    cfg.v === 1 &&
    isHttpUrl(cfg.hubUrl) &&
    isValidRoomId(cfg.roomId) &&
    isValidToken(cfg.token) &&
    ROLES.includes(cfg.role) &&
    typeof cfg.pairedAt === 'string' &&
    STAMP.test(cfg.pairedAt)
  )
}

export function loadHubConfig(opts) {
  const cfg = readJson(HUB_KEY, opts)
  if (!isValidHubConfig(cfg)) return null
  const { v, hubUrl, roomId, token, role, pairedAt } = cfg
  return { v, hubUrl, roomId, token, role, pairedAt }
}

// Only pairing.js's applyPairing() may call this with a new roomId
// (global-constraints.md, room-binding invariant).
export function saveHubConfig(cfg, opts) {
  if (!isValidHubConfig(cfg)) throw new Error('Invalid hub config')
  const { v, hubUrl, roomId, token, role, pairedAt } = cfg
  write(HUB_KEY, JSON.stringify({ v, hubUrl, roomId, token, role, pairedAt }), opts)
}

export function clearHubConfig(opts) {
  remove(HUB_KEY, opts)
}

export function loadProblem(opts) {
  const p = readJson(PROBLEM_KEY, opts)
  if (!p || typeof p !== 'object' || !PROBLEM_KINDS.includes(p.kind) || typeof p.roomId !== 'string') return null
  return { kind: p.kind, roomId: p.roomId, at: typeof p.at === 'string' ? p.at : null }
}

export function setProblem({ kind, roomId }, opts) {
  if (!PROBLEM_KINDS.includes(kind)) throw new Error(`Unknown sync problem: ${kind}`)
  const at = nowStamp(opts?.now ? opts.now() : new Date())
  try {
    write(PROBLEM_KEY, JSON.stringify({ kind, roomId, at }), opts)
  } catch {
    // storage blocked: the in-memory connection state still shows it
  }
}

export function clearProblem(opts) {
  remove(PROBLEM_KEY, opts)
}

export function getLastSyncedAt(opts) {
  const stamp = read(LAST_SYNCED_KEY, opts)
  return stamp && STAMP.test(stamp) ? stamp : null
}

export function setLastSyncedAt(stamp, opts) {
  try {
    write(LAST_SYNCED_KEY, stamp, opts)
  } catch {
    // storage blocked: the header just won't show a time
  }
}

export function clearLastSyncedAt(opts) {
  remove(LAST_SYNCED_KEY, opts)
}
