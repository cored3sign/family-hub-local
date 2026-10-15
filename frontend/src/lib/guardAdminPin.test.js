import { describe, it, expect } from 'vitest'
import { decideRoute } from './guard.js'

const ready = { familyReady: true, memberId: 'm1', canSetUp: false, pendingReplace: null, needsAdminPin: false }
const route = (name, meta = {}) => ({ name, meta })

describe('an admin with no PIN yet', () => {
  it('is sent to the PIN page before anything else', () => {
    const s = { ...ready, needsAdminPin: true }
    expect(decideRoute(s, route('dashboard'))).toEqual({ name: 'set-pin' })
    expect(decideRoute(s, route('settings'))).toEqual({ name: 'set-pin' })
    expect(decideRoute(s, route('set-pin'))).toBe(true)
  })

  it('leaves the PIN page once a PIN is set', () => {
    expect(decideRoute(ready, route('set-pin'))).toEqual({ path: '/' })
    expect(decideRoute(ready, route('dashboard'))).toBe(true)
  })

  it('can still switch profile, so nobody is stuck on one profile', () => {
    const s = { ...ready, memberId: null, needsAdminPin: true }
    expect(decideRoute(s, route('dashboard'))).toEqual({ name: 'profiles' })
  })
})
