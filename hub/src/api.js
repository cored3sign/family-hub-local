// The hub's JSON API, apart from /api/health and the 404 catch-all, which
// stay in server.js. The hub only serves this computer's own browser, so
// every route here is an admin route (see admin.js).
//
//   GET  /api/hub/info           admin
//   POST /api/hub/claim          admin + mutation
//   POST /api/hub/restore        admin + mutation, body <= 512 MiB, streamed
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
import { BodyError, JSON_BODY_LIMIT, RESTORE_BODY_LIMIT, bodyText, readBody, readJsonBody } from './body.js'
import { openDocStore } from './persistence.js'

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

  // [method, handler, access] per path; access is 'admin' (read) or
  // 'mutation'.
  const ROUTES = new Map([
    ['/api/hub/info', ['GET', info, 'admin']],
    ['/api/hub/claim', ['POST', claim, 'mutation']],
    ['/api/hub/restore', ['POST', restore, 'mutation']],
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
