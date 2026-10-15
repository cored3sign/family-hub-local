import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMenu, statusLine, needsAttention } from '../trayMenu.js'

const labels = (items) => items.filter((i) => i.label).map((i) => i.label)
const find = (items, action) => items.find((i) => i.action === action)

test('a running hub shows how many devices are connected, and offers a restart', () => {
  assert.equal(statusLine('running', 2), 'Running · 2 devices connected')
  assert.equal(statusLine('running', 1), 'Running · 1 device connected')
  assert.equal(statusLine('stopped', null), 'Not running')
  const items = buildMenu({ hub: 'running', devices: 2 })
  assert.equal(items[0].enabled, false)
  assert.equal(find(items, 'restart').label, 'Restart Yggltree')
})

test('a stopped hub offers to start, and the actions that need it are off', () => {
  const items = buildMenu({ hub: 'stopped' })
  assert.equal(find(items, 'restart').label, 'Start Yggltree')
  assert.equal(find(items, 'resetPin').enabled, false)
  assert.equal(find(items, 'addDevice').enabled, false)
  assert.equal(find(items, 'openWindow').enabled, undefined)
})

test('an outdated relay gets a dot on the update item', () => {
  assert.match(find(buildMenu({ hub: 'running', relayOutdated: true }), 'updateRelay').label, /^● Update the relay/)
  assert.equal(find(buildMenu({ hub: 'running', relayOutdated: false }), 'updateRelay').label, 'Update the relay…')
})

test('an available update adds a download item with its version', () => {
  const items = buildMenu({ hub: 'running', updateAvailable: '1.2.0' })
  assert.match(find(items, 'download').label, /Version 1\.2\.0 is available/)
  assert.equal(find(buildMenu({ hub: 'running' }), 'download'), undefined)
})

test('the switches show their saved choices, and are on by default', () => {
  const on = buildMenu({ hub: 'running', prefs: {} })
  assert.equal(find(on, 'toggleDailyUpdates').checked, true)
  assert.equal(find(on, 'toggleStartAtLogin').checked, true)
  assert.equal(find(on, 'toggleKeepAwake').checked, true)
  const off = buildMenu({ hub: 'running', prefs: { dailyUpdateCheck: false, startAtLogin: false, keepAwake: false } })
  assert.equal(find(off, 'toggleDailyUpdates').checked, false)
  assert.equal(find(off, 'toggleStartAtLogin').checked, false)
  assert.equal(find(off, 'toggleKeepAwake').checked, false)
})

test('the menu ends with About and Quit, and the leaf needs attention when something is off', () => {
  const items = buildMenu({ hub: 'running', appVersion: '1.0.0' })
  assert.deepEqual(labels(items).slice(-2), ['About Yggltree 1.0.0', 'Quit Yggltree'])
  assert.equal(needsAttention({ hub: 'running' }), false)
  assert.equal(needsAttention({ hub: 'stopped' }), true)
  assert.equal(needsAttention({ hub: 'running', relayOutdated: true }), true)
  assert.equal(needsAttention({ hub: 'running', updateAvailable: '1.2.0' }), true)
})
