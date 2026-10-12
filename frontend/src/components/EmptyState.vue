<script setup>
// Optional onboarding illustration above the plain-text empty state. No
// `illustration` prop -> renders the plain-text empty state alone (call
// sites without an illustration see no layout change).
import { computed, defineAsyncComponent } from 'vue'

// Lazy per-illustration (not a static import per file): several of these
// are full character SVGs in the tens-to-hundreds of KB, and EmptyWishlist
// in particular is ~3.4MB (a vectorizer-traced raster, not hand-drawn --
// see its own file for why). A static import bundles all of them into
// every page's initial load regardless of which illustration (if any) that
// page actually uses; defineAsyncComponent gives each one its own chunk,
// fetched only when a page actually renders that specific illustration key.
// `binder`'s import is defined once and reused directly (not re-imported)
// for the `dashboard` key too -- the Dashboard empty state uses the Binder
// character as a placeholder rather than its own illustration. Sharing one
// factory function means both keys resolve to the exact same async
// chunk/component instance, not two separate loads of the same file.
const binderIllustration = defineAsyncComponent(() => import('./illustrations/EmptyBinder.vue'))

const ILLUSTRATIONS = {
  calendar: defineAsyncComponent(() => import('./illustrations/EmptyCalendar.vue')),
  shopping: defineAsyncComponent(() => import('./illustrations/EmptyCart.vue')),
  wishlist: defineAsyncComponent(() => import('./illustrations/EmptyWishlist.vue')),
  checklist: defineAsyncComponent(() => import('./illustrations/EmptyChecklist.vue')),
  books: defineAsyncComponent(() => import('./illustrations/EmptyBooks.vue')),
  goals: defineAsyncComponent(() => import('./illustrations/EmptyGoals.vue')),
  generic: defineAsyncComponent(() => import('./illustrations/EmptyGeneric.vue')),
  dashboard: binderIllustration,
  chores: defineAsyncComponent(() => import('./illustrations/EmptyChores.vue')),
  recipes: defineAsyncComponent(() => import('./illustrations/EmptyRecipes.vue')),
  communication: defineAsyncComponent(() => import('./illustrations/EmptyCommunication.vue')),
  binder: binderIllustration,
  funds: defineAsyncComponent(() => import('./illustrations/EmptyFunds.vue')),
}

// Full-character illustrations (the Goals archer style: a whole drawn scene,
// two-color themed via --fh-illustration-primary/secondary) get the wider
// "tall art" treatment below instead of the fixed 96px box that icon-style
// glyphs get. `generic` is the only key still on the small icon treatment,
// since no full-character replacement exists for it.
// `dashboard` renders the same full-character Binder SVG as `binder`
// (see ILLUSTRATIONS above), so it needs the same sizing treatment, not the
// small icon box.
const FULL_CHARACTER_ILLUSTRATIONS = new Set([
  'goals', 'calendar', 'shopping', 'wishlist', 'checklist', 'books',
  'chores', 'recipes', 'communication', 'binder', 'funds', 'dashboard',
])

const props = defineProps({
  illustration: { type: String, default: '' }, // calendar | shopping | wishlist | checklist | books | goals | generic | dashboard | chores | recipes | communication | binder | funds
})

const illustrationComponent = computed(() => ILLUSTRATIONS[props.illustration] || null)
const isFullCharacter = computed(() => FULL_CHARACTER_ILLUSTRATIONS.has(props.illustration))
</script>

<template>
  <div v-if="illustrationComponent" class="empty-state empty-state--illustrated">
    <component
      :is="illustrationComponent"
      class="empty-state__art"
      :class="{
        'empty-state__art--full': isFullCharacter,
        'empty-state__art--shopping': illustration === 'shopping',
      }"
    />
    <p class="empty-state__text"><slot /></p>
  </div>
  <p v-else class="empty-state"><slot /></p>
</template>

<style scoped>
.empty-state--illustrated {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 0;
}

.empty-state__art {
  width: 96px;
  height: 96px;
  color: var(--text-muted);
  opacity: 0.7;
  margin-bottom: 12px;
  animation: empty-state-float 3s ease-in-out infinite;
}

/* Full character illustrations (the Goals archer style and the other
   whole-scene illustrations) are meant to dominate the empty state and read
   as real artwork, not a small icon. This isn't hardcoded to one
   illustration's aspect ratio: each SVG carries its own
   intrinsic viewBox ratio, and constraining only max-width (height: auto)
   lets the browser preserve that ratio automatically, whatever it is, so
   this one class works for the tall Goals portrait, wide Calendar/Chores
   scenes, and everything between. Every other (icon-style) illustration
   keeps the compact 96px treatment above.

   --empty-art-base scales up at the same breakpoints the rest of the app
   already uses (480px small-tablet/large-phone, 900px tablet content
   width, 1200px the desktop 3/4 content pane -- see LibraryPage/
   RecipesPage, CalendarPage/BinderPage, and DashboardLayout/DesktopNav
   respectively) rather than staying pinned to a phone-sized cap once
   there's real room to grow into: the mobile PWA doesn't reach these
   widths (portrait-locked below 1200px), so this only ever engages on
   tablet/desktop browser viewports. */
.empty-state__art--full {
  --empty-art-base: 280px;
  width: min(var(--empty-art-base), 70vw);
  height: auto;
  max-height: 320px;
}

@media (min-width: 480px) {
  .empty-state__art--full {
    --empty-art-base: 320px;
    max-height: 360px;
  }
}

@media (min-width: 900px) {
  .empty-state__art--full {
    --empty-art-base: 360px;
    max-height: 400px;
  }
}

@media (min-width: 1200px) {
  .empty-state__art--full {
    --empty-art-base: 420px;
    max-height: 460px;
  }
}

/* Shopping's source art (EmptyCart.vue) draws the character noticeably
   smaller relative to its own canvas than every other illustration --
   the scene's viewBox is filled edge-to-edge with the cart, flying
   groceries, and motion lines around him, not tightly cropped to the
   character the way Goals' archer is. Same width as every other full
   illustration would make him read as a smaller character next to Goals;
   this scales the rendered SVG up ~30% (empirically matched against the
   Goals archer's visual weight) within a proportionally wider box, so
   the enlarged content has room rather than just clipping at the edges. */
.empty-state__art--shopping {
  width: min(calc(var(--empty-art-base) * 1.3), 85vw);
}

.empty-state__text {
  color: var(--text-muted);
  margin: 0;
}

@keyframes empty-state-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

@media (prefers-reduced-motion: reduce) {
  .empty-state__art {
    animation: none;
  }
}
</style>
