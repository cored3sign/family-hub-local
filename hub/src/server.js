// The hub process: one HTTP port on this computer serving the built
// frontend, the /api routes, and authenticated Yjs websocket sync on
// /sync/<roomId>/<doc>. The hub listens on localhost only: phones sync
// through the family relay, not through the family computer.
//
// Routing order for plain HTTP requests:
//   /api, /api/*   /api/health here, the admin routes in api.js; anything
//                  else -> 404 JSON, never the SPA
//   /sync, /sync/* 426 Upgrade Required (only websocket upgrades belong here)
//   Host 127.0.0.1 308 to localhost (one canonical desktop origin, so
//                  the desktop's IndexedDB/localStorage never splits)
//   everything else static files from distDir with SPA fallback

import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { hasFamily } from '../../frontend/src/data/backupFormat.js'
import { CLOSE } from '../../frontend/src/data/sync/protocol.js'
import { createApi, sendJson } from './api.js'
import { createResetToken } from './adminPin.js'
import { createBackups, BACKUP_INTERVAL_MS } from './backups.js'
import { loadHubState } from './hubState.js'
import { createRooms, parseSyncPath } from './rooms.js'
import { createStaticHandler } from './static.js'
import { listen } from './network.js'
import { PROXY_HEADERS } from './admin.js'

export const DEFAULT_PORT = 8787
export const DEFAULT_HOST = '127.0.0.1'
// ws's default maxPayload is 100 MiB; a photo-heavy first push of the
// assets doc can exceed that and loop forever reconnecting.
export const DEFAULT_MAX_PAYLOAD = 512 << 20
// Upgrades that already fail the path/token check are handled by a second
// server with this frame limit: such a socket only ever gets its 44xx
// close, so anything large it sends is dropped at once instead of being
// buffered (up to DEFAULT_MAX_PAYLOAD) until the close completes.
export const REJECTED_MAX_PAYLOAD = 1024
export const DEFAULT_DIST_DIR = fileURLToPath(new URL('../../frontend/dist', import.meta.url))

const HEARTBEAT_MS = 30_000
const SOCKET_CLOSE_GRACE_MS = 1000

function pathOf(rawUrl) {
  const q = rawUrl.indexOf('?')
  return q === -1 ? rawUrl : rawUrl.slice(0, q)
}

function underPrefix(path, prefix) {
  return path === prefix || path.startsWith(prefix + '/')
}

// `127.0.0.1` or `127.0.0.1:<port>` -> the port part (possibly ''), else null.
function loopbackIpHostPort(hostHeader) {
  const m = /^127\.0\.0\.1(:\d+)?$/.exec(String(hostHeader || ''))
  return m ? (m[1] ?? '') : null
}

function waitForSocketsClosed(sockets, graceMs) {
  const open = Array.from(sockets).filter((ws) => ws.readyState !== ws.CLOSED)
  if (open.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    let remaining = open.length
    const done = () => {
      if (--remaining === 0) {
        clearTimeout(timer)
        resolve()
      }
    }
    for (const ws of open) ws.once('close', done)
    const timer = setTimeout(() => {
      for (const ws of open) if (ws.readyState !== ws.CLOSED) ws.terminate()
    }, graceMs)
  })
}

