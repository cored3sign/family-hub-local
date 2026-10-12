// Keys and encryption for the family relay. The relay only ever sees
// ciphertext, a room id and a token hash. The family key never leaves the
// devices. Everything here is pure (no DOM, no IndexedDB), so Node tests can use it.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes, bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export const KEY_BYTES = 32
const NONCE_BYTES = 24

export function newFamilyKey() {
  return randomBytes(KEY_BYTES)
}

// One room per document, so the main data and the photos travel separately.
// The room id is derived from the key, so it can't be guessed without it.
export function deriveRoomId(key, docName) {
  return bytesToHex(hkdf(sha256, key, undefined, utf8ToBytes(`family-hub/room/${docName}`), 16))
}

// The token the relay checks on every connection. The relay stores only its hash.
export function deriveAuth(key) {
  return hkdf(sha256, key, undefined, utf8ToBytes('family-hub/relay-auth'), 32)
}

export function encryptBytes(key, plaintext) {
  const nonce = randomBytes(NONCE_BYTES)
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext)
  const out = new Uint8Array(NONCE_BYTES + ciphertext.length)
  out.set(nonce)
  out.set(ciphertext, NONCE_BYTES)
  return out
}

// null when the key is wrong or the bytes were changed.
export function decryptBytes(key, blob) {
  try {
    return xchacha20poly1305(key, blob.subarray(0, NONCE_BYTES)).decrypt(blob.subarray(NONCE_BYTES))
  } catch {
    return null
  }
}

export function toBase64Url(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function toBase64(bytes) {
  return toBase64Url(bytes).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(bytes.length / 3) * 4, '=')
}

export function fromBase64(text) {
  return fromBase64Url(text.replace(/\+/g, '-').replace(/\//g, '_'))
}
