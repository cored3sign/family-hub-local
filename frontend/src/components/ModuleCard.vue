<script setup>
// Reusable catalog card — one component responsive via CSS (grid on
// desktop, stacked list on mobile), not two parallel layouts.
// Used by the /modules page; the state-appropriate
// action button/badge is driven entirely by props so this stays a dumb
// display component with no routing/API knowledge of its own.
//
// `icon` (an emoji glyph) is deprecated but kept as a fallback for any
// caller that hasn't resolved a lucide component yet -- pass
// `iconComponent` (already resolved, e.g. via a caller-side ICONS map like
// DashboardLayout.vue/ModulesPage.vue's, not a string name) to render the
// icon-tile treatment the rest of the app uses. The fallback is handled
// here, once, at the shared root, rather than per-caller.
//
// One affordance per job: the whole card is the "open this module" target,
// the corner is a single pin/unpin toggle (each member's own nav), and the
// purchase badge is its own spot next to Add --
// unrelated to pin state, so it doesn't share the corner spot. The badge is
// a single "Purchased" label across every module -- see tierBadge prop doc.
import { Pin, PinOff, ChevronUp, ChevronDown } from 'lucide-vue-next'

const props = defineProps({
  icon: { type: String, default: '🧩' },
  iconComponent: { type: [Object, Function], default: null },
  // A CSS background value (solid color or gradient) for the icon tile,
  // e.g. 'linear-gradient(135deg, var(--tile-shopping), var(--accent-soft))'
  // -- lets each caller reuse its module's own already-established tile
  // color instead of this shared component inventing a new palette.
  // Falls back to a neutral tile when omitted (e.g. the coming_soon/flagged
  // cards, which intentionally don't need a module identity color).
  iconTint: { type: String, default: '' },
  label: { type: String, required: true },
  shortDescription: { type: String, default: '' },
  // 'Purchased' | null -- no real billing exists: every
  // available-lifecycle module shows this once enabled, regardless of any
  // free/premium tier. null for not-yet-enabled available modules
  // (nothing to show next to "Add" yet) and for coming_soon/flagged
  // modules (they get their own "Coming soon" tag instead, a separate
  // branch below, not this badge at all).
  tierBadge: { type: String, default: null },
  lifecycle: { type: String, default: 'available' }, // available | coming_soon | flagged
  enabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  // isPinned reflects THIS member's own nav_pinned (per-member, not
  // account-wide). slotsFull disables the pin action once the member
  // already has 4 pinned, matching the bottom nav's actual rendered slot
  // count (DashboardLayout.vue's slotCount).
  isPinned: { type: Boolean, default: false },
  slotsFull: { type: Boolean, default: false },
  pinBusy: { type: Boolean, default: false },
  // Position within the member's pinned order, for the up/down reorder
  // buttons (-1 when not pinned; the reorder row is hidden then).
  pinnedIndex: { type: Number, default: -1 },
  pinnedCount: { type: Number, default: 0 },
})
const emit = defineEmits(['add', 'open', 'pin', 'unpin', 'move-up', 'move-down'])

function openIfEnabled() {
  if (props.lifecycle === 'available' && props.enabled) {
    emit('open')
  }
}
</script>

<template>
  <div
    class="module-card"
    :class="{
      'module-card--enabled': lifecycle === 'available' && enabled,
      'module-card--muted': lifecycle === 'coming_soon',
      'module-card--clickable': lifecycle === 'available' && enabled,
    }"
    :role="lifecycle === 'available' && enabled ? 'button' : undefined"
    :tabindex="lifecycle === 'available' && enabled ? 0 : undefined"
    @click="openIfEnabled"
    @keydown.enter="openIfEnabled"
    @keydown.space.prevent="openIfEnabled"
  >
    <div
      class="module-card__icon"
      :class="{ 'module-card__icon--tinted': Boolean(iconTint) }"
      :style="iconTint ? { background: iconTint } : undefined"
    >
      <component :is="iconComponent" v-if="iconComponent" :size="22" />
      <span v-else>{{ icon }}</span>
    </div>
    <div class="module-card__body">
      <div class="module-card__top">
        <h3 class="module-card__label">{{ label }}</h3>
        <div class="module-card__corner">
          <AppTag v-if="lifecycle === 'coming_soon'" class="app-tag--muted">Coming soon</AppTag>
          <template v-else-if="lifecycle === 'available' && enabled">
            <button
              type="button"
              class="module-card__pin-toggle"
              :class="{ 'module-card__pin-toggle--active': isPinned }"
              :disabled="pinBusy || (!isPinned && slotsFull)"
              :title="isPinned ? 'Unpin from bottom nav' : (slotsFull ? 'All 4 nav slots are full -- unpin something first' : 'Pin to bottom nav')"
              :aria-label="isPinned ? 'Unpin from bottom nav' : 'Pin to bottom nav'"
              @click.stop="isPinned ? $emit('unpin') : $emit('pin')"
            >
              <PinOff v-if="isPinned" :size="16" />
              <Pin v-else :size="16" />
            </button>
          </template>
        </div>
      </div>
      <p class="module-card__desc">{{ shortDescription }}</p>
      <div v-if="lifecycle === 'available' && enabled && isPinned" class="module-card__pin-order">
        <span class="module-card__pin-hint">Nav position</span>
        <button
          type="button"
          class="module-card__icon-btn"
          :disabled="pinBusy || pinnedIndex <= 0"
          title="Move up"
          aria-label="Move up in nav"
          @click.stop="$emit('move-up')"
        >
          <ChevronUp :size="16" />
        </button>
        <button
          type="button"
          class="module-card__icon-btn"
          :disabled="pinBusy || pinnedIndex < 0 || pinnedIndex >= pinnedCount - 1"
          title="Move down"
          aria-label="Move down in nav"
          @click.stop="$emit('move-down')"
        >
          <ChevronDown :size="16" />
        </button>
      </div>
    </div>
    <div class="module-card__action" @click.stop>
      <template v-if="lifecycle === 'available' && !enabled">
        <AppButton variant="primary" :disabled="busy" @click="$emit('add')">
          {{ busy ? 'Adding…' : 'Add' }}
        </AppButton>
      </template>
      <AppTag v-else-if="tierBadge === 'Purchased'" class="app-tag--muted">Purchased</AppTag>
    </div>
  </div>
</template>

<style scoped>
/* Borderless icon-button, unlike BinderPage.vue's .binder-icon-btn
   -- bordered icon-buttons look overlapping/cluttered next to each other,
   so this one deliberately skips the border (background-only hover state, same as DashboardLayout's
   .quick-drawer__close). */
.module-card__icon-btn {
  flex: none;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  transition: background-color 120ms ease, color 120ms ease;
}

.module-card__icon-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--text) 8%, transparent);
  color: var(--text);
}

.module-card__icon-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.module-card__pin-order {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 4px;
}

.module-card__pin-hint {
  font: var(--type-label);
  font-size: 11px;
  color: var(--text-muted);
  margin-right: 2px;
}

.module-card__corner {
  flex-shrink: 0;
}

.module-card__pin-toggle {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-variant);
  border: none;
  border-radius: 10px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  transition: background-color 120ms ease, color 120ms ease;
}

.module-card__pin-toggle:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 14%, var(--surface-variant));
  color: var(--accent);
}

.module-card__pin-toggle--active {
  background: var(--accent-container);
  color: var(--on-accent-container);
}

.module-card__pin-toggle:disabled {
  opacity: 0.4;
  cursor: default;
}

.module-card--clickable {
  cursor: pointer;
}

.module-card--clickable:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
