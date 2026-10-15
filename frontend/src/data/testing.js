// Test-only helpers. Never imported by app code.
import * as Y from 'yjs'
import { setUpFamily } from './schema'
import { addMember, actorFor } from './members'

export function forkDoc(doc) {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  return copy
}

// Two-way exchange of missing updates -- what the sync provider does,
// done by hand so tests can simulate concurrent devices.
export function syncDocs(a, b) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

export function newFamilyDoc() {
  const doc = new Y.Doc()
  const adminId = setUpFamily(doc, { familyName: 'Test Family', adminName: 'Pat Parent' })
  const kidId = addMember(doc, { name: 'Kit Kid' })
  return { doc, admin: actorFor(doc, adminId), kid: actorFor(doc, kidId) }
}

// In-memory stand-in for window.localStorage (the Storage methods the sync
// config uses), so Node tests can inject it.
export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    get length() {
      return map.size
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
  }
}
