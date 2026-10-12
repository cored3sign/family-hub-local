// Pure backup-format logic shared between the frontend and the hub server
// (POST /api/hub/restore validates an uploaded backup with the same
// parseBackup() the frontend uses). Imports only yjs, with explicit .js
// relative extensions, so plain Node ESM resolution (no bundler) works on
// the hub side too.
import * as Y from 'yjs'

export const BACKUP_FORMAT = 'family-hub-backup'
const NOT_A_BACKUP = 'That file is not a Yggltree backup'

// Same naive-UTC "YYYY-MM-DD HH:MM:SS" shape as data/time.js's nowStamp --
// duplicated here (not imported) so this module's only dependency is yjs.
function formatStamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export function toBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function fromBase64(text) {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

// Same logic as schema.js's isSetUp -- duplicated here rather than imported
// so backupFormat.js stays dependency-free (schema.js pulls in collection.js,
// members.js, settings.js, none of which belong on the hub).
export function hasFamily(doc) {
  return doc.getMap('meta').get('schema_version') != null
}

// Full-fidelity backup: the complete Yjs state of both docs (history
// included), so a restore is exact.
export function createBackup({ doc, assets }, now = new Date()) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: 1,
    exported_at: formatStamp(now),
    main: toBase64(Y.encodeStateAsUpdate(doc)),
    assets: toBase64(Y.encodeStateAsUpdate(assets)),
  })
}

export function parseBackup(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(NOT_A_BACKUP)
  }
  if (data?.format !== BACKUP_FORMAT || data.version !== 1 || typeof data.main !== 'string') throw new Error(NOT_A_BACKUP)
  const main = fromBase64(data.main)
  const assets = typeof data.assets === 'string' ? fromBase64(data.assets) : Y.encodeStateAsUpdate(new Y.Doc())
  const probe = new Y.Doc()
  Y.applyUpdate(probe, main)
  if (!hasFamily(probe)) throw new Error('That backup has no family in it')
  return { main, assets }
}
