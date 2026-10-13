// Relay tests against the app's own relay module (frontend/src/data/relay).
// Local: `npx wrangler dev --port 8799 --ip 127.0.0.1 --local` (needs .dev.vars), then `RELAY_EXTERNAL=1 node test/run.mjs`.
// Live: also set RELAY_URL=wss://... and RELAY_TEST_TOKEN to the test-dump token.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
// The app's own copy of Yjs, so the test documents and the relay module share one instance.
import * as Y from '../../node_modules/yjs/dist/yjs.mjs'
import { newFamilyKey, deriveRoomId, deriveAuth, toBase64Url } from '../../frontend/src/data/relay/crypto.js'
import { createRelayRoom } from '../../frontend/src/data/relay/provider.js'
import { PRESENCE_ORIGIN } from '../../frontend/src/data/origins.js'
import { memoryOutbox } from '../../frontend/src/data/relay/outbox.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8799
const WS = process.env.RELAY_URL || `ws://127.0.0.1:${PORT}`
const HTTP = WS.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
const TOKEN = process.env.RELAY_TEST_TOKEN || 'local-test-token'
const MARKER = 'SECRET-MARKER-7'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function until(check, label, ms = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (check()) return Date.now() - t0
    await sleep(50)
  }
  throw new Error(`timed out: ${label}`)
}

const logLines = []
const external = process.env.RELAY_EXTERNAL === '1'
const wrangler = external
  ? { kill() {} }
  : spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--local'], {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
if (!external) {
  wrangler.stdout.on('data', (d) => logLines.push(String(d)))
  wrangler.stderr.on('data', (d) => logLines.push(String(d)))
}
process.on('exit', () => {
  try {
    wrangler.kill('SIGTERM')
  } catch {}
})

const key = newFamilyKey()
const devices = []
const memorySince = () => {
  const m = new Map()
  return { get: (r) => m.get(r) ?? null, set: (r, v) => m.set(r, v) }
}

