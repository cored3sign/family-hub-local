import { describe, it, expect, afterEach } from 'vitest'
import * as realFs from 'node:fs/promises'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renameWithRetry, writeFileAtomic, fsyncDirectoryBestEffort } from '../src/fsAtomic.js'

const dirs = []

async function tmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'fs-atomic-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()
    await rm(dir, { recursive: true, force: true })
  }
})

describe('renameWithRetry', () => {
  it('retries once on EPERM and then succeeds', async () => {
    const dir = await tmpDir()
    const from = join(dir, 'a.tmp')
    const to = join(dir, 'a')
    await realFs.writeFile(from, 'hello')

    let attempts = 0
    const injectedFs = {
      ...realFs,
      rename: async (...args) => {
        attempts += 1
        if (attempts === 1) {
          const err = new Error('EPERM')
          err.code = 'EPERM'
          throw err
        }
        return realFs.rename(...args)
      },
    }

    await renameWithRetry(injectedFs, from, to)
    expect(attempts).toBe(2)
    expect(await readFile(to, 'utf8')).toBe('hello')
  })

  it('retries on EBUSY and then succeeds', async () => {
    const dir = await tmpDir()
    const from = join(dir, 'b.tmp')
    const to = join(dir, 'b')
    await realFs.writeFile(from, 'busy')

    let attempts = 0
    const injectedFs = {
      ...realFs,
      rename: async (...args) => {
        attempts += 1
        if (attempts === 1) {
          const err = new Error('EBUSY')
          err.code = 'EBUSY'
          throw err
        }
        return realFs.rename(...args)
      },
    }

    await renameWithRetry(injectedFs, from, to)
    expect(attempts).toBe(2)
  })

  it('re-throws a non-retryable error immediately', async () => {
    const dir = await tmpDir()
    const from = join(dir, 'c.tmp')
    const to = join(dir, 'c')

    let attempts = 0
    const injectedFs = {
      ...realFs,
      rename: async () => {
        attempts += 1
        const err = new Error('nope')
        err.code = 'EACCES'
        throw err
      },
    }

    await expect(renameWithRetry(injectedFs, from, to)).rejects.toMatchObject({ code: 'EACCES' })
    expect(attempts).toBe(1)
  })
})

describe('writeFileAtomic', () => {
  it('writes, fsyncs, and renames into place', async () => {
    const dir = await tmpDir()
    const path = join(dir, 'file.json')
    const tmpPath = join(dir, 'file.json.tmp')
    await writeFileAtomic(realFs, path, tmpPath, 'content')
    expect(await readFile(path, 'utf8')).toBe('content')
    await expect(readFile(tmpPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('fsyncDirectoryBestEffort', () => {
  it('succeeds silently on a real directory', async () => {
    const dir = await tmpDir()
    await expect(fsyncDirectoryBestEffort(realFs, dir)).resolves.toBeUndefined()
  })

  it('swallows EISDIR/EPERM/EINVAL from an injected fs', async () => {
    for (const code of ['EISDIR', 'EPERM', 'EINVAL']) {
      const injectedFs = {
        ...realFs,
        open: async () => {
          const err = new Error(code)
          err.code = code
          throw err
        },
      }
      await expect(fsyncDirectoryBestEffort(injectedFs, '/irrelevant')).resolves.toBeUndefined()
    }
  })

  it('does not throw even on an unexpected error code', async () => {
    const injectedFs = {
      ...realFs,
      open: async () => {
        const err = new Error('weird')
        err.code = 'EWEIRD'
        throw err
      },
    }
    await expect(fsyncDirectoryBestEffort(injectedFs, '/irrelevant')).resolves.toBeUndefined()
  })
})
