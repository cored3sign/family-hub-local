import { describe, it, expect, vi } from 'vitest'
import { memoryStorage } from '../testing'
import { loadHubConfig, saveHubConfig, setProblem, loadProblem, setLastSyncedAt, getLastSyncedAt } from './config.js'
import { planPairing, applyPairing } from './pairing.js'

const ROOM_A = 'r_' + 'A'.repeat(22)
const ROOM_B = 'r_' + 'B'.repeat(22)
const TOKEN_1 = '1'.repeat(43)
const TOKEN_2 = '2'.repeat(43)
const HUB = 'http://192.0.2.20:8787'
const config = (roomId = ROOM_A, token = TOKEN_1) => ({ v: 1, hubUrl: HUB, roomId, token, role: 'device', pairedAt: '2026-10-01 09:00:00' })
const fixedNow = () => new Date('2026-10-07T10:00:00Z')

describe('planPairing truth table', () => {
  const cases = [
    // config, hasLocalFamily, incoming room -> plan
    [null, false, ROOM_A, 'save'],
    [null, true, ROOM_A, 'confirm-replace'],
    [config(ROOM_A), false, ROOM_A, 'update-token'],
    [config(ROOM_A), true, ROOM_A, 'update-token'],
    [config(ROOM_A), false, ROOM_B, 'confirm-replace'],
    [config(ROOM_A), true, ROOM_B, 'confirm-replace'],
  ]
  it.each(cases)('config=%o local=%s incoming=%s -> %s', (cfg, hasLocalFamily, roomId, expected) => {
    expect(planPairing({ config: cfg, hasLocalFamily, incoming: { roomId } })).toBe(expected)
  })
})

describe('applyPairing', () => {
  const incoming = { roomId: ROOM_B, token: TOKEN_2, familyExists: true }

  it("'save' writes the config and clears any problem", async () => {
    const storage = memoryStorage()
    setProblem({ kind: 'revoked', roomId: ROOM_A }, { storage })
    const wipe = vi.fn()
    const saved = await applyPairing({ plan: 'save', incoming, hubUrl: HUB, role: 'device', storage, wipe, now: fixedNow })
    expect(saved).toEqual({ v: 1, hubUrl: HUB, roomId: ROOM_B, token: TOKEN_2, role: 'device', pairedAt: '2026-10-07 10:00:00' })
    expect(loadHubConfig({ storage })).toEqual(saved)
    expect(loadProblem({ storage })).toBeNull()
    expect(wipe).not.toHaveBeenCalled()
  })

  it("'update-token' keeps the room, swaps the token, never wipes", async () => {
    const storage = memoryStorage()
    saveHubConfig(config(ROOM_A, TOKEN_1), { storage })
    setProblem({ kind: 'revoked', roomId: ROOM_A }, { storage })
    const wipe = vi.fn()
    const saved = await applyPairing({ plan: 'update-token', incoming: { roomId: ROOM_A, token: TOKEN_2 }, hubUrl: HUB, role: 'device', storage, wipe })
    expect(saved.roomId).toBe(ROOM_A)
    expect(saved.token).toBe(TOKEN_2)
    expect(loadProblem({ storage })).toBeNull()
    expect(wipe).not.toHaveBeenCalled()
  })

  it("'update-token' refuses a different room (room-binding invariant)", async () => {
    const storage = memoryStorage()
    saveHubConfig(config(ROOM_A), { storage })
    await expect(applyPairing({ plan: 'update-token', incoming, hubUrl: HUB, role: 'device', storage })).rejects.toThrow()
    expect(loadHubConfig({ storage }).roomId).toBe(ROOM_A)
  })

  it("'confirm-replace' wipes BOTH databases before saving, then clears the problem", async () => {
    const storage = memoryStorage()
    saveHubConfig(config(ROOM_A), { storage })
    setProblem({ kind: 'room-gone', roomId: ROOM_A }, { storage })
    setLastSyncedAt('2026-10-01 09:00:00', { storage })
    const current = { destroy: vi.fn() }
    const order = []
    const wipe = vi.fn(async (opts) => {
      expect(opts.current).toBe(current)
      order.push(['wipe', loadHubConfig({ storage }).roomId])
    })
    const saved = await applyPairing({ plan: 'confirm-replace', incoming, hubUrl: HUB, role: 'device', current, storage, wipe })
    order.push(['saved', loadHubConfig({ storage }).roomId])
    expect(order).toEqual([
      ['wipe', ROOM_A],
      ['saved', ROOM_B],
    ])
    expect(saved.roomId).toBe(ROOM_B)
    expect(loadProblem({ storage })).toBeNull()
    // lastSyncedAt belonged to the old room
    expect(getLastSyncedAt({ storage })).toBeNull()
  })

  it("'confirm-replace' with a failing wipe leaves the config (and problem) unchanged", async () => {
    const storage = memoryStorage()
    saveHubConfig(config(ROOM_A), { storage })
    setProblem({ kind: 'room-gone', roomId: ROOM_A }, { storage })
    const wipe = vi.fn(async () => {
      throw new Error('blocked')
    })
    await expect(applyPairing({ plan: 'confirm-replace', incoming, hubUrl: HUB, role: 'device', storage, wipe })).rejects.toThrow('blocked')
    expect(loadHubConfig({ storage })).toEqual(config(ROOM_A))
    expect(loadProblem({ storage })?.kind).toBe('room-gone')
  })

  it("'adopt' saves the new room without wiping", async () => {
    const storage = memoryStorage()
    const wipe = vi.fn()
    const saved = await applyPairing({ plan: 'adopt', incoming, hubUrl: 'http://localhost:8787', role: 'hub-machine', storage, wipe, claimed: true })
    expect(saved.roomId).toBe(ROOM_B)
    expect(saved.role).toBe('hub-machine')
    expect(wipe).not.toHaveBeenCalled()
  })

  it("'adopt' without claimed: true throws and saves nothing (a 409 claim can't bind the room)", async () => {
    const storage = memoryStorage()
    await expect(applyPairing({ plan: 'adopt', incoming, hubUrl: 'http://localhost:8787', role: 'hub-machine', storage })).rejects.toThrow(/claim/)
    await expect(applyPairing({ plan: 'adopt', incoming, hubUrl: 'http://localhost:8787', role: 'hub-machine', storage, claimed: 'yes' })).rejects.toThrow(/claim/)
    expect(loadHubConfig({ storage })).toBeNull()
  })

  it('rejects unknown plans and invalid credentials without touching storage', async () => {
    const storage = memoryStorage()
    await expect(applyPairing({ plan: 'nope', incoming, hubUrl: HUB, role: 'device', storage })).rejects.toThrow()
    await expect(applyPairing({ plan: 'save', incoming: { roomId: 'bad', token: TOKEN_2 }, hubUrl: HUB, role: 'device', storage })).rejects.toThrow()
    expect(loadHubConfig({ storage })).toBeNull()
  })
})

