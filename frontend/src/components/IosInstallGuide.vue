<script setup>
// Step 1 of 2 on iPhone: put Family Hub on the Home Screen. Step 2 is a second
// scan, made inside the new icon, because iPhone keeps a Home Screen app's data
// apart from Safari. "Use in Safari instead" joins right here when the scan
// brought a family link, and otherwise hands over to the normal join screen.
import { Share } from 'lucide-vue-next'
import { pendingRelay, confirmRelayJoin } from '../data/relay/pending.js'

const emit = defineEmits(['safari-instead'])

function useInSafari() {
  if (pendingRelay.value) confirmRelayJoin()
  else emit('safari-instead')
}
</script>

<template>
  <div class="ios-install">
    <ol class="ios-install__steps">
      <li>Tap <Share :size="14" class="ios-install__icon" aria-hidden="true" /> <strong>Share</strong> at the bottom of Safari.</li>
      <li>Choose <strong>Add to Home Screen</strong>.</li>
      <li>Tap <strong>Add</strong>.</li>
    </ol>

    <div class="ios-install__then">
      <p><strong>Step 2 of 2:</strong> open <strong>Family Hub</strong> from its new icon, then tap <strong>Scan the family QR code</strong>.</p>
      <p class="hint">iPhone keeps the icon's data apart from Safari, so the icon needs its own scan. You only do this once.</p>
    </div>

    <button type="button" class="ios-install__optout" @click="useInSafari">Use in Safari instead</button>
  </div>
</template>

<style scoped>
.ios-install {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ios-install__steps {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ios-install__icon {
  vertical-align: -2px;
}
.ios-install__then {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
}
.ios-install__then p {
  margin: 0;
}
.ios-install__optout {
  align-self: flex-start;
  background: none;
  border: none;
  padding: 8px 0;
  color: var(--text-muted);
  text-decoration: underline;
  cursor: pointer;
}
</style>
