<script setup>
import { computed } from 'vue'
import { pendingRelay, confirmRelayJoin, dismissRelayJoin } from '../data/relay/pending'
import { useCoreStore } from '../stores/core'
import { isIosSafariTab } from '../lib/platform'

const core = useCoreStore()
const host = computed(() => (pendingRelay.value ? new URL(pendingRelay.value.url).host : ''))
// On an iPhone Safari tab with no family, the install page owns the join (see IosInstallGuide.vue).
const hidden = computed(() => isIosSafariTab() && !core.familyReady)
</script>

<template>
  <div v-if="pendingRelay && !hidden" class="relay-join" role="dialog" aria-live="polite">
    <p><strong>Join a family relay at {{ host }}?</strong></p>
    <p class="hint">Only join a link someone in your family sent you. Once joined, this device syncs its data through that relay.</p>
    <p v-if="pendingRelay.replaces" class="error">
      This device already uses a family relay. Joining this one replaces it, and this device stops syncing with the current one.
    </p>
    <div class="relay-join__actions">
      <AppButton variant="primary" @click="confirmRelayJoin()">
        {{ pendingRelay.replaces ? 'Replace and join' : 'Join' }}
      </AppButton>
      <AppButton variant="ghost" @click="dismissRelayJoin()">Not now</AppButton>
    </div>
  </div>
</template>

<style scoped>
.relay-join {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: max(12px, env(safe-area-inset-bottom, 0px));
  z-index: 1000;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--line, #d4d1c7);
  padding: 14px;
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
}
.relay-join__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
