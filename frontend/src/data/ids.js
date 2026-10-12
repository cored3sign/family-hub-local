// `crypto.randomUUID` is secure-context-only (HTTPS or localhost). This app
// is also reachable over plain LAN http (e.g. http://192.0.2.20:8787), so
// every device needs ids without it. The fallback builds an RFC 4122 v4
// UUID from `crypto.getRandomValues`, which has no such restriction.
export function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
