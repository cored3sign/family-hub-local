// Resetting admin PINs from the family computer.
//
// Each admin's PIN lives in the family's data (members.pin_hash). When an admin
// forgets it, the reset clears it, and each admin sets a new one the next time
// they open Yggltree. The reset is a route on the running hub, and it needs a
// token the hub writes to the data folder each time it starts. A browser tab
// on the family computer can reach the hub, but it can't read that file, so
// only someone who can read the data folder can run the reset.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic, PRIVATE_FILE_MODE } from './fsAtomic.js'

export const RESET_TOKEN_FILE = 'reset-token'
export const RESET_HEADER = 'x-family-hub-reset-token'

// A new token each time the hub starts. The file is owner-only.
export async function createResetToken(dataDir) {
  const token = randomBytes(32).toString('hex')
  const path = join(dataDir, RESET_TOKEN_FILE)
  await writeFileAtomic(fs, path, `${path}.tmp`, `${token}\n`, { dirPath: dataDir, mode: PRIVATE_FILE_MODE })
  return token
}

// The token the running hub wrote, or null when there isn't one.
export async function readResetToken(dataDir) {
  try {
    return (await fs.readFile(join(dataDir, RESET_TOKEN_FILE), 'utf8')).trim() || null
  } catch {
    return null
  }
}

// Constant-time comparison, so a wrong token leaks nothing about the right one.
export function resetTokenMatches(expected, given) {
  if (typeof expected !== 'string' || expected === '' || typeof given !== 'string') return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Clears the PIN fields of every admin in the family doc. Returns their names.
export function resetAdminPins(doc) {
  const names = []
  doc.transact(() => {
    for (const member of doc.getMap('members').values()) {
      if (member.get('role') !== 'admin') continue
      member.set('pin_salt', null)
      member.set('pin_hash', null)
      member.set('pin_set_at', null)
      names.push(member.get('name'))
    }
  })
  return names
}
