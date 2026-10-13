import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { deviceLabel, describeLastSeen, listDevices, recordDevice, refreshPresence, startPresence, thisDeviceLabel } from './presence.js'
import { PRESENCE_ORIGIN } from './origins.js'

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
const ANDROID_EDGE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 EdgA/120.0'
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const WINDOWS_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'

// A doc that has a family in it (the same mark hasFamily looks for).
function familyDoc() {
  const doc = new Y.Doc()
  doc.getMap('meta').set('schema_version', 1)
  return doc
}

describe('device labels', () => {
  it('names the device and the browser', () => {
    expect(deviceLabel(IPHONE_SAFARI)).toBe('iPhone · Safari')
    expect(deviceLabel(ANDROID_CHROME)).toBe('Android · Chrome')
    expect(deviceLabel(ANDROID_EDGE)).toBe('Android · Edge')
    expect(deviceLabel(MAC_CHROME)).toBe('Mac · Chrome')
    expect(deviceLabel(WINDOWS_EDGE)).toBe('Windows PC · Edge')
    expect(deviceLabel('')).toBe('Device')
  })

  it('says when the device runs as a Home Screen app', () => {
    expect(deviceLabel(IPHONE_SAFARI, { standalone: true })).toBe('iPhone · Home Screen app')
  })

  it('reads the browser from the environment', () => {
    expect(thisDeviceLabel({ navigator: { userAgent: ANDROID_CHROME } })).toBe('Android · Chrome')
    expect(thisDeviceLabel({ navigator: { userAgent: IPHONE_SAFARI, standalone: true } })).toBe('iPhone · Home Screen app')
  })
})

describe('recording a device', () => {
  it('writes nothing until the family exists on this device', () => {
    const doc = new Y.Doc()
    expect(recordDevice(doc, { id: 'dev-0', label: 'Android · Chrome' })).toBe(false)
    expect(listDevices(doc)).toEqual([])
  })

  it('writes a device once, and not again for a few minutes', () => {
    const doc = familyDoc()
    const start = new Date('2026-10-13T10:00:00Z')
    expect(recordDevice(doc, { id: 'dev-1', label: 'Android · Chrome', now: start })).toBe(true)
    expect(recordDevice(doc, { id: 'dev-1', label: 'Android · Chrome', now: new Date(start.getTime() + 60000) })).toBe(false)
    expect(recordDevice(doc, { id: 'dev-1', label: 'Android · Chrome', now: new Date(start.getTime() + 11 * 60000) })).toBe(true)
    expect(listDevices(doc)).toHaveLength(1)
  })

  it('marks its writes, so the relay sends no notification for them', () => {
    const doc = familyDoc()
    const origins = []
    doc.on('update', (_update, origin) => origins.push(origin))
    recordDevice(doc, { id: 'dev-4', label: 'Mac · Chrome', now: new Date('2026-10-13T10:00:00Z') })
    expect(origins).toEqual([PRESENCE_ORIGIN])
  })

  it('lists devices with the most recent first', () => {
    const doc = familyDoc()
    recordDevice(doc, { id: 'a', label: 'Mac · Chrome', now: new Date('2026-10-13T08:00:00Z') })
    recordDevice(doc, { id: 'b', label: 'iPhone · Safari', now: new Date('2026-10-13T09:00:00Z') })
    expect(listDevices(doc).map((d) => d.id)).toEqual(['b', 'a'])
  })

  it('records this device on start, and on a timer', () => {
    const doc = familyDoc()
    const calls = []
    const timers = {
      setInterval: (fn) => { calls.push(fn); return calls.length },
      clearInterval: (t) => { calls.push(`cleared ${t}`) },
    }
    const stop = startPresence(doc, { id: 'dev-2', label: 'Mac · Chrome' }, { timers })
    expect(listDevices(doc)).toHaveLength(1)
    expect(typeof calls[0]).toBe('function')
    stop()
    expect(calls.at(-1)).toBe('cleared 1')
  })

  it('records as soon as the family arrives over sync', () => {
    const doc = new Y.Doc()
    const timers = { setInterval: () => 1, clearInterval: () => {} }
    const stop = startPresence(doc, { id: 'dev-3', label: 'Android · Chrome' }, { timers })
    expect(listDevices(doc)).toEqual([])
    doc.getMap('meta').set('schema_version', 1)
    expect(listDevices(doc).map((d) => d.label)).toEqual(['Android · Chrome'])
    stop()
  })
})

describe('which member is using a device', () => {
  it('records the member on the device record', () => {
    const doc = familyDoc()
    recordDevice(doc, { id: 'dev-5', label: 'iPhone · Safari', memberId: 'member-kit', now: new Date('2026-10-13T10:00:00Z') })
    expect(listDevices(doc)[0].member_id).toBe('member-kit')
  })

  it('records a member change at once, even within the ten minutes', () => {
    const doc = familyDoc()
    const start = new Date('2026-10-13T10:00:00Z')
    recordDevice(doc, { id: 'dev-6', label: 'Mac · Firefox', memberId: 'member-pat', now: start })
    expect(recordDevice(doc, { id: 'dev-6', label: 'Mac · Firefox', memberId: 'member-kit', now: new Date(start.getTime() + 60000) })).toBe(true)
    expect(listDevices(doc)[0].member_id).toBe('member-kit')
  })

  it('still skips an unchanged member within the ten minutes', () => {
    const doc = familyDoc()
    const start = new Date('2026-10-13T10:00:00Z')
    recordDevice(doc, { id: 'dev-7', label: 'Mac · Firefox', memberId: 'member-pat', now: start })
    expect(recordDevice(doc, { id: 'dev-7', label: 'Mac · Firefox', memberId: 'member-pat', now: new Date(start.getTime() + 60000) })).toBe(false)
  })

  it('refreshes the record straight away when asked, after a member is picked on the device', () => {
    const doc = familyDoc()
    let member = 'member-pat'
    const timers = { setInterval: () => 1, clearInterval: () => {} }
    const stop = startPresence(doc, { id: 'dev-8', label: 'iPhone · Safari', memberId: () => member }, { timers })
    expect(listDevices(doc)[0].member_id).toBe('member-pat')
    member = 'member-kit'
    refreshPresence()
    expect(listDevices(doc)[0].member_id).toBe('member-kit')
    stop()
  })
})

describe('how long ago a device synced', () => {
  it('reads as a short phrase', () => {
    const now = new Date('2026-10-13T12:00:00Z')
    expect(describeLastSeen('2026-10-13 11:59:40', now)).toBe('just now')
    expect(describeLastSeen('2026-10-13 11:45:00', now)).toBe('15 min ago')
    expect(describeLastSeen('2026-10-13 10:00:00', now)).toBe('2 hours ago')
    expect(describeLastSeen('2026-10-12 12:00:00', now)).toBe('1 day ago')
  })

  it('says unknown when there is no usable stamp', () => {
    expect(describeLastSeen(undefined)).toBe('unknown')
    expect(describeLastSeen('not a time')).toBe('unknown')
  })
})
