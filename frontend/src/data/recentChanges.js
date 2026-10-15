// Which records other family devices have just changed, as this device saw them. A tap on a phone's "New family
// update" notification uses this to open the place that changed (lib/pushOpen.js). Only the Yjs origin tells a
// change from another device apart from an edit made here or a load from this device's own saved copy, so the
// origins that carry other devices' changes are registered here.
import { RELAY_REMOTE_ORIGIN } from './origins.js'

const KEEP = 200
const remoteOrigins = new Set([RELAY_REMOTE_ORIGIN])
let changes = []

// The hub's sync connection applies other devices' changes with its own provider as the origin.
export function markRemoteOrigin(origin) {
  remoteOrigins.add(origin)
}

// Records the records changed in the given top-level collections when another device's change arrives.
export function watchRemoteChanges(doc, collections) {
  for (const name of collections) {
    const map = doc.getMap(name)
    map.observeDeep((events, transaction) => {
      if (!remoteOrigins.has(transaction.origin)) return
      const at = Date.now()
      const ids = new Set()
      for (const event of events) {
        // A change to a field of a record has a path that starts with the record's id; adding or removing a
        // record shows up as a changed key of the collection itself.
        const path = event.path
        if (path.length) ids.add(String(path[0]))
        else for (const key of event.keysChanged) ids.add(String(key))
      }
      for (const id of ids) {
        const row = map.get(id)
        const stamp = row ? (row.get('updated_at') ?? row.get('created_at') ?? '') : ''
        changes.push({ collection: name, id, at, stamp: String(stamp) })
      }
      if (changes.length > KEEP) changes = changes.slice(-KEEP)
    })
  }
}

// Changes from other devices, newest first: by when this device saw them, then by the record's own stamp (which
// orders a batch that arrived together).
export function recentRemoteChanges({ since = 0 } = {}) {
  return changes.filter((c) => c.at >= since).sort((a, b) => b.at - a.at || b.stamp.localeCompare(a.stamp))
}

// For tests: forget what has been seen.
export function forgetRemoteChanges() {
  changes = []
}
