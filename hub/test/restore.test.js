// POST /api/hub/restore: restore-to-new-room against a real hub.
import { describe, it, expect, afterEach } from 'vitest'
import * as nodeFs from 'node:fs/promises'
import { readFile, readdir, stat } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import * as Y from 'yjs'
import { CLOSE } from '../../frontend/src/data/sync/protocol.js'
import { createBackup, hasFamily } from '../../frontend/src/data/backupFormat.js'
import { createFixtures, waitFor, onceSynced, onceClosed, delay, httpCall, adminCall, ADMIN_HEADERS } from './helpers.js'

const fx = createFixtures()
const LAN = { en0: [{ address: '192.0.2.20', family: 'IPv4', internal: false }] }
afterEach(() => fx.cleanup())

function backupText(marker = 'from-backup') {
  const doc = new Y.Doc()
  doc.getMap('meta').set('schema_version', 1)
  doc.getMap('m').set('marker', marker)
  const assets = new Y.Doc()
  assets.getMap('blobs').set('photo', 'photo-bytes')
  return createBackup({ doc, assets })
}

// A hub whose current room already holds a family pushed by device A
// (main + assets), with A still connected.
async function hubWithFamily(opts = {}) {
  const dataDir = opts.dataDir ?? (await fx.tmpDir('hub-data-'))
  const hub = await fx.hub({ networkInterfaces: () => LAN, ...opts, dataDir })
  const aMain = fx.provider(hub, { docName: 'main' })
  const aAssets = fx.provider(hub, { docName: 'assets' })
  await Promise.all([aMain, aAssets].map(onceSynced))
  aMain.doc.getMap('meta').set('schema_version', 1)
  aMain.doc.getMap('m').set('marker', 'old-room')
  aAssets.doc.getMap('blobs').set('old', 'old-bytes')
  const hubAssets = await hub._debug.doc('assets')
  await waitFor(() => hub.familyExists() && hubAssets.getMap('blobs').get('old') === 'old-bytes')
  return { hub, dataDir, aMain, aAssets }
}

function restore(hub, body, headers = {}) {
  return adminCall(hub, 'POST', '/api/hub/restore', body, headers)
}

