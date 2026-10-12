import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import { memoryStorage, newFamilyDoc } from '../testing'
import { loadHubConfig, saveHubConfig, loadProblem } from './config.js'
import { bootSync, isLoopbackHostname } from './boot.js'
import { CLOSE } from './protocol.js'

const ROOM_A = 'r_' + 'A'.repeat(22)
const ROOM_B = 'r_' + 'B'.repeat(22)
const TOKEN_1 = '1'.repeat(43)
const TOKEN_2 = '2'.repeat(43)

const DEVICE = { hostname: '192.0.2.20', origin: 'http://192.0.2.20:8787' }
const DESKTOP = { hostname: 'localhost', origin: 'http://localhost:8787' }
const cfg = (over = {}) => ({ v: 1, hubUrl: DEVICE.origin, roomId: ROOM_A, token: TOKEN_1, role: 'device', pairedAt: '2026-10-01 09:00:00', ...over })

const emptyFam = () => ({ doc: new Y.Doc(), assets: new Y.Doc() })
const familyFam = () => ({ doc: newFamilyDoc().doc, assets: new Y.Doc() })

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// routes: { 'GET /api/hub/info': () => Response }
function fakeFetch(routes) {
  return vi.fn(async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`
    const handler = routes[key]
    if (!handler) throw new TypeError(`fetch failed (${key})`)
    return handler(url, init)
  })
}

function fakeConnect() {
  const calls = []
  const connect = vi.fn((fam, config, opts) => {
    const connection = { config, opts, destroyed: false, reconnect: vi.fn(), destroy: vi.fn(), on: vi.fn(), snapshot: vi.fn() }
    calls.push(connection)
    return connection
  })
  return { connect, calls }
}

const info = (over = {}) => ({ roomId: ROOM_A, token: TOKEN_1, familyExists: true, port: 8787, dataDir: '/data', ...over })

describe('isLoopbackHostname', () => {
  it('accepts only localhost, 127.0.0.1 and [::1]', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]', '::1']) expect(isLoopbackHostname(h)).toBe(true)
    for (const h of ['192.0.2.20', 'desktop.example.com', 'localhost.example.com', '127.0.0.2', '']) expect(isLoopbackHostname(h)).toBe(false)
  })
})

describe('bootSync on a device', () => {
  it('uses the stored config without touching the network', async () => {
    const storage = memoryStorage()
    saveHubConfig(cfg(), { storage })
    const fetchImpl = fakeFetch({})
    const { connect, calls } = fakeConnect()
    const r = await bootSync({ fam: emptyFam(), location: DEVICE, storage, fetchImpl, connect })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r.role).toBe('device')
    expect(r.config).toEqual(cfg())
    expect(r.connection).toBe(calls[0])
    expect(calls[0].config).toEqual(cfg())
    expect(r.pendingReplace).toBeNull()
  })

  it('unpaired: no config, no code -> no connection, no network', async () => {
    const fetchImpl = fakeFetch({})
    const { connect } = fakeConnect()
    const r = await bootSync({ fam: emptyFam(), location: DEVICE, storage: memoryStorage(), fetchImpl, connect })
    expect(r).toMatchObject({ role: 'unpaired', config: null, hubInfo: null, pendingReplace: null, connection: null })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('never probes /api/hub/info off loopback', async () => {
    const fetchImpl = fakeFetch({ 'GET /api/hub/info': () => json(200, info()) })
    await bootSync({ fam: emptyFam(), location: DEVICE, storage: memoryStorage(), fetchImpl, connect: fakeConnect().connect })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('bootSync on the hub machine (loopback)', () => {
  it('no config + empty local: saves role hub-machine with the hub info', async () => {
    const storage = memoryStorage()
    const fetchImpl = fakeFetch({ 'GET /api/hub/info': () => json(200, info({ familyExists: false })) })
    const { connect } = fakeConnect()
    const r = await bootSync({ fam: emptyFam(), location: DESKTOP, storage, fetchImpl, connect })
    expect(r.role).toBe('hub-machine')
    expect(r.hubInfo.familyExists).toBe(false)
    expect(r.config).toMatchObject({ hubUrl: DESKTOP.origin, roomId: ROOM_A, token: TOKEN_1, role: 'hub-machine' })
    expect(connect).toHaveBeenCalledOnce()
  })

  it('same room: refreshes the token', async () => {
    const storage = memoryStorage()
    saveHubConfig(cfg({ hubUrl: DESKTOP.origin, role: 'hub-machine' }), { storage })
    const fetchImpl = fakeFetch({ 'GET /api/hub/info': () => json(200, info({ token: TOKEN_2 })) })
    const r = await bootSync({ fam: familyFam(), location: DESKTOP, storage, fetchImpl, connect: fakeConnect().connect })
    expect(r.config.token).toBe(TOKEN_2)
    expect(loadHubConfig({ storage }).token).toBe(TOKEN_2)
  })

  it('room mismatch and the hub has a family: confirm-replace (no adopt)', async () => {
    const storage = memoryStorage()
    saveHubConfig(cfg({ hubUrl: DESKTOP.origin, role: 'hub-machine' }), { storage })
    const fetchImpl = fakeFetch({ 'GET /api/hub/info': () => json(200, info({ roomId: ROOM_B, token: TOKEN_2, familyExists: true })) })
    const { connect } = fakeConnect()
    const r = await bootSync({ fam: familyFam(), location: DESKTOP, storage, fetchImpl, connect })
    expect(r.pendingReplace).toMatchObject({ adopt: false, incoming: { roomId: ROOM_B, token: TOKEN_2 }, role: 'hub-machine' })
    expect(connect).not.toHaveBeenCalled()
    expect(loadHubConfig({ storage }).roomId).toBe(ROOM_A)
  })

  it('hub room empty and a local family: adopt', async () => {
    const storage = memoryStorage()
    const fetchImpl = fakeFetch({ 'GET /api/hub/info': () => json(200, info({ familyExists: false })) })
    const { connect } = fakeConnect()
    const r = await bootSync({ fam: familyFam(), location: DESKTOP, storage, fetchImpl, connect })
    expect(r.pendingReplace).toMatchObject({ adopt: true, incoming: { roomId: ROOM_A }, role: 'hub-machine' })
    expect(r.role).toBe('hub-machine')
    expect(connect).not.toHaveBeenCalled()
    expect(loadHubConfig({ storage })).toBeNull()
  })

  it('the info probe is bounded by hubInfoTimeoutMs; falls back to the stored config', async () => {
    const storage = memoryStorage()
    saveHubConfig(cfg({ hubUrl: DESKTOP.origin, role: 'hub-machine' }), { storage })
    const fetchImpl = vi.fn(() => new Promise(() => {})) // never settles, ignores abort
    const { connect } = fakeConnect()
    const started = Date.now()
    const r = await bootSync({ fam: familyFam(), location: DESKTOP, storage, fetchImpl, connect, hubInfoTimeoutMs: 50 })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(r.hubInfo).toBeNull()
    expect(r.role).toBe('hub-machine')
    expect(connect).toHaveBeenCalledOnce()
  })

  it('hub not running and no config: role hub-machine, no connection', async () => {
    const r = await bootSync({ fam: emptyFam(), location: DESKTOP, storage: memoryStorage(), fetchImpl: fakeFetch({}), connect: fakeConnect().connect })
    expect(r).toMatchObject({ role: 'hub-machine', config: null, hubInfo: null, connection: null })
  })

  it('on 4401 re-fetches info and reconnects with the new token instead of marking revoked', async () => {
    const storage = memoryStorage()
    saveHubConfig(cfg({ hubUrl: DESKTOP.origin, role: 'hub-machine' }), { storage })
    let current = info()
    const fetchImpl = fakeFetch({ 'GET /api/hub/info': () => json(200, current) })
    const { connect, calls } = fakeConnect()
    const r = await bootSync({ fam: familyFam(), location: DESKTOP, storage, fetchImpl, connect })
    expect(calls[0].config.role).toBe('hub-machine')

    current = info({ token: TOKEN_2 })
    await calls[0].opts.onTerminalClose(CLOSE.BAD_TOKEN)
    expect(calls[0].reconnect).toHaveBeenCalledWith(TOKEN_2)
    expect(loadHubConfig({ storage }).token).toBe(TOKEN_2)
    expect(r.config.token).toBe(TOKEN_2)
    expect(loadProblem({ storage })).toBeNull()
  })

  it('on 4401 with no new token available, marks the device revoked', async () => {
    const storage = memoryStorage()
    saveHubConfig(cfg({ hubUrl: DESKTOP.origin, role: 'hub-machine' }), { storage })
    const fetchImpl = fakeFetch({ 'GET /api/hub/info': () => json(200, info()) })
    const { connect, calls } = fakeConnect()
    await bootSync({ fam: familyFam(), location: DESKTOP, storage, fetchImpl, connect })
    await calls[0].opts.onTerminalClose(CLOSE.BAD_TOKEN)
    expect(calls[0].reconnect).not.toHaveBeenCalled()
    expect(loadProblem({ storage })).toMatchObject({ kind: 'revoked', roomId: ROOM_A })
  })

  it('on 4401, if refreshing the token throws, falls back to revoked', async () => {
    const storage = memoryStorage()
    saveHubConfig(cfg({ hubUrl: DESKTOP.origin, role: 'hub-machine' }), { storage })
    let current = info()
    const fetchImpl = fakeFetch({ 'GET /api/hub/info': () => json(200, current) })
    const { connect, calls } = fakeConnect()
    await bootSync({ fam: familyFam(), location: DESKTOP, storage, fetchImpl, connect })
    current = info({ token: TOKEN_2 })
    const setItem = storage.setItem
    storage.setItem = (key, value) => {
      if (key === 'fh.hub') throw new Error('quota')
      return setItem(key, value)
    }
    await expect(calls[0].opts.onTerminalClose(CLOSE.BAD_TOKEN)).resolves.toBeUndefined()
    expect(calls[0].reconnect).not.toHaveBeenCalled()
    expect(loadProblem({ storage })).toMatchObject({ kind: 'revoked', roomId: ROOM_A })
  })

  it('on 4401 after the connection was destroyed, does nothing', async () => {
    const storage = memoryStorage()
    saveHubConfig(cfg({ hubUrl: DESKTOP.origin, role: 'hub-machine' }), { storage })
    let current = info()
    const fetchImpl = fakeFetch({ 'GET /api/hub/info': () => json(200, current) })
    const { connect, calls } = fakeConnect()
    await bootSync({ fam: familyFam(), location: DESKTOP, storage, fetchImpl, connect })
    current = info({ token: TOKEN_2 })
    calls[0].destroyed = true
    await calls[0].opts.onTerminalClose(CLOSE.BAD_TOKEN)
    expect(calls[0].reconnect).not.toHaveBeenCalled()
    expect(loadHubConfig({ storage }).token).toBe(TOKEN_1)
    expect(loadProblem({ storage })).toBeNull()
  })
})
