import * as Y from 'yjs'
import { newId } from './ids'
import { nowStamp } from './time'

// Every collection is a top-level Y.Map of id -> nested Y.Map (one key per
// field), so two devices editing different fields of one record
// merge instead of one whole-object write clobbering the other.

export function table(doc, name) {
  return doc.getMap(name)
}

// JSON round-trip on the way in and out: callers (Vue forms) can mutate what
// they get back without silently mutating Yjs' internal content, and Vue
// reactive proxies passed in are flattened to plain data.
export function copyJson(value) {
  return value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
}

function clean(value) {
  return value === undefined ? null : copyJson(value)
}

function same(a, b) {
  if (a === b) return true
  return a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b)
}

function toRow(ymap) {
  return copyJson(ymap.toJSON())
}

export function all(doc, name) {
  return [...table(doc, name).values()].map(toRow)
}

export function get(doc, name, id) {
  const ymap = id == null ? undefined : table(doc, name).get(id)
  return ymap ? toRow(ymap) : null
}

export function insert(doc, name, fields, id = newId()) {
  doc.transact(() => {
    const ymap = new Y.Map()
    table(doc, name).set(id, ymap)
    const stamp = nowStamp()
    for (const [key, value] of Object.entries({ created_at: stamp, updated_at: stamp, ...fields, id })) {
      ymap.set(key, clean(value))
    }
  })
  return id
}

export function patch(doc, name, id, fields) {
  const ymap = table(doc, name).get(id)
  if (!ymap) return false
  doc.transact(() => {
    let changed = false
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'id' || key === 'created_at') continue
      const next = clean(value)
      if (!same(ymap.get(key), next)) {
        ymap.set(key, next)
        changed = true
      }
    }
    if (changed) ymap.set('updated_at', nowStamp())
  })
  return true
}

export function remove(doc, name, id) {
  const map = table(doc, name)
  if (!map.has(id)) return false
  map.delete(id)
  return true
}

export function removeWhere(doc, name, pred) {
  const map = table(doc, name)
  const ids = [...map.entries()].filter(([, ymap]) => pred(toRow(ymap))).map(([id]) => id)
  doc.transact(() => ids.forEach((id) => map.delete(id)))
  return ids.length
}

export function nextSortOrder(doc, name, pred = () => true) {
  let max = -1
  for (const row of all(doc, name)) {
    if (pred(row) && typeof row.sort_order === 'number' && row.sort_order > max) max = row.sort_order
  }
  return max + 1
}

export function blankToNull(value) {
  const text = value == null ? '' : String(value).trim()
  return text === '' ? null : text
}

export function requireText(value, message) {
  const text = blankToNull(value)
  if (text === null) throw new Error(message)
  return text
}

export function toIntOrNull(value) {
  if (value === '' || value == null) return null
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? null : n
}

export function byText(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base' })
}
