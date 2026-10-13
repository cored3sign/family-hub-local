import { describe, it, expect } from 'vitest'
import { afterAttempt, secondsLeft, NO_TRIES } from './pinLockout.js'

const T0 = 1_000_000

describe('wrong-PIN lockout', () => {
  it('leaves the first four wrong PINs free', () => {
    let s = { ...NO_TRIES }
    for (let i = 0; i < 4; i++) {
      s = afterAttempt(s, false, T0)
      expect(s.lockedUntil).toBe(0)
    }
    expect(s.count).toBe(4)
  })

  it('locks for 30 seconds on the fifth wrong PIN, then doubles', () => {
    let s = { ...NO_TRIES }
    for (let i = 0; i < 4; i++) s = afterAttempt(s, false, T0)
    s = afterAttempt(s, false, T0)
    expect(secondsLeft(s, T0)).toBe(30)
    s = afterAttempt(s, false, T0 + 30_000)
    expect(secondsLeft(s, T0 + 30_000)).toBe(60)
    s = afterAttempt(s, false, T0 + 90_000)
    expect(secondsLeft(s, T0 + 90_000)).toBe(120)
  })

  it('a right PIN clears the count', () => {
    let s = { ...NO_TRIES }
    for (let i = 0; i < 6; i++) s = afterAttempt(s, false, T0)
    expect(afterAttempt(s, true, T0)).toEqual(NO_TRIES)
  })

  it('shows no wait once it has passed', () => {
    const s = afterAttempt(afterAttempt({ ...NO_TRIES }, false, T0), false, T0)
    expect(secondsLeft({ count: 5, lockedUntil: T0 + 30_000 }, T0 + 30_000)).toBe(0)
    expect(secondsLeft({ ...NO_TRIES }, T0)).toBe(0)
    expect(s.count).toBe(2)
  })
})
