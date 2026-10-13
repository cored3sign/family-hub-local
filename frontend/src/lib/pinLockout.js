// Wrong-PIN lockout on this device. The first four wrong PINs are free. From the
// fifth on, each wrong PIN locks the device for 30 seconds, then twice as long
// each time: 30 s, 60 s, 2 min, and so on. A right PIN clears the count.
export const FREE_TRIES = 4
export const FIRST_WAIT_MS = 30_000

export const NO_TRIES = Object.freeze({ count: 0, lockedUntil: 0 })

// The tries state after one attempt.
export function afterAttempt(state, ok, now) {
  if (ok) return { ...NO_TRIES }
  const count = state.count + 1
  if (count <= FREE_TRIES) return { count, lockedUntil: 0 }
  const wait = FIRST_WAIT_MS * 2 ** (count - FREE_TRIES - 1)
  return { count, lockedUntil: now + wait }
}

// Whole seconds left before the next try is allowed (0 when not locked).
export function secondsLeft(state, now) {
  return Math.max(0, Math.ceil((state.lockedUntil - now) / 1000))
}
