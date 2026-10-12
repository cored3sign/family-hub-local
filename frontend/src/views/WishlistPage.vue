<script setup>
import { ref, computed } from 'vue'
import { Gift, Circle, CheckCircle2, Trash2, Plus } from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { firstName } from '../lib/names'
import { useFamily, useLive } from '../data/vue'
import { listWishlist, saveWishlistItem, setWishlistPurchased, clearPurchasedWishlist, deleteWishlistItem } from '../data/modules/wishlist'
import { listMembers } from '../data/members'

const core = useCoreStore()
const { doc, actor } = useFamily()

// Priority is a simple text/enum field -- these three values cover the
// common cases ("soon" / "in 3 months") plus a looser catch-all, without
// overbuilding a rigid enum the family can't express nuance in.
const PRIORITY_OPTIONS = [
  { value: 'soon', label: 'Soon' },
  { value: 'in_3_months', label: 'In 3 months' },
  { value: 'someday', label: 'Someday' },
]
function priorityLabel(value) {
  return PRIORITY_OPTIONS.find((p) => p.value === value)?.label ?? value
}

const items = useLive(listWishlist)
const members = useLive(listMembers)

// Add/edit share one drawer (AppModal, bottom sheet on mobile)
// instead of an always-on inline form -- same pattern as To-Do/Shopping.
const formOpen = ref(false)
const editingId = ref(null)
const formTitle = ref('')
const formPriority = ref('soon')
const formAssignee = ref('') // required -- defaulted to self once member/session load

// Same chip pattern as Todo/Goals, but no "Unassigned" chip --
// assignment is mandatory here, so that option could never match anything.
const filterSelection = ref([])

const showPurchased = ref(true)

const filteredItems = computed(() => {
  return items.value.filter((i) => {
    if (!showPurchased.value && i.purchased) return false
    if (filterSelection.value.length && !filterSelection.value.includes(i.assigned_member_id)) return false
    return true
  })
})

const purchasedCount = computed(() => items.value.filter((i) => i.purchased).length)

function openAdd() {
  editingId.value = null
  formTitle.value = ''
  formPriority.value = 'soon'
  formAssignee.value = core.familyMemberId || ''
  formOpen.value = true
}

