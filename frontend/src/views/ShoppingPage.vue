<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Circle, CheckCircle2, ChevronRight, BookOpen, Plus, Trash2 } from 'lucide-vue-next'
import { useFamily, useLive } from '../data/vue'
import { listShopping, saveShoppingItem, setShoppingCompleted, deleteShoppingItem, deleteShoppingItems } from '../data/modules/shopping'

const router = useRouter()
const { doc } = useFamily()
const items = useLive(listShopping)

// Rows tagged with a recipe_id ("added from a recipe conversion") render in
// their own collapsed-by-default "Recipe ingredients" section instead of
// the main list, grouped by recipe -- collapsed here
// is a local per-viewer UI convenience (not data), same reasoning as any
// other page-local ref, so it isn't persisted.
const recipeSectionOpen = ref(false)

// Add/edit share one drawer (AppModal, renders as a bottom sheet on
// mobile) -- same pattern as To-Do/Calendar. formOpen/editingId track which
// mode it's in.
const formOpen = ref(false)
const editingId = ref(null)
const formTitle = ref('')
const formCategory = ref('')
const formStore = ref('')

// Sort by Category (default), Store, or A-Z.
const sortBy = ref('category')

const statusFilter = ref(new Set()) // 'active' | 'completed'
const storeFilter = ref(new Set())
const categoryFilter = ref(new Set())

// The main list and filter dropdowns only ever consider non-recipe
// items -- a recipe conversion's rows render exclusively in the "Recipe
// ingredients" section below, never duplicated into the main list too.
const mainItems = computed(() => items.value.filter((i) => !i.recipe_id))
const recipeItems = computed(() => items.value.filter((i) => i.recipe_id))

// Grouped by recipe_id for the collapsed section: just the recipe's title
// and how many ingredient rows it added (showing just the recipe's name,
// not each ingredient). recipe_title is resolved by listShopping from the
// recipes collection -- it falls back to a generic label when a tagged
// row's recipe has been deleted (e.g. on another device), so the group
// still has a renderable heading.
const recipeGroups = computed(() => {
  const byRecipe = new Map()
  for (const item of recipeItems.value) {
    const key = item.recipe_id
    if (!byRecipe.has(key)) {
      byRecipe.set(key, { recipeId: key, title: item.recipe_title || 'Deleted recipe', count: 0 })
    }
    byRecipe.get(key).count++
  }
  return [...byRecipe.values()].sort((a, b) => a.title.localeCompare(b.title))
})

function goToRecipe(recipeId) {
  router.push({ path: '/recipes', query: { open: recipeId } })
}

const categories = computed(() =>
  [...new Set(mainItems.value.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b))
)
const stores = computed(() =>
  [...new Set(mainItems.value.map((i) => i.store).filter(Boolean))].sort((a, b) => a.localeCompare(b))
)

// toggleFilter takes a string key and looks up the actual ref inside the
// function, rather than taking the ref itself as `set` (e.g.
// toggleFilter(statusFilter, 'active')): Vue's template compiler
// auto-unwraps refs referenced in template expressions, so the function
// would receive the raw Set, not the ref, and `set.value` would always be
// undefined -- every checkbox in the filter modal would silently no-op.
// Inside the function no auto-unwrapping happens.
const filterRefs = { status: statusFilter, category: categoryFilter, store: storeFilter }

function toggleFilter(filterKey, value) {
  const filterRef = filterRefs[filterKey]
  const next = new Set(filterRef.value)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  filterRef.value = next
}

function clearFilters() {
  statusFilter.value = new Set()
  storeFilter.value = new Set()
  categoryFilter.value = new Set()
}

const activeFilterCount = computed(
  () => statusFilter.value.size + storeFilter.value.size + categoryFilter.value.size
)

const filteredItems = computed(() => {
  return mainItems.value.filter((i) => {
    if (statusFilter.value.size) {
      const state = i.completed ? 'completed' : 'active'
      if (!statusFilter.value.has(state)) return false
    }
    if (storeFilter.value.size && !storeFilter.value.has(i.store || '')) return false
    if (categoryFilter.value.size && !categoryFilter.value.has(i.category || '')) return false
    return true
  })
})

const sortedItems = computed(() => {
  const list = [...filteredItems.value]
  if (sortBy.value === 'store') {
    list.sort((a, b) => (a.store || '￿').localeCompare(b.store || '￿') || a.title.localeCompare(b.title))
  } else if (sortBy.value === 'alpha') {
    list.sort((a, b) => a.title.localeCompare(b.title))
  } else {
    // category (default)
    list.sort((a, b) => (a.category || '￿').localeCompare(b.category || '￿') || a.title.localeCompare(b.title))
  }
  return list
})