export async function startHub({
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
  dataDir,
  distDir = DEFAULT_DIST_DIR,
  log = console,
  maxPayload = DEFAULT_MAX_PAYLOAD,
  // Clock for claims and backup dates (injectable for tests).
  now = () => Date.now(),
  backupIntervalMs = BACKUP_INTERVAL_MS,
  // Test-only: passed to every openDocStore() (e.g. an injected fs).
  storeOptions = {},
  // Test-only: { jsonBytes, restoreBytes } body caps.
  limits,
} = {}) {
  if (!dataDir) throw new Error('startHub: dataDir is required')

  const state = await loadHubState(dataDir)
  await state.acquireLock()
  // Rotated on every start; the terminal PIN reset needs it (see adminPin.js).
  const resetToken = await createResetToken(dataDir)

  let rooms = null
  let server = null
  let wss = null
  let rejectWss = null
  let heartbeat = null
  let backups = null
  let api = null

  try {
    rooms = createRooms({ state, dataDir, log, storeOptions })
    // main is opened eagerly so familyExists() is right from the first
    // request (a lazily-unopened main would read as "no family" and could
    // let a second desktop claim and seed over a real one). assets, which
    // can be large, still opens on first use.
    let mainDoc = await rooms.currentDoc('main')
    const familyExists = () => hasFamily(mainDoc)

    // Restore, after hub.json names the new room: the old room's
    // sockets get 4410 and its stores are closed and forgotten (its files
    // stay on disk as a safety copy), then the new room's main doc is
    // opened eagerly, as at startup, so familyExists() follows it.
    async function onRoomCommitted(oldRoomId) {
      let dropError = null
      try {
        await rooms.dropRoom(oldRoomId, CLOSE.ROOM_RETIRED, 'room retired')
      } catch (err) {
        dropError = err
      }
      mainDoc = await rooms.currentDoc('main')
      if (dropError) throw dropError
    }

    let boundPort = null
    api = createApi({
      state,
      rooms,
      dataDir,
      resetToken,
      getPort: () => boundPort,
      familyExists,
      onRoomCommitted,
      limits,
      storeOptions,
      now,
      log,
    })

    // Backs up the current room only if it holds a family. The room id is
    // read once so main and assets always come from the same room; a
    // restore mid-way just means the next run picks up the new room.
    backups = createBackups({
      dataDir,
      now,
      intervalMs: backupIntervalMs,
      log,
      getDocs: async () => {
        const roomId = state.room.id
        const doc = await rooms.docOf(roomId, 'main')
        // A restore may have retired the room meanwhile: never (re)open a
        // retired room's assets store, which nothing would close again.
        if (state.room.id !== roomId || !hasFamily(doc)) return null
        const assets = await rooms.docOf(roomId, 'assets')
        return state.room.id === roomId ? { doc, assets } : null
      },
    })

    const handleStatic = createStaticHandler({ distDir })

    const handleRequest = (req, res) => {
      const path = pathOf(req.url)
      if (path === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
        sendJson(res, 200, { ok: true, app: 'family-hub', protocol: 1 })
        return
      }
      if (underPrefix(path, '/api')) {
        if (api.handle(req, res, path)) return
        sendJson(res, 404, { error: 'not-found' })
        return
      }
      if (underPrefix(path, '/sync')) {
        const text = 'This address only accepts websocket connections.'
        res.writeHead(426, {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': Buffer.byteLength(text),
        })
        res.end(text)
        return
      }
      // A proxied request (a reverse proxy, a dev proxy) may carry the
      // proxy's own Host 127.0.0.1; redirecting it to localhost would
      // send the remote browser to *its* localhost.
      const portPart = PROXY_HEADERS.some((h) => h in req.headers) ? null : loopbackIpHostPort(req.headers.host)
      if (portPart !== null && req.url.startsWith('/') && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(308, { Location: `http://localhost${portPart}${req.url}`, 'Content-Length': 0 })
        res.end()
        return
      }
      handleStatic(req, res).catch((err) => {
        log.error?.(`[hub] static error: ${err.message}`)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.destroy()
      })
    }
    server = createServer(handleRequest)

    wss = new WebSocketServer({ noServer: true, maxPayload })
    wss.on('connection', (ws, req) => {
      ws.isAlive = true
      ws.on('pong', () => {
        ws.isAlive = true
      })
      rooms.handleConnection(ws, req)
    })
    rejectWss = new WebSocketServer({ noServer: true, maxPayload: REJECTED_MAX_PAYLOAD })
    rejectWss.on('connection', (ws, req) => rooms.handleConnection(ws, req))

    server.on('upgrade', (req, socket, head) => {
      // Node removes its own socket error listener before emitting
      // 'upgrade', so without this a peer that resets mid-handshake
      // (EPIPE / ECONNRESET on our 404 write, or inside ws's handshake)
      // is an uncaught exception that kills the hub. ws's README pattern.
      socket.on('error', () => socket.destroy())
      if (!underPrefix(pathOf(req.url), '/sync')) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        return
      }
      // Pre-check only to pick the frame limit; rooms.handleConnection
      // still decides (and re-checks) on every socket.
      const target = parseSyncPath(req.url)
      const accepted = target !== null && state.checkToken(target.roomId, target.token) === 'ok'
      const server_ = accepted ? wss : rejectWss
      server_.handleUpgrade(req, socket, head, (ws) => server_.emit('connection', ws, req))
    })

    // Detects half-open sockets (a phone that left wifi) so they don't
    // linger in connections() and the awareness map forever.
    heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (!ws.isAlive) {
          ws.terminate()
          continue
        }
        ws.isAlive = false
        ws.ping()
      }
    }, HEARTBEAT_MS)
    heartbeat.unref()

    await listen(server, { port, host })

    boundPort = server.address().port
    await state.recordLockPort(boundPort)
    backups.start()
    let closing = null

    async function close() {
      clearInterval(heartbeat)
      const serverClosed = new Promise((resolve) => server.close(() => resolve()))
      // Close sockets first and let them finish (or terminate after a
      // grace period), so no frame is still being applied when the stores
      // flush and close. stopAccepting() runs synchronously, before any
      // await, so nothing can open a store once close() was called.
      rooms.stopAccepting()
      // No backup may start, or still be running, once stores close. A
      // backup that hadn't fetched its docs yet fails with "hub is
      // closing" (logged) rather than reopening a store.
      await backups.stop()
      for (const ws of wss.clients) if (!rooms.sockets.has(ws)) ws.close(1001, 'hub shutting down')
      await waitForSocketsClosed(wss.clients, SOCKET_CLOSE_GRACE_MS)
      for (const ws of rejectWss.clients) ws.terminate()
      wss.close()
      rejectWss.close()
      server.closeAllConnections()
      // A restore already under way finishes (or fails) before the stores
      // and the lock go away.
      await api.idle()
      let storeError = null
      try {
        await rooms.close()
      } catch (err) {
        storeError = err
      }
      await serverClosed
      await state.releaseLock()
      if (storeError) throw storeError
    }

    return {
      port: boundPort,
      url: `http://localhost:${boundPort}`,
      state,
      familyExists,
      connections: () => rooms.connections(),
      devicesConnected: () => rooms.devicesConnected(),
      close: () => (closing ??= close()),
      // Test-only hooks; not part of the hub's interface.
      _debug: { wss, rejectWss, doc: (docName) => rooms.currentDoc(docName), backups, openStores: () => rooms.openKeys() },
    }
  } catch (err) {
    clearInterval(heartbeat)
    await backups?.stop().catch(() => {})
    wss?.close()
    rejectWss?.close()
    if (server?.listening) await new Promise((resolve) => server.close(() => resolve()))
    await rooms?.close().catch(() => {})
    await state.releaseLock().catch(() => {})
    throw err
  }
}
