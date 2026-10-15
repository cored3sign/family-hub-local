import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, parseLatestRelease, checkForUpdate, dailyCheckDue, DAY_MS, DOWNLOAD_PAGE } from '../updates.js'

test('versions compare by their numbers, not as text', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1)
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0)
  assert.equal(compareVersions('1.2', '1.2.0'), 0)
  assert.equal(compareVersions('v2.0.0', '1.9.9'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1)
})

test('a release answer gives its version and page, and refuses anything else', () => {
  assert.deepEqual(parseLatestRelease({ tag_name: 'v1.2.0', html_url: 'https://example.test/r' }), {
    version: '1.2.0',
    url: 'https://example.test/r',
  })
  assert.equal(parseLatestRelease({ tag_name: 'latest' }), null)
  assert.equal(parseLatestRelease({}), null)
  assert.equal(parseLatestRelease(null), null)
  assert.equal(parseLatestRelease({ tag_name: 'v1.2.0' }).url, DOWNLOAD_PAGE)
})

test('a newer release is reported; the same or older is not', async () => {
  const newer = async () => ({ ok: true, json: async () => ({ tag_name: 'v1.1.0', html_url: 'https://x.test' }) })
  assert.deepEqual(await checkForUpdate({ currentVersion: '1.0.0', fetchImpl: newer }), { version: '1.1.0', url: 'https://x.test' })
  const same = async () => ({ ok: true, json: async () => ({ tag_name: 'v1.0.0' }) })
  assert.equal(await checkForUpdate({ currentVersion: '1.0.0', fetchImpl: same }), null)
})

test('a failed check says nothing, rather than an error', async () => {
  assert.equal(await checkForUpdate({ currentVersion: '1.0.0', fetchImpl: async () => { throw new TypeError('offline') } }), null)
  assert.equal(await checkForUpdate({ currentVersion: '1.0.0', fetchImpl: async () => ({ ok: false }) }), null)
})

test('the daily check is due when it is switched on and never ran or ran a day ago', () => {
  const now = 10 * DAY_MS
  assert.equal(dailyCheckDue({ enabled: false, lastCheckedAt: null, now }), false)
  assert.equal(dailyCheckDue({ enabled: true, lastCheckedAt: null, now }), true)
  assert.equal(dailyCheckDue({ enabled: true, lastCheckedAt: now - DAY_MS + 1000, now }), false)
  assert.equal(dailyCheckDue({ enabled: true, lastCheckedAt: now - DAY_MS, now }), true)
})
