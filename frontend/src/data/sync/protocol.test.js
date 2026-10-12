import { describe, it, expect } from 'vitest'
import { CLOSE, DOC_NAMES, roomName, syncBaseUrl, isValidRoomId, isValidToken } from './protocol.js'

const CODE = 'AbCdEfGhIjKlMnOpQrStUv' // 22 base64url chars
const ROOM_ID = 'r_AbCdEfGhIjKlMnOpQrStUv'
const TOKEN = 'A'.repeat(43)

describe('protocol constants', () => {
  it('exposes close codes', () => {
    expect(CLOSE).toEqual({ BAD_REQUEST: 4400, BAD_TOKEN: 4401, UNKNOWN_ROOM: 4404, ROOM_RETIRED: 4410 })
  })

  it('exposes the two doc names', () => {
    expect(DOC_NAMES).toEqual(['main', 'assets'])
  })

  it('builds a room name from roomId and docName', () => {
    expect(roomName(ROOM_ID, 'main')).toBe(`${ROOM_ID}/main`)
  })

  it('derives a ws sync base url from an http(s) hub url', () => {
    expect(syncBaseUrl('http://192.0.2.20:8787')).toBe('ws://192.0.2.20:8787/sync')
    expect(syncBaseUrl('https://a.example.com')).toBe('wss://a.example.com/sync')
  })
})

describe('regex validators', () => {
  it('validates room ids', () => {
    expect(isValidRoomId(ROOM_ID)).toBe(true)
    expect(isValidRoomId('not-a-room-id')).toBe(false)
    expect(isValidRoomId('r_tooshort')).toBe(false)
  })

  it('validates tokens', () => {
    expect(isValidToken(TOKEN)).toBe(true)
    expect(isValidToken('short')).toBe(false)
    expect(isValidToken(TOKEN + '.')).toBe(false)
  })

})

