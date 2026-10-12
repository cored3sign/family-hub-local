// Shared crash-safe file writing: write to a tmp path, fsync it, then
// rename it over the real path, retrying the rename on EPERM/EBUSY
// (antivirus and other file-lockers can cause these transiently on
// Windows). Used by both persistence.js (the Yjs snapshot) and
// hubState.js (hub.json), so the retry behavior only lives in one place.

const RENAME_RETRY_DELAYS_MS = [20, 50, 100, 250, 500]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function renameWithRetry(fs, from, to) {
  let lastErr
  for (let attempt = 0; attempt <= RENAME_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (err) {
      lastErr = err
      if (err && (err.code === 'EPERM' || err.code === 'EBUSY') && attempt < RENAME_RETRY_DELAYS_MS.length) {
        await sleep(RENAME_RETRY_DELAYS_MS[attempt])
        continue
      }
      throw err
    }
  }
  throw lastErr
}

// Best-effort directory fsync after a rename, so the rename itself (a
// directory-entry change, not file content) survives a crash too on
// filesystems/OSes that need it. Opening a directory for fsync isn't
// supported everywhere -- Windows can't do it at all, and some platforms
// refuse with EINVAL -- so every failure here is swallowed; it's a
// best-effort durability improvement, never a correctness requirement.
export async function fsyncDirectoryBestEffort(fs, dirPath) {
  let handle
  try {
    handle = await fs.open(dirPath, 'r')
    await handle.sync()
  } catch {
    // EISDIR/EPERM/EINVAL are the expected "can't fsync a directory on
    // this platform" cases; anything else is also swallowed here since
    // this is purely a best-effort durability nicety, never something a
    // caller should have to handle or crash over.
  } finally {
    if (handle) await handle.close().catch(() => {})
  }
}

// Writes `contents` to `tmpPath`, fsyncs it, renames it over `path`
// (retrying on EPERM/EBUSY), then best-effort fsyncs the containing
// directory so the rename is durable too. With `mode` the tmp file is
// created with it (and chmod'ed, best effort, in case a stale tmp file
// already existed), so the renamed file ends up with that mode.
export async function writeFileAtomic(fs, path, tmpPath, contents, { dirPath, mode } = {}) {
  const handle = mode === undefined ? await fs.open(tmpPath, 'w') : await fs.open(tmpPath, 'w', mode)
  try {
    if (mode !== undefined) await handle.chmod?.(mode).catch(() => {})
    await handle.writeFile(contents)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await renameWithRetry(fs, tmpPath, path)
  await fsyncDirectoryBestEffort(fs, dirPath ?? dirnameOf(path))
}

function dirnameOf(path) {
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? '.' : path.slice(0, idx)
}

// Private hub data: folders 0700, files 0600 (hub.json holds
// the room token). No-ops in effect on Windows.
export const PRIVATE_DIR_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600

// Creates `dir` (and parents) 0700 and tightens an existing one, best
// effort: a chmod failure (e.g. a folder owned by someone else, or a
// filesystem without modes) never stops the hub.
export async function ensurePrivateDir(fs, dir) {
  await fs.mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE })
  await fs.chmod?.(dir, PRIVATE_DIR_MODE).catch(() => {})
}

// Best-effort chmod 0600 of an existing file; a missing file is fine.
export async function tightenFile(fs, path) {
  await fs.chmod?.(path, PRIVATE_FILE_MODE).catch(() => {})
}
