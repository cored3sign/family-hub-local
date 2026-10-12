import { describe, it, expect } from 'vitest'
import { defaultDataDir } from '../src/dataDir.js'

// Expected values are literal strings, not built with node:path.join --
// join() is POSIX-flavored on a POSIX test runner and would mangle the
// Windows-style inputs/outputs in the win32 cases. Paths follow
// the platform conventions: "Family Hub" (capitalized, with a space) on
// darwin/win32, lowercase hyphenated "family-hub" on linux.
describe('defaultDataDir', () => {
  it('darwin: ~/Library/Application Support/Yggltree', () => {
    const dir = defaultDataDir({ platform: 'darwin', env: {}, homedir: '/Users/example' })
    expect(dir).toBe('/Users/example/Library/Application Support/Yggltree')
  })

  it('win32: uses APPDATA when set', () => {
    const dir = defaultDataDir({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\example\\AppData\\Roaming' },
      homedir: 'C:\\Users\\example',
    })
    expect(dir).toBe('C:\\Users\\example\\AppData\\Roaming\\Yggltree')
  })

  it('win32: falls back to ~/AppData/Roaming/Yggltree when APPDATA is unset', () => {
    const dir = defaultDataDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\example' })
    expect(dir).toBe('C:\\Users\\example\\AppData\\Roaming\\Yggltree')
  })

  it('linux: uses XDG_DATA_HOME when set', () => {
    const dir = defaultDataDir({
      platform: 'linux',
      env: { XDG_DATA_HOME: '/home/example/.data' },
      homedir: '/home/example',
    })
    expect(dir).toBe('/home/example/.data/yggltree')
  })

  it('linux: falls back to homedir/.local/share when XDG_DATA_HOME is unset', () => {
    const dir = defaultDataDir({ platform: 'linux', env: {}, homedir: '/home/example' })
    expect(dir).toBe('/home/example/.local/share/yggltree')
  })
})
