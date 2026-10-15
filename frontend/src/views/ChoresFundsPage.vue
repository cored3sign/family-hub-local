<script setup>
import { useItemHighlight } from '../lib/highlight'

useItemHighlight()
import { ref, computed } from 'vue'
import { Circle, CheckCircle2, Plus } from 'lucide-vue-next'
import { firstName } from '../lib/names'
import { useFamily, useLive } from '../data/vue'
import { listChores, saveChore, completeChore, deleteChore } from '../data/modules/chores'
import { membersWithBalances } from '../data/modules/funds'

const { doc, actor } = useFamily()
const chores = useLive(listChores)
const members = useLive(membersWithBalances)

// "New chore" drawer: creates a brand-new catalog+assignment row in one
// step (title, reward, assignee and an optional description).
const showNewChoreModal = ref(false)
const newTitle = ref('')
const newReward = ref('')
const newDescription = ref('')
const newAssignee = ref('')
const newChoreSaving = ref(false)

// "Pick from existing chores" drawer: opened from a specific
// member's section (or the Unassigned section) to assign one of the
// family's existing chores to that target without retyping it.
const showCatalogModal = ref(false)
const catalogTargetMemberId = ref(null) // null = unassigned
const catalogSaving = ref(false)

const openChores = computed(() => chores.value.filter((c) => c.status === 'open'))
const doneChores = computed(() => chores.value.filter((c) => c.status === 'done'))

// Real per-assignee sections rather than a flat list with an inline
// assignee tag. Every member appears (so a member with zero
// chores right now still gets a heading + their own "add a chore" entry
// point), plus a separate Unassigned bucket -- never hidden.
const openChoresByMember = computed(() =>
  members.value.map((m) => ({
    member: m,
    chores: openChores.value.filter((c) => c.assigned_member_id === m.id),
  }))
)
const unassignedOpenChores = computed(() => openChores.value.filter((c) => !c.assigned_member_id))

function memberName(id) {
  return firstName(members.value.find((m) => m.id === id)?.name) ?? 'Unassigned'
}

// Catalog = the deduplicated set of distinct chores that have ever existed
// (by title + reward_amount), regardless of current assigned_member_id or
// status -- including unassigned/completed ones. This is a read of the
// single chores table (no separate catalog table): the catalog is "every
// distinct chore shape seen so far", the assignment is a separate row
// referencing it.
const catalogChores = computed(() => {
  const seen = new Map()
  for (const c of chores.value) {
    const key = `${c.title.trim().toLowerCase()}|${c.reward_amount}`
    if (!seen.has(key)) seen.set(key, c)
  }
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title))
})

function openNewChoreModal() {
  newTitle.value = ''
  newReward.value = ''
  newDescription.value = ''
  newAssignee.value = ''
  showNewChoreModal.value = true
}

function closeNewChoreModal() {
  showNewChoreModal.value = false
}

function saveNewChore() {
  if (!newTitle.value.trim() || newChoreSaving.value) return
  newChoreSaving.value = true
  try {
    saveChore(doc, actor(), {
      title: newTitle.value,
      reward_amount: newReward.value ? Number(newReward.value) : 0,
      description: newDescription.value || null,
      assigned_member_id: newAssignee.value || null,
    })
    showNewChoreModal.value = false
  } finally {
    newChoreSaving.value = false
  }
}

// Opened from a member's (or Unassigned's) "add a chore" action -- shows
// the catalog to pick from for that specific target.
function openCatalogModal(memberId) {
  catalogTargetMemberId.value = memberId
  showCatalogModal.value = true
}

function closeCatalogModal() {
  showCatalogModal.value = false
}

// Picking a catalog chore creates a NEW row (no id) copying its
// title/reward/description and assigning it to the target member -- the
// original catalog entry is left untouched so it stays reusable by other
// members later, rather than being moved/consumed.
function pickCatalogChore(catalogChore) {
  if (catalogSaving.value) return
  catalogSaving.value = true
  try {
    saveChore(doc, actor(), {
      title: catalogChore.title,
      reward_amount: catalogChore.reward_amount,
      description: catalogChore.description || null,
      assigned_member_id: catalogTargetMemberId.value,
    })
    showCatalogModal.value = false
  } finally {
    catalogSaving.value = false
  }
}

