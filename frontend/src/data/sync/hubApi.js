// fetch wrappers for this computer's hub JSON API.
// Admin routes only answer the hub machine's own browser (loopback Host,
// no proxy headers); mutations also need X-Family-Hub-Admin: 1 and a JSON
// content type. fetchImpl and baseUrl are injectable for Node tests.
import { withTimeout } from './pairing.js'

export class HubApiError extends Error {
  constructor(status, code) {
    super(`Hub request failed (${status}${code ? `: ${code}` : ''})`)
    this.name = 'HubApiError'
    this.status = status
    this.code = code ?? null
  }
}

const ADMIN_HEADERS = { 'X-Family-Hub-Admin': '1', 'Content-Type': 'application/json' }

export function createHubApi({ baseUrl = '', fetchImpl } = {}) {
  // Called as a plain function (never as a method), so a browser's
  // window.fetch keeps a valid receiver.
  const doFetch = (url, init) => (fetchImpl ?? globalThis.fetch)(url, init)

  async function call(method, path, { body, admin = false, rawBody, timeoutMs } = {}) {
    const init = { method, cache: 'no-store', headers: admin ? { ...ADMIN_HEADERS } : {} }
    if (rawBody !== undefined) init.body = rawBody
    else if (body !== undefined) init.body = JSON.stringify(body)
    if (init.body !== undefined && !admin) init.headers['Content-Type'] = 'application/json'
    const res = timeoutMs
      ? await withTimeout((signal) => doFetch(`${baseUrl}${path}`, { ...init, signal }), timeoutMs)
      : await doFetch(`${baseUrl}${path}`, init)
    let json = null
    try {
      json = await res.json()
    } catch {
      // non-JSON answer
    }
    if (!res.ok) throw new HubApiError(res.status, json?.error)
    return json
  }

  return {
    // GET /api/hub/info -- loopback only.
    info: ({ timeoutMs } = {}) => call('GET', '/api/hub/info', { timeoutMs }),
    // 200 { ok } or HubApiError 409 when the family exists / another claim is fresh.
    claim: (claimId) => call('POST', '/api/hub/claim', { admin: true, body: { claimId } }),
    // backupText: the .fhub.json file's text -> { roomId, token } of the NEW room.
    restore: (backupText) => call('POST', '/api/hub/restore', { admin: true, rawBody: backupText }),
  }
}
