// Snapshot + update-log persistence for a single Y.Doc.
//
// On disk, per doc name `<name>`:
//   <name>.snapshot   raw bytes of Y.encodeStateAsUpdate(doc) as of the last
//                      compaction (absent before the first compaction).
//   <name>.log         a sequence of length-prefixed records, each record
//                      holding one Yjs update captured since the last
//                      compaction:  [uint32 LE byte length][update bytes]...
//
// Loading applies the snapshot (if any), then applies each complete record
// in the log in order. A partial final record -- the tail end of a write
// that was interrupted by a crash or power loss -- is detected by its
// length prefix claiming more bytes than the file actually holds, and is
// truncated off rather than treated as fatal.
//
// Writes (updates not produced by applying the snapshot/log during load)
// are appended to the log through a serialized promise chain, so concurrent
// callers never interleave partial writes. The fsync that follows an
// append is debounced to one per second, since a client can emit many
// small Yjs updates in a burst. Durability past that debounced fsync is
// tracked with generation counters (see ensureSynced() below) rather
// than a single "sync pending" flag, so flush()/close() can tell whether
// bytes that landed *during* an already-in-flight fsync have actually
// been covered by a fsync that started after they arrived, and start a
// fresh one if not.
//
// Compaction encodes the full current state, fsyncs it, renames it over
// the old snapshot (retrying the rename on EPERM/EBUSY, which antivirus
// software and other file-lockers can cause on Windows), and then
// truncates the log.

import * as nodeFs from 'node:fs/promises'
import { join } from 'node:path'
import * as Y from 'yjs'
import { renameWithRetry, fsyncDirectoryBestEffort } from './fsAtomic.js'

const LENGTH_PREFIX_BYTES = 4
const DATASYNC_DEBOUNCE_MS = 1000

const LOAD_ORIGIN = Symbol('hub-persistence-load')

async function readFileIfExists(fs, path) {
  try {
    return await fs.readFile(path)
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw err
  }
}

// Splits a log buffer into complete [length-prefix][payload] records,
// stopping at (and reporting) the first incomplete one. Returns
// { records, validLength } where records is [{ bytes, frameStart }] --
// frameStart is this record's own length-prefix offset, so a caller that
// finds a record's payload undecodable (frame-complete but garbage, as
// opposed to merely truncated) can still truncate the file back to right
// before that record -- and validLength is the byte offset just past the
// last complete record, i.e. where the file should be truncated to if a
// partial (truncated mid-frame) record was found instead.
function splitLogRecords(buf) {
  const records = []
  let offset = 0
  while (offset < buf.length) {
    if (offset + LENGTH_PREFIX_BYTES > buf.length) break // partial length prefix
    const frameStart = offset
    const len = buf.readUInt32LE(offset)
    const recordStart = offset + LENGTH_PREFIX_BYTES
    const recordEnd = recordStart + len
    if (recordEnd > buf.length) break // partial payload
    records.push({ bytes: buf.subarray(recordStart, recordEnd), frameStart })
    offset = recordEnd
  }
  return { records, validLength: offset }
}

function encodeRecord(update) {
  const header = Buffer.alloc(LENGTH_PREFIX_BYTES)
  header.writeUInt32LE(update.length, 0)
  return Buffer.concat([header, Buffer.from(update)])
}

