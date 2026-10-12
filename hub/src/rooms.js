// Room docs and the y-websocket wire protocol, server side.
//
// Wire format (matches y-websocket 3.1.0's client, src/y-websocket.js):
// every frame is a binary message whose first varUint is the type --
//   0 sync            y-protocols/sync (step 1, step 2, update)
//   1 awareness       varUint8Array awareness update
//   3 query-awareness reply with every known awareness state
// Type 2 (auth) is never sent by the client; anything unknown is ignored.
//
// Handshake: the upgrade is accepted, then -- synchronously,
// before any 'message' listener exists -- the path is parsed and the token
// checked. A failure closes with the matching 44xx code and the socket's
// frames are never applied; the socket is dropped if the client hasn't
// answered the close within REJECTED_SOCKET_GRACE_MS. (server.js upgrades
// sockets that already fail the check with a 1 KiB frame limit, so a
// rejected client can't make the hub buffer a large frame meanwhile.) Only after the check passes is a message listener
// attached; frames that arrive while the room doc is still opening are
// queued (not dropped: the client sends sync step 1 the instant the socket
// opens, and losing it would mean the client never receives step 2 and
// never reports `synced`), then the hub sends its own step 1 plus the
// current awareness states and drains the queue.
//
// Docs are opened only for the hub's current room, lazily on first use
// (server.js opens `main` eagerly at startup so familyExists() is accurate
// from the first request).

import { join } from 'node:path'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import { CLOSE, DOC_NAMES } from '../../frontend/src/data/sync/protocol.js'
import { openDocStore } from './persistence.js'

export const MESSAGE_SYNC = 0
export const MESSAGE_AWARENESS = 1
export const MESSAGE_QUERY_AWARENESS = 3

// 1007 "invalid frame payload data" -- a transient (non-44xx) code, so a
// client that sent one undecodable frame reconnects rather than being
// told it was revoked.
const CLOSE_INVALID_PAYLOAD = 1007
const CLOSE_INTERNAL_ERROR = 1011
const CLOSE_GOING_AWAY = 1001

// `/sync/<roomId>/<doc>?token=...` -> { roomId, docName, token } or null.
// The doc segment must be exactly one of DOC_NAMES (no decoding), and
// there must be exactly two segments after /sync.
export function parseSyncPath(rawUrl) {
  let url
  try {
    url = new URL(rawUrl, 'http://hub.invalid')
  } catch {
    return null
  }
  const parts = url.pathname.split('/')
  // ['', 'sync', roomId, doc]
  if (parts.length !== 4 || parts[0] !== '' || parts[1] !== 'sync') return null
  const [, , roomId, docName] = parts
  if (!roomId || !DOC_NAMES.includes(docName)) return null
  return { roomId, docName, token: url.searchParams.get('token') ?? '' }
}

const CHECK_TO_CLOSE = {
  'bad-token': [CLOSE.BAD_TOKEN, 'bad token'],
  'unknown-room': [CLOSE.UNKNOWN_ROOM, 'unknown room'],
  retired: [CLOSE.ROOM_RETIRED, 'room retired'],
}

// A rejected socket (bad path or token) is sent its 44xx close and then
// given this long to answer it before the hub drops the connection, so a
// client that never answers can't hold it open for ws's 30 s close timeout.
export const REJECTED_SOCKET_GRACE_MS = 1000

