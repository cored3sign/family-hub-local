<script setup>
import { useItemHighlight } from '../lib/highlight'

useItemHighlight()
// Goals: title + color + mark-complete, with assignee filter chips (the
// same union-select AssigneeFilterChips component To-Do uses, reused
// as-is). There is no stock-photo card art (no external image fetch) and
// no to-do<->Goal linking — no todo/goal coupling anywhere on this page.
import { ref, computed } from 'vue'
import { Circle, CheckCircle2, Plus } from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { firstName } from '../lib/names'
import ConfettiBurst from '../components/ConfettiBurst.vue'
import { useFamily, useLive } from '../data/vue'
import { listGoals, saveGoal, toggleGoalComplete, deleteGoal } from '../data/modules/goals'
import { listMembers } from '../data/members'

const core = useCoreStore()
const { doc, actor } = useFamily()

const goals = useLive(listGoals)
const members = useLive(listMembers)

const newTitle = ref('')
const newColor = ref('')
const newAssignee = ref('')
// A single optional short "progress note" -- a running latest note, not a
// percentage/checklist/history log.
const newProgressNote = ref('')

// Tapping a row opens an edit drawer. One AppModal instance,
// mode-switched between 'new' and 'edit' (same shared-instance convention
// as Communication's 1:1 form), rather than two separate modals.
const showGoalModal = ref(false)
const modalMode = ref('new') // 'new' | 'edit'
const editingId = ref(null)
const goalSaving = ref(false)

function openNewGoal() {
  modalMode.value = 'new'
  editingId.value = null
  newTitle.value = ''
  newColor.value = colorPresets[0]
  newAssignee.value = core.familyMemberId || ''
  newProgressNote.value = ''
  showGoalModal.value = true
}

function openEditGoal(goal) {
  modalMode.value = 'edit'
  editingId.value = goal.id
  newTitle.value = goal.title
  newColor.value = goal.color
  newAssignee.value = goal.assigned_member_id || ''
  newProgressNote.value = goal.progress_note || ''
  showGoalModal.value = true
}

function closeGoalModal() {
  showGoalModal.value = false
}

// A fixed preset swatch list rather than a raw <input type="color"> — keeps every goal's color
// drawn from a palette that reads well against the design tokens instead of
// an arbitrary user-picked hex that might clash with --text/--surface.
const colorPresets = [
  '#4d5faf', // accent (default)
  '#ba1a1a', // danger-ish red
  '#e07a5f', // terracotta
  '#e0b64f', // gold
  '#7a9e7e', // sage
  '#4a90d9', // sky blue
  '#9b6bce', // violet
  '#5c5d67', // neutral gray
]

// Multi-select assignee filter chips, union semantics — identical
// mechanic to To-Do's filterSelection.
//
// Rendered inside the shared FilterButton's modal instead of an
// always-visible row, which removes the need for a
// horizontal-scroll-with-chevron-hint workaround for a growing chip list
// -- a modal has vertical room, so the chips just wrap normally.
const filterSelection = ref([])

const activeGoals = computed(() => goals.value.filter((g) => g.status === 'active'))
const completeGoals = computed(() => goals.value.filter((g) => g.status === 'complete'))

function applyFilter(list) {
  if (filterSelection.value.length === 0) return list
  return list.filter((g) => {
    const bucket = g.assigned_member_id ?? 'unassigned'
    return filterSelection.value.includes(bucket)
  })
}

const filteredActiveGoals = computed(() => applyFilter(activeGoals.value))
const filteredCompleteGoals = computed(() => applyFilter(completeGoals.value))

function saveGoalForm() {
  if (!newTitle.value.trim() || goalSaving.value) return
  goalSaving.value = true
  try {
    saveGoal(doc, actor(), {
      id: editingId.value || undefined,
      title: newTitle.value,
      color: newColor.value || colorPresets[0],
      assigned_member_id: newAssignee.value || null,
      progress_note: newProgressNote.value || null,
    })
    closeGoalModal()
  } finally {
    goalSaving.value = false
  }
}

// Confetti fires only on a genuine active -> complete transition, never on
// the undo (complete -> active) side of this same toggle;
// toggleGoalComplete returns the new status.
const showConfetti = ref(false)

function toggleComplete(goal) {
  const status = toggleGoalComplete(doc, actor(), goal.id)
  if (status === 'complete') showConfetti.value = true
}

function remove(id) {
  deleteGoal(doc, id)
}
</script>

