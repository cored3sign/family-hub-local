// Shared fixtures for hub integration tests: tmp data dirs, a fixture
// dist dir, in-process hubs on port 0, and y-websocket providers -- all
// tracked so a single cleanup() in afterEach tears every one of them down.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { request as httpRequest } from 'node:http'
import { startHub } from '../src/server.js'

export function createFixtures() {
  const dirs = []
  const hubs = []
  const providers = []
  const sockets = []

  async function tmpDir(prefix = 'hub-test-') {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    dirs.push(dir)
    return dir
  }

  // root/dist/... plus root/secret.txt, a file just outside distDir that
  // traversal tests try (and must fail) to reach.
  async function distFixture() {
    const root = await tmpDir('hub-dist-')
    const dist = join(root, 'dist')
    await mkdir(join(dist, 'assets'), { recursive: true })
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>fixture</title>')
    await writeFile(join(dist, 'sw.js'), 'self.x = 1')
    await writeFile(join(dist, 'version.json'), '{"v":"1"}')
    await writeFile(join(dist, 'manifest.json'), '{"name":"fixture"}')
    await writeFile(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(join(dist, 'assets', 'a.js'), 'export const a = 1')
    await writeFile(join(dist, 'assets', 'a.css'), 'body{}')
    await writeFile(join(root, 'secret.txt'), 'TOP SECRET')
    return dist
  }

  const quietLog = { log() {}, info() {}, warn() {}, error() {} }

  async function hub(opts = {}) {
    const dataDir = opts.dataDir ?? (await tmpDir('hub-data-'))
    const distDir = opts.distDir ?? (await distFixture())
    const h = await startHub({ port: 0, host: '127.0.0.1', log: quietLog, ...opts, dataDir, distDir })
    hubs.push(h)
    return h
  }

  function wsBase(h) {
    return `ws://127.0.0.1:${h.port}/sync`
  }

  function provider(h, { roomId = h.state.room.id, docName = 'main', token = h.state.room.token, doc = new Y.Doc(), ...rest } = {}) {
    const p = new WebsocketProvider(wsBase(h), `${roomId}/${docName}`, doc, {
      params: { token },
      WebSocketPolyfill: globalThis.WebSocket,
      disableBc: true,
      ...rest,
    })
    providers.push(p)
    return p
  }

  function track(socket) {
    sockets.push(socket)
    return socket
  }

  async function cleanup() {
    while (providers.length) providers.pop().destroy()
    while (sockets.length) {
      const s = sockets.pop()
      try {
        s.terminate ? s.terminate() : s.close()
      } catch {}
    }
    while (hubs.length) await hubs.pop().close().catch(() => {})
    while (dirs.length) await rm(dirs.pop(), { recursive: true, force: true })
  }

  return { tmpDir, distFixture, hub, provider, track, wsBase, cleanup, quietLog }
}

export async function waitFor(predicate, { timeout = 3000, interval = 10 } = {}) {
  const start = Date.now()
  for (;;) {
    if (await predicate()) return
    if (Date.now() - start > timeout) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, interval))
  }
}

export function onceSynced(p) {
  if (p.synced) return Promise.resolve()
  return new Promise((resolve) => p.once('sync', (s) => s && resolve()))
}

export function onceClosed(p) {
  return new Promise((resolve) => p.once('closed', (event) => resolve(event)))
}

export const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// Raw HTTP against a hub with full header control (fetch forbids setting
// Host). `host` defaults to the canonical localhost:<port>; pass a
// `host` header to override. Resolves { status, headers, text, json }.
export function httpCall(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, ...headers } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json
          try {
            json = JSON.parse(text)
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json })
        })
      }
    )
    req.on('error', reject)
    if (body === undefined) req.end()
    else req.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
  })
}

export const ADMIN_HEADERS = { 'x-family-hub-admin': '1', 'content-type': 'application/json' }

// An admin mutation as the hub machine's own browser would send it.
export function adminCall(h, method, path, body, headers = {}) {
  return httpCall(h.port, { method, path, headers: { ...ADMIN_HEADERS, ...headers }, body })
}
