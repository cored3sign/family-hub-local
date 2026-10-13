#!/usr/bin/env node
// Clears every admin's PIN, for an admin who has forgotten theirs. Run it on
// the family computer while Yggltree is running:
//
//   npm run reset-admin-pin
//
// It asks first (unless you pass --yes). Each admin sets a new PIN the next
// time they open Yggltree. The command needs the reset token that Yggltree
// wrote to its data folder when it started, so only someone who can read that
// folder can run it.
//
// Options: --port <n> (default 8787), --data <dir>, --yes.

import { createInterface } from 'node:readline/promises'
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { defaultDataDir } from './dataDir.js'
import { RESET_HEADER, readResetToken } from './adminPin.js'

const DEFAULT_PORT = 8787

const USAGE = 'Usage: npm run reset-admin-pin -- [--port 8787] [--data <dir>] [--yes]'

export async function runResetAdminPin({
  argv = process.argv.slice(2),
  env = process.env,
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  ask = defaultAsk,
  out = (line) => console.log(line),
  fail = (line) => console.error(line),
} = {}) {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        port: { type: 'string' },
        data: { type: 'string' },
        yes: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }))
  } catch (err) {
    fail(`${err.message}\n${USAGE}`)
    return 2
  }
  if (values.help) {
    out(USAGE)
    return 0
  }

  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`Invalid --port: ${values.port}`)
    return 2
  }
  const dataDir = values.data ?? env.YGGLTREE_DATA ?? env.FAMILY_HUB_DATA ?? defaultDataDir({ platform, env, homedir: homedir() })

  const token = await readResetToken(dataDir)
  if (!token) {
    fail(`Yggltree hasn't started on this computer yet, or its data is somewhere else (${dataDir}).\nStart Yggltree, then run this again.`)
    return 1
  }

  if (!values.yes) {
    const answer = await ask('Clear every admin PIN? Each admin sets a new one the next time they open Yggltree. [y/N] ')
    if (!/^y(es)?$/i.test(answer.trim())) {
      out('Nothing changed.')
      return 0
    }
  }

  let res
  try {
    res = await fetchImpl(`http://127.0.0.1:${port}/api/admin/reset-pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-family-hub-admin': '1', [RESET_HEADER]: token },
      body: '{}',
    })
  } catch {
    fail(`Yggltree isn't running on this computer. Start Yggltree, then run this again.`)
    return 1
  }

  if (res.status === 200) {
    const body = await res.json().catch(() => ({ admins: [] }))
    const names = Array.isArray(body.admins) ? body.admins : []
    out(names.length ? `Cleared the admin PIN for: ${names.join(', ')}.` : 'There are no admins to reset.')
    out('Each admin sets a new PIN the next time they open Yggltree.')
    return 0
  }
  if (res.status === 403) {
    fail('Yggltree refused the reset. Restart Yggltree on this computer, then run this again.')
    return 1
  }
  if (res.status === 409) {
    fail('This computer has no family yet, so there is no PIN to reset.')
    return 1
  }
  fail(`Yggltree answered with an error (${res.status}). Check that it is running, then try again.`)
  return 1
}

async function defaultAsk(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runResetAdminPin()
}