export function createRooms({ state, dataDir, log = console, storeOptions = {} }) {
  // key `${roomId}/${docName}` -> Promise<entry>
  const entries = new Map()
  // every authenticated socket (-> { roomId, docName }), including ones
  // still waiting on a doc open
  const sockets = new Map()
  let closing = false

  function send(ws, bytes) {
    if (ws.readyState !== ws.OPEN) return
    ws.send(bytes, (err) => {
      if (err) {
        log.warn?.(`[hub] send failed, closing socket: ${err.message}`)
        ws.terminate()
      }
    })
  }

  async function openEntry(roomId, docName) {
    const store = await openDocStore(join(dataDir, 'rooms', roomId), docName, storeOptions)
    const { doc } = store
    const awareness = new awarenessProtocol.Awareness(doc)
    awareness.setLocalState(null) // the hub itself has no presence
    const entry = { roomId, docName, store, doc, awareness, conns: new Map() } // ws -> Set<clientId>

    doc.on('update', (update, origin) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      const bytes = encoding.toUint8Array(encoder)
      for (const ws of entry.conns.keys()) if (ws !== origin) send(ws, bytes)
    })

    // Awareness changes are relayed to *every* connection, the sender
    // included. That echo is deliberate: the y-websocket client drops and
    // reconnects any socket that has received nothing for 30 s, and its
    // own 15 s awareness renewal echoed back is what keeps a lone device's
    // socket alive (the reference y-websocket server behaves the same).
    awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed)
      const controlled = entry.conns.get(origin)
      if (controlled) {
        for (const id of added) controlled.add(id)
        for (const id of removed) controlled.delete(id)
      }
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
      const bytes = encoding.toUint8Array(encoder)
      for (const ws of entry.conns.keys()) send(ws, bytes)
    })

    return entry
  }

  function getEntry(roomId, docName) {
    // After close() starts, no store may be (re)opened: it would never be
    // closed, and its log would outlive the hub's lock.
    if (closing) return Promise.reject(new Error('hub is closing'))
    const key = `${roomId}/${docName}`
    let p = entries.get(key)
    if (!p) {
      p = openEntry(roomId, docName)
      entries.set(key, p)
      // A failed open must not be cached forever: the next connection retries.
      p.catch(() => {
        if (entries.get(key) === p) entries.delete(key)
      })
    }
    return p
  }

  // Opens (or returns) a doc of the hub's *current* room.
  async function currentDoc(docName) {
    return (await getEntry(state.room.id, docName)).doc
  }

  // Opens (or returns) a doc of a specific room (backups pin the room id
  // once, so main and assets always come from the same room).
  async function docOf(roomId, docName) {
    return (await getEntry(roomId, docName)).doc
  }

  function handleMessage(ws, entry, data) {
    // Once the hub has started closing this socket (rotation, restore,
    // shutdown) nothing more it sends is applied.
    if (ws.readyState !== ws.OPEN) return
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    try {
      const decoder = decoding.createDecoder(bytes)
      const encoder = encoding.createEncoder()
      const type = decoding.readVarUint(decoder)
      switch (type) {
        case MESSAGE_SYNC:
          encoding.writeVarUint(encoder, MESSAGE_SYNC)
          syncProtocol.readSyncMessage(decoder, encoder, entry.doc, ws)
          if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder))
          break
        case MESSAGE_AWARENESS:
          awarenessProtocol.applyAwarenessUpdate(entry.awareness, decoding.readVarUint8Array(decoder), ws)
          break
        case MESSAGE_QUERY_AWARENESS:
          encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(entry.awareness, Array.from(entry.awareness.getStates().keys()))
          )
          send(ws, encoding.toUint8Array(encoder))
          break
        default:
          break
      }
    } catch (err) {
      log.warn?.(`[hub] undecodable message on ${entry.roomId}/${entry.docName}: ${err.message}`)
      ws.close(CLOSE_INVALID_PAYLOAD, 'invalid message')
    }
  }

  function sendInitial(ws, entry) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(encoder, entry.doc)
    send(ws, encoding.toUint8Array(encoder))
    const states = entry.awareness.getStates()
    if (states.size > 0) {
      const aw = encoding.createEncoder()
      encoding.writeVarUint(aw, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(entry.awareness, Array.from(states.keys())))
      send(ws, encoding.toUint8Array(aw))
    }
  }

  function reject(ws, code, reason) {
    ws.close(code, reason)
    const timer = setTimeout(() => ws.terminate(), REJECTED_SOCKET_GRACE_MS)
    timer.unref?.()
    ws.once('close', () => clearTimeout(timer))
  }

  function handleConnection(ws, req) {
    // An 'error' listener is not a message handler; without one, a socket
    // error would be rethrown as an uncaught exception.
    ws.on('error', (err) => log.warn?.(`[hub] socket error: ${err.message}`))

    if (closing) {
      ws.close(CLOSE_GOING_AWAY, 'hub shutting down')
      return
    }
    const target = parseSyncPath(req.url)
    if (!target) {
      reject(ws, CLOSE.BAD_REQUEST, 'bad request')
      return
    }
    const verdict = state.checkToken(target.roomId, target.token)
    if (verdict !== 'ok') {
      const [code, reason] = CHECK_TO_CLOSE[verdict] ?? CHECK_TO_CLOSE['bad-token']
      reject(ws, code, reason)
      return
    }

    // --- Authenticated: only now is anything the client sends read. ---
    sockets.set(ws, { roomId: target.roomId, docName: target.docName })
    let entry = null
    let queue = []
    ws.on('message', (data) => {
      if (entry) handleMessage(ws, entry, data)
      else if (queue) queue.push(data)
    })
    ws.on('close', () => {
      sockets.delete(ws)
      queue = null
      if (!entry) return
      const controlled = entry.conns.get(ws)
      entry.conns.delete(ws)
      if (controlled && controlled.size > 0) {
        awarenessProtocol.removeAwarenessStates(entry.awareness, Array.from(controlled), null)
      }
    })

    getEntry(target.roomId, target.docName).then(
      (opened) => {
        if (ws.readyState !== ws.OPEN || !queue) return
        // The token may have been rotated / the room retired while the
        // doc was opening -- re-check before reading a single frame.
        const again = state.checkToken(target.roomId, target.token)
        if (again !== 'ok') {
          const [code, reason] = CHECK_TO_CLOSE[again] ?? CHECK_TO_CLOSE['bad-token']
          reject(ws, code, reason)
          return
        }
        entry = opened
        entry.conns.set(ws, new Set())
        sendInitial(ws, entry)
        const pending = queue
        queue = null
        for (const data of pending) {
          if (ws.readyState !== ws.OPEN) break
          handleMessage(ws, entry, data)
        }
      },
      (err) => {
        log.error?.(`[hub] could not open ${target.roomId}/${target.docName}: ${err.message}`)
        ws.close(CLOSE_INTERNAL_ERROR, 'storage error')
      }
    )
  }

  // Closes every authenticated socket with `code` (rotation: 4401 across
  // both docs; shutdown: 1001).
  function closeConnections(code = CLOSE_GOING_AWAY, reason = '') {
    for (const ws of sockets.keys()) ws.close(code, reason)
  }

  async function closeEntry(p) {
    let entry
    try {
      entry = await p
    } catch {
      return null // never opened; nothing to close
    }
    entry.awareness.destroy()
    try {
      await entry.store.close()
      return null
    } catch (err) {
      log.error?.(`[hub] error closing ${entry.roomId}/${entry.docName}: ${err.message}`)
      return err
    }
  }

  // Restore: closes every socket on `roomId` with `code` (4410 for a
  // retired room), then closes and forgets that room's doc stores. The
  // files stay on disk. Sockets still waiting on a doc open are closed
  // too; their pending open sees a non-OPEN socket and attaches nothing.
  // Every store is closed even if one fails; the first error is rethrown.
  async function dropRoom(roomId, code, reason = '') {
    for (const [ws, target] of sockets) if (target.roomId === roomId) ws.close(code, reason)
    let firstError = null
    for (const docName of DOC_NAMES) {
      const key = `${roomId}/${docName}`
      const p = entries.get(key)
      if (!p) continue
      entries.delete(key)
      const err = await closeEntry(p) // always awaited, even after an error
      firstError ??= err
    }
    if (firstError) throw firstError
  }

  // Shutdown: refuse new sockets, close the open ones, then close every
  // doc store (flushing its log). Store close() can reject with an
  // earlier I/O error *after* it has closed; every store is still closed
  // and the first such error is rethrown once all of them are done.
  // First shutdown step: from here on no socket is accepted and no store
  // is opened; every open socket is sent 1001.
  function stopAccepting() {
    closing = true
    closeConnections(CLOSE_GOING_AWAY, 'hub shutting down')
  }

  async function close() {
    stopAccepting()
    const pending = Array.from(entries.values())
    entries.clear()
    let firstError = null
    for (const p of pending) {
      const err = await closeEntry(p) // always awaited, even after an error
      firstError ??= err
    }
    if (firstError) throw firstError
  }

  return {
    handleConnection,
    currentDoc,
    docOf,
    closeConnections,
    dropRoom,
    stopAccepting,
    connections: () => sockets.size,
    // One device = one main-doc socket (each device also holds an assets socket).
    devicesConnected: () => {
      let n = 0
      for (const { docName } of sockets.values()) if (docName === 'main') n++
      return n
    },
    sockets,
    // Test-only: the `${roomId}/${docName}` keys of every open (or opening) store.
    openKeys: () => Array.from(entries.keys()),
    close,
  }
}
