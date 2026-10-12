import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadHubState } from '../src/hubState.js'

const dirs = []

async function tmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-state-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()
    await rm(dir, { recursive: true, force: true })
  }
})

function fixedRandomBytes(seed) {
  // Deterministic but distinguishable "random" bytes for tests: each call
  // gets its own incrementing fill byte (seeded so different `loadHubState`
  // calls never collide with each other), so a single state object that
  // generates more than one id/token in its lifetime -- e.g. beginNewRoom
  // followed by commitNewRoom -- still gets distinct
  // values instead of silently repeating the initial room's bytes.
  let call = 0
  return (n) => Buffer.alloc(n, seed * 10 + call++)
}

describe('loadHubState: state file', () => {
  it('a first run creates hub.json with a fresh room', async () => {
    const dir = await tmpDir()
    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(7) })
    expect(state.room.id).toMatch(/^r_[A-Za-z0-9_-]{22}$/)
    expect(state.room.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(state.room.createdAt).toBe(0)
    expect(state.room.claim).toBeNull()
    expect(state.retired).toEqual([])

    const raw = JSON.parse(await readFile(join(dir, 'hub.json'), 'utf8'))
    expect(raw.v).toBe(1)
    expect(raw.room.id).toBe(state.room.id)
    expect(raw.room.token).toBe(state.room.token)
  })

  it('a second load reads the same values back', async () => {
    const dir = await tmpDir()
    const state1 = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(1) })
    const state2 = await loadHubState(dir, { now: () => 1000, randomBytes: fixedRandomBytes(2) })
    expect(state2.room.id).toBe(state1.room.id)
    expect(state2.room.token).toBe(state1.room.token)
    expect(state2.room.createdAt).toBe(state1.room.createdAt)
  })
})

describe('checkToken', () => {
  async function stateWithRoom() {
    const dir = await tmpDir()
    return loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(3) })
  }

  it('returns ok for the right room and token', async () => {
    const state = await stateWithRoom()
    expect(state.checkToken(state.room.id, state.room.token)).toBe('ok')
  })

  it('returns bad-token for the right room and a wrong token of the same length', async () => {
    const state = await stateWithRoom()
    const wrong = state.room.token.slice(0, -1) + (state.room.token.at(-1) === 'A' ? 'B' : 'A')
    expect(state.checkToken(state.room.id, wrong)).toBe('bad-token')
  })

  it('returns bad-token (not throw) for a different-length token', async () => {
    const state = await stateWithRoom()
    expect(() => state.checkToken(state.room.id, 'short')).not.toThrow()
    expect(state.checkToken(state.room.id, 'short')).toBe('bad-token')
  })

  it('returns unknown-room for a room id that is neither current nor retired', async () => {
    const state = await stateWithRoom()
    expect(state.checkToken('r_' + 'Z'.repeat(22), state.room.token)).toBe('unknown-room')
  })

  it('returns retired for a room id present in the retired list', async () => {
    const dir = await tmpDir()
    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(4) })
    const oldRoomId = state.room.id
    const oldToken = state.room.token
    state.beginNewRoom()
    const fresh = state.beginNewRoom()
    await state.commitNewRoom(fresh.id, fresh.token)
    expect(state.isRetired(oldRoomId)).toBe(true)
    expect(state.checkToken(oldRoomId, oldToken)).toBe('retired')
  })
})

describe('claim', () => {
  it('the same id retrying succeeds', async () => {
    const dir = await tmpDir()
    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(5) })
    expect(await state.claim('claim-1', { familyExists: false, now: 0 })).toBe('ok')
    expect(await state.claim('claim-1', { familyExists: false, now: 10 })).toBe('ok')
  })

  it('a different id within 5 minutes is a conflict', async () => {
    const dir = await tmpDir()
    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(6) })
    expect(await state.claim('claim-1', { familyExists: false, now: 0 })).toBe('ok')
    expect(await state.claim('claim-2', { familyExists: false, now: 60_000 })).toBe('conflict')
  })

  it('a takeover after 5 minutes succeeds', async () => {
    const dir = await tmpDir()
    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(7) })
    expect(await state.claim('claim-1', { familyExists: false, now: 0 })).toBe('ok')
    const fiveMinutes = 5 * 60 * 1000
    expect(await state.claim('claim-2', { familyExists: false, now: fiveMinutes + 1 })).toBe('ok')
  })

  it('an existing family is a conflict, even for a fresh claim id', async () => {
    const dir = await tmpDir()
    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(8) })
    expect(await state.claim('claim-1', { familyExists: true, now: 0 })).toBe('conflict')
  })

  it('an existing family is a conflict even when retrying the same claim id that already succeeded', async () => {
    const dir = await tmpDir()
    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(9) })
    expect(await state.claim('claim-1', { familyExists: false, now: 0 })).toBe('ok')
    expect(await state.claim('claim-1', { familyExists: true, now: 10 })).toBe('conflict')
  })
})

