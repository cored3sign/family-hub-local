// Localhost-only admin guard. All three checks in isLocalAdminRequest are
// required together: a loopback remote address alone is not enough,
// because a reverse proxy and the Vite dev proxy both connect to the hub
// from 127.0.0.1 while forwarding a remote request's original Host (and,
// for a reverse proxy, identity headers).

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
export const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-forwarded-host', 'x-real-ip', 'tailscale-user-login']

// Strict bracketed-IPv6 matcher: the whole header must be exactly
// `[<literal>]` optionally followed by `:<port>`, with nothing before,
// after, or between -- so `[::1]:8787` matches but `[::1]garbage` (or
// anything else trailing the closing bracket besides a clean :port) does
// not silently fall through with the bracket stripped anyway.
const BRACKETED_IPV6 = /^\[([^\]]+)\](:\d*)?$/

// Strips a trailing :port and unwraps an IPv6 literal's brackets, so
// `localhost:8787`, `127.0.0.1:5173` and `[::1]:8787` all reduce to the
// bare host this function compares against the allowed set. Returns ''
// for an absent/empty Host header or a malformed bracketed literal,
// which never matches the allowed set either way.
function hostnameOf(hostHeader) {
  const value = String(hostHeader || '')
  if (value === '') return ''
  if (value.includes('[') || value.includes(']')) {
    const match = BRACKETED_IPV6.exec(value)
    return match ? match[1] : ''
  }
  const colon = value.lastIndexOf(':')
  if (colon === -1) return value
  // A bare (unbracketed) IPv6 literal has more than one colon; a
  // host:port pair has exactly one. Only strip the port in the latter
  // case.
  if (value.indexOf(':') !== colon) return value
  return value.slice(0, colon)
}

export function isLocalAdminRequest(req) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return false
  if (PROXY_HEADERS.some((h) => h in req.headers)) return false
  const host = hostnameOf(req.headers.host)
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export function isAdminMutationAllowed(req) {
  if (!isLocalAdminRequest(req)) return false
  if (req.headers['x-family-hub-admin'] !== '1') return false
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return false
  const origin = req.headers.origin
  return !origin || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)
}
