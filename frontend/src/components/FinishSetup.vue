<script setup>
// The admin's checklist for a new family: what's left to finish setting up. It shows on the
// dashboard to admins until every step is done, so nobody has to remember the steps.
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Check } from 'lucide-vue-next'
import { useFamily, useLive } from '../data/vue'
import { listDevices } from '../data/presence.js'
import { loadRelayConfig, relayDeviceId } from '../data/relay/config.js'
import { useCoreStore } from '../stores/core'

const core = useCoreStore()
const router = useRouter()
const { doc } = useFamily()
const devices = useLive(listDevices)

const steps = computed(() => {
  const others = devices.value.filter((d) => d.id !== relayDeviceId())
  return [
    { key: 'family', label: 'Your family is set up', done: true },
    { key: 'pin', label: 'Your admin PIN is set', done: !core.needsAdminPin },
    { key: 'relay', label: 'Set up the relay, so phones can sync', done: Boolean(loadRelayConfig()), to: '/settings' },
    { key: 'device', label: 'Add a phone or another computer', done: others.length > 0, to: '/settings' },
  ]
})

const remaining = computed(() => steps.value.filter((s) => !s.done).length)
const familyName = computed(() => core.familyName || 'your family')
</script>

<template>
  <AppCard v-if="remaining > 0" class="finish-setup">
    <h2>Finish setting up {{ familyName }}</h2>
    <p class="hint">A few steps, and the family is ready. Only you see this list.</p>
    <ul class="finish-setup__steps">
      <li v-for="s in steps" :key="s.key" class="finish-setup__step" :class="{ 'finish-setup__step--done': s.done }">
        <span class="finish-setup__mark" aria-hidden="true">
          <Check v-if="s.done" :size="14" />
        </span>
        <span class="finish-setup__label">{{ s.label }}</span>
        <AppButton v-if="!s.done && s.to" variant="secondary" @click="router.push(s.to)">Open</AppButton>
      </li>
    </ul>
  </AppCard>
</template>

<style scoped>
.finish-setup h2 {
  margin: 0;
  font-size: 1.1rem;
}

.finish-setup__steps {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.finish-setup__step {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.finish-setup__mark {
  width: 22px;
  height: 22px;
  border: 2px solid var(--border);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.finish-setup__step--done .finish-setup__mark {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

.finish-setup__step--done .finish-setup__label {
  color: var(--text-muted);
  text-decoration: line-through;
}

.finish-setup__label {
  flex: 1;
  min-width: 180px;
}
</style>