describe('lock', () => {
  it('a second acquire fails while the holding pid is alive', async () => {
    const dir = await tmpDir()
    const state1 = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(13) })
    await state1.acquireLock()

    const state2 = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(14) })
    await expect(state2.acquireLock()).rejects.toThrow()

    await state1.releaseLock()
  })

  it('releaseLock removes the lock file', async () => {
    const dir = await tmpDir()
    const state1 = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(15) })
    await state1.acquireLock()
    await state1.releaseLock()

    await expect(readFile(join(dir, 'hub.lock'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('acquireLock takes over a hand-written stale lock file', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(lockPath, JSON.stringify({ pid: 424242, startedAt: 0 }))

    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(16) })
    await expect(state.acquireLock({ isAlive: () => false })).resolves.toBeUndefined()
    await state.releaseLock()
  })

  it('acquireLock refuses to take over a lock whose pid is alive', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(lockPath, JSON.stringify({ pid: 123, startedAt: 0 }))

    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(17) })
    await expect(state.acquireLock({ isAlive: () => true })).rejects.toThrow()
  })

  it('with the real (non-injected) liveness check, a stale pid is taken over', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const { writeFile } = await import('node:fs/promises')
    // PID 1 belongs to init/launchd and this process can never signal it,
    // so it's useless for "alive"; instead write a pid that is extremely
    // unlikely to be allocated to any running process on a dev or CI
    // machine. process.kill(pid, 0) on a genuinely unused pid throws
    // ESRCH, which is exactly the "stale" case acquireLock's default
    // isAlive treats as dead.
    const unusedPid = 999999
    await writeFile(lockPath, JSON.stringify({ pid: unusedPid, startedAt: 0 }))

    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(21) })
    await state.acquireLock() // no injected isAlive -- exercises the real process.kill(pid, 0) path
    await state.releaseLock()
  })

  it('with the real liveness check, the current (alive) process cannot be taken over', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: 0 }))

    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(22) })
    await expect(state.acquireLock()).rejects.toThrow()
  })

  it('treats an empty hub.lock file as stale and takes it over', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(lockPath, '')

    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(24) })
    await expect(state.acquireLock({ isAlive: () => true })).resolves.toBeUndefined()
    await state.releaseLock()
  })

  it('treats an unparseable hub.lock file as stale and takes it over', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(lockPath, 'not valid json{{{')

    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(25) })
    await expect(state.acquireLock({ isAlive: () => true })).resolves.toBeUndefined()
    await state.releaseLock()
  })

  it('releaseLock only unlinks the file when its pid is this process (does not remove another holder\'s lock)', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const { writeFile, readFile: readFileRaw } = await import('node:fs/promises')
    // Someone else's live lock -- not ours, and not stale.
    const otherPid = process.pid + 1 >= 2 ** 31 ? 2 : process.pid + 1
    await writeFile(lockPath, JSON.stringify({ pid: otherPid, startedAt: 0 }))

    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(26) })
    await state.releaseLock() // must be a no-op: the lock's pid isn't ours

    const stillThere = JSON.parse(await readFileRaw(lockPath, 'utf8'))
    expect(stillThere.pid).toBe(otherPid)
  })

  // A fresh double start -- B reads "no lock" (truly absent, ENOENT)
  // *before* A has created anything, then A creates its lock, then B is
  // allowed to proceed with what it decided to do after that read.
  // Unlinking unconditionally after any read outcome, including "nothing
  // found" (ENOENT swallowed as a no-op), would be wrong: B's "no-op"
  // unlink would delete A's brand-new lock, and B's own wx-create would
  // then succeed unopposed, letting both A and B believe they held the
  // lock. So the code never unlinks on an ABSENT read -- it goes straight
  // to wx, which correctly loses to A's already-created lock with EEXIST
  // and loops back to find A's lock alive.
  it('a fresh double start (no existing lock) lets exactly one of two racing processes acquire it', async () => {
    const dir = await tmpDir()
    const realFs = await import('node:fs/promises')
    const stateA = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(30) })

    // B's read of the lock file resolves immediately (seeing ENOENT,
    // since A hasn't written anything yet). Whatever B does *next* as a
    // result of that read (going straight to an exclusive-create attempt)
    // is held back until A has already created its own lock, landing the
    // test squarely in the race window: does B's post-read action blow
    // away A's fresh lock and let both succeed?
    let releaseGate
    const gate = new Promise((resolve) => {
      releaseGate = resolve
    })
    let gated = false
    function gateOnceForLockFile(real) {
      return async (path, ...rest) => {
        if (!gated && typeof path === 'string' && path.endsWith('hub.lock')) {
          gated = true
          await gate
        }
        return real(path, ...rest)
      }
    }
    const fsB = { ...realFs, unlink: gateOnceForLockFile(realFs.unlink), open: gateOnceForLockFile(realFs.open) }
    const stateB = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(31), fs: fsB })

    const pB = stateB
      .acquireLock({ pid: 222222, isAlive: () => true })
      .then(() => 'acquired', (err) => 'rejected: ' + err.message)
    await new Promise((resolve) => setTimeout(resolve, 20)) // let B's read (ENOENT) land and reach its gate
    await stateA.acquireLock({ pid: 111111, isAlive: () => true }) // A acquires, unobstructed
    releaseGate() // now let B's gated next step (unlink, or straight to wx) proceed

    const resultB = await pB
    const onDisk = JSON.parse(await realFs.readFile(join(dir, 'hub.lock'), 'utf8'))

    // Exactly one of A/B acquired. A always wins this particular timing
    // (it runs fully unobstructed while B is gated), so B must be the
    // one rejected, and the lock on disk must still be A's, untouched.
    expect(resultB).toBe('rejected: Hub data directory is already in use by pid 111111')
    expect(onDisk.pid).toBe(111111)
    await stateA.releaseLock()
  })

  it('a stale-lock takeover re-checks the file is still byte-identical before unlinking it, and re-evaluates if not (TOCTOU guard)', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const realFs = await import('node:fs/promises')
    await realFs.writeFile(lockPath, JSON.stringify({ pid: 424242, startedAt: 0 })) // stale: dead pid

    // Simulate another process replacing the stale lock with its own
    // live one between this call's first read and its unlink attempt:
    // the injected fs swaps the file's contents out from under a single
    // acquireLock() call, right after that call's first read.
    let readCount = 0
    const injectedFs = {
      ...realFs,
      readFile: async (path, ...rest) => {
        const result = await realFs.readFile(path, ...rest)
        if (typeof path === 'string' && path.endsWith('hub.lock')) {
          readCount += 1
          if (readCount === 1) {
            // Right after the first read (which judged the old content
            // stale), swap in a different, live lock before the second
            // (re-check) read happens.
            await realFs.writeFile(lockPath, JSON.stringify({ pid: 555555, startedAt: 0 }))
          }
        }
        return result
      },
    }

    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(32), fs: injectedFs })
    // isAlive: true only for the swapped-in pid 555555, so the first
    // read's pid 424242 is (correctly) judged stale, but the re-check
    // must still refuse to unlink once it sees the content changed.
    await expect(state.acquireLock({ isAlive: (pid) => pid === 555555 })).rejects.toThrow(/555555/)

    const onDisk = JSON.parse(await realFs.readFile(lockPath, 'utf8'))
    expect(onDisk.pid).toBe(555555) // untouched -- never unlinked despite the stale first read
  })

  // A and B both read the same stale lock and both judge it identical. A
  // read-recheck-then-unlink design would let both pass the recheck
  // before either actually removed the file, so whichever process's
  // unlink ran last would delete the *other* process's brand-new lock.
  // Instead the stale file is moved aside with an atomic rename and then
  // the code inspects what it actually moved -- if it turns out to be a
  // live lock that appeared in the gap (exactly what happens to B here,
  // once A has already replaced the stale lock with its own), it's
  // restored rather than discarded.
  it('a stale lock that two processes judge identical still lets only one acquire (deterministic)', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const realFs = await import('node:fs/promises')
    await realFs.writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: 0 })) // stale: dead pid

    const stateA = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(34) })

    // B's rename of the (stale) lock is gated until A has fully
    // acquired -- by the time B's rename actually runs, lockPath holds
    // A's fresh, live lock instead of the stale one B read.
    let releaseGate
    const gate = new Promise((resolve) => {
      releaseGate = resolve
    })
    const fsB = {
      ...realFs,
      rename: async (from, to) => {
        if (typeof from === 'string' && from === lockPath) await gate
        return realFs.rename(from, to)
      },
    }
    const stateB = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(35), fs: fsB })

    const alive = (pid) => pid === 111111 || pid === 222222
    const pB = stateB
      .acquireLock({ pid: 222222, isAlive: alive })
      .then(() => 'acquired', (err) => 'rejected: ' + err.message)
    await new Promise((resolve) => setTimeout(resolve, 20)) // B has read+judged stale, blocked at rename
    await stateA.acquireLock({ pid: 111111, isAlive: alive }) // A acquires, unobstructed
    releaseGate() // B's rename now moves A's fresh lock instead of the stale one

    const resultB = await pB
    expect(resultB).toBe('rejected: Hub data directory is already in use by pid 111111')

    const onDisk = JSON.parse(await realFs.readFile(lockPath, 'utf8'))
    expect(onDisk.pid).toBe(111111) // A's lock, restored and untouched
  })

  it('restores a live lock that was accidentally moved aside (the renamed file differs from what was judged stale)', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const realFs = await import('node:fs/promises')
    await realFs.writeFile(lockPath, JSON.stringify({ pid: 424242, startedAt: 0 })) // stale: dead pid

    // Swap the live lock in right after the read that judges the
    // original stale, but before this process's own rename call --
    // simulating another process's fresh lock landing in that exact
    // gap. The rename then moves the swapped-in live lock, not the
    // stale one this call originally read.
    let readCount = 0
    const injectedFs = {
      ...realFs,
      readFile: async (path, ...rest) => {
        const result = await realFs.readFile(path, ...rest)
        if (typeof path === 'string' && path === lockPath) {
          readCount += 1
          if (readCount === 1) {
            await realFs.writeFile(lockPath, JSON.stringify({ pid: 555555, startedAt: 0 }))
          }
        }
        return result
      },
    }

    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(36), fs: injectedFs })
    await expect(state.acquireLock({ isAlive: (pid) => pid === 555555 })).rejects.toThrow(/555555/)

    // The live lock (555555) must be restored at lockPath -- not left
    // stranded under its scratch name, and not deleted.
    const onDisk = JSON.parse(await realFs.readFile(lockPath, 'utf8'))
    expect(onDisk.pid).toBe(555555)
    const leftoverEntries = (await realFs.readdir(dir)).filter((name) => name.startsWith('hub.lock.stale-'))
    expect(leftoverEntries).toEqual([])
  })

  it('restores a moved-aside live lock with rename() when link() is unsupported (EPERM)', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const realFs = await import('node:fs/promises')
    await realFs.writeFile(lockPath, JSON.stringify({ pid: 424242, startedAt: 0 })) // stale: dead pid

    // Same swap as the test above, on a filesystem without hard links.
    let readCount = 0
    const injectedFs = {
      ...realFs,
      readFile: async (path, ...rest) => {
        const result = await realFs.readFile(path, ...rest)
        if (typeof path === 'string' && path === lockPath) {
          readCount += 1
          if (readCount === 1) {
            await realFs.writeFile(lockPath, JSON.stringify({ pid: 555555, startedAt: 0 }))
          }
        }
        return result
      },
      link: async () => {
        const err = new Error('EPERM: operation not permitted, link')
        err.code = 'EPERM'
        throw err
      },
    }

    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(37), fs: injectedFs })
    await expect(state.acquireLock({ isAlive: (pid) => pid === 555555 })).rejects.toThrow(/555555/)

    const onDisk = JSON.parse(await realFs.readFile(lockPath, 'utf8'))
    expect(onDisk.pid).toBe(555555)
    const leftoverEntries = (await realFs.readdir(dir)).filter((name) => name.startsWith('hub.lock.stale-'))
    expect(leftoverEntries).toEqual([])
  })

  it('throws a clear error naming both paths when neither link() nor rename() can restore a moved-aside lock', async () => {
    const dir = await tmpDir()
    const lockPath = join(dir, 'hub.lock')
    const realFs = await import('node:fs/promises')
    await realFs.writeFile(lockPath, JSON.stringify({ pid: 424242, startedAt: 0 }))

    let readCount = 0
    const injectedFs = {
      ...realFs,
      readFile: async (path, ...rest) => {
        const result = await realFs.readFile(path, ...rest)
        if (typeof path === 'string' && path === lockPath) {
          readCount += 1
          if (readCount === 1) {
            await realFs.writeFile(lockPath, JSON.stringify({ pid: 555555, startedAt: 0 }))
          }
        }
        return result
      },
      link: async () => {
        const err = new Error('EPERM: operation not permitted, link')
        err.code = 'EPERM'
        throw err
      },
      rename: async (from, to) => {
        if (typeof to === 'string' && to === lockPath) {
          const err = new Error('EACCES: permission denied, rename')
          err.code = 'EACCES'
          throw err
        }
        return realFs.rename(from, to)
      },
    }

    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(38), fs: injectedFs })
    const err = await state.acquireLock({ isAlive: (pid) => pid === 555555 }).then(
      () => null,
      (e) => e
    )
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain(lockPath)
    expect(err.message).toMatch(/hub\.lock\.stale-[0-9a-f]+/)
  })

  it('gives up after a bounded number of attempts under persistent contention, instead of looping forever', async () => {
    const dir = await tmpDir()
    const realFs = await import('node:fs/promises')
    // Every exclusive-create attempt loses to a (simulated) concurrent
    // creator -- acquireLock must eventually give up rather than retry
    // forever.
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        if (typeof path === 'string' && path.endsWith('hub.lock') && flag === 'wx') {
          const err = new Error('EEXIST')
          err.code = 'EEXIST'
          throw err
        }
        return realFs.open(path, flag)
      },
    }
    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(33), fs: injectedFs })
    await expect(state.acquireLock({ isAlive: () => false })).rejects.toThrow(/could not acquire/i)
  })
})

