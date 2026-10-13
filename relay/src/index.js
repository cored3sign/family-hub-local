// Family relay. Stores and forwards ENCRYPTED family changes. It never sees plaintext:
// each change is opaque bytes, encrypted on the phone before it leaves.
//
// Routes:
//   /room/<roomId>                  WebSocket. Needs the family token in the first message.
//   /room/<roomId>/subscribe        POST. Registers a phone for notifications.
//   /vapid-public-key               The public key the phones use to subscribe to notifications.
//   everything else                 The app itself (static files, see wrangler.jsonc).
//
// Protocol (JSON text messages over the WebSocket):
//   client -> relay  {type:'hello', since, auth}      auth = family token (base64url)
//   client -> relay  {type:'entry', id, data, src, quiet?}  data = base64 ciphertext; src = device id;
//                                                     quiet = a device-list update (stored, no notification)
//   relay  -> client {type:'entry', seq, id, data}
//   relay  -> client {type:'ack', id}                 stored (or already stored)
//   relay  -> client {type:'caught-up'}               history sent; live from now on
//   relay  -> client {type:'error', reason}           e.g. 'auth'
//
// Notifications: when a change arrives from one device, the other subscribed devices get a
// generic "New family update" push, at most once per subscription every 20 seconds. Quiet
// entries (device-list updates) are stored and shared, but they send no push.
// The push text is encrypted, so Apple's and Google's push services can't read it.
//
// The /dump route exists only for the test suite. It needs the secret TEST_DUMP_TOKEN, which
// a deployment doesn't have, so the route answers 404 there.

import { DurableObject } from 'cloudflare:workers'
import { buildPushPayload } from '@block65/webcrypto-web-push'

const MAX_ENTRY_BYTES = 256 * 1024
const HISTORY_PAGE = 500
const PUSH_GAP_MS = 20000
const SERVER_CONTACT = 'https://github.com/cored3sign/yggltree'
const SERVER_KEY = 'server'
const MAX_SUBSCRIPTIONS = 40
// Only the push services browsers use. The relay sends requests only to these hosts.
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com']
const PUSH_SUFFIXES = ['.push.apple.com', '.notify.windows.com']

export function isPushEndpoint(text) {
  let url
  try {
    url = new URL(text)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false
  const host = url.hostname
  return PUSH_HOSTS.includes(host) || PUSH_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/vapid-public-key') {
      const keys = await env.CONFIG.get(env.CONFIG.idFromName(SERVER_KEY)).vapid()
      return Response.json({ key: keys.publicKey })
    }
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{16,64})(\/dump|\/subscribe)?$/)
    if (!m) return new Response('not found', { status: 404 })
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request)
  },
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function toBase64Url(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toBase64(bytes) {
  return toBase64Url(bytes).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(bytes.length / 3) * 4, '=')
}