// "All done" sweep -- chores have no week/
// due-date concept at all, so this fires
// whenever the CURRENTLY open count reaches zero as a result of a
// completion, not a real calendar week. Checked BEFORE the API call since
// completing this chore is what's about to take the open count to zero.
const justClearedAll = ref(false)
const SWEEP_DURATION_MS = 1400
// The checkbox is hidden for unassigned chores (see
// template), so this catch is a safety net for any other unexpected
// completeChore() failure -- surfaced here instead of failing silently.
const completeError = ref('')
function complete(chore) {
  const isLastOpen = openChores.value.length === 1
  try {
    completeChore(doc, actor(), chore.id)
    completeError.value = ''
  } catch (e) {
    completeError.value = e.message
    return
  }
  if (isLastOpen) {
    justClearedAll.value = true
    setTimeout(() => (justClearedAll.value = false), SWEEP_DURATION_MS)
  }
}

function remove(id) {
  deleteChore(doc, id)
}
</script>

<template>
  <div class="module-page">
    <div class="chores-header" :class="{ 'chores-header--sweep': justClearedAll }">
      <h2>Chores</h2>
      <AppButton type="button" variant="primary" @click="openNewChoreModal">
        <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />New chore
      </AppButton>
    </div>

    <p v-if="completeError" class="error">{{ completeError }}</p>

    <!-- Real per-assignee sections -- a plain heading (first
         name only, no icon) per member, their assigned open chores listed
         underneath, plus their own "add a chore" entry point into the
         catalog-pick drawer. -->
      <section v-for="entry in openChoresByMember" :key="entry.member.id" class="chore-section">
        <div class="chore-section__head">
          <h3>{{ firstName(entry.member.name) }}</h3>
          <!-- The small "+" is omitted in the EMPTY-state case (tapping
               the empty text opens the drawer there instead, see
               below), but a section that already has chores still needs
               its own "add from catalog, pre-targeted at this member" entry
               point, since that's a distinct flow from the page-level "New
               chore" button (freeform) and from the empty-state tap. -->
          <button
            v-if="entry.chores.length"
            type="button"
            class="chore-section__add"
            :aria-label="`Add a chore for ${firstName(entry.member.name)}`"
            @click="openCatalogModal(entry.member.id)"
          >
            <Plus :size="18" />
          </button>
        </div>
        <ul v-if="entry.chores.length" class="module-list">
          <ListRow v-for="c in entry.chores" :key="c.id" :data-item-id="c.id" deletable class="chore-list-row" @delete="remove(c.id)">
            <button type="button" class="chore-check" @click="complete(c)" :aria-label="`Mark '${c.title}' done`">
              <Circle :size="22" />
            </button>
            <span class="chore-title">
              {{ c.title }}
              <span v-if="c.description" class="chore-description">{{ c.description }}</span>
            </span>
            <AppTag v-if="c.reward_amount > 0" class="app-tag--reward">${{ c.reward_amount.toFixed(2) }}</AppTag>
          </ListRow>
        </ul>
        <button v-else type="button" class="chore-empty-add" @click="openCatalogModal(entry.member.id)">
          <EmptyState>No chores assigned to {{ firstName(entry.member.name) }}. Tap to add one.</EmptyState>
        </button>
      </section>

      <!-- Unassigned section -- never hidden, same "add a chore" entry point
           but assigns to no one (assigned_member_id stays null). -->
      <section class="chore-section">
        <div class="chore-section__head">
          <h3>Unassigned</h3>
          <button
            v-if="unassignedOpenChores.length"
            type="button"
            class="chore-section__add"
            aria-label="Add an unassigned chore"
            @click="openCatalogModal(null)"
          >
            <Plus :size="18" />
          </button>
        </div>
        <ul v-if="unassignedOpenChores.length" class="module-list">
          <ListRow v-for="c in unassignedOpenChores" :key="c.id" :data-item-id="c.id" deletable class="chore-list-row" @delete="remove(c.id)">
            <!-- An unassigned chore can't be completed
                 (completeChore throws) -- disable the check and show a short
                 hint instead of letting the click throw silently. -->
            <button
              type="button"
              class="chore-check"
              disabled
              aria-label="Assign to complete"
              title="Assign to complete"
            >
              <Circle :size="22" />
            </button>
            <span class="chore-title">
              {{ c.title }}
              <span v-if="c.description" class="chore-description">{{ c.description }}</span>
              <span class="chore-assign-hint">Assign to complete</span>
            </span>
            <AppTag v-if="c.reward_amount > 0" class="app-tag--reward">${{ c.reward_amount.toFixed(2) }}</AppTag>
          </ListRow>
        </ul>
        <button v-else type="button" class="chore-empty-add" @click="openCatalogModal(null)">
          <EmptyState>No unassigned chores. Tap to add one.</EmptyState>
        </button>
      </section>

      <template v-if="doneChores.length">
        <h3>Completed</h3>
        <ul class="module-list done-list">
          <ListRow v-for="c in doneChores" :key="c.id" :data-item-id="c.id" done deletable class="chore-list-row" @delete="remove(c.id)">
            <span class="chore-check chore-check--done">
              <CheckCircle2 :size="22" />
            </span>
            <span class="chore-title chore-title--done">{{ c.title }}</span>
            <AppTag>{{ memberName(c.assigned_member_id) }}</AppTag>
          </ListRow>
        </ul>
      </template>

    <!-- New chore drawer. -->

    <AppModal :open="showNewChoreModal" title="New chore" @close="closeNewChoreModal">
      <div class="chore-form">
        <FormField v-model="newTitle" label="Name" placeholder="e.g. Take out trash" required />
        <FormField v-model="newReward" label="$ value" type="number" step="0.01" min="0" placeholder="0.00" />
        <label class="form-field">
          <span class="form-field__label">Description (optional)</span>
          <textarea v-model="newDescription" rows="3" placeholder="Any extra details…"></textarea>
        </label>
        <label class="form-field">
          <span class="form-field__label">Assignee</span>
          <select v-model="newAssignee">
            <option value="">Unassigned</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ firstName(m.name) }}</option>
          </select>
        </label>

        <div class="chore-form__actions">
          <AppButton type="button" variant="primary" :disabled="newChoreSaving || !newTitle.trim()" @click="saveNewChore">
            {{ newChoreSaving ? 'Saving…' : 'Save chore' }}
          </AppButton>
          <AppButton type="button" variant="ghost" @click="closeNewChoreModal">Cancel</AppButton>
        </div>
      </div>
    </AppModal>

    <!-- Pick-from-catalog drawer: scrollable list of every distinct
         chore that has ever existed, name + $ value, for the member the
         section button was clicked from (or null for Unassigned). -->
    <AppModal :open="showCatalogModal" title="Add from existing chores" @close="closeCatalogModal">
      <ul class="catalog-list">
        <li v-for="c in catalogChores" :key="`${c.title}-${c.reward_amount}`" class="catalog-row">
          <button type="button" class="catalog-row__btn" :disabled="catalogSaving" @click="pickCatalogChore(c)">
            <span class="catalog-row__title">
              {{ c.title }}
              <span v-if="c.description" class="chore-description">{{ c.description }}</span>
            </span>
            <AppTag v-if="c.reward_amount > 0" class="app-tag--reward">${{ c.reward_amount.toFixed(2) }}</AppTag>
          </button>
        </li>
      </ul>
      <EmptyState v-if="catalogChores.length === 0">
        No existing chores yet -- use "New chore" to create the first one.
      </EmptyState>
    </AppModal>
  </div>