function device(name, { key: k = key, roomId } = {}) {
  const doc = new Y.Doc()
  const conn = createRelayRoom({
    doc,
    key: k,
    roomId: roomId ?? deriveRoomId(key, 'main'),
    url: WS,
    WebSocketImpl: globalThis.WebSocket,
    outbox: memoryOutbox(),
    sinceStore: memorySince(),
    fullState: true,
    src: name,
    retryMs: 200,
  })
  const d = {
    name,
    doc,
    conn,
    add(title) {
      doc.getMap('todos').set(Math.random().toString(36).slice(2) + Date.now().toString(36), { title })
    },
    titles() {
      return Array.from(doc.getMap('todos').values()).map((v) => v.title)
    },
    has(title) {
      return d.titles().includes(title)
    },
  }
  devices.push(d)
  return d
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${HTTP}/room/${'0'.repeat(32)}`)
      if (res.status === 426 || res.status === 200) return
    } catch {}
    await sleep(500)
  }
  throw new Error('relay did not answer:\n' + logLines.join(''))
}

const results = []
async function scenario(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, ms: Date.now() - t0, detail })
    console.log(`PASS  ${name}${detail ? '  (' + detail + ')' : ''}`)
  } catch (err) {
    results.push({ name, ok: false, error: err.message })
    console.log(`FAIL  ${name}\n      ${err.message}`)
  }
}

try {
  await waitForServer()
  console.log('relay running on', HTTP)

  const A = device('A')
  const B = device('B')
  await until(() => A.conn.synced && B.conn.synced, 'A and B connect and are authorized')

  await scenario('two devices converge both ways', async () => {
    A.add(`Milk ${MARKER}`)
    B.add('Bread')
    const ms = await until(() => A.has('Bread') && B.has(`Milk ${MARKER}`), 'A and B see both items')
    return `${ms} ms`
  })

  await scenario('offline edits sync after reconnect', async () => {
    await until(() => B.conn.outboxLength === 0, 'B has nothing unconfirmed before going offline')
    B.conn.disconnect()
    try {
      A.add('Eggs')
      B.add('Tea made offline')
      assert.equal(B.conn.outboxLength, 1, 'B holds its offline edit')
    } finally {
      B.conn.reconnect()
    }
    const ms = await until(() => A.has('Tea made offline') && B.has('Eggs'), 'offline edit reaches A and A edit reaches B')
    await until(() => B.conn.outboxLength === 0, 'B outbox empties after confirmation')
    return `${ms} ms, outbox empty`
  })

  await scenario('a new device gets the full history', async () => {
    const C = device('C')
    const ms = await until(() => C.titles().length === A.titles().length, 'C catches up')
    assert.deepEqual(C.titles().sort(), A.titles().sort())
    return `${C.titles().length} items in ${ms} ms`
  })

  await scenario('the relay stores only ciphertext', async () => {
    const res = await fetch(`${HTTP}/room/${deriveRoomId(key, 'main')}/dump?token=${TOKEN}`)
    assert.equal(res.status, 200, 'the test route answers with the test token')
    const bytes = new Uint8Array(await res.arrayBuffer())
    assert.ok(bytes.length > 100, 'there is stored data to inspect')
    const text = Buffer.from(bytes).toString('latin1')
    for (const secret of [MARKER, 'Milk', 'Bread', 'Eggs', 'Tea made offline']) {
      assert.equal(text.includes(secret), false, `plaintext "${secret}" found in relay storage`)
    }
    return `${bytes.length} bytes stored, no readable text found`
  })

  await scenario('a connection without the family key is refused', async () => {
    const intruder = device('intruder', { key: newFamilyKey(), roomId: deriveRoomId(key, 'main') })
    await until(() => intruder.conn.rejected, 'relay refuses the wrong key')
    assert.equal(intruder.titles().length, 0, 'the intruder shows no items')
    return 'refused, nothing shown'
  })

  await scenario('edits made before the room is ready are not lost', async () => {
    const F = device('F')
    for (let i = 0; i < 30; i++) F.add(`early ${i}`)
    const G = device('G')
    await until(() => G.titles().filter((t) => t.startsWith('early ')).length === 30, 'G receives all 30 early edits')
    await until(() => A.titles().filter((t) => t.startsWith('early ')).length === 30, 'A receives all 30 early edits')
    await until(() => F.conn.outboxLength === 0, 'F outbox empties')
    return '30 of 30 on every device'
  })

  await scenario('a burst of 300 edits reaches another device', async () => {
    const t0 = Date.now()
    for (let i = 0; i < 300; i++) A.add(`burst ${i}`)
    await until(() => B.titles().filter((t) => t.startsWith('burst ')).length === 300, 'B receives 300 items', 30000)
    await until(() => A.conn.outboxLength === 0, 'A outbox empties', 30000)
    return `${Date.now() - t0} ms for 300 edits`
  })

  await scenario('a large edit is split and reassembled on the other device', async () => {
    const doc = A.doc
    const big = 'x'.repeat(600 * 1024) // about 600 KB of text, so three pieces
    doc.getMap('todos').set('big-note', { title: big })
    await until(() => B.doc.getMap('todos').get('big-note')?.title === big, 'B receives the large edit', 30000)
    return '600 KB arrived intact'
  })

  await scenario('the stored history is ciphertext even after the burst and the large edit', async () => {
    const res = await fetch(`${HTTP}/room/${deriveRoomId(key, 'main')}/dump?token=${TOKEN}`)
    const text = Buffer.from(new Uint8Array(await res.arrayBuffer())).toString('latin1')
    assert.equal(text.includes('burst 17'), false, 'readable text found')
    assert.equal(text.includes('xxxxxxxxxxxxxxxxxxxxxxxxxxxx'), false, 'large text found in clear')
    return 'no readable text'
  })
  await scenario('a notification subscription needs the family token', async () => {
    const res = await fetch(`${HTTP}/room/${deriveRoomId(key, 'main')}/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'a', auth: 'b' } }, src: 'x' }),
    })
    assert.equal(res.status, 401)
    return 'refused without the token'
  })

  await scenario('subscriptions only accept the browsers\' push services', async () => {
    const auth = toBase64Url(deriveAuth(key))
    const url = `${HTTP}/room/${deriveRoomId(key, 'main')}/subscribe`
    const send = (endpoint) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: { endpoint, keys: { p256dh: 'a', auth: 'b' } }, src: 'x', auth }),
      })
    assert.equal((await send('https://attacker.example/hook')).status, 400, 'a foreign host is refused')
    assert.equal((await send('http://web.push.apple.com/x')).status, 400, 'plain http is refused')
    assert.equal((await send('https://web.push.apple.com:8443/x')).status, 400, 'a non-standard port is refused')
    assert.equal((await send('https://web.push.apple.com/x')).status, 201, 'Apple is accepted')
    return 'foreign hosts refused, Apple accepted'
  })

  await scenario('a device-list update is shared, but sends no notification', async () => {
    if (external) return 'not checked: the relay logs are only visible when this test starts the relay'
    const auth = toBase64Url(deriveAuth(key))
    const watch = await fetch(`${HTTP}/room/${deriveRoomId(key, 'main')}/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: { endpoint: 'https://web.push.apple.com/watcher', keys: { p256dh: 'a', auth: 'b' } }, src: 'watcher', auth }),
    })
    assert.equal(watch.status, 201, 'a watcher subscribes')
    const mark = logLines.length
    const pushed = () => /push (to|failed)/.test(logLines.slice(mark).join(''))
    const writer = device('device-list-writer')
    writer.doc.transact(() => writer.doc.getMap('devices').set('probe', { label: 'probe' }), PRESENCE_ORIGIN)
    await until(() => A.doc.getMap('devices').has('probe'), 'A receives the device-list update')
    await sleep(1500)
    assert.equal(pushed(), false, 'a device-list update sent a notification')
    A.add('a real change')
    await until(() => pushed(), 'a real change sends a notification')
    return 'shared, no notification; a real change notified'
  })
} catch (err) {
  console.log('ERROR', err.message)
} finally {
  for (const d of devices) d.conn.destroy()
  await sleep(300)
  try {
    wrangler.kill('SIGTERM')
  } catch {}
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed} of ${results.length} scenarios passed`)
  writeFileSync(join(root, 'test', 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
  process.exit(passed === results.length && results.length > 0 ? 0 : 1)
}
