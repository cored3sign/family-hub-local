import { describe, it, expect, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { putAsset, getAsset, removeAsset, waitersForTests } from './assets'

describe('asset store', () => {
  it('round-trips bytes and removes them', () => {
    const assets = new Y.Doc()
    const id = putAsset(assets, new Uint8Array([9, 8, 7]), 'image/jpeg')
    expect(getAsset(assets, id)).toEqual({ mime: 'image/jpeg', data: new Uint8Array([9, 8, 7]) })
    removeAsset(assets, id)
    expect(getAsset(assets, id)).toBe(null)
    expect(getAsset(assets, null)).toBe(null)
  })

  it('mutating the array passed to putAsset does not change getAsset result', () => {
    const assets = new Y.Doc()
    const original = new Uint8Array([1, 2, 3])
    const id = putAsset(assets, original, 'image/jpeg')
    // Mutate the original array after storing it
    original[0] = 99
    // getAsset should return the original values, not the mutation
    expect(getAsset(assets, id)).toEqual({ mime: 'image/jpeg', data: new Uint8Array([1, 2, 3]) })
  })

  it('mutating the array returned by getAsset does not change a second getAsset call', () => {
    const assets = new Y.Doc()
    const id = putAsset(assets, new Uint8Array([4, 5, 6]), 'image/jpeg')
    const first = getAsset(assets, id)
    // Mutate the returned data
    first.data[0] = 88
    // A second call should return unmodified data
    expect(getAsset(assets, id)).toEqual({ mime: 'image/jpeg', data: new Uint8Array([4, 5, 6]) })
  })

  it('putAsset produces exactly one update event on the assets doc', () => {
    const assets = new Y.Doc()
    const updateCount = []
    assets.on('update', () => {
      updateCount.push(1)
    })
    const id = putAsset(assets, new Uint8Array([7, 8, 9]), 'image/jpeg')
    expect(updateCount.length).toBe(1)
  })
})

describe('reactive assetUrl', () => {
  // The waiters map is module state: each test starts from an empty one.
  beforeEach(() => waitersForTests().clear())

  it('a computed is null until the bytes sync in, then a blob: URL; only that waiter fires and the map empties', async () => {
    const { computed } = await import('vue')
    const { assetUrl, waitersForTests } = await import('./assets')
    const { forkDoc, syncDocs } = await import('./testing')
    const here = new Y.Doc()
    const there = forkDoc(here)
    const otherId = 'not-yet-' + Math.random()

    const idHolder = {}
    let runsA = 0
    let runsB = 0
    const urlA = computed(() => {
      runsA++
      return idHolder.id ? assetUrl(idHolder.id, here) : null
    })
    const urlB = computed(() => {
      runsB++
      return assetUrl(otherId, here)
    })

    // The asset is created on the other device; its id is known here first
    // (the record referencing it arrived in the main doc).
    idHolder.id = putAsset(there, new Uint8Array([1, 2, 3]), 'image/png')
    expect(urlA.value).toBe(null)
    expect(urlB.value).toBe(null)
    expect(waitersForTests().size).toBe(2)
    expect(runsA).toBe(1)
    expect(runsB).toBe(1)

    syncDocs(there, here)

    expect(urlA.value).toMatch(/^blob:/)
    expect(runsA).toBe(2)
    // B's waiter was not bumped: its computed stays cached.
    expect(urlB.value).toBe(null)
    expect(runsB).toBe(1)
    expect(waitersForTests().has(idHolder.id)).toBe(false)
    expect(waitersForTests().has(otherId)).toBe(true)

    // B's bytes arrive too: the map is empty afterwards.
    const bId = putAsset(there, new Uint8Array([4]), 'image/png')
    const urlC = computed(() => assetUrl(bId, here))
    expect(urlC.value).toBe(null)
    syncDocs(there, here)
    expect(urlC.value).toMatch(/^blob:/)
    there.getMap('blobs').set(otherId, there.getMap('blobs').get(bId).clone())
    syncDocs(there, here)
    expect(urlB.value).toMatch(/^blob:/)
    expect(runsB).toBe(2)
    expect(waitersForTests().size).toBe(0)
  })

  it('a cached URL is returned without creating a waiter', async () => {
    const { assetUrl, waitersForTests } = await import('./assets')
    const assets = new Y.Doc()
    const id = putAsset(assets, new Uint8Array([5]), 'image/png')
    const url = assetUrl(id, assets)
    expect(url).toMatch(/^blob:/)
    expect(assetUrl(id, assets)).toBe(url)
    expect(waitersForTests().has(id)).toBe(false)
  })

  it('a remote removal revokes and evicts the cached URL', async () => {
    const { assetUrl } = await import('./assets')
    const { forkDoc, syncDocs } = await import('./testing')
    const here = new Y.Doc()
    const id = putAsset(here, new Uint8Array([7, 7]), 'image/png')
    const there = forkDoc(here)
    const url = assetUrl(id, here)
    expect(url).toMatch(/^blob:/)

    const revoked = []
    const original = URL.revokeObjectURL
    URL.revokeObjectURL = (u) => {
      revoked.push(u)
      return original.call(URL, u)
    }
    try {
      // Delete on the other device directly (removeAsset would also clear
      // this process's shared cache, which a real remote device can't).
      there.getMap('blobs').delete(id)
      syncDocs(there, here)
    } finally {
      URL.revokeObjectURL = original
    }
    expect(revoked).toEqual([url])
    expect(assetUrl(id, here)).toBe(null)
  })
})
