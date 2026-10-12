import { describe, it, expect } from 'vitest'
import { memoryStorage } from '../testing'
import {
  HUB_KEY,
  PROBLEM_KEY,
  LAST_SYNCED_KEY,
  loadHubConfig,
  saveHubConfig,
  clearHubConfig,
  loadProblem,
  setProblem,
  clearProblem,
  getLastSyncedAt,
  setLastSyncedAt,
} from './config.js'

const ROOM = 'r_' + 'A'.repeat(22)
const TOKEN = 'b'.repeat(43)
const valid = () => ({ v: 1, hubUrl: 'http://192.0.2.20:8787', roomId: ROOM, token: TOKEN, role: 'device', pairedAt: '2026-10-07 10:00:00' })

describe('hub config', () => {
  it('round-trips a valid config under fh.hub', () => {
    const storage = memoryStorage()
    saveHubConfig(valid(), { storage })
    expect(JSON.parse(storage.getItem(HUB_KEY))).toEqual(valid())
    expect(loadHubConfig({ storage })).toEqual(valid())
    clearHubConfig({ storage })
    expect(loadHubConfig({ storage })).toBeNull()
  })

  it('treats anything invalid as "no config"', () => {
    const bad = [
      'not json',
      JSON.stringify(null),
      JSON.stringify({ ...valid(), v: 2 }),
      JSON.stringify({ ...valid(), hubUrl: 'ftp://x' }),
      JSON.stringify({ ...valid(), roomId: 'room' }),
      JSON.stringify({ ...valid(), token: 'short' }),
      JSON.stringify({ ...valid(), role: 'admin' }),
      JSON.stringify({ ...valid(), pairedAt: 42 }),
    ]
    for (const text of bad) expect(loadHubConfig({ storage: memoryStorage({ [HUB_KEY]: text }) })).toBeNull()
  })

  it('refuses to save an invalid config', () => {
    const storage = memoryStorage()
    expect(() => saveHubConfig({ ...valid(), token: 'x' }, { storage })).toThrow()
    expect(storage.getItem(HUB_KEY)).toBeNull()
  })

  it('survives blocked storage (reads as null, writes are no-ops for flags)', () => {
    const storage = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
      removeItem() {
        throw new Error('blocked')
      },
    }
    expect(loadHubConfig({ storage })).toBeNull()
    expect(loadProblem({ storage })).toBeNull()
    expect(getLastSyncedAt({ storage })).toBeNull()
    expect(() => setLastSyncedAt('2026-10-07 10:00:00', { storage })).not.toThrow()
  })
})

describe('problem flag and lastSyncedAt', () => {
  it('stores { kind, roomId, at } and clears it', () => {
    const storage = memoryStorage()
    setProblem({ kind: 'revoked', roomId: ROOM }, { storage, now: () => new Date('2026-10-07T10:00:00Z') })
    expect(loadProblem({ storage })).toEqual({ kind: 'revoked', roomId: ROOM, at: '2026-10-07 10:00:00' })
    expect(JSON.parse(storage.getItem(PROBLEM_KEY)).kind).toBe('revoked')
    clearProblem({ storage })
    expect(loadProblem({ storage })).toBeNull()
  })

  it('accepts the protocol kind (close 4400)', () => {
    const storage = memoryStorage()
    setProblem({ kind: 'protocol', roomId: ROOM }, { storage })
    expect(loadProblem({ storage })).toMatchObject({ kind: 'protocol', roomId: ROOM })
  })

  it('ignores unknown problem kinds', () => {
    const storage = memoryStorage({ [PROBLEM_KEY]: JSON.stringify({ kind: 'weird', roomId: ROOM, at: 'x' }) })
    expect(loadProblem({ storage })).toBeNull()
    expect(() => setProblem({ kind: 'weird', roomId: ROOM }, { storage })).toThrow()
  })

  it('stores lastSyncedAt as a plain stamp', () => {
    const storage = memoryStorage()
    expect(getLastSyncedAt({ storage })).toBeNull()
    setLastSyncedAt('2026-10-07 10:00:00', { storage })
    expect(storage.getItem(LAST_SYNCED_KEY)).toBe('2026-10-07 10:00:00')
    expect(getLastSyncedAt({ storage })).toBe('2026-10-07 10:00:00')
  })
})