function fromBase64(text) {
  return fromBase64Url(text.replace(/\+/g, '-').replace(/\//g, '_'))
}

// One per deployment. Makes the push keys on first use, so nobody has to set a secret.
export class Config extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec('CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
  }

  async vapid() {
    let row = [...this.sql.exec("SELECT v FROM config WHERE k = 'vapid'")][0]
    if (!row) {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
      const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
      const point = new Uint8Array([4, ...fromBase64Url(jwk.x), ...fromBase64Url(jwk.y)]) // uncompressed P-256 point
      this.sql.exec("INSERT OR IGNORE INTO config (k, v) VALUES ('vapid', ?)", JSON.stringify({ publicKey: toBase64Url(point), privateKey: jwk.d }))
      row = [...this.sql.exec("SELECT v FROM config WHERE k = 'vapid'")][0]
    }
    return JSON.parse(row.v)
  }
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec('CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, data BLOB NOT NULL, at INTEGER NOT NULL)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, sub TEXT NOT NULL, src TEXT NOT NULL, last_push INTEGER NOT NULL DEFAULT 0)')
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/dump')) {
      // Test only. Off unless the secret token is set (never in a deployment).
      if (!this.env.TEST_DUMP_TOKEN || url.searchParams.get('token') !== this.env.TEST_DUMP_TOKEN) {
        return new Response('not found', { status: 404 })
      }
      const parts = [...this.sql.exec('SELECT data FROM entries ORDER BY seq')].map((r) => new Uint8Array(r.data))
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
      let offset = 0
      for (const p of parts) {
        out.set(p, offset)
        offset += p.length
      }
      return new Response(out, { headers: { 'content-type': 'application/octet-stream' } })
    }
    if (url.pathname.endsWith('/subscribe')) return this.subscribe(request)
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 })
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // A phone subscribes to notifications only with the family token, and only in a room that
  // already exists (a subscription never claims a room).
  async subscribe(request) {
    let body
    try {
      body = await request.json()
    } catch {
      return new Response('bad request', { status: 400 })
    }
    if (!(await this.authorize(body?.auth, { claim: false }))) return new Response('not authorized', { status: 401 })
    const sub = body?.subscription
    if (!sub || typeof sub.endpoint !== 'string' || !isPushEndpoint(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
      return new Response('bad request', { status: 400 })
    }
    const known = [...this.sql.exec('SELECT endpoint FROM subs')].some((row) => row.endpoint === sub.endpoint)
    if (!known && [...this.sql.exec('SELECT COUNT(*) AS n FROM subs')][0].n >= MAX_SUBSCRIPTIONS) {
      return new Response('too many devices', { status: 429 })
    }
    this.sql.exec(
      'INSERT OR REPLACE INTO subs (endpoint, sub, src, last_push) VALUES (?, ?, ?, 0)',
      sub.endpoint,
      JSON.stringify(sub),
      String(body.src ?? '')
    )
    return new Response('subscribed', { status: 201 })
  }

  // The first device to present a token claims the room. Every later connection must present
  // the same token. Only its SHA-256 hash is stored, never the token itself.
  async authorize(authB64, { claim = true } = {}) {
    if (typeof authB64 !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(authB64)) return false
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64Url(authB64)))
    const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
    if (claim) this.sql.exec("INSERT OR IGNORE INTO meta (k, v) VALUES ('auth', ?)", hex)
    const row = [...this.sql.exec("SELECT v FROM meta WHERE k = 'auth'")][0]
    return row?.v === hex
  }

  notifyOthers(src) {
    const now = Date.now()
    const from = String(src ?? '')
    for (const row of [...this.sql.exec('SELECT endpoint, sub, src, last_push FROM subs')]) {
      if (row.src === from) continue // the device that made the change doesn't need a push
      if (now - row.last_push < PUSH_GAP_MS) continue
      this.sql.exec('UPDATE subs SET last_push = ? WHERE endpoint = ?', now, row.endpoint)
      this.ctx.waitUntil(this.sendPush(row.endpoint, row.sub))
    }
  }

  async sendPush(endpoint, subJson) {
    if (!isPushEndpoint(endpoint)) return // defense in depth: never send to other hosts
    try {
      const subscription = JSON.parse(subJson)
      const keys = await this.env.CONFIG.get(this.env.CONFIG.idFromName(SERVER_KEY)).vapid()
      const vapid = { subject: SERVER_CONTACT, publicKey: keys.publicKey, privateKey: keys.privateKey }
      const message = { data: JSON.stringify({ title: 'Yggltree', body: 'New family update' }), options: { ttl: 300 } }
      const res = await fetch(endpoint, await buildPushPayload(message, subscription, vapid))
      if (res.status === 404 || res.status === 410) this.sql.exec('DELETE FROM subs WHERE endpoint = ?', endpoint)
      console.log(`push to ${new URL(endpoint).host}: ${res.status}`)
    } catch (err) {
      console.log(`push failed: ${err.message}`)
    }
  }

  async webSocketMessage(ws, message) {
    let msg
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    if (msg.type === 'hello') {
      if (!(await this.authorize(msg.auth))) {
        ws.send(JSON.stringify({ type: 'error', reason: 'auth' }))
        ws.close(4401, 'auth')
        return
      }
      ws.serializeAttachment({ authed: true })
      let since = Number(msg.since) || 0
      for (;;) {
        const rows = [...this.sql.exec('SELECT seq, id, data FROM entries WHERE seq > ? ORDER BY seq LIMIT ?', since, HISTORY_PAGE)]
        if (rows.length === 0) break
        for (const r of rows) {
          ws.send(JSON.stringify({ type: 'entry', seq: r.seq, id: r.id, data: toBase64(new Uint8Array(r.data)) }))
          since = r.seq
        }
        if (rows.length < HISTORY_PAGE) break
      }
      ws.send(JSON.stringify({ type: 'caught-up' }))
      return
    }
    if (msg.type === 'entry') {
      if (!ws.deserializeAttachment()?.authed) {
        ws.send(JSON.stringify({ type: 'error', reason: 'not-authorized' }))
        return
      }
      if (typeof msg.id !== 'string' || typeof msg.data !== 'string') return
      const bytes = fromBase64(msg.data)
      if (bytes.length > MAX_ENTRY_BYTES) {
        ws.send(JSON.stringify({ type: 'error', reason: 'entry-too-large', id: msg.id }))
        return
      }
      this.sql.exec('INSERT OR IGNORE INTO entries (id, data, at) VALUES (?, ?, ?)', msg.id, bytes, Date.now())
      const seq = [...this.sql.exec('SELECT seq FROM entries WHERE id = ?', msg.id)][0].seq
      ws.send(JSON.stringify({ type: 'ack', id: msg.id }))
      const out = JSON.stringify({ type: 'entry', seq, id: msg.id, data: msg.data })
      for (const peer of this.ctx.getWebSockets()) {
        if (peer !== ws) peer.send(out)
      }
      // A quiet entry is a device-list update, not a family change, so nobody is notified.
      if (msg.quiet !== true) this.notifyOthers(msg.src)
    }
  }

  webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason)
    } catch {}
  }

  webSocketError(ws) {
    try {
      ws.close(1011, 'error')
    } catch {}
  }
}
