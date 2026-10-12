// Deletes this device's family data: both IndexedDB databases (main doc and
// asset doc). Room-binding invariant: anything that changes config.roomId
// calls this first (via applyPairing), so one room's state never reaches
// another.
//
// Resolves only once BOTH deletes have completed; rejects if either fails
// or stays blocked (another tab, or an open connection in this one) past
// blockedTimeoutMs. y-indexeddb's clearData() is not used: it fires the
// delete without awaiting it.
//
// The caller passes `current` (the open family, which is destroyed here so
// its connections don't block the delete) and must reload the page
// afterwards -- the app's docs are gone.
import { DB_NAME, ASSETS_DB_NAME } from '../family'

export const WIPE_BLOCKED_TIMEOUT_MS = 5000

export class WipeError extends Error {
  constructor(message, { cause } = {}) {
    super(message)
    this.name = 'WipeError'
    if (cause) this.cause = cause
  }
}

export function deleteDatabase(name, { indexedDB = globalThis.indexedDB, blockedTimeoutMs = WIPE_BLOCKED_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new WipeError('IndexedDB is not available'))
    let timer = null
    let req
    try {
      req = indexedDB.deleteDatabase(name)
    } catch (cause) {
      return reject(new WipeError(`Could not delete ${name}`, { cause }))
    }
    const done = (fn) => {
      clearTimeout(timer)
      timer = null
      fn()
    }
    req.onsuccess = () => done(resolve)
    req.onerror = () => done(() => reject(new WipeError(`Could not delete ${name}`, { cause: req.error })))
    // Blocked: keep waiting for success (the other connection may close),
    // but not forever. Never resolve early.
    req.onblocked = () => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        reject(new WipeError(`Deleting ${name} is blocked; close other Yggltree tabs and try again`))
      }, blockedTimeoutMs)
    }
  })
}

export async function wipeLocalFamily({ current = null, dbName = DB_NAME, assetsDbName = ASSETS_DB_NAME, indexedDB, blockedTimeoutMs } = {}) {
  if (current) await current.destroy()
  for (const name of [dbName, assetsDbName]) await deleteDatabase(name, { indexedDB, blockedTimeoutMs })
}
