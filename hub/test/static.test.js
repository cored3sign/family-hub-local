import { describe, it, expect, afterEach } from 'vitest'
import { request } from 'node:http'
import { symlink, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect } from 'node:net'
import { createFixtures } from './helpers.js'

const fx = createFixtures()
afterEach(() => fx.cleanup())

// Raw http request: the path is sent byte-for-byte (no URL normalization,
// unlike fetch), which traversal tests need. Host defaults to the
// canonical localhost so only the redirect test exercises 127.0.0.1.
function get(hub, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: hub.port, path, method, headers: { host: `localhost:${hub.port}`, ...headers } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

describe('hub static serving', () => {
  it('/ and /calendar both serve index.html with no-cache', async () => {
    const hub = await fx.hub()
    for (const path of ['/', '/calendar', '/calendar/2026/10', '/index.html']) {
      const res = await get(hub, path)
      expect(res.status, path).toBe(200)
      expect(res.body).toContain('<title>fixture</title>')
      expect(res.headers['content-type']).toMatch(/^text\/html/)
      expect(res.headers['cache-control']).toBe('no-cache')
    }
  })

  it('sw.js, version.json and manifest.json are no-cache with correct types', async () => {
    const hub = await fx.hub()
    const sw = await get(hub, '/sw.js')
    expect(sw.status).toBe(200)
    expect(sw.headers['content-type']).toMatch(/^text\/javascript/)
    expect(sw.headers['cache-control']).toBe('no-cache')
    const version = await get(hub, '/version.json')
    expect(version.headers['content-type']).toMatch(/^application\/json/)
    expect(version.headers['cache-control']).toBe('no-cache')
    const manifest = await get(hub, '/manifest.json')
    expect(manifest.headers['cache-control']).toBe('no-cache')
    const svg = await get(hub, '/favicon.svg')
    expect(svg.headers['content-type']).toMatch(/^image\/svg\+xml/)
  })

  it('/assets/a.js gets an immutable cache header', async () => {
    const hub = await fx.hub()
    const res = await get(hub, '/assets/a.js')
    expect(res.status).toBe(200)
    expect(res.body).toBe('export const a = 1')
    expect(res.headers['content-type']).toMatch(/^text\/javascript/)
    expect(res.headers['cache-control']).toMatch(/immutable/)
    const css = await get(hub, '/assets/a.css')
    expect(css.headers['content-type']).toMatch(/^text\/css/)
  })

  it('HEAD returns headers without a body', async () => {
    const hub = await fx.hub()
    const res = await get(hub, '/assets/a.js', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toBe(String('export const a = 1'.length))
    expect(res.body).toBe('')
  })

  it('missing files with an extension are 404, not the SPA', async () => {
    const hub = await fx.hub()
    expect((await get(hub, '/assets/missing.js')).status).toBe(404)
    expect((await get(hub, '/nope.png')).status).toBe(404)
  })

  it('traversal attempts return 404', async () => {
    const hub = await fx.hub()
    for (const path of [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/assets/%2e%2e/%2e%2e/secret.txt',
      '/..%5csecret.txt',
      '/%2e%2e%5csecret.txt',
      '/assets/%00a.js',
      '/%E0%A4%A',
    ]) {
      const res = await get(hub, path)
      expect(res.status, path).toBe(404)
      expect(res.body).not.toContain('TOP SECRET')
    }
  })

  it('/api/health answers with its health payload (open, no redirect on 127.0.0.1)', async () => {
    const hub = await fx.hub()
    const res = await get(hub, '/api/health', { headers: { host: `127.0.0.1:${hub.port}` } })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, app: 'family-hub', protocol: 1 })
  })

  it('/api/nope returns 404 JSON and never the SPA', async () => {
    const hub = await fx.hub()
    for (const path of ['/api/nope', '/api', '/api/hub/whatever?x=1']) {
      const res = await get(hub, path)
      expect(res.status, path).toBe(404)
      expect(res.headers['content-type']).toMatch(/^application\/json/)
      expect(JSON.parse(res.body)).toEqual({ error: 'not-found' })
    }
  })

  it('a non-upgrade /sync request returns 426', async () => {
    const hub = await fx.hub()
    for (const path of ['/sync', `/sync/${hub.state.room.id}/main`]) {
      const res = await get(hub, path)
      expect(res.status, path).toBe(426)
    }
  })

  it('Host: 127.0.0.1 gets a 308 redirect to localhost', async () => {
    const hub = await fx.hub()
    const res = await get(hub, '/calendar?x=1', { headers: { host: `127.0.0.1:${hub.port}` } })
    expect(res.status).toBe(308)
    expect(res.headers.location).toBe(`http://localhost:${hub.port}/calendar?x=1`)
    // The API is not a navigation and is never redirected.
    expect((await get(hub, '/api/nope', { headers: { host: `127.0.0.1:${hub.port}` } })).status).toBe(404)
  })

  it('a proxied request with Host 127.0.0.1 is not redirected', async () => {
    const hub = await fx.hub()
    for (const h of ['x-forwarded-for', 'forwarded', 'x-forwarded-host', 'x-real-ip', 'tailscale-user-login']) {
      const res = await get(hub, '/calendar', { headers: { host: `127.0.0.1:${hub.port}`, [h]: 'x' } })
      expect(res.status, h).toBe(200)
    }
  })

  it('HTML responses forbid framing; other files are unchanged', async () => {
    const hub = await fx.hub()
    for (const path of ['/', '/calendar', '/index.html']) {
      const res = await get(hub, path)
      expect(res.headers['content-security-policy'], path).toBe("frame-ancestors 'none'")
      expect(res.headers['x-frame-options'], path).toBe('DENY')
    }
    const js = await get(hub, '/assets/a.js')
    expect(js.headers['x-frame-options']).toBeUndefined()
  })

  it('a symlink inside dist pointing outside it is 404', async (ctx) => {
    const distDir = await fx.distFixture()
    const outside = await fx.tmpDir('hub-outside-')
    await writeFile(join(outside, 'leak.txt'), 'OUTSIDE SECRET')
    try {
      await symlink(join(outside, 'leak.txt'), join(distDir, 'leak.txt'))
      await symlink(outside, join(distDir, 'linkdir'), 'dir')
    } catch (err) {
      if (process.platform === 'win32') return ctx.skip()
      throw err
    }
    const hub = await fx.hub({ distDir })
    for (const path of ['/leak.txt', '/linkdir/leak.txt']) {
      const res = await get(hub, path)
      expect(res.status, path).toBe(404)
      expect(res.body).not.toContain('OUTSIDE SECRET')
    }
    // A regular file is still served.
    expect((await get(hub, '/sw.js')).status).toBe(200)
  })

  it('peers that reset mid-upgrade on a non-/sync path cannot crash the hub', async () => {
    const hub = await fx.hub()
    const upgrade =
      'GET /other HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n' +
      'x'.repeat(100_000)
    const uncaught = []
    const onUncaught = (err) => uncaught.push(err)
    process.on('uncaughtException', onUncaught)
    try {
      const attempts = Array.from({ length: 300 }, () => new Promise((resolve) => {
        const s = connect(hub.port, '127.0.0.1', () => {
          s.write(upgrade)
          setImmediate(() => s.resetAndDestroy())
        })
        s.on('error', () => {})
        s.on('close', resolve)
      }))
      await Promise.all(attempts)
      await new Promise((r) => setTimeout(r, 200))
    } finally {
      process.off('uncaughtException', onUncaught)
    }
    expect(uncaught.map((e) => e.code)).toEqual([])
    expect((await get(hub, '/')).status).toBe(200)
  })

  it('non-GET methods on static paths get 405', async () => {
    const hub = await fx.hub()
    expect((await get(hub, '/', { method: 'POST' })).status).toBe(405)
  })

  it('a missing dist dir answers 503 with a build hint instead of crashing', async () => {
    const missing = (await fx.tmpDir()) + '/no-dist'
    const hub = await fx.hub({ distDir: missing })
    const res = await get(hub, '/')
    expect(res.status).toBe(503)
    expect(res.body).toMatch(/npm run build/)
  })
})
