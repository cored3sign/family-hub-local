// Hub room/token state: hub.json persistence, token checking, the claim
// handshake that lets exactly one desktop become the hub machine, and the
// hub.lock file that refuses a second `npm start` against the same data
// directory.
//
// hub.json shape:
//   { v: 1,
//     room: { id, token, createdAt, claim: null | { id, at } },
//     retired: [{ id, retiredAt, reason: 'restore' }] }
//
// Writes to hub.json go to a tmp file, are fsync'd, then renamed over the
// real file -- the same crash-safety pattern as the doc log in
// persistence.js, just for a small JSON blob instead of a Yjs update log.

import * as nodeFs from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto'
import { PRIVATE_FILE_MODE, ensurePrivateDir, tightenFile, writeFileAtomic } from './fsAtomic.js'

const CLAIM_CONFLICT_WINDOW_MS = 5 * 60 * 1000
const MAX_LOCK_ATTEMPTS = 20

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

function makeRoom(now, randomBytes) {
  return {
    id: 'r_' + toBase64Url(randomBytes(16)),
    token: toBase64Url(randomBytes(32)),
    createdAt: now,
    claim: null,
  }
}

async function readJsonIfExists(fs, path) {
  try {
    const text = await fs.readFile(path, 'utf8')
    return JSON.parse(text)
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw err
  }
}

// Reads hub.lock, returning { raw, parsed } where `raw` is the exact
// file contents read and `parsed` is the JSON value, or null for either
// field when the file is empty/unparseable (never thrown -- a lock file
// left empty or truncated by a crash mid-write must be treated as stale
// so a later acquireLock() isn't blocked forever; hub.json itself, by
// contrast, always uses the strict readJsonIfExists above, since paving
// over its corruption as "no existing state" would make loadHubState
// mint a brand new room and silently orphan a real family's data).
// Returns the sentinel ABSENT, not null, when the file doesn't exist at
// all -- acquireLock needs to tell "nothing is there" apart from "a
// stale/corrupt lock is there," because only the latter is ever safe to
// unlink before taking over.
const ABSENT = Symbol('hub-lock-absent')

async function readLockFile(fs, path) {
  let raw
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return ABSENT
    throw err
  }
  let parsed = null
  if (raw.trim() !== '') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }
  return { raw, parsed }
}

async function writeJsonAtomic(fs, path, tmpPath, value) {
  await writeFileAtomic(fs, path, tmpPath, JSON.stringify(value, null, 2), { mode: PRIVATE_FILE_MODE })
}

