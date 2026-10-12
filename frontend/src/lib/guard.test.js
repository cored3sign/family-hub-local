import { describe, it, expect } from 'vitest'
import { decideRoute } from './guard.js'

const ready = { familyReady: true, memberId: 'm1', enabledModules: ['todos'], canSetUp: false, pendingReplace: null }
const route = (name, meta = {}) => ({ name, meta })

describe('decideRoute', () => {
  it('a freshly paired device (no family yet) goes to /connect, never /setup', () => {
    const s = { ...ready, familyReady: false, memberId: null }
    expect(decideRoute(s, route('dashboard'))).toEqual({ name: 'connect' })
    expect(decideRoute(s, route('setup'))).toEqual({ name: 'connect' })
    expect(decideRoute(s, route('connect'))).toBe(true)
  })

  it('the hub machine with an empty hub goes to /setup', () => {
    const s = { ...ready, familyReady: false, memberId: null, canSetUp: true }
    expect(decideRoute(s, route('dashboard'))).toEqual({ name: 'setup' })
    expect(decideRoute(s, route('connect'))).toEqual({ name: 'setup' })
    expect(decideRoute(s, route('setup'))).toBe(true)
  })

  it('a pending replace always goes to /connect, even with a family and a member', () => {
    const s = { ...ready, pendingReplace: { adopt: false } }
    expect(decideRoute(s, route('dashboard'))).toEqual({ name: 'connect' })
    expect(decideRoute(s, route('setup'))).toEqual({ name: 'connect' })
    expect(decideRoute(s, route('connect'))).toBe(true)
  })

  it('familyReady on /connect or /setup goes to /', () => {
    expect(decideRoute(ready, route('connect'))).toEqual({ path: '/' })
    expect(decideRoute(ready, route('setup'))).toEqual({ path: '/' })
  })

  it('no member selected goes to /profiles', () => {
    const s = { ...ready, memberId: null }
    expect(decideRoute(s, route('dashboard'))).toEqual({ name: 'profiles' })
    expect(decideRoute(s, route('profiles'))).toBe(true)
  })

  it('a stale member id (core resolves it to null) goes to /profiles', () => {
    // core.refresh() resolves fh.memberId through getMember(); an id from a
    // replaced family resolves to null, which is all the guard ever sees.
    const s = { ...ready, memberId: null }
    expect(decideRoute(s, route('todos', { moduleKey: 'todos' }))).toEqual({ name: 'profiles' })
  })

  it('a locked module goes to /', () => {
    expect(decideRoute(ready, route('shopping', { moduleKey: 'shopping' }))).toEqual({ path: '/' })
    expect(decideRoute(ready, route('todos', { moduleKey: 'todos' }))).toBe(true)
    expect(decideRoute(ready, route('dashboard'))).toBe(true)
  })
})
