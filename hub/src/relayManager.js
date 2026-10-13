// Creates, replaces and erases the family's relay on the family's own Cloudflare
// account, from Settings. The Cloudflare API token is kept in the hub's data folder,
// readable only by this computer's user, and is passed to wrangler only through its
// environment. It is never sent to the browser or to the relay, and it's removed from
// any text shown to the user.

import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TOKEN_FILE = 'cloudflare.json'
export const RELAY_DIR = fileURLToPath(new URL('../../relay/', import.meta.url))
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'
const NAME = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/
const ADDRESS = /^https:\/\/([a-z0-9-]+)\.([a-z0-9-]+)\.workers\.dev$/
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,200}$/
const isWindows = process.platform === 'win32'

export class RelayError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RelayError'
  }
}

export function isRelayName(name) {
  return typeof name === 'string' && NAME.test(name)
}

export function isTokenShape(token) {
  return typeof token === 'string' && TOKEN_SHAPE.test(token)
}

// A relay's name is the first part of its address: <name>.<account>.workers.dev. Only a
// valid relay name counts, so nothing that starts with a hyphen can reach a command.
export function nameFromAddress(address) {
  const m = typeof address === 'string' ? ADDRESS.exec(address.trim().replace(/\/$/, '')) : null
  return m && isRelayName(m[1]) ? m[1] : null
}

export async function readToken(dataDir) {
  try {
    return JSON.parse(await readFile(join(dataDir, TOKEN_FILE), 'utf8'))
  } catch {
    return null
  }
}

export async function saveToken(dataDir, record) {
  await mkdir(dataDir, { recursive: true })
  const path = join(dataDir, TOKEN_FILE)
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(record), { mode: 0o600 })
  await rename(tmp, path)
  await chmod(path, 0o600)
}

export async function forgetToken(dataDir) {
  await rm(join(dataDir, TOKEN_FILE), { force: true })
}

// Asks Cloudflare which account the token can deploy to.
export async function verifyToken(token, fetchImpl = globalThis.fetch) {
  let res
  try {
    res = await fetchImpl(`${CLOUDFLARE_API}/accounts`, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    throw new RelayError("Couldn't reach Cloudflare. Check the internet connection, then try again.")
  }
  if (res.status === 401 || res.status === 403) {
    throw new RelayError("Cloudflare didn't accept that token. Check that you copied all of it, with the permissions the setup guide lists.")
  }
  const body = await res.json().catch(() => null)
  const account = Array.isArray(body?.result) ? body.result[0] : null
  if (!res.ok || !account?.id) throw new RelayError("Cloudflare didn't give an account for that token.")
  return { accountId: account.id, accountName: account.name ?? account.id }
}

// Runs a command and collects what it prints. Never throws for a non-zero exit.
export function runCommand(command, args, { cwd, env, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(isWindows ? `${command}.cmd` : command, args, { cwd, env, shell: isWindows, windowsHide: true })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', () => reject(new RelayError("Couldn't start the tools for the relay. Check that Node.js is installed.")))
    child.on('close', (code) => resolve({ code, output }))
  })
}

// Keeps the token out of anything shown to the user, and keeps the message short.
function tail(output, token) {
  const text = String(output).split(token).join('[token]').trim()
  return text.split('\n').slice(-6).join('\n').slice(-500)
}

function cloudflareEnv(token, accountId) {
  return { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId }
}

// Builds the app into the relay, then deploys the relay under the name the family chose.
export async function deployRelay({ name, token, accountId, relayDir = RELAY_DIR, run = runCommand }) {
  if (!isRelayName(name)) {
    throw new RelayError('Use 3 to 63 lowercase letters, digits or hyphens for the relay name.')
  }
  const env = cloudflareEnv(token, accountId)
  const build = await run('npm', ['run', 'build:app'], { cwd: relayDir, env })
  if (build.code !== 0) throw new RelayError(`Building the relay failed. ${tail(build.output, token)}`)
  const deploy = await run('npx', ['--no-install', 'wrangler', 'deploy', `--name=${name}`], { cwd: relayDir, env })
  if (deploy.code !== 0) throw new RelayError(`Cloudflare didn't create the relay. ${tail(deploy.output, token)}`)
  for (const m of String(deploy.output).matchAll(/https:\/\/([a-z0-9-]+)\.([a-z0-9-]+)\.workers\.dev/g)) {
    if (m[1] === name) return `https://${m[1]}.${m[2]}.workers.dev`
  }
  throw new RelayError("The relay was created, but its address wasn't found. Check the Cloudflare dashboard for the address.")
}

// Deletes the relay's worker, and with it everything the relay stored. A relay that is
// already gone counts as deleted.
export async function deleteRelay({ address, token, accountId, relayDir = RELAY_DIR, run = runCommand }) {
  const name = nameFromAddress(address)
  if (!name || !isRelayName(name)) throw new RelayError("That isn't a relay address this app set up.")
  const result = await run('npx', ['--no-install', 'wrangler', 'delete', `--name=${name}`, '--force'], {
    cwd: relayDir,
    env: cloudflareEnv(token, accountId),
  })
  const gone = /not found|does not exist|10007/i.test(result.output)
  if (result.code !== 0 && !gone) throw new RelayError(`Cloudflare didn't delete the relay. ${tail(result.output, token)}`)
  return { name }
}
