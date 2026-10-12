import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { CLOSE, DOC_NAMES, roomName, syncBaseUrl } from '../../frontend/src/data/sync/protocol.js'
import { BACKUP_FORMAT, hasFamily, toBase64, fromBase64, createBackup, parseBackup } from '../../frontend/src/data/backupFormat.js'

// Confirms the hub can import the frontend's shared pure modules through
// plain Node ESM resolution (no bundler, no Vite-only import) -- the whole
// point of keeping protocol.js and backupFormat.js dependency-free.
describe('shared modules import cleanly under Node ESM', () => {
  it('protocol.js exports the expected shapes', () => {
    expect(CLOSE).toEqual({ BAD_REQUEST: 4400, BAD_TOKEN: 4401, UNKNOWN_ROOM: 4404, ROOM_RETIRED: 4410 })
    expect(DOC_NAMES).toEqual(['main', 'assets'])
    expect(roomName('r_123', 'main')).toBe('r_123/main')
    expect(syncBaseUrl('https://a.example.com')).toBe('wss://a.example.com/sync')
  })

  it('backupFormat.js round-trips a backup using only yjs', () => {
    const doc = new Y.Doc()
    doc.getMap('meta').set('schema_version', 1)
    expect(hasFamily(doc)).toBe(true)
    const assets = new Y.Doc()
    const text = createBackup({ doc, assets })
    const data = JSON.parse(text)
    expect(data.format).toBe(BACKUP_FORMAT)
    const parsed = parseBackup(text)
    const doc2 = new Y.Doc()
    Y.applyUpdate(doc2, parsed.main)
    expect(hasFamily(doc2)).toBe(true)
    expect(toBase64(fromBase64(toBase64(new Uint8Array([1, 2, 3]))))).toBe(toBase64(new Uint8Array([1, 2, 3])))
  })

  it('parseBackup rejects a backup with no family in it, same as the frontend', () => {
    const empty = createBackup({ doc: new Y.Doc(), assets: new Y.Doc() })
    expect(() => parseBackup(empty)).toThrow('That backup has no family in it')
  })
})
