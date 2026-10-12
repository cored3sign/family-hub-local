import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { all, get, insert, patch, remove, removeWhere, nextSortOrder, blankToNull, requireText, toIntOrNull } from './collection'
import { forkDoc, syncDocs } from './testing'

describe('collection helpers', () => {
  it('stores each record as a nested Y.Map with id and timestamps', () => {
    const doc = new Y.Doc()
    const id = insert(doc, 'things', { title: 'Milk', note: undefined })
    const raw = doc.getMap('things').get(id)
    expect(raw).toBeInstanceOf(Y.Map)
    const row = get(doc, 'things', id)
    expect(row).toMatchObject({ id, title: 'Milk', note: null })
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('patch only writes changed keys and reports missing records', () => {
    const doc = new Y.Doc()
    const id = insert(doc, 'things', { title: 'Milk', done: false })
    let updates = 0
    doc.on('update', () => updates++)
    expect(patch(doc, 'things', id, { title: 'Milk' })).toBe(true)
    expect(updates).toBe(0)
    patch(doc, 'things', id, { done: true })
    expect(get(doc, 'things', id).done).toBe(true)
    expect(patch(doc, 'things', 'nope', { done: true })).toBe(false)
  })

  it('merges concurrent edits to different fields of one record', () => {
    const a = new Y.Doc()
    const id = insert(a, 'things', { title: 'Milk', store: null })
    const b = forkDoc(a)
    patch(a, 'things', id, { title: 'Oat milk' })
    patch(b, 'things', id, { store: 'Costco' })
    syncDocs(a, b)
    expect(get(a, 'things', id)).toMatchObject({ title: 'Oat milk', store: 'Costco' })
    expect(get(b, 'things', id)).toMatchObject({ title: 'Oat milk', store: 'Costco' })
  })

  it('returns deep copies so callers cannot mutate the doc by accident', () => {
    const doc = new Y.Doc()
    const id = insert(doc, 'things', { tags: ['a'] })
    get(doc, 'things', id).tags.push('b')
    expect(get(doc, 'things', id).tags).toEqual(['a'])
  })

  it('remove, removeWhere, nextSortOrder and all', () => {
    const doc = new Y.Doc()
    insert(doc, 'things', { kind: 'x', sort_order: 0 }, 't1')
    insert(doc, 'things', { kind: 'x', sort_order: 4 }, 't2')
    insert(doc, 'things', { kind: 'y', sort_order: 9 }, 't3')
    expect(nextSortOrder(doc, 'things', (r) => r.kind === 'x')).toBe(5)
    expect(removeWhere(doc, 'things', (r) => r.kind === 'x')).toBe(2)
    expect(remove(doc, 'things', 't3')).toBe(true)
    expect(remove(doc, 'things', 't3')).toBe(false)
    expect(all(doc, 'things')).toEqual([])
    expect(nextSortOrder(doc, 'things')).toBe(0)
  })

  it('text helpers', () => {
    expect(blankToNull('  ')).toBe(null)
    expect(blankToNull(' a ')).toBe('a')
    expect(() => requireText(' ', 'title is required')).toThrow('title is required')
    expect(toIntOrNull('')).toBe(null)
    expect(toIntOrNull('12')).toBe(12)
    expect(toIntOrNull('abc')).toBe(null)
  })
})
