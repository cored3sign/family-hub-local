import { describe, it, expect } from 'vitest'
import { combineConnections } from './combine.js'

function fakeConnection(snap) {
  const listeners = new Set()
  let destroyed = false
  return {
    set(next) {
      Object.assign(snap, next)
      for (const fn of listeners) fn()
    },
    get destroyed() {
      return destroyed
    },
    snapshot: () => ({ ...snap }),
    on: (_type, fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    destroy: () => {
      destroyed = true
    },
  }
}

describe('combined sync connection', () => {
  it('is synced when either side is, and reports the most recent sync', () => {
    const hubSnap = { mainSynced: false, assetsSynced: false, wsStatus: 'connecting', closeCode: null, attemptStartedAt: 100, lastSyncedAt: null }
    const relaySnap = { mainSynced: true, assetsSynced: true, wsStatus: 'connected', closeCode: null, attemptStartedAt: 50, lastSyncedAt: '2026-10-10 12:00:00' }
    const hub = fakeConnection(hubSnap)
    const relay = fakeConnection(relaySnap)
    const combined = combineConnections([hub, relay])
    const snap = combined.snapshot()
    expect(snap.mainSynced).toBe(true)
    expect(snap.wsStatus).toBe('connected')
    expect(snap.attemptStartedAt).toBe(50)
    expect(snap.lastSyncedAt).toBe('2026-10-10 12:00:00')
  })

  it('tells the store about changes from either side, and destroys both', () => {
    const hub = fakeConnection({ mainSynced: false, wsStatus: 'connecting' })
    const relay = fakeConnection({ mainSynced: false, wsStatus: 'connecting' })
    const combined = combineConnections([hub, relay])
    let calls = 0
    combined.on('change', () => calls++)
    relay.set({ mainSynced: true })
    expect(calls).toBe(1)
    combined.destroy()
    expect(combined.destroyed).toBe(true)
    expect(hub.destroyed).toBe(true)
    expect(relay.destroyed).toBe(true)
  })
})
