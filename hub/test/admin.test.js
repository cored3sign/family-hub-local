import { describe, it, expect } from 'vitest'
import { isLocalAdminRequest, isAdminMutationAllowed } from '../src/admin.js'

function fakeRequest({ remoteAddress, headers = {} }) {
  return { socket: { remoteAddress }, headers }
}

describe('isLocalAdminRequest', () => {
  it('accepts localhost:8787 from loopback', () => {
    expect(isLocalAdminRequest(fakeRequest({ remoteAddress: '127.0.0.1', headers: { host: 'localhost:8787' } }))).toBe(true)
  })

  it('accepts 127.0.0.1:5173 from loopback', () => {
    expect(isLocalAdminRequest(fakeRequest({ remoteAddress: '127.0.0.1', headers: { host: '127.0.0.1:5173' } }))).toBe(true)
  })

  it('accepts [::1]:8787 from loopback (IPv6 remote address)', () => {
    expect(isLocalAdminRequest(fakeRequest({ remoteAddress: '::1', headers: { host: '[::1]:8787' } }))).toBe(true)
  })

  it('accepts a loopback-mapped IPv4 remote address (::ffff:127.0.0.1)', () => {
    expect(
      isLocalAdminRequest(fakeRequest({ remoteAddress: '::ffff:127.0.0.1', headers: { host: 'localhost:8787' } }))
    ).toBe(true)
  })

  it('rejects Host: desktop.example.com from loopback (a reverse proxy)', () => {
    expect(
      isLocalAdminRequest(fakeRequest({ remoteAddress: '127.0.0.1', headers: { host: 'desktop.example.com' } }))
    ).toBe(false)
  })

  it('rejects any X-Forwarded-For header, even with a good Host', () => {
    expect(
      isLocalAdminRequest(
        fakeRequest({
          remoteAddress: '127.0.0.1',
          headers: { host: 'localhost:8787', 'x-forwarded-for': '127.0.0.1' },
        })
      )
    ).toBe(false)
  })

  it('rejects other proxy headers (forwarded, x-forwarded-host, x-real-ip, tailscale-user-login)', () => {
    for (const header of ['forwarded', 'x-forwarded-host', 'x-real-ip', 'tailscale-user-login']) {
      expect(
        isLocalAdminRequest(
          fakeRequest({ remoteAddress: '127.0.0.1', headers: { host: 'localhost:8787', [header]: 'anything' } })
        )
      ).toBe(false)
    }
  })

  it('rejects Host: 192.0.2.20:8787 from loopback', () => {
    expect(
      isLocalAdminRequest(fakeRequest({ remoteAddress: '127.0.0.1', headers: { host: '192.0.2.20:8787' } }))
    ).toBe(false)
  })

  it('rejects Host: evil.example from loopback (DNS rebinding)', () => {
    expect(isLocalAdminRequest(fakeRequest({ remoteAddress: '127.0.0.1', headers: { host: 'evil.example' } }))).toBe(
      false
    )
  })

  it('rejects a non-loopback remote address even with a good Host', () => {
    expect(
      isLocalAdminRequest(fakeRequest({ remoteAddress: '192.0.2.20', headers: { host: 'localhost:8787' } }))
    ).toBe(false)
  })

  it('rejects Host: [::1]garbage from loopback (malformed bracketed IPv6, not a clean :port)', () => {
    expect(isLocalAdminRequest(fakeRequest({ remoteAddress: '::1', headers: { host: '[::1]garbage' } }))).toBe(false)
  })

  it('rejects an absent Host header from loopback', () => {
    expect(isLocalAdminRequest(fakeRequest({ remoteAddress: '127.0.0.1', headers: {} }))).toBe(false)
  })
})

describe('isAdminMutationAllowed', () => {
  function validRequest(overrides = {}) {
    return fakeRequest({
      remoteAddress: '127.0.0.1',
      headers: {
        host: 'localhost:8787',
        'x-family-hub-admin': '1',
        'content-type': 'application/json',
        ...overrides,
      },
    })
  }

  it('accepts a well-formed local admin mutation request', () => {
    expect(isAdminMutationAllowed(validRequest())).toBe(true)
  })

  it('accepts a well-formed request with no Origin header', () => {
    const req = validRequest()
    expect(req.headers.origin).toBeUndefined()
    expect(isAdminMutationAllowed(req)).toBe(true)
  })

  it('accepts a loopback Origin', () => {
    expect(isAdminMutationAllowed(validRequest({ origin: 'http://localhost:8787' }))).toBe(true)
  })

  it('rejects a missing X-Family-Hub-Admin header', () => {
    const req = validRequest()
    delete req.headers['x-family-hub-admin']
    expect(isAdminMutationAllowed(req)).toBe(false)
  })

  it('rejects a text/plain content type', () => {
    expect(isAdminMutationAllowed(validRequest({ 'content-type': 'text/plain' }))).toBe(false)
  })

  it('rejects Origin: http://evil.example', () => {
    expect(isAdminMutationAllowed(validRequest({ origin: 'http://evil.example' }))).toBe(false)
  })

  it('rejects when the underlying isLocalAdminRequest check fails', () => {
    const req = validRequest()
    req.socket.remoteAddress = '192.0.2.20'
    expect(isAdminMutationAllowed(req)).toBe(false)
  })
})
