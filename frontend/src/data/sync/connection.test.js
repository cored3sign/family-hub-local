// Integration: real in-process hubs, real WebsocketProviders (Node's global
// WebSocket, disableBc: true so nothing syncs around the hub), one
// openFamily() per simulated device.
import 'fake-indexeddb/auto'
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { startHub } from '../../../../hub/src/server.js'
import { openFamily } from '../family'
import { setUpFamily, isSetUp } from '../schema'
import { listMembers } from '../members'
import { putAsset, getAsset } from '../assets'
import { insert, get } from '../collection'
import { createBackup } from '../backupFormat.js'
import { memoryStorage } from '../testing'
import { CLOSE } from './protocol.js'
import { loadProblem, getLastSyncedAt, loadHubConfig } from './config.js'
import { connectFamily } from './connection.js'
import { applyPairing } from './pairing.js'
import { wipeLocalFamily } from './wipe.js'
import { createHubApi } from './hubApi.js'
import { bootSync } from './boot.js'

const quietLog = { log() {}, info() {}, warn() {}, error() {} }

// Stands in for the rotate-token route (removed): the hub gets a new token,
// and every open socket is closed with 4401, as a rotation used to do.
async function rotateHubToken(h) {
  h.state.room.token = randomBytes(32).toString('base64url')
  for (const ws of [...h._debug.wss.clients, ...h._debug.rejectWss.clients]) ws.close(CLOSE.BAD_TOKEN, 'token rotated')
  return { roomId: h.state.room.id, token: h.state.room.token }
}
const cleanups = []
const later = (fn) => cleanups.push(fn)

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()()
})

async function tmpDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  later(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function hub() {
  const distDir = join(await tmpDir('fh-dist-'), 'dist')
  await mkdir(distDir, { recursive: true })
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>fixture</title>')
  const h = await startHub({ port: 0, host: '127.0.0.1', dataDir: await tmpDir('fh-hub-'), distDir, log: quietLog })
  later(() => h.close())
  // fetch from Node sends Host 127.0.0.1:<port>, which the admin guard accepts.
  const origin = `http://127.0.0.1:${h.port}`
  return { h, origin, api: createHubApi({ baseUrl: origin }) }
}

async function device(opts = { persist: false }) {
  const fam = await openFamily(opts)
  later(() => fam.destroy())
  return fam
}

const configFor = ({ h, origin }, role = 'device') => ({
  v: 1,
  hubUrl: origin,
  roomId: h.state.room.id,
  token: h.state.room.token,
  role,
  pairedAt: '2026-10-07 10:00:00',
})

function connect(fam, config, opts = {}) {
  const c = connectFamily(fam, config, { WebSocketPolyfill: globalThis.WebSocket, disableBc: true, storage: memoryStorage(), ...opts })
  later(() => c.destroy())
  return c
}

// Resolves when predicate(connection.snapshot()) is true; event-driven.
function until(connection, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (predicate(connection.snapshot())) return resolve(connection.snapshot())
    const timer = setTimeout(() => {
      off()
      reject(new Error(`timed out; last snapshot ${JSON.stringify(connection.snapshot())}`))
    }, timeout)
    const off = connection.on('change', (snap) => {
      if (predicate(snap)) {
        clearTimeout(timer)
        off()
        resolve(snap)
      }
    })
  })
}

// Resolves when predicate() is true after a doc update (or right away).
function untilDoc(doc, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (predicate()) return resolve()
    const timer = setTimeout(() => {
      doc.off('update', check)
      reject(new Error('timed out waiting for doc'))
    }, timeout)
    function check() {
      if (predicate()) {
        clearTimeout(timer)
        doc.off('update', check)
        resolve()
      }
    }
    doc.on('update', check)
  })
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function seededHub() {
  const hubCtx = await hub()
  const A = await device()
  setUpFamily(A.doc, { familyName: 'Test Family', adminName: 'Pat Parent', modules: ['todos'] })
  const a = connect(A, configFor(hubCtx, 'hub-machine'))
  await until(a, (s) => s.mainSynced)
  const hubMain = await hubCtx.h._debug.doc('main')
  await untilDoc(hubMain, () => isSetUp(hubMain))
  return { ...hubCtx, A, a, hubMain }
}