export async function openDocStore(dir, name, options = {}) {
  const { maxLogBytes = 8 << 20, maxLogRecords = 500, fs = nodeFs } = options

  const snapshotPath = join(dir, `${name}.snapshot`)
  const logPath = join(dir, `${name}.log`)
  const tmpSnapshotPath = join(dir, `${name}.snapshot.tmp`)

  await fs.mkdir(dir, { recursive: true })

  const doc = new Y.Doc()

  // --- Write pipeline state & helpers (declared before load, since a
  // non-empty log triggers a compaction as the last load step) -----------
  let writeChain = Promise.resolve()
  let recordCount = 0
  let logByteLength = 0
  let closed = false
  // The most recent append/compaction failure that hasn't been reported
  // to a caller yet (set only by runWrite()'s catch). flush()/close()
  // throw this once instead of silently returning as if all were well,
  // then clear it -- report-once makes sense here because the failure
  // already happened and is over; telling every later caller about it
  // again would be noise. Fsync failures are handled differently (see
  // ensureSynced() and lastTimerSyncError below): they propagate live to
  // every current waiter instead of going through this slot, because
  // the data they concern is still genuinely dirty, not a settled fact.
  let lastError = null
  // A debounced timer's own ensureSynced() call has no caller awaiting
  // it directly (it's a background, fire-and-forget fsync), so its
  // failure has nowhere live to propagate to. It's stashed here instead,
  // and the next flush()/close() surfaces it -- but only if that call's
  // own ensureSynced() finds nothing left to do (syncedGen already meets
  // its target): if the explicit call's own fsync attempt actually runs
  // and succeeds, the data is durable *now*, and the earlier timer
  // failure is moot and must not resurrect itself as a stale error.
  let lastTimerSyncError = null
  // Set when an append failed partway through writing its record to the
  // log. A failed append can leave the *in-memory* doc ahead of what's on
  // disk, and -- critically -- any update applied *after* the failed one
  // is a Yjs delta that causally depends on it (Yjs updates are diffs
  // against prior state, not independent snapshots). If that later
  // update is simply appended to the log on its own, it becomes a
  // "pending" update on replay: Yjs buffers it waiting for the missing
  // dependency, which never arrives, and the content is silently lost on
  // reopen even though flush() resolved and the in-memory doc looked
  // fine. The only safe recovery is a full compaction (a complete
  // Y.encodeStateAsUpdate(doc) snapshot, not a diff) before any further
  // log-only appends are trusted again. The next write step -- another
  // append, or an explicit flush()/close()/compact() -- forces that full
  // compaction instead of (or before) continuing normally, and the flag
  // is cleared only once that compaction actually succeeds.
  let needsCompaction = false

  // The fsync after an append is debounced to one per second: a burst of
  // Yjs updates (e.g. typing) would otherwise fsync on every keystroke.
  // Appending bytes is not delayed -- only the fsync that durably commits
  // them is.
  //
  // Durability is tracked with two generation counters rather than a
  // single "is something pending" flag, because a flag can't represent
  // "an append landed *during* an in-flight fsync" -- that append is on
  // disk by the time the in-flight fsync's own fs.open/sync call
  // returns, since fsync has no way to target "only the bytes that
  // existed when I started", but whether the *filesystem* actually
  // persisted those bytes before a crash is unknowable without starting
  // a fresh fsync after the append. A single in-flight promise can only
  // ever answer "is the fsync that was already running done yet," which
  // is the wrong question for bytes that arrived after it started.
  //
  //   appendedGen  -- incremented after each append that lands on disk
  //                   (handle.appendFile() returns), and after each
  //                   compaction succeeds (a compaction's own fsync
  //                   covers everything up to that point by construction).
  //   syncedGen    -- the generation an fsync has *confirmed* durable.
  //                   ensureSynced(targetGen) is satisfied once
  //                   syncedGen >= targetGen.
  //   syncInFlight -- null, or { gen, promise } for an fsync currently
  //                   running, where `gen` is the value appendedGen had
  //                   *when that fsync started* -- i.e. the highest
  //                   generation this particular fsync call can honestly
  //                   claim to cover once it succeeds.
  let appendedGen = 0
  let syncedGen = 0
  let syncInFlight = null

  // Loops until syncedGen >= targetGen, starting or joining fsyncs as
  // needed. If a sync is already running when a newer target is needed,
  // this awaits it first (it may already be enough, or may not be -- an
  // append could have landed after that fsync's `gen` was captured) and
  // then re-evaluates from the top,
  // starting a fresh fsync covering the latest appendedGen if still
  // short. On failure, every caller currently waiting on that same
  // in-flight fsync is rejected (not just the one that happened to start
  // it), syncedGen is left untouched (the data stays "dirty"), and the
  // loop's own caller sees the same rejection -- a later ensureSynced()
  // call will simply try again since the target still isn't met.
  async function ensureSynced(targetGen) {
    while (syncedGen < targetGen) {
      if (syncInFlight) {
        await syncInFlight.promise
        continue
      }
      const gen = appendedGen
      const promise = (async () => {
        const handle = await fs.open(logPath, 'r+')
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
      })()
      syncInFlight = { gen, promise }
      try {
        await promise
        syncedGen = Math.max(syncedGen, gen)
        // A successful fsync that covers this call's target supersedes
        // any earlier failed timer fsync: everything up to targetGen
        // (which includes whatever that failed timer was trying to
        // cover, since appendedGen only grows) is durable now.
        if (syncedGen >= targetGen) lastTimerSyncError = null
      } finally {
        if (syncInFlight && syncInFlight.promise === promise) {
          syncInFlight = null
        }
      }
      // A failure propagates straight out of this function (and thus to
      // every awaiter of this same ensureSynced() call, including every
      // concurrent flush()/close() that was awaiting it) without ever
      // touching `lastError`. Unlike an append failure, an fsync failure
      // isn't a one-time event to report-once-and-move-on: the data is
      // still genuinely dirty (syncedGen was deliberately left behind),
      // so every caller currently waiting on this sync must see the
      // failure, and the *next* ensureSynced() call (from a later
      // flush()/close(), or the next debounce timer) simply tries again
      // because the loop condition above is still unmet.
    }
  }

  // Every write-pipeline step that mutates the log/snapshot files
  // (append, compaction) runs through this wrapper so that one failure
  // -- EMFILE, ENOSPC, a rename that exhausted its retries -- never
  // leaves writeChain permanently rejected. A rejected writeChain would
  // make every later `writeChain.then(...)` a no-op forever, silently
  // disabling persistence for the rest of the process's life. Instead,
  // the error is captured in `lastError` (surfaced once by the next
  // flush()/close()) and the chain itself always resolves, so the *next*
  // append still runs normally. The debounced fsync (scheduleDatasync,
  // below) deliberately runs *outside* this chain -- see lastTimerSyncError.
  function runWrite(fn) {
    writeChain = writeChain.then(fn).catch((err) => {
      lastError = err
    })
    return writeChain
  }

  // Schedules a debounced call to ensureSynced() covering everything
  // appended so far. Re-arming on every append (clearing any previous
  // timer) is what gives the 1-per-second debounce its "burst of
  // updates -> one fsync" behavior; the timer reads appendedGen when it
  // actually *fires*, not when it was scheduled, so it naturally covers
  // any append that lands during the debounce window.
  let datasyncTimer = null

  //
  // close() clears this timer (its own final ensureSynced() covers
  // everything), and the callback also bails out once closed, so no fsync
  // ever runs after close(). The timer is unref'd as well, so a pending
  // debounce never keeps the process alive on its own.
  function scheduleDatasync() {
    if (datasyncTimer || closed) return
    datasyncTimer = setTimeout(() => {
      datasyncTimer = null
      if (closed) return
      ensureSynced(appendedGen).catch((err) => {
        lastTimerSyncError = err
      })
    }, DATASYNC_DEBOUNCE_MS)
    if (typeof datasyncTimer.unref === 'function') datasyncTimer.unref()
  }

  function appendUpdate(update) {
    return runWrite(async () => {
      // A previous append failed partway through (recorded by catching
      // below): the log may now be missing an update that this new one
      // causally depends on. Force a full-state compaction *before*
      // appending this update's own record, so it gets folded into a
      // fresh snapshot instead of becoming another log-only delta that
      // Yjs can't resolve on replay. runCompaction() only clears the
      // flag once it actually succeeds -- if it throws too, the next
      // write attempts the same recovery again.
      if (needsCompaction) {
        await runCompaction()
      }
      try {
        const handle = await fs.open(logPath, 'a')
        try {
          const record = encodeRecord(update)
          await handle.appendFile(record)
          recordCount += 1
          logByteLength += record.length
        } finally {
          await handle.close()
        }
      } catch (err) {
        needsCompaction = true
        throw err
      }
      // The append landed on disk (appendFile() returned): bump the
      // generation counter so a later ensureSynced() call knows this
      // byte range needs to be covered, then arm the debounced fsync.
      appendedGen += 1
      scheduleDatasync()
      if (recordCount >= maxLogRecords || logByteLength >= maxLogBytes) {
        await runCompaction()
      }
    })
  }

  // Encodes the full current doc state to the snapshot file (fsync,
  // rename-with-retry, best-effort directory fsync) and truncates the
  // log. A compaction's own fsync covers everything appended before it
  // started by construction (the snapshot is taken from the in-memory
  // doc, which already reflects every prior append), so it advances both
  // appendedGen and syncedGen to the same new generation on success.
  // Clears `needsCompaction` only on success too, so a compaction that
  // itself fails leaves the flag set for the next write to retry.
  async function runCompaction() {
    const state = Y.encodeStateAsUpdate(doc)
    const handle = await fs.open(tmpSnapshotPath, 'w')
    try {
      await handle.writeFile(Buffer.from(state))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(fs, tmpSnapshotPath, snapshotPath)
    await fsyncDirectoryBestEffort(fs, dir)

    const logHandle = await fs.open(logPath, 'w')
    try {
      await logHandle.truncate(0)
      await logHandle.sync()
    } finally {
      await logHandle.close()
    }
    recordCount = 0
    logByteLength = 0
    needsCompaction = false
    appendedGen += 1
    syncedGen = appendedGen
    // Everything is durable now, so an earlier failed timer fsync is moot.
    lastTimerSyncError = null
  }

  function compact() {
    return runWrite(runCompaction)
  }

  // Shared tail for flush() and close():
  //   1. Wait for the current write chain to drain.
  //   2. If an append failure left a compaction owed (see appendUpdate),
  //      run it now -- flush()/close() must not let needsCompaction
  //      linger just because the caller never writes again before
  //      reading state back after a reopen.
  //   3. Call ensureSynced(appendedGen), targeting the generation as of
  //      right after the drain above (which already reflects whatever
  //      the owed compaction advanced it to, if one ran).
  //   4. Surface whichever failure applies, append failures and fsync
  //      failures differently:
  //      - An append/compaction failure (captured in `lastError`) is
  //        reported exactly once, by whichever flush()/close() call
  //        happens to run next, then cleared -- it already happened and
  //        telling every caller who happens to ask "about" it doesn't
  //        change anything.
  //      - An fsync failure is different: the data is still genuinely
  //        dirty (ensureSynced never advances syncedGen on failure), so
  //        the rejection from ensureSynced() is let through to *every*
  //        caller currently awaiting this call -- each one is still
  //        waiting on data that still isn't durable, so each one must
  //        still see the failure. Nothing is cleared: the next
  //        flush()/close() calls ensureSynced() again and genuinely
  //        retries the fsync, since the target generation still isn't
  //        met.
  // Reporting either failure is never a reason to skip any of steps 1-3:
  // a caller that catches the rejection must still find the store fully
  // drained (and, for close(), genuinely closed).
  async function drainAndReportError() {
    await writeChain
    if (needsCompaction) {
      await runWrite(runCompaction)
    }
    const targetGen = appendedGen
    const alreadySynced = syncedGen >= targetGen
    await ensureSynced(targetGen) // rejection here propagates to every awaiter, unmodified
    // ensureSynced() just succeeded (it would have thrown above
    // otherwise) -- the data up to targetGen is durable *now*. If this
    // call actually ran a fresh fsync (alreadySynced was false), that
    // fresh success supersedes any earlier timer failure, which is now
    // moot and must not resurface as a stale error. Only surface the
    // stashed timer failure when nothing needed syncing here at all --
    // the one case where this is the sole evidence something went wrong
    // with a background sync that nobody else has retried since.
    if (!alreadySynced) {
      lastTimerSyncError = null
    } else if (lastTimerSyncError) {
      const err = lastTimerSyncError
      lastTimerSyncError = null
      throw err
    }
    if (lastError) {
      const err = lastError
      lastError = null
      throw err
    }
  }

  async function flush() {
    await drainAndReportError()
  }

  async function close() {
    // Set before draining so a doc.on('update') firing while close() is
    // in flight (e.g. a caller still mutating the doc concurrently with
    // closing it) can never queue a new append afterward.
    closed = true
    if (datasyncTimer) {
      clearTimeout(datasyncTimer)
      datasyncTimer = null
    }
    await drainAndReportError()
  }

  // --- Load ---------------------------------------------------------
  const snapshot = await readFileIfExists(fs, snapshotPath)
  if (snapshot && snapshot.length > 0) {
    Y.applyUpdate(doc, snapshot, LOAD_ORIGIN)
  }

  const logBuf = await readFileIfExists(fs, logPath)
  if (logBuf && logBuf.length > 0) {
    const { records, validLength } = splitLogRecords(logBuf)
    // Apply each complete-framed record individually, in a try/catch: a
    // record whose length prefix is intact but whose payload is garbage
    // (undecodable by Yjs, including a corrupt len=0 frame) is not a
    // truncated write -- it's frame-complete -- so splitLogRecords alone
    // can't catch it. Treat it the same as a crash-truncated tail:
    // truncate the log right before that record and stop applying any
    // records after it, rather than failing the whole load.
    let appliedCount = 0
    let truncateAt = validLength
    for (const record of records) {
      try {
        Y.applyUpdate(doc, record.bytes, LOAD_ORIGIN)
        appliedCount += 1
      } catch {
        truncateAt = record.frameStart
        break
      }
    }
    if (truncateAt < logBuf.length) {
      // A partial final record, or a corrupt one: truncate it (and
      // anything after it) off disk now so a future load never re-reads
      // it.
      const handle = await fs.open(logPath, 'r+')
      try {
        await handle.truncate(truncateAt)
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
    if (appliedCount > 0) {
      await compact()
    }
  }

  // Updates applied during load are tagged with LOAD_ORIGIN and skipped
  // here; only genuinely new writes get appended to the log.
  doc.on('update', (update, origin) => {
    if (origin === LOAD_ORIGIN || closed) return
    appendUpdate(update).catch(() => {})
  })

  return { doc, flush, compact, close }
}
