// What the app reports about itself, and whether a family's relay serves the same build.
import { describe, it, expect, afterEach } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appVersion, buildStamp, relayBuildStamp } from '../src/appInfo.js'
import { createFixtures, httpCall, ADMIN_HEADERS } from './helpers.js'

const fx = createFixtures()
afterEach(() => fx.cleanup())

describe('appVersion', () => {
  it('uses the version the desktop app passes in', async () => {
    expect(await appVersion({ YGGLTREE_APP_VERSION: '9.8.7' })).toBe('9.8.7')
  })

  it('reads the version from the root package when there is no override', async () => {
    expect(await appVersion({})).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('buildStamp', () => {
  it('reads the build stamp the frontend wrote', async () => {
    const dist = await fx.tmpDir('dist-')
    await writeFile(join(dist, 'version.json'), '{"version":"1792029912664"}')
    expect(await buildStamp(dist)).toBe('1792029912664')
  })

  it('is null when there is no build', async () => {
    expect(await buildStamp(await fx.tmpDir('dist-'))).toBe(null)
    expect(await buildStamp(null)).toBe(null)
  })
})

describe('relayBuildStamp', () => {
  it('asks the relay for its version file', async () => {
    const seen = []
    const fetchImpl = async (url) => {
      seen.push(url)
      return { ok: true, json: async () => ({ version: 'abc' }) }
    }
    expect(await relayBuildStamp('https://the-relay.acct.workers.dev', { fetchImpl })).toBe('abc')
    expect(seen).toEqual(['https://the-relay.acct.workers.dev/version.json'])
  })

  it('is null when the relay cannot be reached or does not answer with a version', async () => {
    expect(await relayBuildStamp('https://x.y.workers.dev', { fetchImpl: async () => { throw new TypeError('offline') } })).toBe(null)
    expect(await relayBuildStamp('https://x.y.workers.dev', { fetchImpl: async () => ({ ok: false }) })).toBe(null)
    expect(await relayBuildStamp('https://x.y.workers.dev', { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) })).toBe(null)
  })
})

describe('hub routes for the app', () => {
  it('the info route reports the app version and the devices connected', async () => {
    const hub = await fx.hub({ dataDir: await fx.tmpDir('hub-data-') })
    const res = await httpCall(hub.port, { method: 'GET', path: '/api/hub/info' })
    expect(res.status).toBe(200)
    expect(res.json.appVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(res.json.devices).toBe(0)
  })

  it('the relay update route needs the admin headers, and refuses a bad name without deploying', async () => {
    const hub = await fx.hub({ dataDir: await fx.tmpDir('hub-data-') })
    const forged = await httpCall(hub.port, { method: 'POST', path: '/api/relay/update', headers: {}, body: { name: 'x' } })
    expect(forged.status).toBe(403)
    const bad = await httpCall(hub.port, { method: 'POST', path: '/api/relay/update', headers: ADMIN_HEADERS, body: { name: '--help' } })
    expect(bad.status).toBe(400)
  })

  it('the relay version route only asks a relay address this app set up', async () => {
    const hub = await fx.hub({ dataDir: await fx.tmpDir('hub-data-') })
    const other = await httpCall(hub.port, { method: 'GET', path: '/api/relay/version?url=' + encodeURIComponent('https://example.com') })
    expect(other.status).toBe(400)
    const remote = await httpCall(hub.port, {
      method: 'GET',
      path: '/api/relay/version?url=https%3A%2F%2Fthe-relay.acct.workers.dev',
      headers: { host: 'desktop.example.com' },
    })
    expect(remote.status).toBe(403)
  })
})

