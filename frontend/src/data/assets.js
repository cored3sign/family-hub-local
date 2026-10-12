import * as Y from 'yjs'
import { shallowRef } from 'vue'
import { newId } from './ids'
import { nowStamp } from './time'
import { family } from './family'

// Image bytes live in the separate asset doc, keyed by
// id; records in the main doc only hold the id (avatar_asset_id,
// photo_asset_id, image_asset_id).
const BLOBS = 'blobs'
const urlCache = new Map()

export function putAsset(assets, bytes, mime) {
  const id = newId()
  const entry = new Y.Map()
  assets.transact(() => {
    assets.getMap(BLOBS).set(id, entry)
    entry.set('mime', mime)
    entry.set('data', new Uint8Array(bytes))
    entry.set('created_at', nowStamp())
  })
  return id
}

export function getAsset(assets, id) {
  const entry = id ? assets.getMap(BLOBS).get(id) : undefined
  return entry ? { mime: entry.get('mime'), data: new Uint8Array(entry.get('data')) } : null
}

export function removeAsset(assets, id) {
  if (!id) return
  assets.getMap(BLOBS).delete(id)
  evict(id)
}

// Reactivity for bytes that arrive after the record referencing them (the
// asset doc syncs separately from the main doc). A caller that asked for a
// missing id reads that id's waiter, so its effect (computed / render)
// tracks it; when the id's key changes in the blobs map the waiter is
// bumped once and deleted. The map only holds ids someone is waiting on
// right now, so it never grows without bound. Cached URLs are not tracked.
const waiters = new Map() // id -> ShallowRef<number>
const observed = new WeakSet() // asset docs whose blobs map is observed

function waiterFor(id) {
  let w = waiters.get(id)
  if (!w) {
    w = shallowRef(0)
    waiters.set(id, w)
  }
  return w
}

function evict(id) {
  const url = urlCache.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(id)
  }
}

function observe(assets) {
  if (observed.has(assets)) return
  observed.add(assets)
  const blobs = assets.getMap(BLOBS)
  blobs.observe((event) => {
    for (const id of event.keysChanged) {
      // Deleted (here or on another device): the object URL is dead.
      if (!blobs.has(id)) evict(id)
      const w = waiters.get(id)
      if (w) {
        waiters.delete(id)
        w.value++
      }
    }
  })
}

// Test-only: the live waiters map.
export function waitersForTests() {
  return waiters
}

// Returns null until the bytes are present (they may arrive after the
// record that references them); the calling effect re-runs when they do.
// Callers fall back to initials or a placeholder (AssetImage) for null.
export function assetUrl(id, assets = family().assets) {
  if (!id) return null
  if (urlCache.has(id)) return urlCache.get(id)
  observe(assets)
  const asset = getAsset(assets, id)
  if (!asset) {
    void waiterFor(id).value // tracked by the calling effect
    return null
  }
  const url = URL.createObjectURL(new Blob([asset.data], { type: asset.mime }))
  urlCache.set(id, url)
  return url
}

// Downscale on-device so the doc stays small (target: <= maxDim px, JPEG).
// White background first so transparent PNGs don't turn black.
export async function resizeImage(file, maxDim = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process that image'))), 'image/jpeg', quality),
  )
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' }
}

export async function putImageFile(assets, file, { maxDim = 1600 } = {}) {
  if (!file?.type?.startsWith('image/')) throw new Error('Unsupported image type')
  const { bytes, mime } = await resizeImage(file, maxDim)
  return putAsset(assets, bytes, mime)
}
