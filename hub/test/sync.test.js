import { describe, it, expect, afterEach } from 'vitest'
import * as Y from 'yjs'
import WebSocket from 'ws'
import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import { CLOSE } from '../../frontend/src/data/sync/protocol.js'
import { DEFAULT_MAX_PAYLOAD } from '../src/server.js'
import { createFixtures, waitFor, onceSynced, onceClosed, delay } from './helpers.js'

const fx = createFixtures()
afterEach(() => fx.cleanup())

// A y-websocket "sync update" frame carrying `doc`'s full state.
function updateFrame(doc) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc))
  return encoding.toUint8Array(encoder)
}

function docWith(key, value, mapName = 'm') {
  const doc = new Y.Doc()
  doc.getMap(mapName).set(key, value)
  return doc
}

function rawSocket(url) {
  const ws = fx.track(new WebSocket(url))
  const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)))
  ws.on('error', () => {})
  return { ws, closed }
}

describe('hub websocket sync', () => {
  it('two clients on main converge in both directions', async () => {
    const hub = await fx.hub()
    const a = fx.provider(hub)
    const b = fx.provider(hub)
    await Promise.all([onceSynced(a), onceSynced(b)])

    a.doc.getMap('m').set('from', 'a')
    await waitFor(() => b.doc.getMap('m').get('from') === 'a')
    b.doc.getMap('m').set('back', 'b')
    await waitFor(() => a.doc.getMap('m').get('back') === 'b')

    expect(hub.connections()).toBe(2)
  })

  it('a late joiner receives state written before it connected', async () => {
    const hub = await fx.hub()
    const a = fx.provider(hub)
    await onceSynced(a)
    a.doc.getMap('m').set('early', 1)
    const hubMain = await hub._debug.doc('main')
    await waitFor(() => hubMain.getMap('m').get('early') === 1)

    const b = fx.provider(hub)
    await onceSynced(b)
    expect(b.doc.getMap('m').get('early')).toBe(1)
  })

  it('assets is a separate doc from main', async () => {
    const hub = await fx.hub()
    const aMain = fx.provider(hub, { docName: 'main' })
    const aAssets = fx.provider(hub, { docName: 'assets' })
    const bMain = fx.provider(hub, { docName: 'main' })
    const bAssets = fx.provider(hub, { docName: 'assets' })
    await Promise.all([aMain, aAssets, bMain, bAssets].map(onceSynced))

    aAssets.doc.getMap('blobs').set('photo', 'bytes')
    await waitFor(() => bAssets.doc.getMap('blobs').get('photo') === 'bytes')
    await delay(50)
    expect(bMain.doc.getMap('blobs').get('photo')).toBeUndefined()
    expect((await hub._debug.doc('main')).getMap('blobs').get('photo')).toBeUndefined()
  })

  it('a bad token closes with 4401 and neither side sees the other state', async () => {
    const hub = await fx.hub()
    const good = fx.provider(hub)
    await onceSynced(good)
    good.doc.getMap('m').set('hub', 'secret')
    const hubMain = await hub._debug.doc('main')
    await waitFor(() => hubMain.getMap('m').get('hub') === 'secret')

    const intruderDoc = docWith('intruder', 'x')
    const bad = fx.provider(hub, { token: 'A'.repeat(43), doc: intruderDoc })
    const closed = await onceClosed(bad)
    expect(closed.code).toBe(CLOSE.BAD_TOKEN)
    expect(bad.synced).toBe(false)
    expect(bad.shouldConnect).toBe(false) // client stops retrying
    expect(intruderDoc.getMap('m').get('hub')).toBeUndefined()
    expect(hubMain.getMap('m').get('intruder')).toBeUndefined()
  })

  it('a raw socket that sends an update immediately (bad token) leaves the hub doc unchanged', async () => {
    const hub = await fx.hub()
    const hubMain = await hub._debug.doc('main')
    const before = Y.encodeStateVector(hubMain)
    const { ws, closed } = rawSocket(`${fx.wsBase(hub)}/${hub.state.room.id}/main?token=${'B'.repeat(43)}`)
    ws.on('open', () => {
      ws.send(updateFrame(docWith('evil', 1)))
      ws.send(updateFrame(docWith('evil2', 2)))
    })
    expect(await closed).toBe(CLOSE.BAD_TOKEN)
    await delay(50)
    expect(hubMain.getMap('m').get('evil')).toBeUndefined()
    expect(hubMain.getMap('m').get('evil2')).toBeUndefined()
    expect(Y.encodeStateVector(hubMain)).toEqual(before)
  })

  it('a raw socket with a good token that sends an update immediately is applied (lazy doc open does not drop it)', async () => {
    const hub = await fx.hub()
    // assets is not open yet, so this frame lands while the hub is still
    // opening the doc (the window in which frames are queued). The hub's
    // doc is only touched after its first reply, so the test itself never
    // opens it early.
    const { ws } = rawSocket(`${fx.wsBase(hub)}/${hub.state.room.id}/assets?token=${hub.state.room.token}`)
    const firstReply = new Promise((resolve) => ws.once('message', resolve))
    ws.on('open', () => ws.send(updateFrame(docWith('early', 'yes'))))
    await firstReply
    const hubAssets = await hub._debug.doc('assets')
    await waitFor(() => hubAssets.getMap('m').get('early') === 'yes')
  })

  it('a missing token closes with 4401', async () => {
    const hub = await fx.hub()
    const { closed } = rawSocket(`${fx.wsBase(hub)}/${hub.state.room.id}/main`)
    expect(await closed).toBe(CLOSE.BAD_TOKEN)
  })

  it('an unknown room closes with 4404', async () => {
    const hub = await fx.hub()
    const p = fx.provider(hub, { roomId: 'r_' + 'Z'.repeat(22) })
    expect((await onceClosed(p)).code).toBe(CLOSE.UNKNOWN_ROOM)
  })

  it('a retired room closes with 4410', async () => {
    const hub = await fx.hub()
    const oldId = hub.state.room.id
    const oldToken = hub.state.room.token
    const next = hub.state.beginNewRoom()
    await hub.state.commitNewRoom(next.id, next.token)
    const p = fx.provider(hub, { roomId: oldId, token: oldToken })
    expect((await onceClosed(p)).code).toBe(CLOSE.ROOM_RETIRED)
  })

  it('/sync/x/other and other malformed paths close with 4400', async () => {
    const hub = await fx.hub()
    const p = fx.provider(hub, { roomId: 'x', docName: 'other' })
    expect((await onceClosed(p)).code).toBe(CLOSE.BAD_REQUEST)
    const id = hub.state.room.id
    const token = hub.state.room.token
    for (const path of [`/${id}/other`, `/${id}`, '', `/${id}/main/extra`, `/${id}/%6dain`]) {
      const { closed } = rawSocket(`${fx.wsBase(hub)}${path}?token=${token}`)
      expect(await closed, path).toBe(CLOSE.BAD_REQUEST)
    }
  })

  it('a restart on the same dataDir keeps state', async () => {
    const dataDir = await fx.tmpDir('hub-data-')
    const hub1 = await fx.hub({ dataDir })
    const a = fx.provider(hub1)
    const aAssets = fx.provider(hub1, { docName: 'assets' })
    await Promise.all([onceSynced(a), onceSynced(aAssets)])
    a.doc.getMap('m').set('kept', 'yes')
    aAssets.doc.getMap('blobs').set('pic', 'data')
    const m1 = await hub1._debug.doc('main')
    const as1 = await hub1._debug.doc('assets')
    await waitFor(() => m1.getMap('m').get('kept') === 'yes' && as1.getMap('blobs').get('pic') === 'data')
    const { id, token } = hub1.state.room
    a.destroy()
    aAssets.destroy()
    await hub1.close()

    const hub2 = await fx.hub({ dataDir })
    expect(hub2.state.room.id).toBe(id)
    const b = fx.provider(hub2, { roomId: id, token })
    const bAssets = fx.provider(hub2, { roomId: id, token, docName: 'assets' })
    await Promise.all([onceSynced(b), onceSynced(bAssets)])
    expect(b.doc.getMap('m').get('kept')).toBe('yes')
    expect(bAssets.doc.getMap('blobs').get('pic')).toBe('data')
  })

  it('familyExists() reflects the main doc', async () => {
    const hub = await fx.hub()
    expect(hub.familyExists()).toBe(false)
    const a = fx.provider(hub)
    await onceSynced(a)
    a.doc.getMap('meta').set('schema_version', 1)
    await waitFor(() => hub.familyExists())
  })

  it('awareness is relayed between clients and removed when a client leaves', async () => {
    const hub = await fx.hub()
    const a = fx.provider(hub)
    const b = fx.provider(hub)
    await Promise.all([onceSynced(a), onceSynced(b)])
    a.awareness.setLocalStateField('user', 'a')
    await waitFor(() => b.awareness.getStates().get(a.doc.clientID)?.user === 'a')
    a.destroy()
    await waitFor(() => !b.awareness.getStates().has(a.doc.clientID))
    await waitFor(() => hub.connections() === 1)
  })

  it('awareness of a socket that drops without saying goodbye is removed by the hub', async () => {
    const hub = await fx.hub()
    const b = fx.provider(hub)
    await onceSynced(b)
    // A raw client announces presence, then vanishes (no null-state
    // goodbye like provider.destroy() sends) -- only the hub can clean up.
    const ghostDoc = new Y.Doc()
    const ghost = new awarenessProtocol.Awareness(ghostDoc)
    ghost.setLocalStateField('user', 'ghost')
    const { ws } = rawSocket(`${fx.wsBase(hub)}/${hub.state.room.id}/main?token=${hub.state.room.token}`)
    ws.on('open', () => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, 1)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(ghost, [ghostDoc.clientID]))
      ws.send(encoding.toUint8Array(encoder))
    })
    await waitFor(() => b.awareness.getStates().get(ghostDoc.clientID)?.user === 'ghost')
    ws.terminate()
    await waitFor(() => !b.awareness.getStates().has(ghostDoc.clientID))
    ghost.destroy()
  })

  it('awareness is echoed to its sender (keeps a lone client\'s 30 s no-message watchdog from firing)', async () => {
    const hub = await fx.hub()
    const doc = new Y.Doc()
    const aw = new awarenessProtocol.Awareness(doc)
    aw.setLocalStateField('user', 'solo')
    const { ws } = rawSocket(`${fx.wsBase(hub)}/${hub.state.room.id}/main?token=${hub.state.room.token}`)
    const frames = []
    ws.on('message', (data) => frames.push(new Uint8Array(data)))
    ws.on('open', () => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, 1)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(aw, [doc.clientID]))
      ws.send(encoding.toUint8Array(encoder))
    })
    await waitFor(() => frames.some((f) => f[0] === 1))
    aw.destroy()
  })

  it('maxPayload defaults to 512 MiB and reaches the WebSocketServer', async () => {
    expect(DEFAULT_MAX_PAYLOAD).toBe(512 * 1024 * 1024)
    const hub = await fx.hub()
    expect(hub._debug.wss.options.maxPayload).toBe(DEFAULT_MAX_PAYLOAD)
  })

  it('a custom maxPayload is enforced: an oversized frame closes the socket (1009)', async () => {
    const hub = await fx.hub({ maxPayload: 1024 })
    expect(hub._debug.wss.options.maxPayload).toBe(1024)
    const { ws, closed } = rawSocket(`${fx.wsBase(hub)}/${hub.state.room.id}/main?token=${hub.state.room.token}`)
    ws.on('open', () => ws.send(updateFrame(docWith('big', 'x'.repeat(4096)))))
    expect(await closed).toBe(1009)
  })

  it('a rejected socket is read with a 1 KiB frame limit: a large frame after the 4401 close is dropped at once', async () => {
    const warnings = []
    const log = { ...fx.quietLog, warn: (m) => warnings.push(m) }
    const hub = await fx.hub({ log })
    expect(hub._debug.rejectWss.options.maxPayload).toBe(1024)
    const serverSide = new Promise((resolve) => hub._debug.rejectWss.once('connection', (ws) => resolve(ws)))
    const { ws } = rawSocket(`${fx.wsBase(hub)}/${hub.state.room.id}/main?token=${'B'.repeat(43)}`)
    ws.on('open', () => ws.send(new Uint8Array(1 << 20)))
    const server = await serverSide
    const t0 = Date.now()
    await new Promise((resolve) => (server.readyState === server.CLOSED ? resolve() : server.once('close', resolve)))
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(warnings.some((w) => /max payload/i.test(w))).toBe(true)
    expect(hub._debug.wss.clients.size).toBe(0)
  })

  it('a rejected client that never answers the close is terminated within about a second', async () => {
    const hub = await fx.hub()
    const serverSide = new Promise((resolve) => hub._debug.rejectWss.once('connection', (ws) => resolve(ws)))
    const { ws } = rawSocket(`${fx.wsBase(hub)}/r_${'Z'.repeat(22)}/main?token=x`)
    ws.on('open', () => ws.pause()) // never reads (or answers) the hub's close frame
    const server = await serverSide
    const t0 = Date.now()
    await new Promise((resolve) => (server.readyState === server.CLOSED ? resolve() : server.once('close', resolve)))
    expect(Date.now() - t0).toBeLessThan(1500)
  })

  it('close() closes sockets, the server and the stores, and releases the lock', async () => {
    const dataDir = await fx.tmpDir('hub-data-')
    const hub = await fx.hub({ dataDir })
    const { ws, closed } = rawSocket(`${fx.wsBase(hub)}/${hub.state.room.id}/main?token=${hub.state.room.token}`)
    await new Promise((r) => ws.on('open', r))
    await waitFor(() => hub.connections() === 1)
    await hub.close()
    expect(await closed).toBe(1001)
    // The lock is released: a new hub on the same dataDir starts.
    const again = await fx.hub({ dataDir })
    expect(again.state.room.id).toBe(hub.state.room.id)
  })

  it('a second hub on the same dataDir is refused by the lock', async () => {
    const dataDir = await fx.tmpDir('hub-data-')
    await fx.hub({ dataDir })
    await expect(fx.hub({ dataDir })).rejects.toMatchObject({ code: 'HUB_LOCKED' })
  })

  it('devicesConnected() counts main-doc sockets only', async () => {
    const hub = await fx.hub()
    const ps = [fx.provider(hub), fx.provider(hub, { docName: 'assets' }), fx.provider(hub)]
    await Promise.all(ps.map(onceSynced))
    expect(hub.connections()).toBe(3)
    expect(hub.devicesConnected()).toBe(2)
    ps[0].destroy()
    await waitFor(() => hub.devicesConnected() === 1)
  })

  it('no doc store can be opened once close() has started', async () => {
    const hub = await fx.hub()
    const closing = hub.close()
    await expect(hub._debug.doc('assets')).rejects.toThrow(/closing/)
    await closing
    await expect(hub._debug.doc('assets')).rejects.toThrow(/closing/)
  })
})
