// Pairing: deciding what a room's { roomId, token } means for this computer
// (planPairing), and applying it (applyPairing -- the ONLY writer of
// config.roomId). Only the family computer's own hub is paired this way;
// phones join through the family relay (data/relay) instead.
import { nowStamp } from '../time'
import { loadHubConfig, saveHubConfig, clearProblem, clearLastSyncedAt } from './config.js'
import { isValidRoomId, isValidToken } from './protocol.js'
import { wipeLocalFamily } from './wipe.js'

// -> 'save' | 'update-token' | 'confirm-replace'
export function planPairing({ config, hasLocalFamily, incoming }) {
  if (config && config.roomId === incoming.roomId) return 'update-token'
  if (!config && !hasLocalFamily) return 'save'
  return 'confirm-replace'
}

// Plans: planPairing's three, plus 'adopt' (the hub machine uploads
// its local family into an empty hub room -- saved without wiping,
// and only after the caller's POST /api/hub/claim succeeded).
//
// 'confirm-replace' order is the point: wipe both IndexedDBs, THEN save
// the new room, THEN clear the problem flag. If the wipe throws, nothing
// is saved, so the old data stays bound to the old room.
//
// For 'confirm-replace' pass `current` (the open family): the wipe
// destroys it so its IndexedDB connections don't block the delete (a
// blocked delete rejects after a timeout and nothing is saved). The caller
// must reload afterwards.
//
// 'adopt' requires `claimed: true` -- the caller's proof that POST
// /api/hub/claim returned 200 -- so a 409 can never bind the room.
//
// -> the saved config.
export async function applyPairing({ plan, incoming, hubUrl, role, current = null, storage, wipe = wipeLocalFamily, claimed = false, now = () => new Date() }) {
  if (!['save', 'update-token', 'confirm-replace', 'adopt'].includes(plan)) throw new Error(`Unknown pairing plan: ${plan}`)
  if (plan === 'adopt' && claimed !== true) throw new Error('adopt requires a successful hub claim (claimed: true)')
  if (!isValidRoomId(incoming?.roomId) || !isValidToken(incoming?.token)) throw new Error('Invalid pairing credentials')
  const opts = { storage }
  const config = { v: 1, hubUrl, roomId: incoming.roomId, token: incoming.token, role, pairedAt: nowStamp(now()) }

  if (plan === 'update-token') {
    const existing = loadHubConfig(opts)
    if (existing && existing.roomId !== incoming.roomId) throw new Error('update-token cannot change the room')
  }
  if (plan === 'confirm-replace') await wipe({ current })

  const previousRoom = loadHubConfig(opts)?.roomId ?? null
  saveHubConfig(config, opts)
  clearProblem(opts)
  if (previousRoom !== config.roomId) clearLastSyncedAt(opts)
  return config
}

export async function withTimeout(promiseFactory, ms) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort()
      reject(new Error('timeout'))
    }, ms)
  })
  try {
    return await Promise.race([promiseFactory(controller?.signal), timeout])
  } finally {
    clearTimeout(timer)
  }
}
