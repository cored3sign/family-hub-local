// Pure protocol constants and helpers shared between the frontend and the
// hub server. No imports (not even yjs) so both sides can load this module
// with plain Node ESM resolution, with zero bundler-specific behavior.

export const CLOSE = { BAD_REQUEST: 4400, BAD_TOKEN: 4401, UNKNOWN_ROOM: 4404, ROOM_RETIRED: 4410 }

export const DOC_NAMES = ['main', 'assets']

export const roomName = (roomId, docName) => `${roomId}/${docName}`

// http(s) -> ws(s), same origin, fixed /sync path.
export const syncBaseUrl = (hubUrl) => hubUrl.replace(/^http/, 'ws') + '/sync'

// Formats: roomId is `r_` + 22 base64url chars; token is 43 base64url
// chars (256-bit).
const BASE64URL_22 = '[A-Za-z0-9_-]{22}'
const BASE64URL_43 = '[A-Za-z0-9_-]{43}'

export const isValidRoomId = (value) => typeof value === 'string' && new RegExp(`^r_${BASE64URL_22}$`).test(value)
export const isValidToken = (value) => typeof value === 'string' && new RegExp(`^${BASE64URL_43}$`).test(value)
