import { test } from 'node:test'
import assert from 'node:assert/strict'
import { externalLinkOf } from '../links.js'

test('secure web and mail links go to the browser or mail app', () => {
  assert.equal(externalLinkOf('https://github.com/cored3sign/yggltree/releases/latest'), 'https://github.com/cored3sign/yggltree/releases/latest')
  assert.equal(externalLinkOf('mailto:family@example.com'), 'mailto:family@example.com')
})

test('other schemes never reach the system', () => {
  assert.equal(externalLinkOf('file:///Applications/Calculator.app'), null)
  assert.equal(externalLinkOf('javascript:alert(1)'), null)
  assert.equal(externalLinkOf('smb://192.0.2.10/share'), null)
  assert.equal(externalLinkOf('x-apple.systempreferences:com.apple.preference.security'), null)
  assert.equal(externalLinkOf('http://example.com/'), null)
})

test('text that is not a URL is dropped', () => {
  assert.equal(externalLinkOf(''), null)
  assert.equal(externalLinkOf('not a link'), null)
  assert.equal(externalLinkOf(undefined), null)
})