describe('restore to a new room', () => {
  it('writes the backup into a new room, retires the old one (4410) and survives a restart', async () => {
    const { hub, dataDir, aMain, aAssets } = await hubWithFamily()
    const old = { id: hub.state.room.id, token: hub.state.room.token }
    const closedMain = onceClosed(aMain)
    const closedAssets = onceClosed(aAssets)

    const res = await restore(hub, backupText())
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ roomId: hub.state.room.id, token: hub.state.room.token })
    expect(res.json.roomId).not.toBe(old.id)
    expect(res.json.token).not.toBe(old.token)

    // The old room's devices are told it is gone.
    expect((await closedMain).code).toBe(CLOSE.ROOM_RETIRED)
    expect((await closedAssets).code).toBe(CLOSE.ROOM_RETIRED)
    // Reconnecting with the old id and token: 4410, not 4401/4404.
    const stale = fx.provider(hub, { roomId: old.id, token: old.token })
    expect((await onceClosed(stale)).code).toBe(CLOSE.ROOM_RETIRED)

    // The hub now serves the new room (familyExists, info, sync).
    expect(hub.familyExists()).toBe(true)
    const info = (await httpCall(hub.port, { path: '/api/hub/info' })).json
    expect(info.roomId).toBe(res.json.roomId)
    expect(info.token).toBe(res.json.token)
    expect(info.familyExists).toBe(true)
    const hubMain = await hub._debug.doc('main')
    expect(hubMain.getMap('m').get('marker')).toBe('from-backup')

    const bMain = fx.provider(hub, { roomId: res.json.roomId, token: res.json.token, docName: 'main' })
    const bAssets = fx.provider(hub, { roomId: res.json.roomId, token: res.json.token, docName: 'assets' })
    await Promise.all([bMain, bAssets].map(onceSynced))
    expect(bMain.doc.getMap('m').get('marker')).toBe('from-backup')
    expect(bAssets.doc.getMap('blobs').get('photo')).toBe('photo-bytes')
    expect(bAssets.doc.getMap('blobs').get('old')).toBeUndefined()
    expect(hub.devicesConnected()).toBe(1)

    // The old room stays on disk as a safety copy, and hub.json points at the new one.
    expect((await stat(join(dataDir, 'rooms', old.id))).isDirectory()).toBe(true)
    const persisted = JSON.parse(await readFile(join(dataDir, 'hub.json'), 'utf8'))
    expect(persisted.room.id).toBe(res.json.roomId)
    expect(persisted.room.token).toBe(res.json.token)
    expect(persisted.retired).toEqual([{ id: old.id, retiredAt: expect.any(Number), reason: 'restore' }])

    // Restart on the same data dir.
    for (const p of [bMain, bAssets]) p.destroy()
    await hub.close()
    const again = await fx.hub({ dataDir })
    expect(again.state.room.id).toBe(res.json.roomId)
    expect(again.familyExists()).toBe(true)
    expect((await again._debug.doc('main')).getMap('m').get('marker')).toBe('from-backup')
    expect((await again._debug.doc('assets')).getMap('blobs').get('photo')).toBe('photo-bytes')
    const staleAfterRestart = fx.provider(again, { roomId: old.id, token: old.token })
    expect((await onceClosed(staleAfterRestart)).code).toBe(CLOSE.ROOM_RETIRED)
  })

  it('a bad backup returns 400 and leaves the room, its clients and the disk unchanged', async () => {
    const { hub, dataDir, aMain } = await hubWithFamily()
    const before = { id: hub.state.room.id, token: hub.state.room.token }
    const hubJsonBefore = await readFile(join(dataDir, 'hub.json'), 'utf8')
    const roomsBefore = await readdir(join(dataDir, 'rooms'))

    const emptyFamily = createBackup({ doc: new Y.Doc(), assets: new Y.Doc() })
    for (const body of ['{"format":"family-hub-backup","version":1}', '{"hello":1}', '{nope', emptyFamily, '']) {
      const res = await restore(hub, body)
      expect(res.status, body.slice(0, 40)).toBe(400)
      expect(typeof res.json.error).toBe('string')
    }

    expect(hub.state.room.id).toBe(before.id)
    expect(hub.state.room.token).toBe(before.token)
    expect(await readFile(join(dataDir, 'hub.json'), 'utf8')).toBe(hubJsonBefore)
    expect(await readdir(join(dataDir, 'rooms'))).toEqual(roomsBefore)
    await delay(50)
    expect(aMain.wsconnected).toBe(true)
    aMain.doc.getMap('m').set('still', 'here')
    const hubMain = await hub._debug.doc('main')
    await waitFor(() => hubMain.getMap('m').get('still') === 'here')
  })

  it('a storage failure while writing the new room is a 500 that leaves the old room current', async () => {
    // main of the new room is written fine; the assets log write fails,
    // so a half-written room directory exists until the restore cleans up.
    let failNewRoom = false
    let currentRoomId = null
    const fs = {
      ...nodeFs,
      open: (path, ...rest) =>
        failNewRoom && !String(path).includes(currentRoomId) && String(path).includes('assets')
          ? Promise.reject(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
          : nodeFs.open(path, ...rest),
    }
    const { hub, dataDir, aMain } = await hubWithFamily({ storeOptions: { fs } })
    currentRoomId = hub.state.room.id
    const before = hub.state.room.token
    failNewRoom = true
    const res = await restore(hub, backupText())
    failNewRoom = false
    expect(res.status).toBe(500)
    expect(res.json).toEqual({ error: 'restore-failed' })
    expect(hub.state.room.id).toBe(currentRoomId)
    expect(hub.state.room.token).toBe(before)
    expect(hub.state.retired).toEqual([])
    expect(await readdir(join(dataDir, 'rooms'))).toEqual([currentRoomId])
    expect(aMain.wsconnected).toBe(true)
  })

  it('a body over the restore cap is 413, by Content-Length or while streaming', async () => {
    const { hub } = await hubWithFamily({ limits: { restoreBytes: 4096 } })
    const roomBefore = hub.state.room.id
    const big = backupText('x'.repeat(10_000))
    const byLength = await restore(hub, big)
    expect(byLength.status).toBe(413)
    expect(byLength.json).toEqual({ error: 'too-large' })

    // Chunked (no Content-Length): the cap is enforced on the stream.
    const streamed = await new Promise((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: hub.port, method: 'POST', path: '/api/hub/restore', headers: { host: `localhost:${hub.port}`, ...ADMIN_HEADERS, 'transfer-encoding': 'chunked' } },
        (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }))
        }
      )
      req.on('error', (err) => (err.code === 'ECONNRESET' || err.code === 'EPIPE' ? null : reject(err)))
      req.write(big.slice(0, 3000))
      setTimeout(() => req.write(big.slice(3000, 6000)), 20)
    })
    expect(streamed.status).toBe(413)

    // A declared oversize Content-Length is refused before the body is sent.
    const declared = await new Promise((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: hub.port, method: 'POST', path: '/api/hub/restore', headers: { host: `localhost:${hub.port}`, ...ADMIN_HEADERS, 'content-length': '100000' } },
        (res) => {
          res.resume()
          resolve(res.statusCode)
        }
      )
      req.on('error', (err) => (err.code === 'ECONNRESET' || err.code === 'EPIPE' ? null : reject(err)))
      req.write('{')
    })
    expect(declared).toBe(413)
    expect(hub.state.room.id).toBe(roomBefore)
    // The hub is still fine afterwards.
    expect((await restore(hub, backupText())).status).toBe(200)
  })

  it('restoring when no family exists yet also works (setup via restore)', async () => {
    const hub = await fx.hub()
    expect(hub.familyExists()).toBe(false)
    const res = await restore(hub, backupText())
    expect(res.status).toBe(200)
    expect(hub.familyExists()).toBe(true)
    expect(hasFamily(await hub._debug.doc('main'))).toBe(true)
  })
})
