import { describe, it, expect } from 'vitest'
import { memoryStorage } from '../testing'
import { readRelayFragment, loadRelayConfig, saveRelayConfig, relayPairingUrl, parseRelayLink } from './config.js'
import { newFamilyKey } from './crypto.js'
import { offerRelayJoin, pendingRelay, dismissRelayJoin } from './pending.js'

const location = (hash) => ({ hash, origin: 'https://relay.example', pathname: '/', search: '' })

describe('relay links', () => {
  it('reads the key from the fragment, removes the fragment, and saves nothing', () => {
    const key = newFamilyKey()
    const link = relayPairingUrl('https://relay.example', key)
    const calls = []
    const history = { replaceState: (_s, _t, url) => calls.push(url) }
    const storage = memoryStorage()
    const candidate = readRelayFragment(location('#' + link.split('#')[1]), history)
    expect(candidate.url).toBe('https://relay.example')
    expect(Array.from(candidate.key)).toEqual(Array.from(key))
    expect(calls).toEqual(['/'])
    expect(loadRelayConfig({ storage })).toBeNull()
  })

  it('ignores fragments that are not relay links, and still removes them', () => {
    const calls = []
    const history = { replaceState: (_s, _t, url) => calls.push(url) }
    expect(readRelayFragment(location('#pair=1.abc'), history)).toBeNull()
    expect(readRelayFragment(location('#relay=1.tooshort'), history)).toBeNull()
    expect(readRelayFragment(location(''), history)).toBeNull()
  })

  it('offers a link for confirmation, and never offers the link already in use', () => {
    const storage = memoryStorage()
    const key = newFamilyKey()
    const candidate = { url: 'https://relay.example', key }
    expect(offerRelayJoin(candidate, { storage })).toBe(true)
    expect(pendingRelay.value.replaces).toBe(false)
    saveRelayConfig(candidate, { storage })
    expect(offerRelayJoin(candidate, { storage })).toBe(false)
    expect(offerRelayJoin({ url: 'https://relay.example', key: newFamilyKey() }, { storage })).toBe(true)
    expect(pendingRelay.value.replaces).toBe(true)
    dismissRelayJoin()
    expect(pendingRelay.value).toBeNull()
  })

  it('reads a pasted family link, with or without its address', () => {
    const key = newFamilyKey()
    const link = relayPairingUrl('https://relay.example', key)
    const parsed = parseRelayLink(link)
    expect(parsed.url).toBe('https://relay.example')
    expect(Array.from(parsed.key)).toEqual(Array.from(key))
    expect(parseRelayLink('  ' + link + '  ')).not.toBeNull()
    expect(parseRelayLink('https://relay.example/')).toBeNull()
    expect(parseRelayLink('not a link')).toBeNull()
    expect(parseRelayLink('ftp://relay.example/#relay=1.' + 'A'.repeat(43))).toBeNull()
  })
})
