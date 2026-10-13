// The hub's JSON API, apart from /api/health and the 404 catch-all, which
// stay in server.js. The hub only serves this computer's own browser, so
// every route here is an admin route (see admin.js).
//
//   GET  /api/hub/info           admin
//   POST /api/hub/claim          admin + mutation
//   POST /api/hub/restore        admin + mutation, body <= 512 MiB, streamed
//   GET  /api/relay/status       admin (reads the saved connection only; starts no program)
//   POST /api/relay/check        admin + mutation (asks Wrangler whether it's logged in here)
//   POST /api/relay/login        admin + mutation (Wrangler's Cloudflare login, opens a browser page)
//   POST /api/relay/token        admin + mutation (checks the Cloudflare token, then saves it here)
//   POST /api/relay/token/forget admin + mutation
//   POST /api/relay/create       admin + mutation (optional: replace an existing relay first)
//   POST /api/relay/delete       admin + mutation (deletes the relay and everything it stored)
//   POST /api/admin/reset-pin    admin + mutation + the reset token (clears every admin PIN; see adminPin.js)
//
// Admin routes check the guard (admin.js) before anything else, including
// the method, and answer 403 with no CORS headers. No route here ever
// sets a CORS header, so a cross-origin preflight is never approved.
//
// State-changing admin work (claim, restore) runs one at a time through
// `exclusive`, so a restore's room swap can't interleave with a claim.
// A restore's upload is read *before* it queues.

import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import * as Y from 'yjs'
import { parseBackup } from '../../frontend/src/data/backupFormat.js'
import { isAdminMutationAllowed, isLocalAdminRequest } from './admin.js'
import { RESET_HEADER, resetAdminPins, resetTokenMatches } from './adminPin.js'
import { BodyError, JSON_BODY_LIMIT, RESTORE_BODY_LIMIT, bodyText, readBody, readJsonBody } from './body.js'
import { openDocStore } from './persistence.js'
import {
  RelayError,
  deleteRelay,
  deployRelay,
  forgetConnection,
  isRelayName,
  isTokenShape,
  loginWithWrangler,
  readConnection,
  saveConnection,
  verifyToken,
  wranglerAccount,
} from './relayManager.js'

const MAX_CLAIM_ID_LENGTH = 200

