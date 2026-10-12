<script setup>
// Force-update prompt on stale PWA build.
//
// Deliberately NOT service-worker-lifecycle-driven (no
// updatefound/controllerchange wiring). Instead: __APP_BUILD_VERSION__ is a
// constant baked into this bundle at build time (see vite.config.js's
// buildVersionPlugin), and on user interaction we fetch dist/version.json
// fresh -- cache: 'no-store', so a cached copy never hides a new build --
// and compare the two. A mismatch
// means a new build has been deployed since this page loaded.
//
// Interaction-triggered (not just visibility-triggered) so it works
// identically on an installed iOS PWA and Android Chrome without relying on
// any one-platform-only API -- a click/tap anywhere is available on both.
// visibilitychange is added on top (catches "left the app open, came back
// after a deploy").
import { onMounted, onUnmounted, ref } from 'vue'
import { checkBuild } from '../lib/updateCheck.js'

const CHECK_INTERVAL_MS = 60_000 // at most once/minute

const showPrompt = ref(false)
const busy = ref(false)
const error = ref('')
let lastCheckAt = 0
let checking = false

async function checkForUpdate() {
  const now = Date.now()
  if (checking || showPrompt.value) return
  if (now - lastCheckAt < CHECK_INTERVAL_MS) return
  lastCheckAt = now
  checking = true
  try {
    // Offline or unreachable: say nothing and try again on the next
    // interaction rather than nagging on every failed check.
    if ((await checkBuild({ buildVersion: __APP_BUILD_VERSION__ })) === 'stale') showPrompt.value = true
  } finally {
    checking = false
  }
}

function onInteraction() {
  checkForUpdate()
}

// capture: true so this still sees the click even when a descendant's
// handler calls stopPropagation() (several existing components do, e.g.
// NotificationBell's onClickOutside pattern) -- this listener only ever
// reads, never interferes with the app's own click handling.
onMounted(() => {
  document.addEventListener('click', onInteraction, { capture: true, passive: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
})

onUnmounted(() => {
  document.removeEventListener('click', onInteraction, { capture: true })
})

async function reload() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  // Check the family computer answers before navigating. A navigation that
  // can't reach it (the phone is off home Wi-Fi) never finishes, and the
  // page just sits there, so say so instead.
  const state = await checkBuild({ buildVersion: __APP_BUILD_VERSION__ })
  busy.value = false
  if (state === 'unreachable') {
    error.value = "Can't reach your Yggltree right now. Connect to your home Wi-Fi, then tap Update again."
    return
  }
  if (state === 'current') {
    showPrompt.value = false
    return
  }
  // location.reload() can still be served from the browser's HTTP cache;
  // rewriting the URL with a fresh cache-busting query param forces an
  // actual new navigation/request, so the new index.html and hashed bundle
  // are fetched rather than the old ones replayed.
  const base = location.href.split('?')[0]
  location.href = `${base}?_v=${Date.now()}`
}
</script>

<template>
  <div v-if="showPrompt" class="update-prompt" role="status">
    <span class="update-prompt__text">A new version of Yggltree is available.</span>
    <button type="button" class="update-prompt__btn" :disabled="busy" @click="reload">
      {{ busy ? 'Checking…' : 'Update' }}
    </button>
    <p v-if="error" class="update-prompt__error">{{ error }}</p>
  </div>
</template>
