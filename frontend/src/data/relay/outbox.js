// Our own changes that the relay hasn't confirmed yet. Kept in IndexedDB so a
// page that's closed or killed by the phone can still send them later.
const DB = 'family-hub-relay-outbox'
const STORE = 'entries'

export function openOutbox(indexedDB = globalThis.indexedDB) {
  let dbPromise = null
  const db = () =>
    (dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }))

  const run = async (mode, fn) => {
    const database = await db()
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, mode)
      const store = tx.objectStore(STORE)
      const result = fn(store)
      tx.oncomplete = () => resolve(result?.result)
      tx.onerror = () => reject(tx.error)
    })
  }

  return {
    async all(room) {
      const rows = await run('readonly', (store) => store.getAll())
      return (rows ?? []).filter((row) => row.room === room)
    },
    put(entry) {
      return run('readwrite', (store) => store.put(entry))
    },
    remove(id) {
      return run('readwrite', (store) => store.delete(id))
    },
  }
}

// In-memory stand-in for tests.
export function memoryOutbox() {
  const rows = new Map()
  return {
    async all(room) {
      return [...rows.values()].filter((row) => row.room === room)
    },
    async put(entry) {
      rows.set(entry.id, entry)
    },
    async remove(id) {
      rows.delete(id)
    },
  }
}
