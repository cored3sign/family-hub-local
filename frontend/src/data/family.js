import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { COLLECTIONS } from './schema'
import { watchRemoteChanges } from './recentChanges'

export const DB_NAME = 'family-hub'
export const ASSETS_DB_NAME = 'family-hub-assets'

// Two docs, by design: the main doc holds every record
// and stays small and fast to load; image bytes live in their own doc so
// they never delay the family's data. Both persist to IndexedDB, so
// every read/write is local first and the network only syncs.
export async function openFamily({ persist = true, dbName = DB_NAME, assetsDbName = ASSETS_DB_NAME } = {}) {
  const doc = new Y.Doc()
  const assets = new Y.Doc()
  const providers = persist
    ? [new IndexeddbPersistence(dbName, doc), new IndexeddbPersistence(assetsDbName, assets)]
    : []
  await Promise.all(providers.map((p) => p.whenSynced))
  return {
    doc,
    assets,
    providers,
    async destroy() {
      await Promise.all(providers.map((p) => p.destroy()))
      doc.destroy()
      assets.destroy()
    },
  }
}

let current = null

export async function initFamily(opts) {
  current = await openFamily(opts)
  // Before any sync delivers changes, so the first batch from another device is seen.
  watchRemoteChanges(current.doc, COLLECTIONS)
  return current
}

export function family() {
  if (!current) throw new Error('initFamily() must finish before the app reads family data')
  return current
}

export function setFamilyForTests(value) {
  current = value
}