describe('hub.json write chain recovery', () => {
  it('a transient persist failure is recovered: a later mutation still persists, and the failure surfaces exactly once', async () => {
    const dir = await tmpDir()
    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(27) })

    const realFs = await import('node:fs/promises')
    let shouldFail = true
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        if (shouldFail && typeof path === 'string' && path.endsWith('hub.json.tmp') && flag === 'w') {
          shouldFail = false
          const err = new Error('ENOSPC: no space left on device')
          err.code = 'ENOSPC'
          throw err
        }
        return realFs.open(path, flag)
      },
    }

    const state2 = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(28), fs: injectedFs })

    // The first mutation's persist fails...
    await expect(state2.claim('claim-1', { familyExists: false, now: 0 })).rejects.toMatchObject({ code: 'ENOSPC' })
    // ...but the in-memory state still updated (claim() mutates before
    // awaiting persist), and the write chain recovered rather than
    // wedging, so a later mutation's persist succeeds normally.
    expect(state2.room.claim).toEqual({ id: 'claim-1', at: 0 })
    // Past the 5-minute window, so a different claim id takes over and persists.
    await expect(state2.claim('claim-2', { familyExists: false, now: 600_000 })).resolves.toBe('ok')

    const reloaded = await loadHubState(dir, { now: () => 1, randomBytes: fixedRandomBytes(29) })
    expect(reloaded.room.claim).toEqual({ id: 'claim-2', at: 600_000 })
  })
})