export function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(text)
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function createApi({
  state,
  rooms,
  dataDir,
  resetToken = null,
  getPort,
  familyExists,
  onRoomCommitted,
  limits = {},
  storeOptions = {},
  now = () => Date.now(),
  log = console,
}) {
  const jsonLimit = limits.jsonBytes ?? JSON_BODY_LIMIT
  const restoreLimit = limits.restoreBytes ?? RESTORE_BODY_LIMIT

  let chain = Promise.resolve()
  function exclusive(fn) {
    const p = chain.then(fn)
    chain = p.catch(() => {})
    return p
  }

  // --- admin ----------------------------------------------------------

  function info(req, res) {
    sendJson(res, 200, {
      roomId: state.room.id,
      token: state.room.token,
      familyExists: familyExists(),
      port: getPort(),
      dataDir,
    })
  }

  // Clears every admin's PIN. The reset token (written to the data folder when
  // the hub started) is what makes this a terminal-only action: a browser tab
  // can't read that file. See adminPin.js.
  async function resetPin(req, res) {
    if (!resetTokenMatches(resetToken, req.headers[RESET_HEADER])) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    if (!familyExists()) {
      sendJson(res, 409, { error: 'no-family' })
      return
    }
    const admins = resetAdminPins(await rooms.currentDoc('main'))
    sendJson(res, 200, { ok: true, admins })
  }

  async function claim(req, res) {
    const body = await readJsonBody(req, { limit: jsonLimit })
    const claimId = isPlainObject(body) ? body.claimId : undefined
    if (typeof claimId !== 'string' || claimId === '' || claimId.length > MAX_CLAIM_ID_LENGTH) {
      sendJson(res, 400, { error: 'bad-request' })
      return
    }
    const result = await exclusive(() => state.claim(claimId, { familyExists: familyExists(), now: now() }))
    if (result === 'ok') sendJson(res, 200, { ok: true })
    else sendJson(res, 409, { error: 'conflict' })
  }

  // Writes both docs of a brand-new room. On any failure the partial room
  // directory is removed and the error rethrown; hub.json is untouched.
  async function writeRoom(roomId, { main, assets }) {
    const dir = join(dataDir, 'rooms', roomId)
    const opened = []
    try {
      for (const [docName, update] of [
        ['main', main],
        ['assets', assets],
      ]) {
        const store = await openDocStore(dir, docName, storeOptions)
        opened.push(store)
        Y.applyUpdate(store.doc, update)
      }
      for (const store of opened.splice(0)) await store.close()
    } catch (err) {
      for (const store of opened) await store.close().catch(() => {})
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  }

  async function restore(req, res) {
    let backup
    {
      const buf = await readBody(req, { limit: restoreLimit })
      const text = bodyText(buf)
      try {
        backup = parseBackup(text)
      } catch (err) {
        sendJson(res, 400, { error: 'bad-backup', message: err.message })
        return
      }
    }
    let result
    try {
      result = await exclusive(async () => {
        const fresh = state.beginNewRoom()
        await writeRoom(fresh.id, backup)
        const oldId = state.room.id
        // The commit point: hub.json now names the new room (rolled back
        // in memory by commitNewRoom itself if the write fails).
        await state.commitNewRoom(fresh.id, fresh.token)
        // Past the commit point the restore has happened; a failure while
        // tidying up the old room is logged, never reported as a failed
        // restore.
        await Promise.resolve()
          .then(() => onRoomCommitted(oldId))
          .catch((err) => log.error?.(`[hub] retiring room ${oldId}: ${err.message}`))
        return { roomId: fresh.id, token: fresh.token }
      })
    } catch (err) {
      log.error?.(`[hub] restore failed: ${err.message}`)
      sendJson(res, 500, { error: 'restore-failed' })
      return
    }
    sendJson(res, 200, result)
  }

  // --- relay (Settings) ---------------------------------------------------

  // A RelayError carries a message for the user. Anything else is logged, and the user
  // gets a general message.
  function relayFailure(res, err) {
    if (err instanceof RelayError) return sendJson(res, 502, { error: 'relay', message: err.message })
    log.error?.(`[hub] relay: ${err?.message ?? err}`)
    return sendJson(res, 500, { error: 'relay-failed', message: 'Something went wrong with the relay. Try again.' })
  }

  // The Cloudflare access to use: a pasted token if the family chose that, otherwise
  // Wrangler's login on this computer.
  async function cloudflareAuth() {
    const saved = await readConnection(dataDir)
    if (saved) return { token: saved.token ?? null, accountId: saved.accountId ?? null }
    const account = await wranglerAccount()
    if (account) return { token: null, accountId: account.accountId }
    throw new RelayError('Connect Cloudflare first.')
  }

  // Reads the saved connection only. It starts no program, so it can't be used to run anything.
  async function relayStatus(req, res) {
    const saved = await readConnection(dataDir)
    if (saved) sendJson(res, 200, { connected: true, method: saved.token ? 'token' : 'login', accountName: saved.accountName ?? null })
    else sendJson(res, 200, { connected: false, method: null, accountName: null })
  }

  // Asks Wrangler whether it's logged in on this computer. This runs a program, so it's a
  // mutation route: only the local admin's own page can call it.
  async function relayCheck(req, res) {
    const saved = await readConnection(dataDir)
    if (saved) {
      sendJson(res, 200, { connected: true, method: saved.token ? 'token' : 'login', accountName: saved.accountName ?? null })
      return
    }
    try {
      const account = await exclusive(() => wranglerAccount())
      if (account) sendJson(res, 200, { connected: true, method: 'login', accountName: account.accountName })
      else sendJson(res, 200, { connected: false, method: null, accountName: null })
    } catch (err) {
      relayFailure(res, err)
    }
  }

  async function relayLogin(req, res) {
    try {
      const account = await exclusive(() => loginWithWrangler())
      await exclusive(() => saveConnection(dataDir, { accountId: account.accountId, accountName: account.accountName }))
      sendJson(res, 200, { connected: true, method: 'login', accountName: account.accountName })
    } catch (err) {
      relayFailure(res, err)
    }
  }

  async function relaySaveToken(req, res) {
    const body = await readJsonBody(req, { limit: jsonLimit })
    const token = isPlainObject(body) && typeof body.token === 'string' ? body.token.trim() : ''
    if (!isTokenShape(token)) {
      sendJson(res, 400, { error: 'relay', message: 'Paste the whole Cloudflare API token.' })
      return
    }
    try {
      const account = await verifyToken(token)
      await exclusive(() => saveConnection(dataDir, { token, ...account }))
      sendJson(res, 200, { connected: true, method: 'token', accountName: account.accountName })
    } catch (err) {
      relayFailure(res, err)
    }
  }

  async function relayForgetToken(req, res) {
    await forgetConnection(dataDir)
    sendJson(res, 200, { connected: false, method: null, accountName: null })
  }

  async function relayCreate(req, res) {
    const body = await readJsonBody(req, { limit: jsonLimit })
    const name = isPlainObject(body) ? body.name : undefined
    const replace = isPlainObject(body) && typeof body.replace === 'string' ? body.replace : null
    if (!isRelayName(name)) {
      sendJson(res, 400, { error: 'relay', message: 'Use 3 to 63 lowercase letters, digits or hyphens for the relay name.' })
      return
    }
    try {
      const url = await exclusive(async () => {
        const auth = await cloudflareAuth()
        if (replace) await deleteRelay({ address: replace, ...auth })
        return deployRelay({ name, ...auth })
      })
      sendJson(res, 200, { url })
    } catch (err) {
      relayFailure(res, err)
    }
  }

  async function relayDelete(req, res) {
    const body = await readJsonBody(req, { limit: jsonLimit })
    const address = isPlainObject(body) && typeof body.address === 'string' ? body.address : ''
    try {
      await exclusive(async () => {
        const auth = await cloudflareAuth()
        await deleteRelay({ address, ...auth })
      })
      sendJson(res, 200, { ok: true })
    } catch (err) {
      relayFailure(res, err)
    }
  }

  // [method, handler, access] per path; access is 'admin' (read) or
  // 'mutation'.
  const ROUTES = new Map([
    ['/api/hub/info', ['GET', info, 'admin']],
    ['/api/hub/claim', ['POST', claim, 'mutation']],
    ['/api/hub/restore', ['POST', restore, 'mutation']],
    ['/api/relay/status', ['GET', relayStatus, 'admin']],
    ['/api/relay/check', ['POST', relayCheck, 'mutation']],
    ['/api/relay/login', ['POST', relayLogin, 'mutation']],
    ['/api/relay/token', ['POST', relaySaveToken, 'mutation']],
    ['/api/relay/token/forget', ['POST', relayForgetToken, 'mutation']],
    ['/api/relay/create', ['POST', relayCreate, 'mutation']],
    ['/api/relay/delete', ['POST', relayDelete, 'mutation']],
    ['/api/admin/reset-pin', ['POST', resetPin, 'mutation']],
  ])

  // -> true if `path` is one of this module's routes (and was answered).
  function handle(req, res, path) {
    const route = ROUTES.get(path)
    if (!route) return false
    const [method, handler, access] = route
    if (access === 'admin' && !isLocalAdminRequest(req)) return forbid(req, res)
    if (access === 'mutation' && !isAdminMutationAllowed(req)) {
      // A GET (or preflight) from a genuine local admin isn't a forgery;
      // tell it the method is wrong rather than "forbidden".
      if (req.method !== method && isLocalAdminRequest(req)) return methodNotAllowed(req, res, method)
      return forbid(req, res)
    }
    if (req.method !== method) return methodNotAllowed(req, res, method)
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((err) => {
        if (err instanceof BodyError) {
          // Over the cap: answer, then drop the connection rather than
          // reading (up to hundreds of MB of) the rest of the upload.
          const close = err.status === 413
          if (!res.headersSent) sendJson(res, err.status, { error: err.code }, close ? { Connection: 'close' } : {})
          if (close) res.once('finish', () => req.destroy())
          return
        }
        log.error?.(`[hub] ${req.method} ${path} failed: ${err.message}`)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.destroy()
      })
    return true
  }

  function forbid(req, res) {
    sendJson(res, 403, { error: 'forbidden' }, { Connection: 'close' })
    req.resume()
    return true
  }

  function methodNotAllowed(req, res, allowed) {
    sendJson(res, 405, { error: 'method-not-allowed' }, { Allow: allowed })
    req.resume()
    return true
  }

  // Resolves once no state-changing admin work is queued or running.
  function idle() {
    return chain
  }

  return { handle, idle }
}
