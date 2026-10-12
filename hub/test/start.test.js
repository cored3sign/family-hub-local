// Pure parts of scripts/start.cjs (the `npm start` launcher): the Node
// version gate, the frontend source stamp, and the needs-install decision.
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { mkdir, writeFile, utimes, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createFixtures } from './helpers.js'

const require = createRequire(import.meta.url)
const start = require('../../scripts/start.cjs')

const fx = createFixtures()
afterEach(() => fx.cleanup())

describe('isNodeSupported', () => {
  it('accepts 22.12 and newer, rejects anything older', () => {
    for (const v of ['22.12.0', '22.12.1', '22.13.0', '23.0.0', '24.1.0', '100.0.0']) expect(start.isNodeSupported(v), v).toBe(true)
    for (const v of ['22.11.9', '22.0.0', '21.99.99', '20.18.0', '18.20.4', '8.17.0', '', 'garbage']) expect(start.isNodeSupported(v), v).toBe(false)
  })
})

async function frontendTree() {
  const root = await fx.tmpDir('start-root-')
  const fe = join(root, 'frontend')
  await mkdir(join(fe, 'src', 'views'), { recursive: true })
  await mkdir(join(fe, 'public', 'icons'), { recursive: true })
  await mkdir(join(fe, 'dist'), { recursive: true })
  await mkdir(join(fe, 'test-setup'), { recursive: true })
  await writeFile(join(fe, 'src', 'main.js'), 'console.log(1)')
  await writeFile(join(fe, 'src', 'views', 'A.vue'), '<template/>')
  await writeFile(join(fe, 'public', 'icons', 'i.png'), 'png')
  await writeFile(join(fe, 'index.html'), '<!doctype html>')
  await writeFile(join(fe, 'package.json'), '{}')
  await writeFile(join(fe, 'vite.config.js'), 'export default {}')
  return root
}

describe('sourceStamp', () => {
  it('is a stable sha1 hex over the listed frontend sources', async () => {
    const root = await frontendTree()
    const a = start.sourceStamp(root)
    expect(a).toMatch(/^[0-9a-f]{40}$/)
    expect(start.sourceStamp(root)).toBe(a)
  })

  it('changes when a source file changes size, mtime, name, or a file is added', async () => {
    const root = await frontendTree()
    const fe = join(root, 'frontend')
    const seen = new Set([start.sourceStamp(root)])
    const expectNew = () => {
      const s = start.sourceStamp(root)
      expect(seen.has(s)).toBe(false)
      seen.add(s)
    }
    await writeFile(join(fe, 'src', 'main.js'), 'console.log(12)') // size
    expectNew()
    await utimes(join(fe, 'src', 'views', 'A.vue'), new Date(2001, 1, 1), new Date(2001, 1, 1)) // mtime only
    expectNew()
    await rename(join(fe, 'public', 'icons', 'i.png'), join(fe, 'public', 'icons', 'j.png')) // path
    expectNew()
    await writeFile(join(fe, 'src', 'new.js'), '') // new file
    expectNew()
    for (const f of ['index.html', 'package.json', 'vite.config.js']) {
      await writeFile(join(fe, f), 'changed!!')
      expectNew()
    }
  })

  it('ignores everything outside the listed paths (dist, tests, node_modules)', async () => {
    const root = await frontendTree()
    const fe = join(root, 'frontend')
    const before = start.sourceStamp(root)
    await writeFile(join(fe, 'dist', '.source-stamp'), 'x')
    await writeFile(join(fe, 'dist', 'index.html'), 'built')
    await writeFile(join(fe, 'test-setup', 'x.js'), 'x')
    await mkdir(join(fe, 'node_modules', '.vite'), { recursive: true })
    await writeFile(join(fe, 'node_modules', '.vite', 'cache'), 'x')
    await writeFile(join(root, 'README.md'), 'x')
    expect(start.sourceStamp(root)).toBe(before)
  })

  it('works when an optional path is missing', async () => {
    const root = await frontendTree()
    const before = start.sourceStamp(root)
    await rm(join(root, 'frontend', 'public'), { recursive: true })
    const after = start.sourceStamp(root)
    expect(after).toMatch(/^[0-9a-f]{40}$/)
    expect(after).not.toBe(before)
  })
})

describe('needsInstall', () => {
  async function repo() {
    const root = await fx.tmpDir('start-root-')
    await writeFile(join(root, 'package-lock.json'), '{}')
    return root
  }

  it('is true when node_modules/.package-lock.json is missing', async () => {
    const root = await repo()
    expect(start.needsInstall(root)).toBe(true)
    await mkdir(join(root, 'node_modules'))
    expect(start.needsInstall(root)).toBe(true)
  })

  it('is true when package-lock.json is newer than the installed marker, false otherwise', async () => {
    const root = await repo()
    await mkdir(join(root, 'node_modules'))
    const marker = join(root, 'node_modules', '.package-lock.json')
    await writeFile(marker, '{}')
    const lock = join(root, 'package-lock.json')
    await utimes(marker, new Date(2020, 0, 1), new Date(2020, 0, 1))
    await utimes(lock, new Date(2021, 0, 1), new Date(2021, 0, 1))
    expect(start.needsInstall(root)).toBe(true)
    await utimes(marker, new Date(2022, 0, 1), new Date(2022, 0, 1))
    expect(start.needsInstall(root)).toBe(false)
    await utimes(marker, new Date(2021, 0, 1), new Date(2021, 0, 1)) // same mtime: installed from this lock
    expect(start.needsInstall(root)).toBe(false)
  })
})

describe('Node version messages', () => {
  it('name the real minimum (22.12) in npm start and both launchers', async () => {
    const { readFile } = await import('node:fs/promises')
    expect(start.NODE_MESSAGE).toBe(
      'Family Hub needs Node.js 22.12 or newer. Download the LTS installer from https://nodejs.org, install it, then run npm start again.'
    )
    const root = new URL('../../', import.meta.url)
    for (const name of ['Start Family Hub.command', 'Start Family Hub.bat']) {
      const text = await readFile(new URL(name, root), 'utf8')
      expect(text, name).toContain('Family Hub needs Node.js 22.12 or newer.')
      expect(text, name).not.toContain('Node.js 22 or newer')
    }
  })
})
