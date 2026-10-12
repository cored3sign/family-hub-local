import { describe, it, expect } from 'vitest'
import { HubApiError } from '../data/sync/hubApi.js'
import { hubErrorMessage } from './devices'

describe('hubErrorMessage', () => {
  it('a hub error names its status; a network failure says the hub is not reachable', () => {
    expect(hubErrorMessage(new HubApiError(500))).toMatch(/error 500/)
    expect(hubErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Couldn't reach Family Hub/)
  })
})
