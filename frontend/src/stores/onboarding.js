import { defineStore } from 'pinia'
import { useCoreStore } from './core'

// Kept as a real, named total (not a magic number in state()) so the step
// count is declared in exactly one place and DashboardLayout's step array
// length is the thing that must match it -- see DashboardLayout.vue's
// ONBOARDING_STEPS.
const TOTAL_STEPS = 4

// Onboarding tutorial (first-login callouts). Deliberately small and
// single-purpose -- this store only tracks tour-active
// state + step position, it does not know anything about *what* each step
// anchors to or says (that's DashboardLayout.vue's OnboardingCallout wiring).
//
// Two triggers call start():
//   1. Automatic first-login: router.js checks core.hasSeenOnboarding (the
//      persisted /me flag) and only calls start() when it's still false.
//   2. Manual replay: HelpPage.vue's "View tutorial" button calls start()
//      unconditionally, every time, regardless of that flag's value -- it
//      never reads or writes hasSeenOnboarding at all.
//
// Only close() (and next() past the last step, which routes through the
// same finish() path) ever persists the "seen" flag -- and does so
// unconditionally, so a manual replay that's later closed just re-writes an
// already-true flag, which is harmless (no special-casing needed).
export const useOnboardingStore = defineStore('onboarding', {
  state: () => ({
    active: false,
    stepIndex: 0,
    totalSteps: TOTAL_STEPS,
  }),

  getters: {
    isLastStep: (state) => state.stepIndex >= state.totalSteps - 1,
  },

  actions: {
    // Called by both triggers described above. Always resets to step 0, so
    // a manual replay after a partial/earlier run starts clean from the top.
    start() {
      this.stepIndex = 0
      this.active = true
    },

    // Advances to the next step, or finishes the tour (same net effect as
    // close()) if already on the last step -- reaching the end via repeated
    // "Next" persists has_seen_onboarding exactly like clicking "X" early
    // does.
    next() {
      if (this.isLastStep) {
        this.finish()
        return
      }
      this.stepIndex += 1
    },

    // The "X" close button: ends the tour immediately and persists
    // has_seen_onboarding = true.
    close() {
      this.finish()
    },

    // Shared by close() and next()-past-the-end: stop the tour locally, and
    // persist "seen" once (a synchronous Yjs write). Safe to call more
    // than once in a session (e.g. finishing an auto-started tour, then
    // later re-opening and closing a manual replay) -- re-writing an
    // already-true flag is a harmless no-op, so no guard is needed here.
    finish() {
      this.active = false
      useCoreStore().markOnboardingSeen()
    },
  },
})
