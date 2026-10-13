import { defineStore } from 'pinia'
import { family } from '../data/family'
import { hasAdminPin, memberName, verifyAdminPin } from '../data/members'
import { afterAttempt, secondsLeft, NO_TRIES } from '../lib/pinLockout'

// After an admin enters their PIN, sensitive changes on this device don't ask
// again for this long.
export const UNLOCK_MS = 5 * 60 * 1000
const TRIES_KEY = 'fh.pin.tries'

function readTries() {
  try {
    return { ...NO_TRIES, ...JSON.parse(globalThis.localStorage?.getItem(TRIES_KEY) ?? 'null') }
  } catch {
    return { ...NO_TRIES }
  }
}

function writeTries(tries) {
  try {
    globalThis.localStorage?.setItem(TRIES_KEY, JSON.stringify(tries))
  } catch {
    // Storage blocked: the lockout can't be remembered, so it doesn't apply here.
  }
}

// The PIN prompt and the 5-minute unlock. Sensitive actions call confirmAdmin();
// picking an admin profile calls confirmMember(). The prompt itself is shown by
// components/PinPrompt.vue, mounted once at the app root.
export const useAdminLockStore = defineStore('adminLock', {
  state: () => ({
    unlockedUntil: 0,
    // { memberId, reason, unlock, error, busy, resolve } while a prompt is open.
    prompt: null,
  }),

  actions: {
    // Resolves true when the admin is confirmed (already unlocked, or the PIN is right).
    confirmAdmin(memberId, reason) {
      if (Date.now() < this.unlockedUntil) return Promise.resolve(true)
      return this.ask(memberId, reason, { unlock: true }).then((id) => id !== null)
    },

    // Resolves with the member's id once their PIN is right, or null if cancelled.
    confirmMember(memberId, reason) {
      return this.ask(memberId, reason, { unlock: false })
    },

    ask(memberId, reason, { unlock }) {
      return new Promise((resolve) => {
        this.prompt = { memberId, reason, unlock, error: '', busy: false, resolve }
      })
    },

    cancel() {
      const prompt = this.prompt
      this.prompt = null
      prompt?.resolve(null)
    },

    // Checks the PIN in the open prompt. Wrong PINs count toward a lockout kept on this device.
    async submit(pin) {
      const prompt = this.prompt
      if (!prompt || prompt.busy) return
      const now = Date.now()
      const tries = readTries()
      const waiting = secondsLeft(tries, now)
      if (waiting > 0) {
        prompt.error = `Too many wrong PINs. Wait ${waiting} seconds.`
        return
      }
      if (!hasAdminPin(family().doc, prompt.memberId)) {
        prompt.error = `${memberName(family().doc, prompt.memberId) ?? 'This admin'} has no PIN yet. Set one first.`
        return
      }
      prompt.busy = true
      let ok = false
      try {
        ok = await verifyAdminPin(family().doc, prompt.memberId, pin)
      } finally {
        prompt.busy = false
      }
      const next = afterAttempt(tries, ok, now)
      writeTries(next)
      if (!ok) {
        const wait = secondsLeft(next, now)
        prompt.error = wait > 0 ? `That PIN is wrong. Wait ${wait} seconds before trying again.` : 'That PIN is wrong.'
        return
      }
      if (prompt.unlock) this.unlockedUntil = Date.now() + UNLOCK_MS
      this.prompt = null
      prompt.resolve(prompt.memberId)
    },
  },
})
