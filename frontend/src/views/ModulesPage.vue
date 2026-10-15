<script setup>
// Module catalog / browse page. Not a pinnable module — a persistent
// link outside the nav slots,
// same as /style-guide's precedent (router.js + DashboardLayout topbar).
//
// Two jobs on one page: discover modules not yet
// enabled (the marketplace framing) AND reach already-enabled modules that
// aren't pinned to the bottom nav — same underlying registry+config data
// either way, so no separate "my modules" surface is built here.
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  LayoutGrid,
  CheckCircle2, Calendar, ShoppingCart, Coins, ChefHat,
  Megaphone, Target, Gift, Library, BookOpen, Compass, Cake,
} from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { findAddon, categoryLabels, categoryOrder } from '../addons/registry'

// Explicit map (not `import * as` — see DashboardLayout.vue's own ICONS map,
// the precedent for this exact tree-shaking concern), keyed by the
// registry's `lucideIcon` field so each catalog card can render its
// module's real icon as a tile instead of a plain emoji span.
const ICONS = {
  CheckCircle2, Calendar, ShoppingCart, Coins, ChefHat,
  Megaphone, Target, Gift, Library, BookOpen, Compass, Cake,
}

function iconFor(addon) {
  return ICONS[addon?.lucideIcon] || LayoutGrid
}

// The catalog grid below (ModuleCard.vue) renders each module's real icon
// in a tile. Each value here matches that module's own icon-tile gradient
// from its own page, so the catalog tile looks identical to the tile a
// member already sees once they're on that module's page. Kept as a plain
// CSS string per module
// (not a token itself) since these are compositions of existing tokens.
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
  family_binder: 'linear-gradient(135deg, var(--tile-binder), var(--tile-binder-deep))',
  birthdays: 'linear-gradient(135deg, var(--tile-birthday-start), var(--tile-birthday-end))',
}

const core = useCoreStore()
const router = useRouter()

const addingKey = ref(null)
const pinningKey = ref(null)
const error = ref('')

// A lightweight reorder control lives here, alongside per-module Pin/Unpin
// from the catalog grid below via ModuleCard's own button. MAX_PINNED must
// match the bottom nav's actual rendered slot count exactly
// (DashboardLayout.vue's slotCount, portrait-only) -- a larger cap would
// let a 5th pin silently become unreachable from the nav.
const MAX_PINNED = 4
const slotsFull = computed(() => core.pinnedModules.length >= MAX_PINNED)

// Turning modules on or off is admin-only (enableModule enforces it). Pins
// are per-member, so every member pins, unpins and reorders their own nav.
const canManage = computed(() => core.isAdmin)

// Reordering uses up/down buttons, not drag-and-drop -- matches this codebase's one other
// reorder precedent (BinderPage.vue's moveSection), not a new interaction
// pattern. Store already does the optimistic-update + rollback-on-failure
// dance (reorderPinnedModules).
const reorderBusy = ref(false)
function movePinned(key, direction) {
  if (reorderBusy.value) return
  const order = core.pinnedModules.slice()
  const idx = order.indexOf(key)
  const swapWith = idx + direction
  if (idx === -1 || swapWith < 0 || swapWith >= order.length) return
  ;[order[idx], order[swapWith]] = [order[swapWith], order[idx]]
  reorderPinned(order)
}

function reorderPinned(order) {
  error.value = ''
  reorderBusy.value = true
  try {
    core.reorderPinnedModules(order)
  } catch (e) {
    error.value = e.message || 'Could not reorder pinned modules.'
  } finally {
    reorderBusy.value = false
  }
}

// Catalog listing = the frontend addons registry (no tier/price metadata --
// every module is free). Flagged modules are excluded from the catalog.
const catalogModules = computed(() => {
  const registry = core.moduleRegistry || {}
  return Object.entries(registry)
    .filter(([, m]) => (m.lifecycle ?? 'available') !== 'flagged')
    .map(([key, m]) => ({
      key,
      ...m,
      icon: findAddon(key)?.icon ?? '🧩',
      lucideIcon: findAddon(key)?.lucideIcon ?? null,
    }))
})