function openEdit(item) {
  editingId.value = item.id
  formTitle.value = item.title
  formPriority.value = item.priority
  formAssignee.value = item.assigned_member_id ?? ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

function save() {
  if (!formTitle.value.trim() || !formAssignee.value) return
  saveWishlistItem(doc, actor(), {
    id: editingId.value ?? undefined,
    title: formTitle.value,
    priority: formPriority.value,
    assigned_member_id: formAssignee.value,
  })
  formOpen.value = false
}

function togglePurchased(item) {
  setWishlistPurchased(doc, item.id, !item.purchased)
}

function remove(id) {
  deleteWishlistItem(doc, id)
  formOpen.value = false
}

function clearPurchased() {
  clearPurchasedWishlist(doc)
}
</script>

<template>
  <div class="module-page">
    <div class="wishlist-header">
      <div class="wishlist-header__tile">
        <Gift :size="22" />
      </div>
      <h2>Wish</h2>
    </div>

    <!-- Chips render inside the shared FilterButton's modal, which
         removes the need for a horizontal-scroll workaround for a growing
         chip list. -->
    <FilterButton :count="filterSelection.length" title="Filter wishlist" @clear="filterSelection = []">
      <AssigneeFilterChips
        v-model="filterSelection"
        :members="members"
        :current-member-id="core.familyMemberId"
        my-label="My Wishlist"
        :show-unassigned="false"
      />
    </FilterButton>

    <AppButton variant="primary" class="add-pill" @click="openAdd">
      <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Add an item
    </AppButton>

    <div class="wishlist-toolbar">
      <label class="wishlist-toggle">
        <input type="checkbox" v-model="showPurchased" />
        Show purchased
      </label>
      <AppButton
        v-if="purchasedCount > 0"
        type="button"
        variant="ghost"
        @click="clearPurchased"
      >
        Clear purchased ({{ purchasedCount }})
      </AppButton>
    </div>

    <ul class="module-list wishlist-list">
      <li
        v-for="i in filteredItems"
        :key="i.id"
        class="wishlist-card"
        :class="{ 'wishlist-card--done': i.purchased }"
      >
        <!-- Purchased state is signaled non-color-alone, matching the
             precedent set by Todos/Shopping: icon shape swap (outline
             circle -> filled check), the card losing its elevation and
             going flat/recessed, strikethrough title text, and an explicit
             "Purchased" text label -- four stacked signals (WCAG AA
             contrast standard). -->
        <button
          type="button"
          class="wishlist-card__check"
          :class="{ 'wishlist-card__check--done': i.purchased }"
          :aria-pressed="i.purchased"
          :aria-label="i.purchased ? `Mark ${i.title} not purchased` : `Mark ${i.title} purchased`"
          @click="togglePurchased(i)"
        >
          <CheckCircle2 v-if="i.purchased" :size="26" />
          <Circle v-else :size="26" />
        </button>

        <div class="wishlist-card__body" @click="openEdit(i)">
          <div class="wishlist-card__title" :class="{ 'wishlist-card__title--done': i.purchased }">
            {{ i.title }}
          </div>
          <div class="wishlist-card__meta">
            <span v-if="i.purchased" class="wishlist-card__done-label">Purchased</span>
            <AppTag>{{ priorityLabel(i.priority) }}</AppTag>
          </div>
        </div>

        <button type="button" class="wishlist-card__del" aria-label="Delete item" @click.stop="remove(i.id)">
          <Trash2 :size="16" />
        </button>
      </li>
    </ul>
    <EmptyState v-if="filteredItems.length === 0 && items.length > 0">
      No items match the current filters.
    </EmptyState>
    <EmptyState v-if="items.length === 0" illustration="wishlist">
      Wishlist is empty. Add something above.
    </EmptyState>

    <AppModal :open="formOpen" :title="editingId ? 'Edit item' : 'Add an item'" @close="closeForm">
      <form class="wishlist-form" @submit.prevent="save">
        <FormField v-model="formTitle" label="Item" placeholder="Add a wishlist item…" required />
        <label class="form-field">
          <span class="form-field__label">Priority</span>
          <select v-model="formPriority">
            <option v-for="p in PRIORITY_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>
        </label>
        <label class="form-field">
          <span class="form-field__label">Assignee</span>
          <select v-model="formAssignee" required>
            <option value="" disabled>Choose a member…</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ firstName(m.name) }}</option>
          </select>
        </label>
        <div class="wishlist-form__actions">
          <AppButton v-if="editingId" type="button" variant="danger" @click="remove(editingId)">Delete</AppButton>
          <AppButton type="submit" variant="primary">Save</AppButton>
        </div>
      </form>
    </AppModal>
  </div>
</template>

<style scoped>
/* Header: icon tile + title, matching the DashboardPage/comp-C card
   language (44x44px rounded-12px tile, linear-gradient fill, white icon). */
.wishlist-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.wishlist-header__tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
  background: linear-gradient(135deg, var(--complement-mid), var(--tile-wishlist));
}

.wishlist-header h2 {
  margin: 0;
}

.add-pill {
  display: inline-flex;
  align-items: center;
  margin-bottom: 16px;
}

.wishlist-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wishlist-form__actions {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
}

.wishlist-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 4px 0 14px;
}

.wishlist-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font: var(--type-label);
  color: var(--text-muted);
  cursor: pointer;
}

/* Wishlist cards: white rounded-16px cards with elevation-1, matching the
   feed-card / Todos/Shopping card language. */
.wishlist-list {
  gap: 10px;
}

.wishlist-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 12px 14px;
  transition: box-shadow 120ms ease;
}

.wishlist-card:hover {
  box-shadow: var(--elevation-2);
}

/* Done state: recessed/muted flat card (elevation + surface change) stacked
   with the icon shape swap below, the strikethrough title, and the explicit
   "Purchased" label -- four non-color signals together, never color alone. */
.wishlist-card--done {
  background: var(--surface-variant);
  box-shadow: none;
}

.wishlist-card__check {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -6px;
  background: none;
  border: none;
  padding: 0;
  border-radius: 50%;
  color: var(--accent);
  cursor: pointer;
  transition: background-color 120ms ease;
}

.wishlist-card__check:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.wishlist-card__body {
  min-width: 0;
  flex: 1;
  cursor: pointer;
}

.wishlist-card__title {
  font: var(--type-title);
  color: var(--text);
  overflow-wrap: break-word;
}

.wishlist-card__title--done {
  text-decoration: line-through;
  color: var(--text-muted);
  font-weight: 500;
}

.wishlist-card__meta {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.wishlist-card__done-label {
  font: var(--type-label);
  font-size: 12px;
  color: var(--text-muted);
}

.wishlist-card__del {
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

.wishlist-card__del:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.wishlist-card__del:focus-visible,
.wishlist-card__check:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
