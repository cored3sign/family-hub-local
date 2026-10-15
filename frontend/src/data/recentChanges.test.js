import { describe, it, expect, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { insert } from './collection'
import { RELAY_REMOTE_ORIGIN } from './origins'
import { forgetRemoteChanges, markRemoteOrigin, recentRemoteChanges, watchRemoteChanges } from './recentChanges'

beforeEach(() => forgetRemoteChanges())

function docWatching(...names) {
  const doc = new Y.Doc()
  watchRemoteChanges(doc, names)
  return doc
}

describe('remote changes', () => {
  it('records what another device added or edited, and not this device\'s own writes', () => {
    const doc = docWatching('todos')
    insert(doc, 'todos', { title: 'Mine' }, 'local-1')
    doc.transact(() => insert(doc, 'todos', { title: 'Theirs' }, 'remote-1'), RELAY_REMOTE_ORIGIN)
    expect(recentRemoteChanges()).toEqual([expect.objectContaining({ collection: 'todos', id: 'remote-1' })])

    doc.transact(() => doc.getMap('todos').get('remote-1').set('title', 'Edited'), RELAY_REMOTE_ORIGIN)
    expect(recentRemoteChanges().map((c) => c.id)).toEqual(['remote-1', 'remote-1'])
  })

  it('a load from this device\'s own saved copy is not a change from another device', () => {
    const doc = docWatching('todos')
    const savedCopy = {}
    doc.transact(() => insert(doc, 'todos', { title: 'Saved' }, 'saved-1'), savedCopy)
    expect(recentRemoteChanges()).toEqual([])
  })

  it('watches only the collections it is given', () => {
    const doc = docWatching('todos')
    doc.transact(() => insert(doc, 'shopping_items', { title: 'Milk' }, 'milk'), RELAY_REMOTE_ORIGIN)
    expect(recentRemoteChanges()).toEqual([])
  })

  it('the newest comes first: by the record\'s own stamp when a batch arrived together', () => {
    const doc = docWatching('chores')
    doc.transact(() => {
      insert(doc, 'chores', { title: 'Older', updated_at: '2026-10-15 08:00:00' }, 'older')
      insert(doc, 'chores', { title: 'Newer', updated_at: '2026-10-15 09:30:00' }, 'newer')
    }, RELAY_REMOTE_ORIGIN)
    expect(recentRemoteChanges().map((c) => c.id)).toEqual(['newer', 'older'])
  })

  it('a change since a given time leaves out the earlier ones', () => {
    const doc = docWatching('goals')
    doc.transact(() => insert(doc, 'goals', { title: 'Old' }, 'old'), RELAY_REMOTE_ORIGIN)
    const since = Date.now() + 1
    expect(recentRemoteChanges({ since })).toEqual([])
    doc.transact(() => insert(doc, 'goals', { title: 'New' }, 'new'), RELAY_REMOTE_ORIGIN)
    expect(recentRemoteChanges({ since: 0 })).toHaveLength(2)
  })

  it('an origin registered for the hub\'s sync counts as another device', () => {
    const doc = docWatching('wishlist_items')
    const hubProvider = {}
    markRemoteOrigin(hubProvider)
    doc.transact(() => insert(doc, 'wishlist_items', { title: 'Bike' }, 'bike'), hubProvider)
    expect(recentRemoteChanges()).toEqual([expect.objectContaining({ collection: 'wishlist_items', id: 'bike' })])
  })

  it('a record that another device removed is still recorded, so its page can be opened', () => {
    const doc = docWatching('todos')
    insert(doc, 'todos', { title: 'Gone soon' }, 'gone')
    doc.transact(() => doc.getMap('todos').delete('gone'), RELAY_REMOTE_ORIGIN)
    expect(recentRemoteChanges()).toEqual([expect.objectContaining({ id: 'gone' })])
  })
})
