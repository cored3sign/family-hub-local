import { describe, it, expect } from 'vitest'
import { checkBuild } from './updateCheck.js'

const respond = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('checkBuild', () => {
  it('says current when the hub has this build', async () => {
    expect(await checkBuild({ fetchImpl: respond(200, { version: '42' }), buildVersion: '42' })).toBe('current')
  })

  it('says stale when the hub has a newer build', async () => {
    expect(await checkBuild({ fetchImpl: respond(200, { version: '43' }), buildVersion: '42' })).toBe('stale')
  })

  it('says unreachable when the request fails (off home Wi-Fi)', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await checkBuild({ fetchImpl, buildVersion: '42' })).toBe('unreachable')
  })

  it('says unreachable when the hub never answers in time', async () => {
    const fetchImpl = () => new Promise(() => {})
    expect(await checkBuild({ fetchImpl, buildVersion: '42', timeoutMs: 20 })).toBe('unreachable')
  })

  it('says unreachable on an error status or a malformed answer', async () => {
    expect(await checkBuild({ fetchImpl: respond(500, {}), buildVersion: '42' })).toBe('unreachable')
    expect(await checkBuild({ fetchImpl: respond(200, { version: 42 }), buildVersion: '42' })).toBe('unreachable')
  })
})
