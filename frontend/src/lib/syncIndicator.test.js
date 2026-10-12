import { describe, it, expect } from 'vitest'
import { STATUS_COPY, statusCopy } from '../data/sync/status.js'
import { SYNC_ICON, syncMessage, lastSyncedText } from './syncIndicator'

const NOW = new Date('2026-10-07T10:00:10Z')

describe('sync indicator', () => {
  it('has an icon for each of the five states', () => {
    expect(Object.keys(SYNC_ICON).sort()).toEqual(Object.keys(STATUS_COPY).sort())
    expect(SYNC_ICON).toEqual({
      connected: 'Cloud',
      waiting: 'CloudOff',
      offline: 'WifiOff',
      connecting: 'Loader',
      'needs-pairing': 'AlertTriangle',
    })
  })

  it('connected: the message plus the last-synced time', () => {
    const s = { status: 'connected', statusCopy: statusCopy('connected'), lastSyncedAt: '2026-10-07 10:00:00' }
    expect(syncMessage(s, NOW)).toBe('Connected to your Yggltree. Last synced: Just now.')
    expect(syncMessage({ ...s, lastSyncedAt: null }, NOW)).toBe('Connected to your Yggltree.')
  })

  it('connecting has no fixed status message, so it says what it is doing', () => {
    expect(syncMessage({ status: 'connecting', statusCopy: statusCopy('connecting') }, NOW)).toBe('Connecting to your Yggltree…')
  })

  it('other states use the status copy verbatim (never claims synced)', () => {
    for (const state of ['waiting', 'offline', 'needs-pairing']) {
      const msg = syncMessage({ status: state, statusCopy: statusCopy(state), lastSyncedAt: '2026-10-07 10:00:00' }, NOW)
      expect(msg).toBe(STATUS_COPY[state].message)
    }
  })

  it('lastSyncedText: friendly, or "Not yet"', () => {
    expect(lastSyncedText('2026-10-07 09:55:00', NOW)).toBe('5m ago')
    expect(lastSyncedText(null, NOW)).toBe('Not yet')
  })
})
