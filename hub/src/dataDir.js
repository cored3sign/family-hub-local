import { access, readFile, rename } from 'node:fs/promises'

// Picks the hub's default data directory:
//   darwin  ~/Library/Application Support/Yggltree
//   win32   %APPDATA%\Yggltree (falls back to ~/AppData/Roaming/Yggltree)
//   linux   ${XDG_DATA_HOME:-~/.local/share}/yggltree
// Earlier installs kept their data in a folder named "Family Hub" on macOS and
// Windows, and "family-hub" on Linux. legacyDataDir() returns that folder, so
// the first start can move its data to the current location.
// All inputs are passed in rather than read from `process`/`os` directly, so
// tests can exercise every platform branch from a single process.
export function defaultDataDir({ platform, env, homedir }) {
  if (platform === 'darwin') {
    return join(homedir, 'Library', 'Application Support', 'Yggltree')
  }
  if (platform === 'win32') {
    const base = env.APPDATA || join(homedir, 'AppData', 'Roaming')
    return join(base, 'Yggltree')
  }
  const base = env.XDG_DATA_HOME || join(homedir, '.local', 'share')
  return join(base, 'yggltree')
}

export function legacyDataDir({ platform, env, homedir }) {
  if (platform === 'darwin') {
    return join(homedir, 'Library', 'Application Support', 'Family Hub')
  }
  if (platform === 'win32') {
    const base = env.APPDATA || join(homedir, 'AppData', 'Roaming')
    return join(base, 'Family Hub')
  }
  const base = env.XDG_DATA_HOME || join(homedir, '.local', 'share')
  return join(base, 'family-hub')
}

// Moves an existing data folder from its old name to the new one, so existing
// families keep their data. It moves only when the new folder doesn't exist
// yet and the old folder isn't in use (a running hub holds hub.lock there).
// Otherwise the old folder is used where it is. Returns { action, dir }, where
// dir is the folder to use from now on.
export async function migrateLegacyDataDir({ dataDir, legacyDir }) {
  if (legacyDir === dataDir || (await exists(dataDir)) || !(await exists(legacyDir))) {
    return { action: 'none', dir: dataDir }
  }
  if (await lockHeldByLiveProcess(join(legacyDir, 'hub.lock'))) {
    return { action: 'in-use', dir: legacyDir }
  }
  try {
    await rename(legacyDir, dataDir)
    return { action: 'moved', dir: dataDir, from: legacyDir }
  } catch (error) {
    return { action: 'failed', dir: legacyDir, error }
  }
}

// A lock whose process is still running means another copy uses this folder. A lock
// left by a process that has exited is stale, the same as the hub treats it. A lock
// that can't be read is treated as in use, to be safe.
async function lockHeldByLiveProcess(lockPath) {
  let text
  try {
    text = await readFile(lockPath, 'utf8')
  } catch {
    return false
  }
  let pid
  try {
    pid = JSON.parse(text).pid
  } catch {
    return true
  }
  if (!Number.isInteger(pid)) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// A tiny platform-agnostic join: inputs can be POSIX or Windows-style
// paths depending on the platform under test, and Node's `path.join`
// (POSIX-flavored on a POSIX host) would mangle a Windows path like
// `C:\Users\example`. Joining with the separator already present in the
// base (backslash for anything that looks like a Windows path, '/'
// otherwise) keeps each platform's own convention intact.
function join(base, ...parts) {
  const sep = base.includes('\\') ? '\\' : '/'
  const trimmedBase = base.endsWith(sep) ? base.slice(0, -1) : base
  return [trimmedBase, ...parts].join(sep)
}
