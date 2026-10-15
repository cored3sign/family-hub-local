// One y-websocket provider per doc (main, assets) to the family computer:
//   <hubUrl as ws(s)>/sync/<roomId>/<docName>?token=<token>
//
// y-websocket 3.1.0 facts this relies on (read from its source):
// - events: 'status' {status: connecting|connected|disconnected}, 'sync'
//   (bool), 'connection-close' (CloseEvent | null -- null when closed
//   locally), and 'closed' {code, reason} for terminal closes only;
// - by default it already stops reconnecting on close codes 4400-4499 by
//   setting shouldConnect = false; disconnect() does the same;
// - 'connection-close' fires at the START of the close handling, before
//   `synced` drops to false -- so change notifications for a close are
//   deferred a microtask to report the settled state.
//
// On BAD_REQUEST / BAD_TOKEN / UNKNOWN_ROOM / ROOM_RETIRED from either doc, BOTH
// providers are disconnected (the other one must not keep retrying) and
// the problem flag is set -- except a 4401 on the hub machine, which only
// means "the token was rotated": that is left to the caller
// (onTerminalClose; bootSync re-fetches the token and calls reconnect()).
import { WebsocketProvider } from 'y-websocket'
import { nowStamp } from '../time'
import { markRemoteOrigin } from '../recentChanges'
import { CLOSE, roomName, syncBaseUrl } from './protocol.js'
import { setProblem, clearProblem, loadProblem, setLastSyncedAt, getLastSyncedAt } from './config.js'

const TERMINAL = new Map([
  [CLOSE.BAD_REQUEST, 'protocol'],
  [CLOSE.BAD_TOKEN, 'revoked'],
  [CLOSE.UNKNOWN_ROOM, 'room-gone'],
  [CLOSE.ROOM_RETIRED, 'room-gone'],
])

export function isTerminalClose(code) {
  return TERMINAL.has(code)
}

export function connectFamily(
  { doc, assets },
  config,
  { WebSocketPolyfill = globalThis.WebSocket, disableBc = false, storage, now = () => Date.now(), onTerminalClose } = {}
) {
  const opts = { storage }
  const listeners = new Set()
  let token = config.token
  let wsStatus = 'connecting'
  let closeCode = null
  let attemptStartedAt = now()
  let terminal = false
  let destroyed = false
  let lastSyncedAt = getLastSyncedAt(opts)

  const serverUrl = syncBaseUrl(config.hubUrl)
  const make = (docName, ydoc) =>
    new WebsocketProvider(serverUrl, roomName(config.roomId, docName), ydoc, {
      params: { token },
      WebSocketPolyfill,
      disableBc,
      connect: false, // listeners first
    })
  const main = make('main', doc)
  markRemoteOrigin(main)
  const assetsProvider = make('assets', assets)
  const providers = [main, assetsProvider]

  function snapshot() {
    return { mainSynced: main.synced, assetsSynced: assetsProvider.synced, wsStatus, closeCode, attemptStartedAt, lastSyncedAt }
  }

  function emit() {
    if (destroyed) return
    const snap = snapshot()
    for (const fn of Array.from(listeners)) fn(snap)
  }

  function markSynced() {
    lastSyncedAt = nowStamp(new Date(now()))
    setLastSyncedAt(lastSyncedAt, opts)
  }

  main.on('status', ({ status }) => {
    wsStatus = status
    emit()
  })

  let mainWasSynced = false
  main.on('sync', (synced) => {
    if (synced) {
      closeCode = null
      markSynced()
      // A problem recorded for this room is evidently over (e.g. the hub
      // was briefly started on the wrong data folder).
      if (loadProblem(opts)?.roomId === config.roomId) clearProblem(opts)
    } else if (mainWasSynced) {
      attemptStartedAt = now() // a new unsynced period begins
    }
    mainWasSynced = synced
    emit()
  })
  assetsProvider.on('sync', () => emit())

  // lastSyncedAt also moves on each remote main-doc update while connected.
  const onMainUpdate = (_update, origin) => {
    if (origin === main && main.synced) markSynced()
  }
  doc.on('update', onMainUpdate)

  function onConnectionClose(event) {
    if (destroyed || terminal || event == null || typeof event.code !== 'number') return
    closeCode = event.code
    if (TERMINAL.has(event.code)) {
      terminal = true
      for (const p of providers) p.disconnect()
      wsStatus = 'disconnected'
      const hubTokenRotated = config.role === 'hub-machine' && event.code === CLOSE.BAD_TOKEN
      if (!hubTokenRotated) setProblem({ kind: TERMINAL.get(event.code), roomId: config.roomId }, opts)
      if (onTerminalClose) {
        Promise.resolve()
          .then(() => {
            if (!destroyed) return onTerminalClose(event.code)
          })
          .catch(() => {})
      }
    }
    queueMicrotask(emit)
  }
  for (const p of providers) p.on('connection-close', onConnectionClose)

  for (const p of providers) p.connect()

  return {
    providers,
    snapshot,
    get destroyed() {
      return destroyed
    },
    on(type, fn) {
      if (type !== 'change') throw new Error(`Unknown connection event: ${type}`)
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    // A fresh attempt with a new token for the same room (the hub machine
    // after a rotation). Clears a terminal state.
    reconnect(newToken = token) {
      if (destroyed) return
      token = newToken
      terminal = false
      closeCode = null
      attemptStartedAt = now()
      wsStatus = 'connecting'
      for (const p of providers) {
        p.params = { token }
        p.disconnect()
        p.connect()
      }
      emit()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      listeners.clear()
      doc.off('update', onMainUpdate)
      for (const p of providers) p.destroy()
    },
  }
}
