<script setup>
// The Modules page: a member pins up to four modules to their bottom menu on a phone, and puts them in order.
// A pin belongs to the member, not to the device, so it follows them to every device. On a computer every module
// is in the left menu, so pins only matter on a phone.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  LayoutGrid, Pin, PinOff, ChevronUp, ChevronDown,
  CheckCircle2, Calendar, ShoppingCart, Coins, ChefHat,
  Megaphone, Target, Gift, Library, BookOpen, Cake,
} from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { navigableAddons, findAddon } from '../addons/registry'

// The bottom menu has four slots (DashboardLayout.vue's slotCount), so a fifth pin would have nowhere to go.
const MAX_PINNED = 4

// Explicit map, not `import * as`, so the icons stay tree-shakeable (see DashboardLayout.vue's ICONS).
const ICONS = {
  CheckCircle2, Calendar, ShoppingCart, Coins, ChefHat,
  Megaphone, Target, Gift, Library, BookOpen, Cake,
}

function iconFor(addon) {
  return ICONS[addon.lucideIcon] || LayoutGrid
}

// Each module's icon tile uses the same gradient as its own page, so the Modules page matches the rest of the app.
const TILE_TINT = {
  todos: 'linear-gradient(135deg, var(--complement-soft), var(--complement))',
  calendar: 'linear-gradient(135deg, var(--complement-mid), var(--complement))',
  shopping: 'linear-gradient(135deg, var(--tile-shopping), var(--accent-soft))',
  chores_funds: 'linear-gradient(135deg, var(--accent-soft), var(--accent))',
  funds: 'linear-gradient(135deg, var(--accent-soft), var(--accent))',
  recipes: 'linear-gradient(135deg, var(--tile-recipe-start), var(--tile-recipe-end))',
  communication: 'var(--tile-communication)',
  goals: 'linear-gradient(135deg, var(--tile-goal), var(--accent-deep))',
  wishlist: 'linear-gradient(135deg, var(--complement-mid), var(--tile-wishlist))',
  library: 'linear-gradient(135deg, var(--tile-library), var(--tile-library-deep))',
  birthdays: 'linear-gradient(135deg, var(--tile-birthday-start), var(--tile-birthday-end))',
  family_binder: 'linear-gradient(135deg, var(--tile-binder), var(--tile-binder-deep))',
}

const core = useCoreStore()
const router = useRouter()
const error = ref('')
const busyKey = ref(null)

// The member's pins, in bottom-menu order. A pin that no longer matches a module is skipped here.
const pinned = computed(() => core.pinnedModules.map(findAddon).filter((a) => a?.route))
const unpinned = computed(() => navigableAddons.filter((a) => !core.pinnedModules.includes(a.key)))
const slotsFull = computed(() => core.pinnedModules.length >= MAX_PINNED)

function run(key, action, message) {
  error.value = ''
  busyKey.value = key
  try {
    action()
  } catch (e) {
    error.value = e.message || message
  } finally {
    busyKey.value = null
  }
}

function pin(key) {
  run(key, () => core.pinModule(key), 'Could not pin that module.')
}

function unpin(key) {
  run(key, () => core.unpinModule(key), 'Could not unpin that module.')
}

// The bottom menu's order is the array order of the member's pins, so moving a pin swaps two entries.
function move(key, direction) {
  const order = pinned.value.map((a) => a.key)
  const from = order.indexOf(key)
  const to = from + direction
  if (from === -1 || to < 0 || to >= order.length) return
  ;[order[from], order[to]] = [order[to], order[from]]
  run(key, () => core.reorderPinnedModules(order), 'Could not change the order of your bottom menu.')
}

function open(addon) {
  router.push(addon.route)
}
</script>

