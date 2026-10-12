import { describe, it, expect } from 'vitest'
import { deriveSyncStatus, STATUS_COPY, PROBLEM_COPY, HUB_MACHINE_NOT_UPLOADED, HUB_MACHINE_ROOM_GONE, statusCopy, CONNECTING_GRACE_MS } from './status.js'

const base = { hasConfig: true, problem: null, online: true, mainSynced: false, connectingSinceMs: 0, nowMs: 0, role: 'device' }
const s = (over) => deriveSyncStatus({ ...base, ...over })

describe('deriveSyncStatus', () => {
  it('needs-pairing: no config on a device', () => {
    expect(s({ hasConfig: false })).toBe('needs-pairing')
    expect(s({ hasConfig: false, role: 'unpaired' })).toBe('needs-pairing')
  })

  it('needs-pairing: revoked / room-gone problem', () => {
    expect(s({ problem: { kind: 'revoked' } })).toBe('needs-pairing')
    expect(s({ problem: { kind: 'room-gone' } })).toBe('needs-pairing')
  })

  it('needs-pairing: a protocol problem (close 4400), even on the hub machine and offline', () => {
    expect(s({ problem: { kind: 'protocol' } })).toBe('needs-pairing')
    expect(s({ problem: { kind: 'protocol' }, role: 'hub-machine', online: false })).toBe('needs-pairing')
  })

  it('a problem beats offline and a stale synced flag', () => {
    expect(s({ problem: { kind: 'revoked' }, online: false })).toBe('needs-pairing')
    expect(s({ problem: { kind: 'revoked' }, mainSynced: true })).toBe('needs-pairing')
  })

  it('offline beats everything else, including no config', () => {
    expect(s({ online: false, mainSynced: true })).toBe('offline')
    expect(s({ online: false, hasConfig: false })).toBe('offline')
  })

  it('connected only when the main doc is synced', () => {
    expect(s({ mainSynced: true, nowMs: 60_000 })).toBe('connected')
  })

  it('connecting for under 4 s since boot / the last attempt, then waiting', () => {
    expect(CONNECTING_GRACE_MS).toBe(4000)
    expect(s({ connectingSinceMs: 1000, nowMs: 1000 })).toBe('connecting')
    expect(s({ connectingSinceMs: 1000, nowMs: 4999 })).toBe('connecting')
    expect(s({ connectingSinceMs: 1000, nowMs: 5000 })).toBe('waiting')
    expect(s({ connectingSinceMs: null, nowMs: 5000 })).toBe('connecting')
  })

  it('the hub machine without a config is never needs-pairing (hub not running -> waiting)', () => {
    expect(s({ hasConfig: false, role: 'hub-machine', connectingSinceMs: 0, nowMs: 1000 })).toBe('connecting')
    expect(s({ hasConfig: false, role: 'hub-machine', connectingSinceMs: 0, nowMs: 4000 })).toBe('waiting')
  })
})

describe('STATUS_COPY', () => {
  it('covers all five states with their status copy', () => {
    expect(STATUS_COPY['needs-pairing']).toEqual({
      label: 'Not syncing',
      tone: 'red',
      message: "This device isn't connected to your family. Scan the family's QR code to join.",
    })
    expect(STATUS_COPY.offline).toEqual({ label: 'Offline', tone: 'orange', message: 'You are offline. Changes are saved on this device.' })
    expect(STATUS_COPY.connected).toEqual({ label: 'Synced', tone: 'green', message: 'Connected to your family hub.' })
    expect(STATUS_COPY.connecting).toEqual({ label: 'Connecting…', tone: 'grey', message: '' })
    expect(STATUS_COPY.waiting).toEqual({
      label: 'Waiting for hub',
      tone: 'yellow',
      message: 'Changes are saved on this device and will sync when your family hub is reachable.',
    })
  })

  it('statusCopy swaps in the hub-machine waiting message', () => {
    expect(statusCopy('waiting', { role: 'hub-machine' }).message).toBe("Family Hub isn't running on this computer. Start it with npm start.")
    expect(statusCopy('waiting', { role: 'device' })).toEqual(STATUS_COPY.waiting)
    expect(statusCopy('connected', { role: 'hub-machine' })).toEqual(STATUS_COPY.connected)
  })

  it('statusCopy: the hub machine with the hub answering but no live connection (adopt cancelled)', () => {
    expect(HUB_MACHINE_NOT_UPLOADED).toBe("This computer's family isn't on the hub yet. Reload to upload it.")
    expect(statusCopy('waiting', { role: 'hub-machine', hubRunning: true, hasConnection: false }).message).toBe(HUB_MACHINE_NOT_UPLOADED)
    // A live connection that can't sync: the hub stopped since it last answered.
    expect(statusCopy('waiting', { role: 'hub-machine', hubRunning: true, hasConnection: true }).message).toBe(
      "Family Hub isn't running on this computer. Start it with npm start."
    )
    expect(statusCopy('waiting', { role: 'hub-machine', hubRunning: false, hasConnection: false }).message).toBe(
      "Family Hub isn't running on this computer. Start it with npm start."
    )
  })

  it('statusCopy: a room restored or reset under the hub machine says reload, not "pair again"', () => {
    expect(HUB_MACHINE_ROOM_GONE).toBe('Your family hub was restored or reset. Reload this page.')
    expect(statusCopy('needs-pairing', { role: 'hub-machine', problem: { kind: 'room-gone' } }).message).toBe(HUB_MACHINE_ROOM_GONE)
    expect(statusCopy('needs-pairing', { role: 'hub-machine', problem: { kind: 'revoked' } }).message).toBe(HUB_MACHINE_ROOM_GONE)
    expect(statusCopy('needs-pairing', { role: 'device', problem: { kind: 'room-gone' } })).toEqual(STATUS_COPY['needs-pairing'])
  })

  it('statusCopy swaps in the protocol message for a 4400 problem', () => {
    const copy = statusCopy('needs-pairing', { role: 'device', problem: { kind: 'protocol' } })
    expect(copy).toEqual({ ...STATUS_COPY['needs-pairing'], message: PROBLEM_COPY.protocol })
    expect(PROBLEM_COPY.protocol).toBe(
      "This device can't talk to your family hub. Update Family Hub on the family computer, then reload this page."
    )
    expect(statusCopy('needs-pairing', { role: 'hub-machine', problem: { kind: 'protocol' } }).message).toBe(PROBLEM_COPY.protocol)
    expect(statusCopy('needs-pairing', { problem: { kind: 'revoked' } })).toEqual(STATUS_COPY['needs-pairing'])
  })
})