describe('connectFamily against a real hub', () => {
  it('uses <hubUrl ws>/sync/<roomId>/<doc>?token=', async () => {
    const ctx = await hub()
    const c = connect(await device(), configFor(ctx))
    const urls = c.providers.map((p) => p.url)
    expect(urls).toEqual([
      `ws://127.0.0.1:${ctx.h.port}/sync/${ctx.h.state.room.id}/main?token=${ctx.h.state.room.token}`,
      `ws://127.0.0.1:${ctx.h.port}/sync/${ctx.h.state.room.id}/assets?token=${ctx.h.state.room.token}`,
    ])
  })

  it('fresh device pulls the family; the hub still has exactly one admin', async () => {
    const ctx = await seededHub()
    const B = await device()
    const storage = memoryStorage()
    const b = connect(B, configFor(ctx), { storage })
    const snap = await until(b, (s) => s.mainSynced)
    expect(snap.wsStatus).toBe('connected')
    expect(snap.closeCode).toBeNull()
    expect(isSetUp(B.doc)).toBe(true)
    expect(listMembers(ctx.hubMain).filter((m) => m.role === 'admin')).toHaveLength(1)
    expect(getLastSyncedAt({ storage })).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
  })

  it('fresh device never seeds: an empty room stays empty', async () => {
    const ctx = await hub()
    const B = await device()
    const b = connect(B, configFor(ctx))
    await until(b, (s) => s.mainSynced && s.assetsSynced)
    const hubMain = await ctx.h._debug.doc('main')
    expect(hubMain.getMap('meta').size).toBe(0)
    expect(B.doc.getMap('meta').size).toBe(0)
    expect(ctx.h.familyExists()).toBe(false)
  })

  it('revoked: rotation -> closeCode 4401, problem flag, and no reconnect attempts', async () => {
    const ctx = await seededHub()
    const B = await device()
    let sockets = 0
    class CountingWebSocket extends globalThis.WebSocket {
      constructor(...args) {
        super(...args)
        sockets++
      }
    }
    const storage = memoryStorage()
    const b = connect(B, configFor(ctx), { storage, WebSocketPolyfill: CountingWebSocket })
    await until(b, (s) => s.mainSynced && s.assetsSynced)
    expect(sockets).toBe(2)

    await rotateHubToken(ctx.h)
    const snap = await until(b, (s) => s.closeCode === CLOSE.BAD_TOKEN)
    expect(snap.mainSynced).toBe(false)
    expect(loadProblem({ storage })).toMatchObject({ kind: 'revoked', roomId: ctx.h.state.room.id })
    expect(b.providers.every((p) => p.shouldConnect === false)).toBe(true)

    // y-websocket's backoff tops out at 2.5 s; give it longer than that.
    await delay(3000)
    expect(sockets).toBe(2)
    expect(b.snapshot().closeCode).toBe(CLOSE.BAD_TOKEN)
  }, 10_000)

  it('a terminal close on ONE doc disconnects the other doc too', async () => {
    const ctx = await seededHub()
    const B = await device()
    let sockets = 0
    class CountingWebSocket extends globalThis.WebSocket {
      constructor(...args) {
        super(...args)
        sockets++
      }
    }
    const storage = memoryStorage()
    const b = connect(B, configFor(ctx), { storage, WebSocketPolyfill: CountingWebSocket })
    await until(b, (s) => s.mainSynced && s.assetsSynced)
    const [main, assets] = b.providers
    // Deliver a 4401 close to main's socket only (the hub never sees it),
    // exactly as y-websocket's onclose handler would receive it.
    main.ws.onclose({ code: CLOSE.BAD_TOKEN, reason: 'stub' })
    const snap = await until(b, (s) => s.closeCode === CLOSE.BAD_TOKEN)
    expect(snap.mainSynced).toBe(false)
    expect(assets.shouldConnect).toBe(false)
    expect(assets.ws).toBeNull()
    expect(assets.synced).toBe(false)
    expect(loadProblem({ storage })).toMatchObject({ kind: 'revoked' })
    // nothing reconnects, on either doc
    await delay(3000)
    expect(sockets).toBe(2)
    expect(b.snapshot().assetsSynced).toBe(false)
  }, 10_000)

  it('close 4400 (protocol) is terminal: both docs stop and the problem is protocol, on the hub machine too', async () => {
    const ctx = await seededHub()
    const B = await device()
    const storage = memoryStorage()
    const terminalCodes = []
    const b = connect(B, configFor(ctx, 'hub-machine'), { storage, onTerminalClose: (code) => terminalCodes.push(code) })
    await until(b, (s) => s.mainSynced && s.assetsSynced)
    const [main, assets] = b.providers
    main.ws.onclose({ code: CLOSE.BAD_REQUEST, reason: 'stub' })
    const snap = await until(b, (s) => s.closeCode === CLOSE.BAD_REQUEST)
    expect(snap.mainSynced).toBe(false)
    expect(main.shouldConnect).toBe(false)
    expect(assets.shouldConnect).toBe(false)
    expect(loadProblem({ storage })).toMatchObject({ kind: 'protocol', roomId: ctx.h.state.room.id })
    await Promise.resolve()
    expect(terminalCodes).toEqual([CLOSE.BAD_REQUEST])
  })

  it('restore: A gets 4410; confirm-replace to the new room leaves A equal to the backup', async () => {
    const ctx = await hub()
    const names = { dbName: 'restore-a-main', assetsDbName: 'restore-a-assets' }
    let A = await openFamily(names)
    let aliveA = A
    later(() => aliveA.destroy())
    setUpFamily(A.doc, { familyName: 'Test Family', adminName: 'Pat Parent', modules: ['todos'] })
    insert(A.doc, 'shopping_items', { title: 'Before backup', completed: false }, 'item-before')
    const storage = memoryStorage()
    const config = await applyPairing({
      plan: 'save',
      incoming: { roomId: ctx.h.state.room.id, token: ctx.h.state.room.token },
      hubUrl: ctx.origin,
      role: 'hub-machine',
      storage,
    })
    const a = connect(A, config, { storage })
    await until(a, (s) => s.mainSynced && s.assetsSynced)

    const backup = createBackup(A)
    const backupMain = new Y.Doc()
    Y.applyUpdate(backupMain, Y.encodeStateAsUpdate(A.doc))
    // An edit after the backup: it must not reach the restored room.
    insert(A.doc, 'shopping_items', { title: 'After backup', completed: false }, 'item-after')
    const hubOldMain = await ctx.h._debug.doc('main')
    await untilDoc(hubOldMain, () => get(hubOldMain, 'shopping_items', 'item-after') != null)

    const restored = await ctx.api.restore(backup)
    expect(restored.roomId).not.toBe(config.roomId)
    await until(a, (s) => s.closeCode === CLOSE.ROOM_RETIRED)
    expect(loadProblem({ storage })).toMatchObject({ kind: 'room-gone', roomId: config.roomId })

    a.destroy()
    const next = await applyPairing({
      plan: 'confirm-replace',
      incoming: restored,
      hubUrl: ctx.origin,
      role: 'hub-machine',
      current: A,
      storage,
      wipe: (opts) => wipeLocalFamily({ ...opts, ...names }),
    })
    expect(loadHubConfig({ storage }).roomId).toBe(restored.roomId)
    expect(loadProblem({ storage })).toBeNull()

    A = await openFamily(names) // the reload
    aliveA = A
    expect(isSetUp(A.doc)).toBe(false) // wiped
    const a2 = connect(A, next, { storage })
    await until(a2, (s) => s.mainSynced && s.assetsSynced)
    expect(Y.encodeStateVector(A.doc)).toEqual(Y.encodeStateVector(backupMain))
    expect(get(A.doc, 'shopping_items', 'item-before')).toMatchObject({ title: 'Before backup' })
    expect(get(A.doc, 'shopping_items', 'item-after')).toBeNull()
    const hubNewMain = await ctx.h._debug.doc('main')
    expect(Y.encodeStateVector(hubNewMain)).toEqual(Y.encodeStateVector(backupMain))
  }, 15_000)

  it('assets arrive later: an asset put on A appears on B', async () => {
    const ctx = await seededHub()
    const B = await device()
    const b = connect(B, configFor(ctx))
    await until(b, (s) => s.mainSynced && s.assetsSynced)
    const id = putAsset(ctx.A.assets, new Uint8Array([1, 2, 3, 4]), 'image/png')
    await untilDoc(B.assets, () => getAsset(B.assets, id) != null)
    expect(getAsset(B.assets, id)).toEqual({ mime: 'image/png', data: new Uint8Array([1, 2, 3, 4]) })
  })

  it('a transient hub outage is not terminal: no problem flag, keeps retrying', async () => {
    const ctx = await seededHub()
    const B = await device()
    const storage = memoryStorage()
    const b = connect(B, configFor(ctx), { storage })
    await until(b, (s) => s.mainSynced)
    await ctx.h.close()
    const snap = await until(b, (s) => !s.mainSynced)
    expect(snap.attemptStartedAt).toBeGreaterThan(0)
    expect(loadProblem({ storage })).toBeNull()
    expect(b.providers.every((p) => p.shouldConnect)).toBe(true)
  })
})

describe('bootSync against a real hub', () => {
  it('the hub machine adopts the hub room, syncs, and survives a rotation (4401 -> new token)', async () => {
    const ctx = await seededHub()
    const D = await device()
    const storage = memoryStorage()
    const r = await bootSync({
      fam: D,
      location: { hostname: '127.0.0.1', origin: ctx.origin },
      storage,
      connectOptions: { WebSocketPolyfill: globalThis.WebSocket, disableBc: true },
    })
    later(() => r.connection.destroy())
    expect(r.role).toBe('hub-machine')
    expect(r.hubInfo.familyExists).toBe(true)
    await until(r.connection, (s) => s.mainSynced)
    expect(isSetUp(D.doc)).toBe(true)

    const rotated = await rotateHubToken(ctx.h)
    await until(r.connection, (s) => s.mainSynced && s.closeCode === null && r.config.token === rotated.token)
    expect(loadHubConfig({ storage }).token).toBe(rotated.token)
    expect(loadProblem({ storage })).toBeNull()
  })

})
