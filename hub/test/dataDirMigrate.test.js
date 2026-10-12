import { describe, it, expect } from 'vitest'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { legacyDataDir, migrateLegacyDataDir } from '../src/dataDir.js'

const exists = (p) => access(p).then(() => true, () => false)

async function fresh() {
  const root = await mkdtemp(join(tmpdir(), 'yggltree-migrate-'))
  return { root, legacy: join(root, 'Family Hub'), next: join(root, 'Yggltree') }
}

describe('legacyDataDir', () => {
  it('points at the old folder names on each platform', () => {
    expect(legacyDataDir({ platform: 'darwin', env: {}, homedir: '/Users/example' })).toBe(
      '/Users/example/Library/Application Support/Family Hub',
    )
    expect(legacyDataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\example\\AppData\\Roaming' }, homedir: 'C:\\Users\\example' })).toBe(
      'C:\\Users\\example\\AppData\\Roaming\\Family Hub',
    )
    expect(legacyDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/home/example/.data' }, homedir: '/home/example' })).toBe(
      '/home/example/.data/family-hub',
    )
  })
})

describe('migrateLegacyDataDir', () => {
  it('moves an existing old folder to the new name, with its data', async () => {
    const { legacy, next } = await fresh()
    await mkdir(join(legacy, 'backups'), { recursive: true })
    await writeFile(join(legacy, 'hub.json'), '{"room":"r"}')
    const result = await migrateLegacyDataDir({ dataDir: next, legacyDir: legacy })
    expect(result).toMatchObject({ action: 'moved', dir: next, from: legacy })
    expect(await readFile(join(next, 'hub.json'), 'utf8')).toBe('{"room":"r"}')
    expect(await exists(legacy)).toBe(false)
  })

  it('leaves things alone when the new folder already exists', async () => {
    const { legacy, next } = await fresh()
    await mkdir(legacy, { recursive: true })
    await mkdir(next, { recursive: true })
    const result = await migrateLegacyDataDir({ dataDir: next, legacyDir: legacy })
    expect(result).toEqual({ action: 'none', dir: next })
    expect(await exists(legacy)).toBe(true)
  })

  it('does nothing when there is no old folder', async () => {
    const { legacy, next } = await fresh()
    expect(await migrateLegacyDataDir({ dataDir: next, legacyDir: legacy })).toEqual({ action: 'none', dir: next })
    expect(await exists(next)).toBe(false)
  })

  it('keeps using the old folder while another copy is running from it', async () => {
    const { legacy, next } = await fresh()
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'hub.lock'), '{"pid":123}')
    const result = await migrateLegacyDataDir({ dataDir: next, legacyDir: legacy })
    expect(result).toEqual({ action: 'in-use', dir: legacy })
    expect(await exists(legacy)).toBe(true)
    expect(await exists(next)).toBe(false)
  })

  it('treats identical paths as nothing to move', async () => {
    const { legacy } = await fresh()
    await mkdir(legacy, { recursive: true })
    expect(await migrateLegacyDataDir({ dataDir: legacy, legacyDir: legacy })).toEqual({ action: 'none', dir: legacy })
  })
})
