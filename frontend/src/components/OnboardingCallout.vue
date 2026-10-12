<script setup>
// A single positioned callout bubble, anchored to a real on-screen
// element via a CSS selector (not a template ref) -- DashboardLayout's step
// targets are a mix of elements that only sometimes exist (an empty nav
// slot, a menu that must be opened first) and elements rendered inside a
// v-for, so a plain querySelector-by-selector lookup is the simplest thing
// that works for all of them without threading refs through conditionally-
// rendered/looped markup. No existing tooltip/popover utility exists in
// this codebase to reuse instead.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({
  targetSelector: { type: String, required: true },
  text: { type: String, required: true },
  stepIndex: { type: Number, required: true }, // 0-based
  totalSteps: { type: Number, required: true },
  // Where the bubble sits relative to the target's box. Kept simple (two
  // options) since every current step anchors to something near the top or
  // bottom edge of the screen (topbar vs. bottom-nav) -- not a general
  // popover engine, just enough placement logic for this tour's own steps.
  placement: { type: String, default: 'above' }, // 'above' | 'below'
})

const emit = defineEmits(['next', 'close'])

const isLastStep = computed(() => props.stepIndex >= props.totalSteps - 1)

const style = ref({})
const highlightStyle = ref({})
// Whether a real, on-screen (non-hidden, non-zero-size) anchor was found.
// Distinct from whether the CONTROLS render -- see the template: Next/X
// always render regardless of this flag (hiding the whole bubble,
// buttons included, when the anchor is missing would leave the tour
// permanently stuck with no way to advance or dismiss
// it -- e.g. on desktop, where `.bottom-nav` is `display:none` so
// querySelector still finds `.nav-item--empty`/`.nav-fab` but they report a
// zero-size rect at (0,0), or when the FAB drawer's "More modules" link
// never mounts because openDrawer()'s empty-quick-select shortcut redirects
// to /modules instead of opening the drawer). When no real anchor is
// found, the callout falls back to an unanchored, screen-centered card with
// no highlight ring, rather than disappearing.
const anchored = ref(false)

function measure() {
  const el = document.querySelector(props.targetSelector)
  // A `display:none` ancestor (e.g. the desktop breakpoint's
  // `.bottom-nav { display: none }`) still matches querySelector but has no
  // layout box -- offsetParent is null for any element that isn't rendered
  // (fixed-position elements are the one exception, which none of this
  // tour's real targets are), and its rect collapses to 0x0. Treat both as
  // "not really there" rather than trusting a zero-size rect at (0,0).
  const rect = el ? el.getBoundingClientRect() : null
  const isRealAnchor = Boolean(el) && el.offsetParent !== null && rect.width > 0 && rect.height > 0

  if (!isRealAnchor) {
    anchored.value = false
    style.value = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    }
    return
  }

  anchored.value = true
  highlightStyle.value = {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }

  const gap = 12
  if (props.placement === 'below') {
    style.value = {
      top: `${rect.bottom + gap}px`,
      left: `${Math.max(16, Math.min(rect.left, window.innerWidth - 296))}px`,
    }
  } else {
    style.value = {
      bottom: `${window.innerHeight - rect.top + gap}px`,
      left: `${Math.max(16, Math.min(rect.left, window.innerWidth - 296))}px`,
    }
  }
}

function scheduleMeasure() {
  // nextTick: a step change can coincide with markup that only just
  // appeared (e.g. a menu opened programmatically right before this step
  // shows) -- wait for the DOM to settle before measuring it.
  nextTick(measure)
}

watch(() => [props.targetSelector, props.placement], scheduleMeasure)

onMounted(() => {
  scheduleMeasure()
  window.addEventListener('resize', measure)
  window.addEventListener('scroll', measure, true)
})

onUnmounted(() => {
  window.removeEventListener('resize', measure)
  window.removeEventListener('scroll', measure, true)
})
</script>

<template>
  <Teleport to="body">
    <div class="onboarding-overlay">
      <div v-if="anchored" class="onboarding-highlight" :style="highlightStyle" />
      <!-- Controls always render, anchored or not (see measure()'s comment)
           -- Next/X must never disappear, or the tour has no way out. -->
      <div class="onboarding-callout" :class="{ 'onboarding-callout--unanchored': !anchored }" :style="style" role="dialog" aria-modal="true" aria-label="Guided tour">
        <button type="button" class="onboarding-callout__close" aria-label="Close tutorial" @click="emit('close')">
          <X :size="16" />
        </button>
        <p class="onboarding-callout__text">{{ text }}</p>
        <div class="onboarding-callout__footer">
          <span class="onboarding-callout__step">{{ stepIndex + 1 }} / {{ totalSteps }}</span>
          <button type="button" class="onboarding-callout__next" @click="emit('next')">
            {{ isLastStep ? 'Got it' : 'Next' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  pointer-events: none;
}

.onboarding-highlight {
  position: fixed;
  border-radius: 14px;
  box-shadow: 0 0 0 4px var(--accent), 0 0 0 9999px rgba(0, 0, 0, 0.45);
  /* No transition on top/left/width/height: those are layout properties --
     animating them forces a reflow every frame. This box only moves between steps, a handful of times per
     member ever, between differently-sized/shaped targets (a nav slot, the
     FAB, the topbar avatar) -- a transform-based glide would need extra
     scale-distortion math for little payoff on a first-login-only UI, so it
     snaps to each new target instantly instead of animating the move. */
}

.onboarding-callout {
  position: fixed;
  width: 280px;
  max-width: calc(100vw - 32px);
  background: var(--surface);
  color: var(--text);
  border-radius: 16px;
  box-shadow: var(--elevation-3);
  padding: 16px;
  pointer-events: auto;
}

/* Fallback for a step whose real anchor couldn't be resolved (see
   measure()'s comment) -- a full-screen dim scrim behind the centered card
   substitutes for the missing highlight ring, so the step still reads as
   "something's being pointed out" rather than a stray floating box. */
.onboarding-callout--unanchored {
  box-shadow: var(--elevation-3), 0 0 0 9999px rgba(0, 0, 0, 0.45);
}

.onboarding-callout__close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 50%;
  color: var(--text-muted);
  cursor: pointer;
}

.onboarding-callout__close:hover {
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.onboarding-callout__text {
  margin: 0 22px 14px 0;
  font: var(--type-body);
}

.onboarding-callout__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.onboarding-callout__step {
  font: var(--type-label);
  color: var(--text-muted);
}

.onboarding-callout__next {
  min-height: 36px;
  padding: 0 16px;
  border: none;
  border-radius: 10px;
  background: var(--accent);
  color: var(--accent-contrast);
  font: var(--type-label);
  font-weight: 700;
  cursor: pointer;
}
</style>
