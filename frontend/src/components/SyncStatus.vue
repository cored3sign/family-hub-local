<script setup>
// Header sync indicator: a dot, an icon and
// a label for the five states, with the full message as the title. Clicking
// opens Help's Sync card. "Synced" only ever comes from the main doc's
// synced flag (status.js), never from an open socket.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, Cloud, CloudOff, Loader, WifiOff } from 'lucide-vue-next'
import { useSyncStore } from '../stores/sync'
import { SYNC_ICON, syncMessage } from '../lib/syncIndicator'

const ICONS = { AlertTriangle, Cloud, CloudOff, Loader, WifiOff }

const router = useRouter()
const sync = useSyncStore()

// "Last synced: 5m ago" in the title moves with time, not only with state.
const now = ref(new Date())
let timer = null
onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 30000)
})
onUnmounted(() => clearInterval(timer))

const icon = computed(() => ICONS[SYNC_ICON[sync.status]] ?? Cloud)
const message = computed(() => syncMessage(sync, now.value))

function openHelp() {
  router.push({ path: '/help', hash: '#sync' })
}
</script>

<template>
  <div class="sync-status">
    <button
      type="button"
      class="sync-status__trigger"
      :class="`sync-status--${sync.statusCopy.tone}`"
      :title="message"
      @click="openHelp"
    >
      <span class="sync-status__dot" aria-hidden="true" />
      <component
        :is="icon"
        :size="18"
        aria-hidden="true"
        :class="{ 'sync-status__spin': sync.status === 'connecting' }"
      />
      <span class="sync-status__label" aria-live="polite">{{ sync.statusCopy.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.sync-status {
  display: contents;
}

.sync-status__trigger {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 44px;
  min-height: 44px;
  padding: 0 10px;
  border: none;
  border-radius: 22px;
  background: none;
  /* The topbar is the accent gradient; --accent-contrast is #fff in every theme. */
  color: var(--accent-contrast);
  font: var(--type-label);
  cursor: pointer;
  transition: background-color 120ms ease;
}

.sync-status__trigger:hover {
  background: rgb(255 255 255 / 20%);
}

.sync-status__trigger:focus-visible {
  outline: 2px solid var(--accent-contrast);
  outline-offset: 2px;
}

/* State is never color alone: the icon and the label change too. */
.sync-status__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--sync-dot);
  box-shadow: 0 0 0 2px rgb(255 255 255 / 85%);
}

.sync-status--green { --sync-dot: #2e9d5b; }
.sync-status--yellow { --sync-dot: #f2c230; }
.sync-status--orange { --sync-dot: #f08a24; }
.sync-status--red { --sync-dot: #d93025; }
.sync-status--gray { --sync-dot: #9aa0a6; }

.sync-status__label {
  white-space: nowrap;
}

/* Below 600 px the label is visually hidden, not removed: it stays the
   button's accessible name and the polite live region. */
@media (max-width: 599px) {
  .sync-status__label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
}

.sync-status__spin {
  animation: sync-status-spin 1.2s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .sync-status__spin {
    animation: none;
  }
}

@keyframes sync-status-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
