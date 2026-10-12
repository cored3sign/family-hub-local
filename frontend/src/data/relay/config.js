// This device's relay setup: the relay address and the family key, kept in
// localStorage. The key is also in the pairing link, in the fragment, which
// browsers never send to a server.
import { KEY_BYTES, deriveRoomId, fromBase64Url, toBase64Url } from './crypto.js'

export const RELAY_KEY = 'fh.relay'
export const RELAY_FRAGMENT = 'relay'
const VERSION = 1

function storageOf(opts) {
  return opts?.storage ?? globalThis.localStorage
}

export function isValidRelayConfig(cfg) {
  return (
    cfg !== null &&
    typeof cfg === 'object' &&
    cfg.v === VERSION &&
    typeof cfg.url === 'string' &&
    /^https?:\/\/[^/\s]+$/.test(cfg.url) &&
    typeof cfg.key === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(cfg.key)
  )
}

export function loadRelayConfig(opts) {
  try {
    const cfg = JSON.parse(storageOf(opts)?.getItem(RELAY_KEY) ?? 'null')
    return isValidRelayConfig(cfg) ? { url: cfg.url, key: fromBase64Url(cfg.key) } : null
  } catch {
    return null
  }
}

export function saveRelayConfig({ url, key }, opts) {
  if (key.length !== KEY_BYTES) throw new Error('Invalid family key')
  storageOf(opts).setItem(RELAY_KEY, JSON.stringify({ v: VERSION, url, key: toBase64Url(key) }))
}

export function clearRelayConfig(opts) {
  try {
    storageOf(opts)?.removeItem(RELAY_KEY)
  } catch {
    // storage blocked: nothing to clear
  }
}

export function relayPairingUrl(url, key) {
  return `${url.replace(/\/$/, '')}/#${RELAY_FRAGMENT}=${VERSION}.${toBase64Url(key)}`
}

// Reads #relay=1.<key> from the page address and removes it from the address bar at once.
// Nothing is saved here. A link someone else sent could point this device at their room,
// so the app asks the person to confirm the join first (see pending.js).
// -> { url, key } or null.
export function readRelayFragment(location = globalThis.location, history = globalThis.history) {
  const raw = (location?.hash ?? '').replace(/^#/, '')
  const value = new URLSearchParams(raw).get(RELAY_FRAGMENT)
  if (!value) return null
  history?.replaceState?.(null, '', location.pathname + location.search)
  const match = /^1\.([A-Za-z0-9_-]{43})$/.exec(value)
  if (!match) return null
  return { url: location.origin, key: fromBase64Url(match[1]) }
}

// The device id this phone uses in relay messages, so the relay doesn't push a
// device its own changes. Random, kept on the device.
export function relayDeviceId(opts) {
  const store = storageOf(opts)
  try {
    let id = store?.getItem('fh.relay.device')
    if (!id) {
      id = toBase64Url(newDeviceBytes())
      store?.setItem('fh.relay.device', id)
    }
    return id
  } catch {
    return toBase64Url(newDeviceBytes())
  }
}

function newDeviceBytes() {
  return globalThis.crypto.getRandomValues(new Uint8Array(12))
}

// The relay in the same shape as a hub config, so the status logic and Settings
// keep working. The family's room id is derived from the key.
export function relayStatusConfig(relay) {
  return { v: VERSION, hubUrl: relay.url, roomId: deriveRoomId(relay.key, 'main'), token: '', role: 'device', pairedAt: '' }
}

// Reads a family link the person pasted (the whole link, or just its #relay= part).
// -> { url, key } or null. Saves nothing. Used on a phone's Home Screen app, which
// can't read the link from Safari.
export function parseRelayLink(text) {
  let url
  try {
    url = new URL(String(text ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const value = new URLSearchParams(url.hash.replace(/^#/, '')).get(RELAY_FRAGMENT)
  const match = value ? /^1\.([A-Za-z0-9_-]{43})$/.exec(value) : null
  if (!match) return null
  return { url: url.origin, key: fromBase64Url(match[1]) }
}