function safeTokenEquals(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function loadHubState(dataDir, options = {}) {
  const { now = () => Date.now(), randomBytes = nodeRandomBytes, fs = nodeFs } = options

  const statePath = join(dataDir, 'hub.json')
  const tmpStatePath = join(dataDir, 'hub.json.tmp')
  const lockPath = join(dataDir, 'hub.lock')

  // The data folder and its rooms/ and backups/ are private (0700), and
  // hub.json / hub.lock 0600, whether the folder is new or already exists.
  await ensurePrivateDir(fs, dataDir)
  await ensurePrivateDir(fs, join(dataDir, 'rooms'))
  await ensurePrivateDir(fs, join(dataDir, 'backups'))
  await tightenFile(fs, statePath)

  let data = await readJsonIfExists(fs, statePath)
  if (!data) {
    data = { v: 1, room: makeRoom(now(), randomBytes), retired: [] }
    await writeJsonAtomic(fs, statePath, tmpStatePath, data)
  }

  // Every write goes through this chain so two persist() calls (e.g. a
  // claim() right after another) never both open
  // hub.json.tmp at once -- the second writer's open/write would race the
  // first writer's rename, and whichever rename loses finds its tmp file
  // already gone (ENOENT). Each persist() captures the *current* `data` at
  // the time it actually runs, not at call time, so it always writes the
  // latest in-memory state even if several mutations queued up first.
  //
  // The chain recovers from a failed write (.catch stores it rather than
  // leaving the chain rejected) so one transient error -- EMFILE, ENOSPC,
  // a rename that exhausted its retries -- doesn't silently disable every
  // later persist() for the rest of the process's life. The stored error
  // is surfaced by the very next persist() call instead of being dropped;
  // claim()/commitNewRoom() all await
  // persist(), so that failure propagates to whichever of those the
  // caller is awaiting.
  let writeChain = Promise.resolve()
  let lastPersistError = null

  function persist() {
    writeChain = writeChain
      .then(() => writeJsonAtomic(fs, statePath, tmpStatePath, data))
      .catch((err) => {
        lastPersistError = err
      })
    return writeChain.then(() => {
      if (lastPersistError) {
        const err = lastPersistError
        lastPersistError = null
        throw err
      }
    })
  }

  function isRetired(id) {
    return data.retired.some((entry) => entry.id === id)
  }

  function checkToken(roomId, token) {
    if (roomId === data.room.id) {
      return safeTokenEquals(token, data.room.token) ? 'ok' : 'bad-token'
    }
    if (isRetired(roomId)) return 'retired'
    return 'unknown-room'
  }

  // claim() mutates in-memory state synchronously (so
  // data.room.claim / data.room.token are correct for the very next call
  // even before the write lands), then await the serialized persist before
  // resolving -- callers get back a Promise of the plain result value, but
  // the write is never left dangling after the function returns, which
  // matters both for correctness (a caller awaiting claim() can trust
  // hub.json reflects it) and for tests (a tmp dir removed right after a
  // fire-and-forget write landed underneath it would otherwise surface as
  // an unhandled rejection in a *later*, unrelated test).
  async function claim(claimId, { familyExists, now: claimNow }) {
    if (familyExists) return 'conflict'
    const existing = data.room.claim
    const fresh = existing && claimNow - existing.at < CLAIM_CONFLICT_WINDOW_MS
    if (fresh && existing.id !== claimId) return 'conflict'
    data.room.claim = { id: claimId, at: claimNow }
    await persist()
    return 'ok'
  }

  function beginNewRoom() {
    const room = makeRoom(now(), randomBytes)
    return { id: room.id, token: room.token }
  }

  // The swap is applied in memory first (so checkToken answers for the new
  // room as soon as the write is queued), but a failed write rolls it back:
  // a restore whose hub.json swap never reached disk must leave the old
  // room current in memory too, or the hub would serve a room that a
  // restart forgets.
  async function commitNewRoom(id, token) {
    const prevRoom = data.room
    const prevRetired = data.retired
    data.retired = [...prevRetired, { id: prevRoom.id, retiredAt: now(), reason: 'restore' }]
    data.room = { id, token, createdAt: now(), claim: null }
    try {
      await persist()
    } catch (err) {
      if (data.room.id === id) {
        data.room = prevRoom
        data.retired = prevRetired
      }
      throw err
    }
  }

  // Takeover of a stale lock (existing but dead pid, or an empty/
  // unparseable file left by a crash mid-write) uses an atomic rename,
  // not a read-recheck-then-unlink: two processes can both read the
  // *same* stale lock and both pass a "is it still what I judged stale"
  // recheck before either one unlinks, because re-reading and unlinking
  // are two separate operations with a gap between them -- whichever
  // process's unlink runs last can delete a lock the *other* process
  // already replaced with its own fresh one in that gap. `rename()`,
  // unlike unlink, is atomic in the sense that
  // matters here: when two processes both rename the same source path,
  // only one rename can possibly move the inode that was there first --
  // the other either renames whatever replaced it (which this code then
  // detects and repairs) or gets ENOENT because there's nothing left at
  // that path to move.
  //
  // So the loop has three paths:
  //   - ABSENT: go straight to wx-create. EEXIST loops back to re-check.
  //   - a parsed lock with a live pid: refuse.
  //   - stale or corrupt: rename lockPath to a scratch path unique to
  //     this attempt. ENOENT means someone else already moved it --
  //     loop back to re-evaluate. Otherwise, re-read the *renamed* file:
  //     - if its bytes match what was judged stale, this process really
  //       did move the stale lock -- delete the scratch file and
  //       wx-create the new lock (EEXIST loops back, same as the ABSENT
  //       path).
  //     - if its bytes differ, this process actually renamed a *live*
  //       lock that got created in the gap between its read and its
  //       rename (i.e. it moved someone else's fresh lock, not the
  //       stale one it meant to remove) -- restore it with `link()`
  //       (which fails EEXIST rather than silently overwriting anything
  //       that might already be back at lockPath by the time this
  //       runs; falls back to rename() where hard links are
  //       unsupported), then remove the scratch copy and loop back to
  //       re-evaluate the restored lock. See the accepted three-starter
  //       limit documented at the restore site below.
  // Bounded to MAX_LOCK_ATTEMPTS so persistent contention fails loudly
  // instead of spinning forever.
  async function restoreMovedLock(scratchPath) {
    try {
      await fs.link(scratchPath, lockPath)
      return
    } catch (err) {
      if (err && err.code === 'EEXIST') return
    }
    try {
      await fs.rename(scratchPath, lockPath)
    } catch (err) {
      throw new Error(
        `Could not restore another process's hub lock from ${scratchPath} to ${lockPath}` +
          ` (link and rename both failed: ${err && err.message})`,
        { cause: err }
      )
    }
  }

  async function acquireLock(lockOptions = {}) {
    const { pid = process.pid, isAlive = defaultIsAlive, startedAt = now() } = lockOptions
    for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
      const found = await readLockFile(fs, lockPath)
      if (found !== ABSENT) {
        if (found.parsed && isAlive(found.parsed.pid)) {
          throw Object.assign(new Error(`Hub data directory is already in use by pid ${found.parsed.pid}`), {
            code: 'HUB_LOCKED',
            pid: found.parsed.pid,
            port: found.parsed.port,
            lockPath,
          })
        }
        // Stale or corrupt: move it aside atomically before deciding
        // whether it's safe to delete.
        const scratchPath = `${lockPath}.stale-${nodeRandomBytes(8).toString('hex')}`
        try {
          await fs.rename(lockPath, scratchPath)
        } catch (err) {
          if (err && err.code === 'ENOENT') continue // someone else already moved it
          throw err
        }
        const moved = await readLockFile(fs, scratchPath)
        if (moved !== ABSENT && moved.raw === found.raw) {
          // Really did move the stale lock: safe to discard.
          await fs.unlink(scratchPath).catch((err) => {
            if (!err || err.code !== 'ENOENT') throw err
          })
        } else {
          // Moved a *live* lock that was created in the gap between the
          // read above and this rename -- restore it rather than
          // silently dropping another process's current lock. link()
          // fails with EEXIST instead of overwriting if some other lock
          // is already back at lockPath by the time this runs; the loop
          // then re-evaluates whichever lock is there.
          //
          // Accepted limit:
          // while the live lock is moved aside -- between the rename
          // above and this link() -- lockPath is empty, so a *third*
          // concurrent starter can wx-create its own lock in that gap.
          // The live lock's owner and that third process can then both
          // believe they hold the lock (link() hits EEXIST and the
          // moved-aside lock is dropped). This needs three simultaneous
          // starts plus a stale lock, which is acceptable for a
          // single-family desktop app.
          //
          // On a filesystem without hard links (link() fails with EPERM,
          // ENOTSUP, etc.), fall back to rename() so the live lock is not
          // left stranded under its scratch name. rename() overwrites,
          // which is the best available option there.
          await restoreMovedLock(scratchPath)
          await fs.unlink(scratchPath).catch((err) => {
            if (!err || err.code !== 'ENOENT') throw err
          })
          continue // re-evaluate the (restored) lock
        }
      }
      try {
        const handle = await fs.open(lockPath, 'wx', PRIVATE_FILE_MODE)
        try {
          await handle.writeFile(JSON.stringify({ pid, startedAt }))
          await handle.sync()
        } finally {
          await handle.close()
        }
        return
      } catch (err) {
        if (err && err.code === 'EEXIST') continue // someone else just created it; re-check them
        throw err
      }
    }
    throw new Error(`Could not acquire the hub lock after ${MAX_LOCK_ATTEMPTS} attempts (contended by another process)`)
  }

  // Adds the listening port to the lock this process holds, so a second
  // start can find (and health-probe) the running hub. Written with the
  // same tmp+fsync+rename as hub.json, so a reader only ever sees the old
  // or the new complete lock. A no-op if the lock is not (or no longer)
  // ours -- never touches another process's lock.
  async function recordLockPort(port, { pid = process.pid } = {}) {
    const found = await readLockFile(fs, lockPath)
    if (found === ABSENT || !found.parsed || found.parsed.pid !== pid) return
    await writeFileAtomic(fs, lockPath, `${lockPath}.tmp`, JSON.stringify({ ...found.parsed, port }), { mode: PRIVATE_FILE_MODE })
  }

  // Only removes the lock file when it is still the one this process
  // holds (its recorded pid is our own) -- otherwise a process that lost
  // a stale-takeover race (see acquireLock) could unlink the *new*
  // owner's lock out from under it.
  async function releaseLock() {
    const found = await readLockFile(fs, lockPath)
    if (found === ABSENT || !found.parsed || found.parsed.pid !== process.pid) return
    try {
      await fs.unlink(lockPath)
    } catch (err) {
      if (err && err.code === 'ENOENT') return
      throw err
    }
  }

  return {
    get room() {
      return data.room
    },
    get retired() {
      return data.retired
    },
    isRetired,
    checkToken,
    claim,
    beginNewRoom,
    commitNewRoom,
    acquireLock,
    recordLockPort,
    releaseLock,
  }
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    if (err && err.code === 'ESRCH') return false
    // EPERM means the process exists but we can't signal it -- treat as alive.
    return true
  }
}
