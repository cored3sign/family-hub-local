import { describe, it, expect } from 'vitest'
import { relayVersionState, relayNameOf } from './version.js'

describe('relayVersionState', () => {
  it('is current when the relay serves this build', () => {
    expect(relayVersionState({ upToDate: true, relayBuild: '1', localBuild: '1' })).toBe('current')
  })

  it('is outdated when the relay serves another build', () => {
    expect(relayVersionState({ upToDate: false, relayBuild: '1', localBuild: '2' })).toBe('outdated')
  })

  it('is unknown when either side could not say', () => {
    expect(relayVersionState({ upToDate: false, relayBuild: null, localBuild: '2' })).toBe('unknown')
    expect(relayVersionState({ upToDate: false, relayBuild: '1', localBuild: null })).toBe('unknown')
    expect(relayVersionState({})).toBe('unknown')
  })
})

describe('relayNameOf', () => {
  it('takes the name from a relay address', () => {
    expect(relayNameOf('https://the-relay.acct-sub.workers.dev')).toBe('the-relay')
    expect(relayNameOf('https://the-relay.acct-sub.workers.dev/')).toBe('the-relay')
  })

  it('refuses anything that is not a workers.dev relay address', () => {
    expect(relayNameOf('http://the-relay.acct.workers.dev')).toBe(null)
    expect(relayNameOf('https://example.com')).toBe(null)
    expect(relayNameOf('https://--help.acct.workers.dev')).toBe(null)
    expect(relayNameOf(undefined)).toBe(null)
  })
})
