import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { openFamily } from './family'
import { insert, get } from './collection'

describe('openFamily', () => {
  it('persists records across a close/reopen, i.e. a page reload', async () => {
    const opts = { dbName: 'reload-main', assetsDbName: 'reload-assets' }
    const first = await openFamily(opts)
    insert(first.doc, 'shopping_items', { title: 'Milk', completed: false }, 'item-1')
    first.assets.getMap('blobs').set('a1', new Uint8Array([1, 2, 3]))
    await first.destroy()

    const second = await openFamily(opts)
    expect(get(second.doc, 'shopping_items', 'item-1')).toMatchObject({ title: 'Milk', completed: false })
    expect(second.assets.getMap('blobs').get('a1')).toEqual(new Uint8Array([1, 2, 3]))
    await second.destroy()
  })

  it('persist: false gives throwaway in-memory docs', async () => {
    const f = await openFamily({ persist: false })
    expect(f.providers).toEqual([])
    await f.destroy()
  })
})
