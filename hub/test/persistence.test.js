import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, appendFile, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { openDocStore } from '../src/persistence.js'

const dirs = []

async function tmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-persistence-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()
    await rm(dir, { recursive: true, force: true })
  }
})

function textOf(doc) {
  return doc.getText('t').toString()
}

describe('openDocStore', () => {
  it('write, close, reopen: state is equal', async () => {
    const dir = await tmpDir()
    const store1 = await openDocStore(dir, 'main', {})
    store1.doc.getText('t').insert(0, 'hello')
    await store1.flush()
    await store1.close()

    const store2 = await openDocStore(dir, 'main', {})
    expect(textOf(store2.doc)).toBe('hello')
    await store2.close()
  })

  it('write without close, then reopen: all flushed records are recovered', async () => {
    const dir = await tmpDir()
    const store1 = await openDocStore(dir, 'main', {})
    store1.doc.getText('t').insert(0, 'a')
    store1.doc.getText('t').insert(1, 'b')
    await store1.flush()
    // No close() call -- simulates a crash after the writes were flushed.

    const store2 = await openDocStore(dir, 'main', {})
    expect(textOf(store2.doc)).toBe('ab')
    await store2.close()
  })

  it('truncates a hand-appended partial record, and the state equals the state before it', async () => {
    const dir = await tmpDir()
    const store1 = await openDocStore(dir, 'main', {})
    store1.doc.getText('t').insert(0, 'ok')
    await store1.flush()
    await store1.close()

    // Hand-append a partial (truncated) record: a length prefix claiming
    // more bytes than actually follow on disk (a buffer shorter than
    // 4 + 10 bytes, so the payload really is cut short, not just
    // zero-padded out to the declared length).
    const logPath = join(dir, 'main.log')
    const partial = Buffer.alloc(4 + 3)
    partial.writeUInt32LE(10, 0)
    partial.set(Buffer.from([1, 2, 3]), 4) // only 3 of the promised 10 bytes
    await appendFile(logPath, partial)

    const store2 = await openDocStore(dir, 'main', {})
    // State equals the state before the partial record -- not byte-identical
    // (each Y.Doc has its own random client id) but the same content, and
    // nothing from the bogus partial bytes leaked into the doc.
    expect(textOf(store2.doc)).toBe('ok')

    // The partial record must have been truncated off the log file (and,
    // since the log had at least one complete record, the load compacts,
    // leaving the log empty).
    const raw = await readFile(logPath)
    expect(raw.length).toBe(0)
    await store2.close()
    // After truncation, nothing partial should remain to re-corrupt future loads.
    const store3 = await openDocStore(dir, 'main', {})
    expect(textOf(store3.doc)).toBe('ok')
    await store3.close()
  })

  it('compaction leaves an empty log', async () => {
    const dir = await tmpDir()
    const store = await openDocStore(dir, 'main', {})
    store.doc.getText('t').insert(0, 'hello world')
    await store.flush()

    const logPath = join(dir, 'main.log')
    let stat = await readFile(logPath)
    expect(stat.length).toBeGreaterThan(0)

    await store.compact()

    stat = await readFile(logPath)
    expect(stat.length).toBe(0)

    // State survives compaction.
    expect(textOf(store.doc)).toBe('hello world')
    await store.close()

    const reopened = await openDocStore(dir, 'main', {})
    expect(textOf(reopened.doc)).toBe('hello world')
    await reopened.close()
  })

  it('a rename failing once with EPERM succeeds (injected fs)', async () => {
    const dir = await tmpDir()
    const store = await openDocStore(dir, 'main', {})
    store.doc.getText('t').insert(0, 'retry me')
    await store.flush()

    let attempts = 0
    const realFs = await import('node:fs/promises')
    const injectedFs = {
      ...realFs,
      rename: async (...args) => {
        attempts += 1
        if (attempts === 1) {
          const err = new Error('EPERM: operation not permitted')
          err.code = 'EPERM'
          throw err
        }
        return realFs.rename(...args)
      },
    }

    const store2 = await openDocStore(dir, 'main', { fs: injectedFs })
    store2.doc.getText('t').insert(8, '!')
    await store2.flush()
    await store2.compact()
    expect(attempts).toBeGreaterThanOrEqual(2)

    const reopened = await openDocStore(dir, 'main', {})
    expect(textOf(reopened.doc)).toBe('retry me!')
    await reopened.close()
    await store.close()
    await store2.close()
  })

  it('concurrent flush() calls both resolve (do not hang)', async () => {
    const dir = await tmpDir()
    const store = await openDocStore(dir, 'main', {})
    store.doc.getText('t').insert(0, 'concurrent')

    await Promise.all([store.flush(), store.flush()])

    expect(textOf(store.doc)).toBe('concurrent')
    await store.close()
  })

  it('flush() racing close() both resolve (do not hang)', async () => {
    const dir = await tmpDir()
    const store = await openDocStore(dir, 'main', {})
    store.doc.getText('t').insert(0, 'race')

    await Promise.all([store.flush(), store.close()])

    const reopened = await openDocStore(dir, 'main', {})
    expect(textOf(reopened.doc)).toBe('race')
    await reopened.close()
  })

  it('a concurrent flush() waits for the shared fsync to actually finish, not just start', async () => {
    const dir = await tmpDir()
    const realFs = await import('node:fs/promises')
    let syncDone = false
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        const handle = await realFs.open(path, flag)
        if (path.endsWith('.log') && flag === 'r+') {
          const realSync = handle.sync.bind(handle)
          handle.sync = async () => {
            await new Promise((resolve) => setTimeout(resolve, 200))
            await realSync()
            syncDone = true
          }
        }
        return handle
      },
    }
    const store = await openDocStore(dir, 'main', { fs: injectedFs })
    store.doc.getText('t').insert(0, 'x')

    let secondFlushSawSyncDone
    const first = store.flush()
    const second = store.flush().then(() => {
      secondFlushSawSyncDone = syncDone
    })
    await Promise.all([first, second])

    expect(secondFlushSawSyncDone).toBe(true)
    await store.close()
  })

  it('flush() landing while the debounce timer\'s own fsync is already in flight still waits for it', async () => {
    const dir = await tmpDir()
    const realFs = await import('node:fs/promises')
    let syncDone = false
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        const handle = await realFs.open(path, flag)
        if (path.endsWith('.log') && flag === 'r+') {
          const realSync = handle.sync.bind(handle)
          handle.sync = async () => {
            await new Promise((resolve) => setTimeout(resolve, 200))
            await realSync()
            syncDone = true
          }
        }
        return handle
      },
    }
    const store = await openDocStore(dir, 'main', { fs: injectedFs })
    store.doc.getText('t').insert(0, 'y')

    // Let the 1s debounce timer fire on its own and start the (slowed)
    // fsync, then call flush() while that fsync is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 1050))
    await store.flush()

    expect(syncDone).toBe(true)
    await store.close()
  }, 10_000)

  it('a transient append failure is recovered: later causally-dependent updates still survive a reopen, and flush() reports the earlier error once', async () => {
    // The scenario: one failed append followed by a
    // second, successful one whose Yjs update is a *diff* against state
    // that includes the first (failed) insert. Naively re-appending only
    // the second update's delta to the log leaves that delta referencing
    // a dependency (the first insert) that was never durably written --
    // on replay, Yjs buffers it as "pending" waiting for a dependency
    // that will never arrive, so the content is silently lost even
    // though flush() resolved and the in-memory doc looked correct.
    // Recovering from the failure must force a full-state compaction
    // (an independent snapshot, not a diff) rather than merely letting
    // later appends continue on their own.
    const dir = await tmpDir()
    const store = await openDocStore(dir, 'main', {})
    const text = store.doc.getText('t')

    const realFs = await import('node:fs/promises')
    let shouldFail = true
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        if (shouldFail && typeof path === 'string' && path.endsWith('.log') && flag === 'a') {
          shouldFail = false
          const err = new Error('EMFILE: too many open files')
          err.code = 'EMFILE'
          throw err
        }
        return realFs.open(path, flag)
      },
    }

    const store2 = await openDocStore(dir, 'main', { fs: injectedFs })
    const text2 = store2.doc.getText('t')
    text2.insert(0, 'A') // this append fails (injected EMFILE)

    // flush() surfaces that failure instead of silently succeeding...
    await expect(store2.flush()).rejects.toMatchObject({ code: 'EMFILE' })
    // ...but only once: the chain recovered (writeChain itself resolved
    // rather than staying rejected forever), so a second flush() with no
    // new failure resolves cleanly instead of re-throwing or hanging.
    await expect(store2.flush()).resolves.toBeUndefined()

    // A later update, causally dependent on the lost "A" insert, is
    // applied and flushed...
    text2.insert(1, 'BCDEF')
    await store2.flush()
    expect(text2.toString()).toBe('ABCDEF')

    // ...and must survive a close + reopen intact: the recovery
    // compaction folded the full state (including "A") into a fresh
    // snapshot, so nothing is left pending on replay.
    await store2.close()
    const reopened = await openDocStore(dir, 'main', {})
    expect(textOf(reopened.doc)).toBe('ABCDEF')
    await reopened.close()
    await store.close()
  })

  it('the same recovery works with no intermediate flush() at all: failed "A", then "BCDEF", then close, then reopen', async () => {
    // Same causal-dependency hazard as the test above, but without ever
    // calling flush() between the two inserts -- close() alone must
    // still run the owed recovery compaction before it durably closes,
    // exactly as it would if the caller simply kept editing and only
    // closed the store once, with no explicit flush in between.
    const dir = await tmpDir()
    const realFs = await import('node:fs/promises')
    let shouldFail = true
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        if (shouldFail && typeof path === 'string' && path.endsWith('.log') && flag === 'a') {
          shouldFail = false
          const err = new Error('EMFILE: too many open files')
          err.code = 'EMFILE'
          throw err
        }
        return realFs.open(path, flag)
      },
    }

    const store = await openDocStore(dir, 'main', { fs: injectedFs })
    const text = store.doc.getText('t')
    text.insert(0, 'A') // fails (injected EMFILE)
    text.insert(1, 'BCDEF') // succeeds, causally dependent on the lost "A"

    await expect(store.close()).rejects.toMatchObject({ code: 'EMFILE' })

    const reopened = await openDocStore(dir, 'main', {})
    expect(textOf(reopened.doc)).toBe('ABCDEF')
    await reopened.close()
  })

  it('an append landing while the debounce timer\'s fsync is already in flight is covered by the next flush()', async () => {
    // Pins a durability edge case. The event order is
    // append -> sync-start -> append -> sync-end -> flush-call ->
    // (a *fresh* sync-start/sync-end) -> flush-done. The second append
    // lands *during* the first (slow) fsync -- that fsync can only ever
    // cover the bytes that existed when it started, so a later flush()
    // must notice the data is still behind and run another fsync, not
    // assume the in-flight one (or its own stale "nothing pending" read)
    // already covers everything.
    const dir = await tmpDir()
    const realFs = await import('node:fs/promises')
    const events = []
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        const handle = await realFs.open(path, flag)
        if (path.endsWith('.log') && flag === 'r+') {
          const realSync = handle.sync.bind(handle)
          handle.sync = async () => {
            events.push('sync-start')
            await new Promise((resolve) => setTimeout(resolve, 300))
            await realSync()
            events.push('sync-end')
          }
        }
        if (path.endsWith('.log') && flag === 'a') {
          const realAppend = handle.appendFile.bind(handle)
          handle.appendFile = async (buf) => {
            await realAppend(buf)
            events.push('append')
          }
        }
        return handle
      },
    }
    const store = await openDocStore(dir, 'main', { fs: injectedFs })
    const text = store.doc.getText('t')

    text.insert(0, 'x')
    await new Promise((resolve) => setTimeout(resolve, 1100)) // timer fires, slow fsync starts
    text.insert(1, 'y') // lands mid-fsync
    await new Promise((resolve) => setTimeout(resolve, 400)) // the in-flight fsync finishes

    events.push('flush-call')
    await store.flush()
    events.push('flush-done')

    // The second append's bytes must have been covered by a sync that
    // started *after* that append landed -- i.e. a fresh sync-start
    // appearing after the second 'append' event, not just the one
    // in-flight sync that predates it.
    const secondAppendIndex = events.lastIndexOf('append')
    const syncStartsAfterSecondAppend = events
      .slice(secondAppendIndex + 1)
      .filter((e) => e === 'sync-start').length
    expect(syncStartsAfterSecondAppend).toBeGreaterThanOrEqual(1)
    expect(events.indexOf('flush-done')).toBe(events.length - 1)

    await store.close()
  }, 10_000)

  it('three concurrent flush() calls all reject when the fsync fails, and a later flush() with a working fsync succeeds', async () => {
    const dir = await tmpDir()
    const realFs = await import('node:fs/promises')
    let shouldFail = true
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        const handle = await realFs.open(path, flag)
        if (shouldFail && path.endsWith('.log') && flag === 'r+') {
          shouldFail = false
          handle.sync = async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
            const err = new Error('EIO: i/o error')
            err.code = 'EIO'
            throw err
          }
        }
        return handle
      },
    }
    const store = await openDocStore(dir, 'main', { fs: injectedFs })
    store.doc.getText('t').insert(0, 'x')

    const results = await Promise.all(
      [store.flush(), store.flush(), store.flush()].map((p) => p.then(() => 'ok', (err) => err.code))
    )
    expect(results).toEqual(['EIO', 'EIO', 'EIO'])

    // The fsync that failed was injected to fail only once; the data is
    // still dirty (syncedGen never advanced), so this flush() genuinely
    // retries with a real fsync this time and must succeed.
    await expect(store.flush()).resolves.toBeUndefined()

    await store.close()
  })

  it('close() leaves no debounce timer pending (the process can exit promptly)', async () => {
    const dir = await tmpDir()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const store = await openDocStore(dir, 'main', {})
      store.doc.getText('t').insert(0, 'x')
      await store.flush() // the append has landed, so the debounce timer is armed
      expect(vi.getTimerCount()).toBe(1)
      await store.close()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('no fsync runs after close(), even when close()\'s own fsync failed', async () => {
    const dir = await tmpDir()
    const realFs = await import('node:fs/promises')
    let failNextSync = false
    let closedAt = null
    let syncsAfterClose = 0
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        const handle = await realFs.open(path, flag)
        if (typeof path === 'string' && path.endsWith('.log') && flag === 'r+') {
          if (closedAt !== null) syncsAfterClose += 1
          if (failNextSync) {
            failNextSync = false
            handle.sync = async () => {
              const err = new Error('EIO: i/o error')
              err.code = 'EIO'
              throw err
            }
          }
        }
        return handle
      },
    }
    const store = await openDocStore(dir, 'main', { fs: injectedFs })
    store.doc.getText('t').insert(0, 'x')
    failNextSync = true // close()'s own fsync fails, so the data is still dirty afterwards
    await expect(store.close()).rejects.toMatchObject({ code: 'EIO' })
    closedAt = Date.now()

    // Past the 1 s debounce: a still-armed timer would retry the fsync here.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(syncsAfterClose).toBe(0)
  }, 10_000)

  it('a failed timer fsync followed by a successful timer fsync does not make a later flush() reject (stale timer error)', async () => {
    const dir = await tmpDir()
    const realFs = await import('node:fs/promises')
    let shouldFail = true
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        const handle = await realFs.open(path, flag)
        if (shouldFail && typeof path === 'string' && path.endsWith('.log') && flag === 'r+') {
          shouldFail = false
          handle.sync = async () => {
            const err = new Error('EIO: i/o error')
            err.code = 'EIO'
            throw err
          }
        }
        return handle
      },
    }
    const store = await openDocStore(dir, 'main', { fs: injectedFs })
    store.doc.getText('t').insert(0, 'a')
    await new Promise((resolve) => setTimeout(resolve, 1300)) // timer fires; its fsync fails
    store.doc.getText('t').insert(1, 'b')
    await new Promise((resolve) => setTimeout(resolve, 1300)) // timer fires again; its fsync succeeds

    await expect(store.flush()).resolves.toBeUndefined()
    await store.close()
  }, 10_000)

  it('close() still rejects with the last unreported write error, after closing everything', async () => {
    const dir = await tmpDir()
    const realFs = await import('node:fs/promises')
    let shouldFail = true
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        if (shouldFail && typeof path === 'string' && path.endsWith('.log') && flag === 'a') {
          shouldFail = false
          const err = new Error('ENOSPC: no space left on device')
          err.code = 'ENOSPC'
          throw err
        }
        return realFs.open(path, flag)
      },
    }
    const store = await openDocStore(dir, 'main', { fs: injectedFs })
    store.doc.getText('t').insert(0, 'x') // append fails (injected ENOSPC)

    await expect(store.close()).rejects.toMatchObject({ code: 'ENOSPC' })

    // "Still closed everything": a fresh open against the same (now
    // unobstructed) fs must work normally -- close() didn't leave any
    // handle open or the store half-shut-down just because it reported
    // the error.
    const reopened = await openDocStore(dir, 'main', {})
    await reopened.close()
  })

  it('a corrupt (frame-complete but undecodable) record is truncated, and earlier state is preserved', async () => {
    const dir = await tmpDir()
    const store1 = await openDocStore(dir, 'main', {})
    store1.doc.getText('t').insert(0, 'good')
    await store1.flush()
    await store1.close()

    // Append a frame-complete record (correct length prefix, matching
    // payload length) whose payload is simply not a valid Yjs update --
    // unlike the "partial record" test, splitLogRecords sees this as a
    // complete record; only Y.applyUpdate rejects it.
    const logPath = join(dir, 'main.log')
    const garbagePayload = Buffer.from([9, 9, 9, 9, 9, 9, 9, 9])
    const garbageRecord = Buffer.alloc(4 + garbagePayload.length)
    garbageRecord.writeUInt32LE(garbagePayload.length, 0)
    garbagePayload.copy(garbageRecord, 4)
    await appendFile(logPath, garbageRecord)

    const store2 = await openDocStore(dir, 'main', {})
    expect(textOf(store2.doc)).toBe('good')

    const raw = await readFile(logPath)
    expect(raw.length).toBe(0) // truncated back to before the garbage record, then compacted

    await store2.close()
    const store3 = await openDocStore(dir, 'main', {})
    expect(textOf(store3.doc)).toBe('good')
    await store3.close()
  })

  it('500 small updates trigger compaction', async () => {
    const dir = await tmpDir()
    const store = await openDocStore(dir, 'main', { maxLogRecords: 500 })
    for (let i = 0; i < 500; i++) {
      store.doc.getText('t').insert(i, 'x')
    }
    await store.flush()

    const logPath = join(dir, 'main.log')
    const raw = await readFile(logPath)
    // Compaction should have kicked in automatically once the record count
    // threshold was hit, leaving the log empty (or at least far short of
    // 500 records worth of data) with a fresh snapshot on disk.
    expect(raw.length).toBe(0)

    const snapshotPath = join(dir, 'main.snapshot')
    const snapshotHandle = await open(snapshotPath, 'r')
    const snapshotStat = await snapshotHandle.stat()
    await snapshotHandle.close()
    expect(snapshotStat.size).toBeGreaterThan(0)

    const reopened = await openDocStore(dir, 'main', {})
    expect(textOf(reopened.doc).length).toBe(500)
    await reopened.close()
    await store.close()
  })
})