</template>

<style scoped>
.chores-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  overflow: hidden;
}

/* "All done" sweep: fires once the last open
   chore is completed. A pseudo-element sweeps across the header -- opacity
   + transform only (never width/height/top/left, which would animate
   layout properties), so it can't perturb the header's own
   box during the animation. */
.chores-header--sweep::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent, color-mix(in srgb, var(--accent) 35%, transparent), transparent);
  transform: translateX(-100%);
  opacity: 0;
  pointer-events: none;
  animation: chores-sweep 1.4s ease-out;
}

@keyframes chores-sweep {
  0% { transform: translateX(-100%); opacity: 0; }
  15% { opacity: 1; }
  60% { opacity: 1; }
  100% { transform: translateX(100%); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .chores-header--sweep::after {
    animation: none;
  }
}

.chores-header h2 {
  margin: 0;
  min-width: 160px;
}

/* Assignee sections: a plain heading -- no icon, first name
   only -- with an inline 44x44 "add a chore" icon button next to it. The
   heading text needs a real pixel min-width alongside the fixed 44px
   button so the row wraps instead of squeezing either side (never
   min-width:0 + flex-wrap together). */
.chore-section {
  margin-bottom: 20px;
}

.chore-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.chore-section__head h3 {
  margin: 0;
  min-width: 120px;
}

.chore-section__add {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -11px;
  background: none;
  border: none;
  border-radius: 50%;
  color: var(--accent);
  cursor: pointer;
  transition: background-color 120ms ease;
}

.chore-section__add:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

/* Tapping anywhere in a section that says 'No chores assigned' opens the
   add-a-chore drawer: a real <button> wraps EmptyState so the whole empty
   area is one tap target, reset to look like the plain centered text it
   wraps rather than a button. */
.chore-empty-add {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-radius: 12px;
  padding: 0;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.chore-empty-add:hover {
  background: var(--surface-variant);
}

.module-list {
  margin-bottom: 8px;
}

/* A 2-line description (e.g. "Sort recycling bins" /
   "Cardboard separate from plastics this month") would make .list-row__main claim
   the row's full available width -- with no explicit flex-basis it sizes by
   its max-content hypothetical width during .list-row's flex-wrap
   line-fitting pass, before any shrinking is considered -- leaving no room
   on that line for the trash-can button (a sibling of .list-row__main) and
   dropping it to its own line below. Same flex: 1 + min-width: 0 fix
   applied for the identical footgun in TodosPage/GoalsPage/RecipesPage/
   LibraryPage: flex: 1 gives it a 0% flex-basis so it starts at zero width
   and grows into whatever the trash can doesn't need, instead of the other
   way around; min-width: 0 lets it actually shrink/grow that way instead of
   being held at its content's min-content floor. */
.chore-list-row :deep(.list-row__main) {
  flex: 1;
  min-width: 0;
}

/* Chore rows: same ListRow/row-checkbox shell used by To-Do and Shopping,
   with the plain <input type="checkbox"> swapped for an icon-based button so
   completing a chore carries two non-color signals together -- an icon swap
   (open circle -> filled check) here, plus the strikethrough + muted text
   .list-row.done already applies globally -- not color alone. */
.chore-check {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -11px;
  background: none;
  border: none;
  border-radius: 50%;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  transition: background-color 120ms ease;
}

.chore-check:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.chore-check--done {
  color: var(--text-muted);
}

/* An unassigned chore's check is disabled (completeChore would
   throw) -- same muted treatment as the done state, cursor swap so it
   doesn't invite a tap that silently does nothing. */
.chore-check:disabled {
  color: var(--text-muted);
  cursor: default;
}

.chore-check:disabled:hover {
  background: none;
}

/* Real pixel min-width (not min-width:0) alongside the fixed-width reward
   AppTag sibling in the same flex-wrap row -- the row wraps to a second line on narrow screens instead of the
   title getting crushed. */
.chore-title {
  font: var(--type-body);
  min-width: 140px;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.chore-title--done {
  /* Redundant with .list-row.done's strikethrough (kept for clarity if this
     row is ever used outside a .done ListRow); harmless when both apply. */
  text-decoration: line-through;
  color: var(--text-muted);
}

.chore-description {
  font: var(--type-label);
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 400;
  text-decoration: none;
}

/* Short inline hint for why the Unassigned section's check is
   disabled -- same muted/label treatment as .chore-description above. */
.chore-assign-hint {
  font: var(--type-label);
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}

.app-tag--reward {
  background: var(--accent-container);
  color: var(--on-accent-container);
  font-weight: 600;
}

.done-list {
  margin-top: 4px;
}

/* New-chore drawer form */
.chore-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chore-form textarea {
  font: var(--type-body);
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  resize: vertical;
}

.chore-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

/* Catalog-pick drawer: scrollable list of distinct chores, name + $ value,
   each row a full-width tap target (not just an icon) since picking one
   is the entire point of the row. */
.catalog-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 60vh;
  overflow-y: auto;
}

.catalog-row__btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 14px;
  min-height: 44px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  transition: box-shadow 120ms ease, border-color 120ms ease;
}

.catalog-row__btn:hover {
  box-shadow: var(--elevation-1);
  border-color: color-mix(in srgb, var(--text) 16%, var(--border));
}

.catalog-row__btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.catalog-row__title {
  font: var(--type-body);
  color: var(--text);
  min-width: 140px;
  flex: 1;
  display: flex;
  flex-direction: column;
}
</style>
