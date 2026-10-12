import 'fake-indexeddb/auto'
import { describe, it, expect, afterEach } from 'vitest'
import { openFamily } from '../family'
import { insert } from '../collection'
import { memoryStorage } from '../testing'
import { loadHubConfig, saveHubConfig } from './config.js'
import { applyPairing } from './pairing.js'
import { wipeLocalFamily, deleteDatabase, WipeError } from './wipe.js'

const ROOM_A = 'r_' + 'A'.repeat(22)
const ROOM_B = 'r_' + 'B'.repeat(22)
const TOKEN = '1'.repeat(43)
const HUB = 'http://192.0.2.20:8787'
const oldConfig = { v: 1, hubUrl: HUB, roomId: ROOM_A, token: TOKEN, role: 'device', pairedAt: '2026-10-01 09:00:00' }

const open = []
afterEach(() => {
  while (open.length) open.pop().close()
})

// A raw connection that ignores versionchange, like another tab that
// won't let go: it blocks deleteDatabase until closed.
function holdOpen(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name)
    req.onsuccess = () => {
      open.push(req.result)
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

const exists = async (name) => (await indexedDB.databases()).some((d) => d.name === name)
const flush = () => new Promise((r) => setTimeout(r, 30))

async function seeded(prefix) {
  const names = { dbName: `${prefix}-main`, assetsDbName: `${prefix}-assets` }
  const fam = await openFamily(names)
  insert(fam.doc, 'shopping_items', { title: 'Old family', completed: false }, 'x')
  return { fam, names }
}

describe('wipeLocalFamily', () => {
  it('resolves only after both databases are deleted', async () => {
    const { fam, names } = await seeded('wipe-ok')
    await wipeLocalFamily({ current: fam, ...names })
    expect(await exists(names.dbName)).toBe(false)
    expect(await exists(names.assetsDbName)).toBe(false)
  })

  it('waits while blocked; applyPairing saves nothing until the delete completes', async () => {
    const { fam, names } = await seeded('wipe-blocked')
    const blocker = await holdOpen(names.dbName)
    const storage = memoryStorage()
    saveHubConfig(oldConfig, { storage })

    let settled = false
    const pairing = applyPairing({
      plan: 'confirm-replace',
      incoming: { roomId: ROOM_B, token: TOKEN },
      hubUrl: HUB,
      role: 'device',
      current: fam,
      storage,
      wipe: (o) => wipeLocalFamily({ ...o, ...names, blockedTimeoutMs: 5000 }),
    }).finally(() => (settled = true))

    await flush()
    expect(settled).toBe(false)
    expect(loadHubConfig({ storage }).roomId).toBe(ROOM_A)
    expect(await exists(names.dbName)).toBe(true)

    blocker.close()
    open.splice(open.indexOf(blocker), 1)
    await pairing
    expect(await exists(names.dbName)).toBe(false)
    expect(await exists(names.assetsDbName)).toBe(false)
    expect(loadHubConfig({ storage }).roomId).toBe(ROOM_B)
  })

  it('a delete that stays blocked rejects after the timeout and the config is not saved', async () => {
    const { fam, names } = await seeded('wipe-timeout')
    await holdOpen(names.dbName)
    const storage = memoryStorage()
    saveHubConfig(oldConfig, { storage })
    const err = await applyPairing({
      plan: 'confirm-replace',
      incoming: { roomId: ROOM_B, token: TOKEN },
      hubUrl: HUB,
      role: 'device',
      current: fam,
      storage,
      wipe: (o) => wipeLocalFamily({ ...o, ...names, blockedTimeoutMs: 50 }),
    }).catch((e) => e)
    expect(err).toBeInstanceOf(WipeError)
    expect(err.message).toMatch(/blocked/)
    expect(loadHubConfig({ storage })).toEqual(oldConfig)
  })

  it('a failing delete rejects', async () => {
    const failing = {
      deleteDatabase() {
        const req = {}
        setTimeout(() => {
          req.error = new Error('disk')
          req.onerror()
        })
        return req
      },
    }
    await expect(deleteDatabase('x', { indexedDB: failing })).rejects.toBeInstanceOf(WipeError)
    await expect(deleteDatabase('x', { indexedDB: null })).rejects.toBeInstanceOf(WipeError)
  })
})
