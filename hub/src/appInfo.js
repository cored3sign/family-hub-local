// What the running app is: its version number, and its build stamp (the frontend's
// version.json, written at build time). The desktop app sets YGGLTREE_APP_VERSION from its own
// package; from source, the root package.json has the number.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_PACKAGE = fileURLToPath(new URL('../../package.json', import.meta.url))

export async function appVersion(env = process.env) {
  if (env.YGGLTREE_APP_VERSION) return env.YGGLTREE_APP_VERSION
  try {
    return JSON.parse(await readFile(ROOT_PACKAGE, 'utf8')).version ?? null
  } catch {
    return null
  }
}

// The build stamp of the app this hub serves, or null when there's no build.
export async function buildStamp(distDir) {
  if (!distDir) return null
  try {
    const parsed = JSON.parse(await readFile(join(distDir, 'version.json'), 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

// Asks a relay which build it serves. Only a relay address the app could have set up is asked,
// over https, with a short timeout. Returns null when the relay can't say.
export async function relayBuildStamp(address, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  let res
  try {
    res = await fetchImpl(`${address}/version.json`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  } catch {
    return null
  }
  if (!res.ok) return null
  const body = await res.json().catch(() => null)
  return typeof body?.version === 'string' ? body.version : null
}
