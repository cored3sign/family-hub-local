// Automatic daily hub backups.
//
// At startup and then every 24 h, if the current room's family changed
// since the last backup, write backups/yggltree-<local date>.fhub.json
// with createBackup() (the same format "Download a backup" produces, so
// it restores through the normal restore path) and keep the newest 14.
//
// "Changed" compares each doc's Yjs snapshot (state vector *plus* delete
// set): a delete-only edit leaves the state vector as it was, and would
// otherwise be missed. The last backup's fingerprint is kept in
// backups/last-backup.json, so a restart does not write a duplicate of an
// unchanged family; if the file it names is gone, the next run writes.
//
// A second run on the same day overwrites that day's file. Retired-room
// backups are not treated specially: the newest 14 files are kept,
// whichever room they came from.

import * as nodeFs from 'node:fs/promises'
import { join } from 'node:path'
import * as Y from 'yjs'
import { createBackup } from '../../frontend/src/data/backupFormat.js'
import { PRIVATE_FILE_MODE, ensurePrivateDir, writeFileAtomic } from './fsAtomic.js'

export const BACKUP_KEEP = 14
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
// Older builds wrote family-hub-<date>.fhub.json; those are still recognized.
const BACKUP_FILE = /^(?:yggltree|family-hub)-\d{4}-\d{2}-\d{2}\.fhub\.json$/
const dayOf = (name) => name.match(/\d{4}-\d{2}-\d{2}/)[0]
const STATE_FILE = 'last-backup.json'

const pad = (n) => String(n).padStart(2, '0')

export function backupFileName(date) {
  return `yggltree-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.fhub.json`
}

function fingerprint({ doc, assets }) {
  const fp = (d) => Buffer.from(Y.encodeSnapshot(Y.snapshot(d))).toString('base64')
  return `${fp(doc)}.${fp(assets)}`
}

async function exists(fs, path) {
  try {
    await fs.stat(path)
    return true
  } catch (err) {
    if (err && err.code === 'ENOENT') return false
    throw err
  }
}

// getDocs() -> Promise<{ doc, assets } | null>; null means "no family to
// back up" (an empty room, or the room changed mid-way).
export function createBackups({
  dataDir,
  getDocs,
  now = () => Date.now(),
  keep = BACKUP_KEEP,
  intervalMs = BACKUP_INTERVAL_MS,
  log = console,
  fs = nodeFs,
}) {
  const dir = join(dataDir, 'backups')
  const statePath = join(dir, STATE_FILE)
  let last = undefined // { fingerprint, file } | null once loaded
  let running = null
  let timer = null
  let stopped = false

  async function loadLast() {
    if (last !== undefined) return last
    try {
      const parsed = JSON.parse(await fs.readFile(statePath, 'utf8'))
      last = typeof parsed?.fingerprint === 'string' && typeof parsed?.file === 'string' ? parsed : null
    } catch {
      last = null // missing or unreadable: the next run simply writes
    }
    return last
  }

  async function prune() {
    const names = (await fs.readdir(dir))
      .filter((n) => BACKUP_FILE.test(n))
      .sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : dayOf(a) > dayOf(b) ? 1 : 0))
    for (const name of names.slice(0, Math.max(0, names.length - keep))) {
      await fs.unlink(join(dir, name)).catch((err) => {
        if (!err || err.code !== 'ENOENT') throw err
      })
    }
  }

  async function run() {
    const docs = await getDocs()
    if (!docs) return { skipped: 'no-family' }
    const fp = fingerprint(docs)
    const prev = await loadLast()
    if (prev && prev.fingerprint === fp && (await exists(fs, join(dir, prev.file)))) {
      return { skipped: 'unchanged' }
    }
    const date = new Date(now())
    const file = backupFileName(date)
    const text = createBackup(docs, date)
    await ensurePrivateDir(fs, dir)
    await writeFileAtomic(fs, join(dir, file), join(dir, `${file}.tmp`), text, { mode: PRIVATE_FILE_MODE })
    last = { fingerprint: fp, file }
    await writeFileAtomic(fs, statePath, `${statePath}.tmp`, JSON.stringify(last), { mode: PRIVATE_FILE_MODE })
    await prune()
    return { written: file }
  }

  // One run at a time; a call while one is running shares it.
  function runOnce() {
    running ??= run().finally(() => {
      running = null
    })
    return running
  }

  function runLogged() {
    if (stopped) return
    runOnce().then(
      (result) => {
        if (result.written) log.info?.(`[hub] backup written: ${result.written}`)
      },
      (err) => log.error?.(`[hub] backup failed: ${err.message}`)
    )
  }

  function start() {
    stopped = false
    runLogged()
    timer = setInterval(runLogged, intervalMs)
    timer.unref()
  }

  // Clears the timer and waits for a running backup to finish.
  async function stop() {
    stopped = true
    clearInterval(timer)
    timer = null
    await idle()
  }

  async function idle() {
    if (running) await running.catch(() => {})
  }

  return { runOnce, start, stop, idle, timer: () => timer }
}
