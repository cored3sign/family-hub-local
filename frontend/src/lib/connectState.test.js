import { describe, it, expect } from 'vitest'
import { connectState } from './connectState.js'

const CFG = { hubUrl: 'http://192.0.2.20:8787', roomId: 'r', token: 't', role: 'device' }
const base = { pendingReplace: null, problem: null, role: 'device', hubInfo: null, config: CFG, status: 'connecting' }
const s = (over) => connectState({ ...base, ...over })

describe('connectState', () => {
  it('a pending replace wins, with the adopt variant', () => {
    expect(s({ pendingReplace: { adopt: false }, problem: { kind: 'revoked' } })).toBe('confirm-replace')
    expect(s({ pendingReplace: { adopt: true }, role: 'hub-machine' })).toBe('confirm-adopt')
  })

  it('a replace whose wipe failed is replace-failed (no Cancel offered)', () => {
    expect(s({ pendingReplace: { adopt: false }, replaceStuck: true })).toBe('replace-failed')
    expect(s({ pendingReplace: { adopt: false }, replaceStuck: false })).toBe('confirm-replace')
  })

  it('a stored problem is needs-pairing (revoked, room gone, protocol)', () => {
    for (const kind of ['revoked', 'room-gone', 'protocol']) expect(s({ problem: { kind } })).toBe('needs-pairing')
  })

  it('the hub machine with no hub answering is hub-not-running', () => {
    expect(s({ role: 'hub-machine', hubInfo: null, config: null })).toBe('hub-not-running')
    expect(s({ role: 'hub-machine', hubInfo: null })).toBe('hub-not-running')
    expect(s({ role: 'hub-machine', hubInfo: null, problem: { kind: 'revoked' } })).toBe('hub-not-running')
  })

  it('an unpaired device is not-paired', () => {
    expect(s({ role: 'unpaired', config: null, status: 'needs-pairing' })).toBe('not-paired')
  })

  it('a typed code that needs a replace goes to the confirm screen', () => {
    expect(s({ role: 'unpaired', config: null, pendingReplace: { adopt: false } })).toBe('confirm-replace')
  })

  it('synced with the hub but still no family: the hub is empty', () => {
    expect(s({ status: 'connected' })).toBe('hub-empty')
  })

  it('otherwise connecting (also waiting / offline)', () => {
    for (const status of ['connecting', 'waiting', 'offline']) expect(s({ status })).toBe('connecting')
    expect(s({ role: 'hub-machine', hubInfo: { familyExists: true } })).toBe('connecting')
  })
})

describe('connectState: install-first (an iPhone Safari tab with no family)', () => {
  const unpaired = { role: 'unpaired', config: null, status: 'needs-pairing' }

  it('is install-first when the page asks for it, and not-paired otherwise', () => {
    expect(s({ ...unpaired, installFirst: true })).toBe('install-first')
    expect(s({ ...unpaired, installFirst: false })).toBe('not-paired')
    expect(s(unpaired)).toBe('not-paired')
  })

  it('never applies to a device that already has a family, or to the hub machine', () => {
    expect(s({ installFirst: true })).toBe('connecting')
    expect(s({ role: 'hub-machine', hubInfo: null, config: null, installFirst: true })).toBe('hub-not-running')
  })

  it('a pending replace still wins over install-first', () => {
    expect(s({ ...unpaired, installFirst: true, pendingReplace: { adopt: false } })).toBe('confirm-replace')
  })
})