describe('loadHubState: recordLockPort', () => {
  it('adds the port to our own lock and never touches another process\'s lock', async () => {
    const dir = await tmpDir()
    const state = await loadHubState(dir)
    await state.acquireLock({ startedAt: 5 })
    await state.recordLockPort(8787)
    expect(JSON.parse(await readFile(join(dir, 'hub.lock'), 'utf8'))).toEqual({ pid: process.pid, startedAt: 5, port: 8787 })
    await state.recordLockPort(9999, { pid: process.pid + 1 })
    expect(JSON.parse(await readFile(join(dir, 'hub.lock'), 'utf8')).port).toBe(8787)
    await state.releaseLock()
  })

  it('a refusal carries code HUB_LOCKED, the holder\'s pid and port, and the lock path', async () => {
    const dir = await tmpDir()
    const a = await loadHubState(dir)
    await a.acquireLock()
    await a.recordLockPort(4321)
    const b = await loadHubState(dir)
    await expect(b.acquireLock()).rejects.toMatchObject({ code: 'HUB_LOCKED', pid: process.pid, port: 4321, lockPath: join(dir, 'hub.lock') })
    await a.releaseLock()
  })
})

describe('commitNewRoom persist failure', () => {
  it('rolls the in-memory room back so the old room stays current, and hub.json is unchanged', async () => {
    const dir = await tmpDir()
    const realFs = await import('node:fs/promises')
    let shouldFail = false
    const injectedFs = {
      ...realFs,
      open: async (path, flag) => {
        if (shouldFail && typeof path === 'string' && path.endsWith('hub.json.tmp')) {
          throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
        }
        return realFs.open(path, flag)
      },
    }
    const state = await loadHubState(dir, { now: () => 0, randomBytes: fixedRandomBytes(40), fs: injectedFs })
    const old = { ...state.room }
    const before = await readFile(join(dir, 'hub.json'), 'utf8')
    const fresh = state.beginNewRoom()
    shouldFail = true
    await expect(state.commitNewRoom(fresh.id, fresh.token)).rejects.toMatchObject({ code: 'ENOSPC' })
    shouldFail = false
    expect(state.room).toEqual(old)
    expect(state.retired).toEqual([])
    expect(state.checkToken(old.id, old.token)).toBe('ok')
    expect(state.checkToken(fresh.id, fresh.token)).toBe('unknown-room')
    expect(await readFile(join(dir, 'hub.json'), 'utf8')).toBe(before)
  })
})

