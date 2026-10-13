// The family's device list. Each device writes one record about itself into the family's
// shared data, and Settings → Devices shows them. A record holds only a readable label, a
// random id, and when the device last synced. It says nothing about what the device shows.

import { all, get, insert, patch } from './collection.js'
import { hasFamily } from './backupFormat.js'
import { PRESENCE_ORIGIN } from './origins.js'
import { nowStamp } from './time.js'

const T = 'devices'
const WRITE_EVERY_MS = 10 * 60 * 1000
let stopCurrent = null

// A readable name for a browser, such as "iPhone · Safari" or "Mac · Chrome".
export function deviceLabel(userAgent = '', { standalone = false } = {}) {
  const ua = String(userAgent)
  const platform = /iPad/.test(ua) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Android'
    : /Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows PC'
    : /Linux/.test(ua) ? 'Linux'
    : 'Device'
  const browser = /\bEdg[A-Za-z]*\//.test(ua) ? 'Edge'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : ''
  const app = standalone ? 'Home Screen app' : browser
  return app ? `${platform} · ${app}` : platform
}

// This device's label, from the browser it runs in.
export function thisDeviceLabel(env = globalThis) {
  const navigatorLike = env.navigator ?? {}
  const standalone = navigatorLike.standalone === true
    || Boolean(env.matchMedia?.('(display-mode: standalone)')?.matches)
  return deviceLabel(navigatorLike.userAgent ?? '', { standalone })
}

// Writes this device's record, unless it was written in the last few minutes. Nothing is
// written until the family exists on this device, so an unpaired device's doc stays empty.
export function recordDevice(doc, { id, label, now = new Date() }) {
  if (!id || !hasFamily(doc)) return false
  const existing = get(doc, T, id)
  const last = parseStamp(existing?.last_seen)
  if (last !== null && now.getTime() - last < WRITE_EVERY_MS) return false
  const fields = { label, last_seen: nowStamp(now) }
  doc.transact(() => {
    if (existing) patch(doc, T, id, fields)
    else insert(doc, T, fields, id)
  }, PRESENCE_ORIGIN)
  return true
}

// Keeps this device's record fresh while the page is open. It also writes as soon as the
// family arrives over sync, so a new phone shows up without waiting ten minutes. Only one
// device list runs per page; starting another one replaces it. Returns a function that stops it.
export function startPresence(doc, { id, label }, { timers = globalThis } = {}) {
  if (stopCurrent) stopCurrent()
  const write = () => {
    try {
      recordDevice(doc, { id, label })
    } catch {
      // The device list is extra. A failed write must never stop the family's sync.
    }
  }
  doc.on('update', write)
  write()
  const timer = timers.setInterval(write, WRITE_EVERY_MS)
  timer?.unref?.()
  stopCurrent = () => {
    doc.off('update', write)
    timers.clearInterval(timer)
  }
  return stopCurrent
}

// Every device in the family, most recently synced first.
export function listDevices(doc) {
  return all(doc, T).sort((a, b) => String(b.last_seen ?? '').localeCompare(String(a.last_seen ?? '')))
}

// "just now", "12 min ago", "3 hours ago", "1 day ago".
export function describeLastSeen(stamp, now = new Date()) {
  const t = parseStamp(stamp)
  if (t === null) return 'unknown'
  const minutes = Math.floor((now.getTime() - t) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

// The stamp as milliseconds, or null when it is missing or not a stamp.
function parseStamp(stamp) {
  if (!stamp) return null
  const t = Date.parse(`${String(stamp).replace(' ', 'T')}Z`)
  return Number.isFinite(t) ? t : null
}