<template>
  <div class="module-page">
    <h2>Goals</h2>

    <FilterButton :count="filterSelection.length" title="Filter goals" @clear="filterSelection = []">
      <AssigneeFilterChips
        v-model="filterSelection"
        :members="members"
        :current-member-id="core.familyMemberId"
        my-label="My Goals"
      />
    </FilterButton>

    <AppButton type="button" variant="primary" class="goal-new-btn" @click="openNewGoal">
      <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Add goal
    </AppButton>

    <ul class="module-list">
      <ListRow v-for="g in filteredActiveGoals" :key="g.id" :data-item-id="g.id" deletable class="goal-row" @delete="remove(g.id)">
        <div class="goal-row__body" @click="openEditGoal(g)">
          <button type="button" class="goal-row__toggle" @click.stop="toggleComplete(g)">
            <Circle :size="20" />
          </button>
          <span class="goal-row__title">
            {{ g.title }}
            <span v-if="g.progress_note" class="goal-row__note">{{ g.progress_note }}</span>
          </span>
        </div>
      </ListRow>
    </ul>
    <EmptyState v-if="filteredActiveGoals.length === 0 && activeGoals.length > 0">No active goals match this filter.</EmptyState>
    <EmptyState v-if="activeGoals.length === 0" illustration="goals">No active goals yet. Add one above.</EmptyState>

    <template v-if="filteredCompleteGoals.length">
      <h3>Completed</h3>
      <ul class="module-list done-list">
        <ListRow v-for="g in filteredCompleteGoals" :key="g.id" :data-item-id="g.id" done deletable class="goal-row" @delete="remove(g.id)">
          <div class="goal-row__body" @click="openEditGoal(g)">
            <button type="button" class="goal-row__toggle" @click.stop="toggleComplete(g)">
              <CheckCircle2 :size="20" />
            </button>
            <span class="goal-row__title goal-row__title--done">
              {{ g.title }}
              <span v-if="g.progress_note" class="goal-row__note">{{ g.progress_note }}</span>
            </span>
          </div>
        </ListRow>
      </ul>
    </template>

    <AppModal
      :open="showGoalModal"
      :title="modalMode === 'new' ? 'Add goal' : 'Edit goal'"
      @close="closeGoalModal"
    >
      <div class="goal-form">
        <FormField v-model="newTitle" label="Title" placeholder="Add a goal…" required />
        <label class="form-field">
          <span class="form-field__label">Assignee</span>
          <select v-model="newAssignee">
            <option value="">Unassigned</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ firstName(m.name) }}</option>
          </select>
        </label>
        <div class="color-picker">
          <span class="form-field__label">Color</span>
          <div class="color-swatches">
            <button
              v-for="c in colorPresets"
              :key="c"
              type="button"
              class="color-swatch"
              :class="{ 'color-swatch--active': newColor === c }"
              :style="{ background: c }"
              :aria-label="`Choose color ${c}`"
              @click="newColor = c"
            />
          </div>
        </div>
        <label class="form-field">
          <span class="form-field__label">Progress note (optional)</span>
          <textarea
            v-model="newProgressNote"
            rows="2"
            placeholder="Where things stand right now…"
          ></textarea>
        </label>

        <div class="goal-form__actions">
          <AppButton type="button" variant="primary" :disabled="goalSaving || !newTitle.trim()" @click="saveGoalForm">
            {{ goalSaving ? 'Saving…' : 'Save goal' }}
          </AppButton>
          <AppButton type="button" variant="ghost" @click="closeGoalModal">Cancel</AppButton>
        </div>
      </div>
    </AppModal>

    <ConfettiBurst v-if="showConfetti" @done="showConfetti = false" />
  </div>
</template>

<style scoped>
.goal-new-btn {
  margin-bottom: 16px;
}

/* A long title (e.g. "Learn to ride a bike without training wheels") would
   make .goal-row__body grow to its full content width. .list-row__main has no explicit flex-basis by
   default (flex: 0 1 auto), so the browser's flex-wrap line-fitting pass
   sizes it by its max-content hypothetical width -- which is the row's
   entire available width here -- before any shrinking is considered, so
   .list-row (flex-wrap: wrap) had no room left on that line for the
   trash-can button (a sibling of .list-row__main, not of .goal-row__body)
   and dropped it to its own line below. flex: 1 gives it a 0% flex-basis so
   the line-fitting pass starts it at zero width and grows it into whatever
   space the trash can doesn't need, instead of the reverse; min-width: 0
   lets that shrink/grow actually happen instead of the browser holding it
   at its content's min-content floor; nowrap on .list-row__main keeps the
   toggle icon + title + trash can on one row while the title text wraps
   inside its own box. Same fix applied for the identical footgun in
   TodosPage/RecipesPage/LibraryPage (min-width: 0 + nowrap alone do not
   fix it; flex: 1 is the essential part). */
.goal-row :deep(.list-row__main) {
  flex: 1;
  min-width: 0;
  flex-wrap: nowrap;
}

.goal-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.goal-form__actions {
  display: flex;
  gap: 8px;
}

.goal-form textarea {
  font: var(--type-body);
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  resize: vertical;
}

.color-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.color-swatches {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}

.color-swatch:hover {
  transform: scale(1.08);
}

.color-swatch--active {
  border-color: var(--text);
  box-shadow: 0 0 0 2px var(--surface);
}

.goal-row__body {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.goal-row__toggle {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -12px;
  background: none;
  border: none;
  border-radius: 50%;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  transition: background-color 120ms ease;
}

.goal-row__toggle:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.goal-row__title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  font: var(--type-title);
  color: var(--text);
}

.goal-row__title--done {
  text-decoration: line-through;
  color: var(--text-muted);
  font-weight: 500;
}

.goal-row__note {
  font: var(--type-label);
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 400;
  text-decoration: none;
}
</style>