const groupedByCategory = computed(() => {
  const groups = {}
  for (const mod of catalogModules.value) {
    const cat = mod.category || 'core'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(mod)
  }
  return categoryOrder
    .filter((cat) => groups[cat]?.length)
    .map((cat) => ({ key: cat, label: categoryLabels[cat], modules: groups[cat] }))
})

function isEnabled(key) {
  return core.enabledModules.includes(key)
}

function isPinned(key) {
  return core.pinnedModules.includes(key)
}

// Reorder up/down needs to know each pinned module's position (to disable
// "up" at the top / "down" at the bottom) -- pinnedModules' own array order
// IS the nav display order (see core.js reorderPinnedModules).
function pinnedIndex(key) {
  return core.pinnedModules.indexOf(key)
}

// No billing exists, so there's no "Purchased" badge to show --
// every module is free the moment it's added. ModuleCard.vue's tierBadge
// prop is left unset (defaults to null) so its badge markup simply never
// renders.

function addModule(key) {
  error.value = ''
  addingKey.value = key
  try {
    core.addModule(key)
  } catch (e) {
    error.value = e.message || 'Could not add that module.'
  } finally {
    addingKey.value = null
  }
}

function openModule(key) {
  const addon = findAddon(key)
  if (addon?.route) {
    router.push(addon.route)
  }
}

function pinModule(key) {
  error.value = ''
  pinningKey.value = key
  try {
    core.pinModule(key)
  } catch (e) {
    error.value = e.message || 'Could not pin that module.'
  } finally {
    pinningKey.value = null
  }
}

function unpinModule(key) {
  error.value = ''
  pinningKey.value = key
  try {
    core.unpinModule(key)
  } catch (e) {
    error.value = e.message || 'Could not unpin that module.'
  } finally {
    pinningKey.value = null
  }
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
          Browse everything Yggltree can do. Every module is free.
        </p>
      </div>
    </div>

    <p v-if="!canManage" class="modules-readonly-note">
      Only a family admin can turn modules on or off.
    </p>

    <p v-if="error" class="error">{{ error }}</p>

    <section v-for="group in groupedByCategory" :key="group.key" class="catalog-category">
      <h3>{{ group.label }}</h3>
      <div class="module-grid">
        <ModuleCard
          v-for="mod in group.modules"
          :key="mod.key"
          :icon="mod.icon"
          :icon-component="iconFor(mod)"
          :icon-tint="TILE_TINT[mod.key] || ''"
          :label="mod.label"
          :short-description="mod.short_description"
          :lifecycle="mod.lifecycle"
          :enabled="isEnabled(mod.key)"
          :busy="addingKey === mod.key"
          :is-pinned="isPinned(mod.key)"
          :pinned-index="pinnedIndex(mod.key)"
          :pinned-count="core.pinnedModules.length"
          :slots-full="slotsFull"
          :pin-busy="pinningKey === mod.key || reorderBusy"
          @add="addModule(mod.key)"
          @open="openModule(mod.key)"
          @pin="pinModule(mod.key)"
          @unpin="unpinModule(mod.key)"
          @move-up="movePinned(mod.key, -1)"
          @move-down="movePinned(mod.key, 1)"
        />
      </div>
    </section>

    <EmptyState v-if="groupedByCategory.length === 0">No modules to show.</EmptyState>
  </div>
</template>

<style scoped>
/* Page header: icon tile + title, matching the established convention
   (ShoppingPage.vue's .shopping-header / WishlistPage.vue's .wishlist-header)
   instead of a bare <h2> with an inline-styled subtitle paragraph. */
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

.modules-loading {
  color: var(--text-muted);
  text-align: center;
  padding: 24px 0;
}

/* Brief explanatory note shown to non-admin members, who can't turn modules
   on or off -- same muted-text treatment
   as .modules-header__subtitle above, not a full alert/banner since this
   isn't an error state. */
.modules-readonly-note {
  margin: -8px 0 16px;
  padding: 10px 14px;
  background: var(--surface-variant);
  border-radius: 10px;
  color: var(--text-muted);
  font: var(--type-label);
}
</style>