// When filtered to exactly one store or category, pre-fill the
// corresponding Add Item field so re-adding items to a filtered view is
// one less step. Reactive to the filter itself (not one-shot) so switching
// which single category/store is filtered updates the prefill too.
const prefilledCategory = computed(() => (categoryFilter.value.size === 1 ? [...categoryFilter.value][0] : null))
const prefilledStore = computed(() => (storeFilter.value.size === 1 ? [...storeFilter.value][0] : null))

watch(prefilledCategory, (val) => {
  if (val && !formOpen.value) formCategory.value = val
})
watch(prefilledStore, (val) => {
  if (val && !formOpen.value) formStore.value = val
})

function openAdd() {
  editingId.value = null
  formTitle.value = ''
  formCategory.value = prefilledCategory.value || ''
  formStore.value = prefilledStore.value || ''
  formOpen.value = true
}

function openEdit(item) {
  editingId.value = item.id
  formTitle.value = item.title
  formCategory.value = item.category || ''
  formStore.value = item.store || ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

function save() {
  if (!formTitle.value.trim()) return
  const existing = editingId.value ? items.value.find((i) => i.id === editingId.value) : null
  saveShoppingItem(doc, {
    id: editingId.value ?? undefined,
    title: formTitle.value,
    category: formCategory.value || null,
    store: formStore.value || null,
    completed: existing?.completed ?? false,
  })
  formOpen.value = false
}

function toggle(item) {
  setShoppingCompleted(doc, item.id, !item.completed)
}

function remove(id) {
  deleteShoppingItem(doc, id)
  formOpen.value = false
}

// "Clear list" clears only the main list (mirrors mainItems above) --
// recipe-tagged rows stay put, since they're a separate unit removed via
// the recipe toggle, not swept up by a general list action.
function clearList() {
  deleteShoppingItems(doc, mainItems.value.map((i) => i.id))
}

// A recipe group has no single row/id of its own (it's a
// virtual grouping of several shopping_list rows sharing a recipe_id, see
// recipeGroups above), so deleting "the recipe" here means deleting every
// ingredient row it added, same fan-out shape as clearList above.
function removeRecipeGroup(recipeId) {
  deleteShoppingItems(doc, recipeItems.value.filter((i) => i.recipe_id === recipeId).map((i) => i.id))
}
</script>

<template>
  <div class="module-page">
    <h2>Shopping</h2>

    <div class="shopping-toolbar">
      <FilterButton :count="activeFilterCount" title="Filter items" @clear="clearFilters">
        <div class="filter-group">
          <h3>Sort by</h3>
          <label class="filter-check">
            <input type="radio" name="shopping-sort" value="category" v-model="sortBy" />
            Category
          </label>
          <label class="filter-check">
            <input type="radio" name="shopping-sort" value="store" v-model="sortBy" />
            Store
          </label>
          <label class="filter-check">
            <input type="radio" name="shopping-sort" value="alpha" v-model="sortBy" />
            A–Z
          </label>
        </div>

        <div class="filter-group">
          <h3>Status</h3>
          <label class="filter-check">
            <input
              type="checkbox"
              :checked="statusFilter.has('active')"
              @change="toggleFilter('status', 'active')"
            />
            Active
          </label>
          <label class="filter-check">
            <input
              type="checkbox"
              :checked="statusFilter.has('completed')"
              @change="toggleFilter('status', 'completed')"
            />
            Completed
          </label>
        </div>

        <div class="filter-group" v-if="categories.length">
          <h3>Category</h3>
          <label v-for="c in categories" :key="c" class="filter-check">
            <input
              type="checkbox"
              :checked="categoryFilter.has(c)"
              @change="toggleFilter('category', c)"
            />
            {{ c }}
          </label>
        </div>

        <div class="filter-group" v-if="stores.length">
          <h3>Store</h3>
          <label v-for="s in stores" :key="s" class="filter-check">
            <input
              type="checkbox"
              :checked="storeFilter.has(s)"
              @change="toggleFilter('store', s)"
            />
            {{ s }}
          </label>
        </div>
      </FilterButton>

      <AppButton variant="primary" class="add-pill" @click="openAdd">
        <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Add an item
      </AppButton>
    </div>

    <p v-if="prefilledCategory || prefilledStore" class="prefill-hint">
      Adding to
      <template v-if="prefilledCategory">"{{ prefilledCategory }}"</template>
      <template v-if="prefilledCategory && prefilledStore"> at </template>
      <template v-if="prefilledStore">"{{ prefilledStore }}"</template>
    </p>

    <ul class="module-list shopping-list">
      <li
        v-for="i in sortedItems"
        :key="i.id"
        class="shopping-card"
        :class="{ 'shopping-card--done': i.completed }"
      >
        <button
          type="button"
          class="shopping-card__check"
          :class="{ 'shopping-card__check--done': i.completed }"
          :aria-pressed="i.completed"
          :aria-label="i.completed ? `Mark ${i.title} not purchased` : `Mark ${i.title} purchased`"
          @click="toggle(i)"
        >
          <CheckCircle2 v-if="i.completed" :size="24" />
          <Circle v-else :size="24" />
        </button>

        <div class="shopping-card__body" @click="openEdit(i)">
          <div class="shopping-card__title" :class="{ 'shopping-card__title--done': i.completed }">
            {{ i.title }}
          </div>
          <div class="shopping-card__meta">
            <span v-if="i.completed" class="shopping-card__done-label">Purchased</span>
            <AppTag v-if="i.category">{{ i.category }}</AppTag>
            <AppTag v-if="i.store">{{ i.store }}</AppTag>
          </div>
        </div>

        <button type="button" class="shopping-card__del" aria-label="Delete item" @click.stop="remove(i.id)">
          <Trash2 :size="16" />
        </button>
      </li>
    </ul>
    <EmptyState v-if="sortedItems.length === 0 && mainItems.length > 0">
      No items match the current filters.
    </EmptyState>
    <EmptyState v-if="mainItems.length === 0" illustration="shopping">List is empty.</EmptyState>

    <!-- "Clear list" button at the bottom of the full shopping list. Only
         shown once there's something to clear. -->
    <AppButton
      v-if="mainItems.length > 0"
      type="button"
      variant="ghost"
      class="clear-list-btn"
      @click="clearList"
    >
      Clear list
    </AppButton>

    <!-- Recipe-conversion rows never mix into the list above --
         they collapse into their own section, one row per recipe (just its
         title + how many ingredients it added), not per ingredient. -->
    <div v-if="recipeGroups.length" class="recipe-section" :class="{ 'recipe-section--open': recipeSectionOpen }">
      <button
        type="button"
        class="recipe-section__header"
        :aria-expanded="recipeSectionOpen"
        @click="recipeSectionOpen = !recipeSectionOpen"
      >
        <span class="recipe-section__icon-tile">
          <BookOpen :size="18" />
        </span>
        <span class="recipe-section__title">Recipe ingredients</span>
        <span class="recipe-section__count">{{ recipeGroups.length }}</span>
        <ChevronRight :size="18" class="recipe-section__chevron" />
      </button>

      <ul v-if="recipeSectionOpen" class="module-list recipe-section__body">
        <li v-for="g in recipeGroups" :key="g.recipeId" class="recipe-group-row">
          <button type="button" class="recipe-group-row__link" @click="goToRecipe(g.recipeId)">
            <span class="recipe-group-row__title">{{ g.title }}</span>
            <AppTag>{{ g.count }} item{{ g.count === 1 ? '' : 's' }}</AppTag>
          </button>
          <button
            type="button"
            class="recipe-group-row__delete"
            :aria-label="`Remove all ${g.title} ingredients from the shopping list`"
            @click.stop="removeRecipeGroup(g.recipeId)"
          >
            <Trash2 :size="18" />
          </button>
        </li>
      </ul>
    </div>

    <AppModal :open="formOpen" :title="editingId ? 'Edit item' : 'Add an item'" @close="closeForm">
      <form class="shopping-form" @submit.prevent="save">
        <FormField v-model="formTitle" label="Item" placeholder="Add an item…" required />
        <FormField v-model="formCategory" label="Category" placeholder="Category" />
        <FormField v-model="formStore" label="Store" placeholder="Store" />
        <div class="shopping-form__actions">
          <AppButton v-if="editingId" type="button" variant="danger" @click="remove(editingId)">Delete</AppButton>
          <AppButton type="submit" variant="primary">Save</AppButton>
        </div>
      </form>
    </AppModal>
  </div>
</template>

<style scoped>
/* The toolbar has one filter control: Sort lives as a radio group inside
   the same Filter modal that holds Status/Category/Store, rather than as
   separate native <select>s competing with the Filter pill. */
.shopping-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.prefill-hint {
  font: var(--type-label);
  color: var(--text-muted);
  margin: 0 0 8px;
}

.add-pill {
  display: inline-flex;
  align-items: center;
  margin-bottom: 14px;
}

.shopping-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.shopping-form__actions {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
}

.shopping-loading {
  color: var(--text-muted);
  text-align: center;
  padding: 32px 0;
}

/* Shopping list cards: white rounded-16px cards with elevation-1, an
   icon-tile-style circular check control on the left (shape swap
   Circle -> CheckCircle2, not just a color change) and a delete action on
   the right, matching the feed-card visual language from DashboardPage. */
.shopping-list {
  gap: 10px;
}

.shopping-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 12px 14px;
  transition: box-shadow 120ms ease;
}

