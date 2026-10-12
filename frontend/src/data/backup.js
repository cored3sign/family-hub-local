import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { DB_NAME, ASSETS_DB_NAME } from './family'
import { COLLECTIONS } from './schema'
import { getSettings } from './settings'
import { all } from './collection'
import { nowStamp } from './time'
import { BACKUP_FORMAT, createBackup, parseBackup } from './backupFormat.js'

// createBackup/parseBackup/BACKUP_FORMAT now live in backupFormat.js (pure,
// yjs-only) so the hub server can share them for POST /api/hub/restore.
export { BACKUP_FORMAT, createBackup, parseBackup }

// Replaces this device's stored data with the backup. The caller reloads
// the page afterward. Because devices sync, a restore must also move to a
// fresh room, or peers will merge the old state straight back in.
export async function restoreBackup({ main, assets }, { current = null, dbName = DB_NAME, assetsDbName = ASSETS_DB_NAME } = {}) {
  if (current) await current.destroy() // close live connections so the DBs can be deleted
  for (const [name, update] of [[dbName, main], [assetsDbName, assets]]) {
    await new IndexeddbPersistence(name, new Y.Doc()).clearData()
    const fresh = new Y.Doc()
    Y.applyUpdate(fresh, update)
    // y-indexeddb stores a doc's existing state when it first attaches.
    const provider = new IndexeddbPersistence(name, fresh)
    await provider.whenSynced
    await provider.destroy()
    fresh.destroy()
  }
}

// Human-readable JSON export.
export function exportJson(doc) {
  return {
    format: 'family-hub-export',
    exported_at: nowStamp(),
    settings: getSettings(doc),
    collections: Object.fromEntries(COLLECTIONS.map((name) => [name, all(doc, name)])),
  }
}
