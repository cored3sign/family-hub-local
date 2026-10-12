// Daily hub backups: unit tests on createBackups with real docs and
// an injected clock, plus startup/interval/close wiring in a real hub.
import { describe, it, expect, afterEach } from 'vitest'
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import * as Y from 'yjs'
import { parseBackup } from '../../frontend/src/data/backupFormat.js'
import { createBackups, backupFileName } from '../src/backups.js'
import { createFixtures, waitFor, onceSynced, delay } from './helpers.js'

const fx = createFixtures()
afterEach(() => fx.cleanup())

const DAY = 24 * 60 * 60 * 1000
// Local noon, so the local calendar date is stable whatever the TZ.
const T0 = new Date(2026, 9, 7, 12, 0, 0).getTime()

function familyDocs() {
  const doc = new Y.Doc()
  doc.getMap('meta').set('schema_version', 1)
  doc.getMap('m').set('k', 'v1')
  const assets = new Y.Doc()
  return { doc, assets }
}

async function backupFiles(dataDir) {
  try {
    return (await readdir(join(dataDir, 'backups'))).filter((f) => f.endsWith('.fhub.json')).sort()
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

describe('backupFileName', () => {
  it('uses the local calendar date', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe('yggltree-2026-01-05.fhub.json')
  })
})

describe('createBackups', () => {
  it('writes a parseable backup of both docs when they changed, and skips when unchanged', async () => {
    const dataDir = await fx.tmpDir()
    const docs = familyDocs()
    docs.assets.getMap('blobs').set('p', 'bytes')
    let t = T0
    const backups = createBackups({ dataDir, getDocs: async () => docs, now: () => t, log: fx.quietLog })

    expect(await backups.runOnce()).toEqual({ written: 'yggltree-2026-10-07.fhub.json' })
    const parsed = parseBackup(await readFile(join(dataDir, 'backups', 'yggltree-2026-10-07.fhub.json'), 'utf8'))
    const restored = new Y.Doc()
    Y.applyUpdate(restored, parsed.main)
    expect(restored.getMap('m').get('k')).toBe('v1')
    const restoredAssets = new Y.Doc()
    Y.applyUpdate(restoredAssets, parsed.assets)
    expect(restoredAssets.getMap('blobs').get('p')).toBe('bytes')

    t += DAY
    expect(await backups.runOnce()).toEqual({ skipped: 'unchanged' })
    expect(await backupFiles(dataDir)).toEqual(['yggltree-2026-10-07.fhub.json'])

    // A change in either doc counts.
    docs.assets.getMap('blobs').set('q', 'more')
    expect(await backups.runOnce()).toEqual({ written: 'yggltree-2026-10-08.fhub.json' })
    t += DAY
    docs.doc.getMap('m').set('k', 'v2')
    expect(await backups.runOnce()).toEqual({ written: 'yggltree-2026-10-09.fhub.json' })
    expect(await backupFiles(dataDir)).toHaveLength(3)
  })

  it('notices a delete-only change (the state vector alone would not)', async () => {
    const dataDir = await fx.tmpDir()
    const docs = familyDocs()
    let t = T0
    const backups = createBackups({ dataDir, getDocs: async () => docs, now: () => t, log: fx.quietLog })
    await backups.runOnce()
    t += DAY
    docs.doc.getMap('m').delete('k')
    expect(await backups.runOnce()).toEqual({ written: 'yggltree-2026-10-08.fhub.json' })
  })

  it('remembers the last backup across restarts, but writes again if that file is gone', async () => {
    const dataDir = await fx.tmpDir()
    const docs = familyDocs()
    let t = T0
    await createBackups({ dataDir, getDocs: async () => docs, now: () => t, log: fx.quietLog }).runOnce()
    t += DAY
    const restarted = createBackups({ dataDir, getDocs: async () => docs, now: () => t, log: fx.quietLog })
    expect(await restarted.runOnce()).toEqual({ skipped: 'unchanged' })

    const { rm } = await import('node:fs/promises')
    await rm(join(dataDir, 'backups', 'yggltree-2026-10-07.fhub.json'))
    expect(await restarted.runOnce()).toEqual({ written: 'yggltree-2026-10-08.fhub.json' })
  })

  it('skips a room with no family', async () => {
    const dataDir = await fx.tmpDir()
    const backups = createBackups({ dataDir, getDocs: async () => null, now: () => T0, log: fx.quietLog })
    expect(await backups.runOnce()).toEqual({ skipped: 'no-family' })
    expect(await backupFiles(dataDir)).toEqual([])
  })

  it('keeps only the newest 14 backup files and leaves other files alone', async () => {
    const dataDir = await fx.tmpDir()
    await mkdir(join(dataDir, 'backups'), { recursive: true })
    for (let i = 1; i <= 16; i++) {
      await writeFile(join(dataDir, 'backups', `yggltree-2026-09-${String(i).padStart(2, '0')}.fhub.json`), '{}')
    }
    await writeFile(join(dataDir, 'backups', 'notes.txt'), 'keep me')
    const backups = createBackups({ dataDir, getDocs: async () => familyDocs(), now: () => T0, log: fx.quietLog })
    await backups.runOnce()
    const files = await backupFiles(dataDir)
    expect(files).toHaveLength(14)
    expect(files[files.length - 1]).toBe('yggltree-2026-10-07.fhub.json')
    expect(files[0]).toBe('yggltree-2026-09-04.fhub.json')
    expect(await readFile(join(dataDir, 'backups', 'notes.txt'), 'utf8')).toBe('keep me')
  })

  it('start() runs now and on the interval; stop() clears the timer and waits for a running backup', async () => {
    const dataDir = await fx.tmpDir()
    const docs = familyDocs()
    let t = T0
    let calls = 0
    const backups = createBackups({
      dataDir,
      getDocs: async () => {
        calls++
        return docs
      },
      now: () => t,
      intervalMs: 20,
      log: fx.quietLog,
    })
    backups.start()
    await waitFor(() => calls >= 3)
    await backups.stop()
    const after = calls
    await delay(80)
    expect(calls).toBe(after)
    expect(await backupFiles(dataDir)).toEqual(['yggltree-2026-10-07.fhub.json'])
  })
})

describe('hub backups', () => {
  it('backs up at startup when there is a family, and close() stops the timer', async () => {
    const dataDir = await fx.tmpDir('hub-data-')
    let t = T0
    const first = await fx.hub({ dataDir, now: () => t })
    const p = fx.provider(first)
    await onceSynced(p)
    p.doc.getMap('meta').set('schema_version', 1)
    await waitFor(() => first.familyExists())
    // No family at its startup, so no backup yet.
    await first._debug.backups.idle()
    expect(await backupFiles(dataDir)).toEqual([])
    p.destroy()
    await first.close()

    const hub = await fx.hub({ dataDir, now: () => t, backupIntervalMs: 25 })
    await waitFor(async () => (await backupFiles(dataDir)).length === 1)
    expect(await backupFiles(dataDir)).toEqual(['yggltree-2026-10-07.fhub.json'])

    // Next "day", a change: the interval picks it up.
    t += DAY
    const q = fx.provider(hub)
    await onceSynced(q)
    q.doc.getMap('m').set('later', 1)
    await waitFor(async () => (await backupFiles(dataDir)).length === 2)
    q.destroy()

    const timer = hub._debug.backups.timer()
    expect(timer).not.toBe(null)
    expect(timer.hasRef()).toBe(false) // never keeps the process alive
    await hub.close()
    expect(hub._debug.backups.timer()).toBe(null)
    await delay(100)
    expect(await backupFiles(dataDir)).toHaveLength(2)
  })

  it('a room retired while a backup is starting never has its assets store reopened', async () => {
    const dataDir = await fx.tmpDir('hub-data-')
    const hub = await fx.hub({ dataDir })
    await hub._debug.backups.idle()
    const p = fx.provider(hub)
    await onceSynced(p)
    p.doc.getMap('meta').set('schema_version', 1)
    await waitFor(() => hub.familyExists())
    const oldId = hub.state.room.id
    const run = hub._debug.backups.runOnce()
    const fresh = hub.state.beginNewRoom()
    await hub.state.commitNewRoom(fresh.id, fresh.token)
    expect(await run).toEqual({ skipped: 'no-family' })
    expect(hub._debug.openStores()).not.toContain(`${oldId}/assets`)
  })

  it.skipIf(process.platform === 'win32')('writes backup files and the sidecar 0600 inside a 0700 backups folder', async () => {
    const dataDir = await fx.tmpDir()
    await mkdir(join(dataDir, 'backups'), { mode: 0o755 })
    const backups = createBackups({ dataDir, getDocs: async () => familyDocs(), now: () => T0, log: fx.quietLog })
    await backups.runOnce()
    const mode = async (path) => (await stat(path)).mode & 0o777
    expect(await mode(join(dataDir, 'backups'))).toBe(0o700)
    expect(await mode(join(dataDir, 'backups', 'yggltree-2026-10-07.fhub.json'))).toBe(0o600)
    expect(await mode(join(dataDir, 'backups', 'last-backup.json'))).toBe(0o600)
  })
})