<template>
  <div class="module-page modules-page">
    <div class="modules-header">
      <div class="modules-header__tile">
        <LayoutGrid :size="22" />
      </div>
      <div class="modules-header__text">
        <h2>Modules</h2>
        <p class="modules-header__subtitle">
          Pin up to four to your bottom menu on a phone, in the order you want. Your pins follow you to every device.
        </p>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <section class="modules-section" aria-labelledby="modules-menu-heading">
      <h3 id="modules-menu-heading">
        Your bottom menu
        <span class="modules-section__count">{{ pinned.length }} of {{ MAX_PINNED }}</span>
      </h3>
      <ul v-if="pinned.length" class="modules-list">
        <li v-for="(addon, i) in pinned" :key="addon.key" class="modules-row">
          <button type="button" class="modules-row__main" @click="open(addon)">
            <span class="modules-row__icon" :style="{ background: TILE_TINT[addon.key] }">
              <component :is="iconFor(addon)" :size="20" />
            </span>
            <span class="modules-row__text">
              <span class="modules-row__label">{{ addon.label }}</span>
              <span class="modules-row__desc">{{ addon.short_description }}</span>
            </span>
          </button>
          <div class="modules-row__controls">
            <button
              type="button"
              class="modules-row__btn"
              :disabled="busyKey !== null || i === 0"
              title="Move up"
              :aria-label="`Move ${addon.label} up in your bottom menu`"
              @click="move(addon.key, -1)"
            >
              <ChevronUp :size="18" />
            </button>
            <button
              type="button"
              class="modules-row__btn"
              :disabled="busyKey !== null || i === pinned.length - 1"
              title="Move down"
              :aria-label="`Move ${addon.label} down in your bottom menu`"
              @click="move(addon.key, 1)"
            >
              <ChevronDown :size="18" />
            </button>
            <button
              type="button"
              class="modules-row__btn modules-row__btn--active"
              :disabled="busyKey !== null"
              title="Unpin from bottom menu"
              :aria-label="`Unpin ${addon.label} from bottom menu`"
              @click="unpin(addon.key)"
            >
              <PinOff :size="18" />
            </button>
          </div>
        </li>
      </ul>
      <p v-else class="modules-empty">Nothing pinned yet. Pin the modules you open most, below.</p>
    </section>

    <section class="modules-section" aria-labelledby="modules-all-heading">
      <h3 id="modules-all-heading">All modules</h3>
      <ul class="modules-list">
        <li v-for="addon in unpinned" :key="addon.key" class="modules-row">
          <button type="button" class="modules-row__main" @click="open(addon)">
            <span class="modules-row__icon" :style="{ background: TILE_TINT[addon.key] }">
              <component :is="iconFor(addon)" :size="20" />
            </span>
            <span class="modules-row__text">
              <span class="modules-row__label">{{ addon.label }}</span>
              <span class="modules-row__desc">{{ addon.short_description }}</span>
            </span>
          </button>
          <div class="modules-row__controls">
            <button
              type="button"
              class="modules-row__btn"
              :disabled="busyKey !== null || slotsFull"
              :title="slotsFull ? 'Your bottom menu is full. Unpin one first.' : 'Pin to bottom menu'"
              :aria-label="`Pin ${addon.label} to bottom menu`"
              @click="pin(addon.key)"
            >
              <Pin :size="18" />
            </button>
          </div>
        </li>
      </ul>
      <p v-if="!unpinned.length" class="modules-empty">Every module is in your bottom menu.</p>
    </section>
  </div>
</template>

<style scoped>
/* Page header: icon tile + title, the same treatment as the other module pages. */
.modules-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.modules-header__tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
  background: linear-gradient(135deg, var(--accent-soft), var(--accent));
}

.modules-header__text {
  min-width: 0;
}

.modules-header h2 {
  margin: 0;
}

.modules-header__subtitle {
  margin: 2px 0 0;
  color: var(--text-muted);
  font: var(--type-label);
}

.modules-section {
  margin-bottom: 24px;
}

.modules-section h3 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 10px;
}

.modules-section__count {
  font: var(--type-label);
  font-weight: 400;
  color: var(--text-muted);
}

.modules-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.modules-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 10px 12px;
}

.modules-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  color: inherit;
  cursor: pointer;
}

.modules-row__icon {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
}

.modules-row__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.modules-row__label {
  font-weight: 600;
}

.modules-row__desc {
  font: var(--type-label);
  color: var(--text-muted);
}

.modules-row__controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}

.modules-row__btn {
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
}

.modules-row__btn:hover:not(:disabled) {
  color: var(--text);
}

.modules-row__btn--active {
  background: var(--accent-container);
  color: var(--on-accent-container);
}

.modules-row__btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.modules-empty {
  margin: 0;
  padding: 10px 14px;
  background: var(--surface-variant);
  border-radius: 10px;
  color: var(--text-muted);
  font: var(--type-label);
}
</style>