describe('file permissions', () => {
  it.skipIf(process.platform === 'win32')('creates the data dir, rooms/ and backups/ 0700 and hub.json / hub.lock 0600, tightening existing ones', async () => {
    const { mkdir, chmod, writeFile, stat } = await import('node:fs/promises')
    const parent = await tmpDir()
    const fresh = join(parent, 'fresh')
    const state = await loadHubState(fresh)
    await state.acquireLock()
    await state.recordLockPort(8787)
    const mode = async (p) => (await stat(p)).mode & 0o777
    expect(await mode(fresh)).toBe(0o700)
    expect(await mode(join(fresh, 'rooms'))).toBe(0o700)
    expect(await mode(join(fresh, 'backups'))).toBe(0o700)
    expect(await mode(join(fresh, 'hub.json'))).toBe(0o600)
    expect(await mode(join(fresh, 'hub.lock'))).toBe(0o600)
    await state.releaseLock()

    // Pre-existing, too-open files and folders are tightened (best effort).
    const old = join(parent, 'old')
    await mkdir(join(old, 'rooms'), { recursive: true, mode: 0o755 })
    await chmod(old, 0o755)
    await writeFile(join(old, 'hub.json'), JSON.stringify({ v: 1, room: { id: 'r_x', token: 't', createdAt: 0, claim: null }, retired: [] }), { mode: 0o644 })
    const reopened = await loadHubState(old)
    expect(await mode(old)).toBe(0o700)
    expect(await mode(join(old, 'rooms'))).toBe(0o700)
    expect(await mode(join(old, 'hub.json'))).toBe(0o600)
    await reopened.claim('claim-3', { familyExists: false, now: 0 })
    expect(await mode(join(old, 'hub.json'))).toBe(0o600)
  })
})