.shopping-card:hover {
  box-shadow: var(--elevation-2);
}

/* Done state: at least two non-color signals stack here beyond the check
   icon swap itself -- a recessed/muted card surface, strikethrough title
   text, and an explicit "Purchased" text label (comp-C.jpg's completed-card
   treatment: shape + icon fill + strikethrough + text label together). */
.shopping-card--done {
  background: var(--surface-variant);
  box-shadow: none;
}

.shopping-card__check {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-min);
  height: var(--control-min);
  margin: -10px;
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  border-radius: 50%;
  transition: background-color 120ms ease;
}

.shopping-card__check:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.shopping-card__check--done {
  color: var(--accent);
}

.shopping-card__body {
  min-width: 0;
  flex: 1;
  cursor: pointer;
}

.shopping-card__title {
  font: var(--type-title);
  color: var(--text);
  overflow-wrap: break-word;
}

.shopping-card__title--done {
  text-decoration: line-through;
  color: var(--text-muted);
  font-weight: 500;
}

.shopping-card__meta {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.shopping-card__done-label {
  font: var(--type-label);
  font-size: 12px;
  color: var(--text-muted);
}

.shopping-card__del {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-min);
  height: var(--control-min);
  margin: -10px -8px -10px 0;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.shopping-card__del:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.shopping-card__del:focus-visible,
.shopping-card__check:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.clear-list-btn {
  display: flex;
  margin: 14px auto 0;
}

/* Recipe ingredients section: same collapsed-card-with-chevron
   language as BinderPage.vue's section accordion -- rotating chevron +
   bolder title + accent color together signal "open" (never color alone). */
.recipe-section {
  margin-top: 18px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  overflow: hidden;
}

.recipe-section__header {
  width: 100%;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-height: 44px;
  padding: 12px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font: var(--type-title);
  color: var(--text);
}

.recipe-section--open .recipe-section__header {
  color: var(--accent);
}

.recipe-section--open .recipe-section__title {
  font-weight: 800;
}

.recipe-section__icon-tile {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
  background: linear-gradient(135deg, var(--tile-shopping), var(--accent-soft));
}

.recipe-section__title {
  flex: 1;
  min-width: 140px;
}

.recipe-section__count {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 11px;
  background: var(--surface-variant);
  color: var(--text-muted);
  font: var(--type-label);
  font-size: 12px;
  font-weight: 700;
}

.recipe-section__chevron {
  flex: none;
  color: var(--text-muted);
  transition: transform 160ms ease, color 120ms ease;
}

.recipe-section--open .recipe-section__chevron {
  color: var(--accent);
  transform: rotate(90deg);
}

.recipe-section__body {
  padding: 0 10px 10px;
  gap: 6px;
}

.recipe-group-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
}

.recipe-group-row__link {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 44px;
  padding: 10px 12px;
  background: var(--surface-variant);
  border: none;
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  transition: background-color 120ms ease;
}

/* Trash-can button next to each recipe in 'Recipe Ingredients' -- same
   visual language as .shopping-card__del below. */
.recipe-group-row__delete {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-min);
  height: var(--control-min);
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.recipe-group-row__delete:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.recipe-group-row__link:hover {
  background: color-mix(in srgb, var(--accent) 10%, var(--surface-variant));
}

.recipe-group-row__link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.recipe-group-row__title {
  flex: 1 1 160px;
  min-width: 160px;
  font: var(--type-body);
  color: var(--accent);
  font-weight: 700;
  overflow-wrap: break-word;
}

.filter-group {
  margin-bottom: 20px;
}

.filter-group h3 {
  margin-bottom: 8px;
}

.filter-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  cursor: pointer;
}
</style>
