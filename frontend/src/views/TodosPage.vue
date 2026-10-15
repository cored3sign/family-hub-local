<script setup>
import { useItemHighlight } from '../lib/highlight'

useItemHighlight()
import { ref, computed } from 'vue'
import { CheckCircle2, Circle, CalendarClock, Zap, Plus } from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { firstName } from '../lib/names'
import { useFamily, useLive } from '../data/vue'
import { listTodos, saveTodo, deleteTodo, nudgeTodo } from '../data/modules/todos'
import { listMembers } from '../data/members'

const core = useCoreStore()
const { doc, actor } = useFamily()

const todos = useLive(listTodos)
const members = useLive(listMembers)

// A compact pill opens the same drawer used for edit-on-tap (AppModal
// renders as a bottom sheet on mobile — see RecipesPage's "Edit recipe"
// drawer for the precedent). One modal, two modes, same shape as
// CalendarPage's add/edit form.
const formOpen = ref(false)
const editingId = ref(null)
const formTitle = ref('')
const formAssignee = ref('') // required — defaulted to self once members/session load
const formDeadline = ref('') // optional

// Multi-select assignee filter chips, union semantics. Empty
// selection = no filter (show everything). Values are member ids or the
// 'unassigned' sentinel from AssigneeFilterChips.
//
// To-do items are filtered by default to items assigned to the logged-in
// user -- defaulted to [core.familyMemberId] rather than [] so a fresh
// visit to this page starts on "My Tasks", not everyone's to-dos. The "all" chip (deselecting My Tasks) still gets you
// back to an empty/no-filter selection via the chips' own toggle.
const filterSelection = ref(core.familyMemberId ? [core.familyMemberId] : [])

function memberName(id) {
  return firstName(members.value.find((m) => m.id === id)?.name) ?? 'Unassigned'
}

const filteredTodos = computed(() => {
  if (filterSelection.value.length === 0) return todos.value
  return todos.value.filter((t) => {
    const bucket = t.assigned_member_id ?? 'unassigned'
    return filterSelection.value.includes(bucket)
  })
})

function openAdd() {
  editingId.value = null
  formTitle.value = ''
  formAssignee.value = core.familyMemberId || ''
  formDeadline.value = ''
  formOpen.value = true
}

function openEdit(todo) {
  editingId.value = todo.id
  formTitle.value = todo.title
  formAssignee.value = todo.assigned_member_id ?? ''
  formDeadline.value = todo.deadline ?? ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

function save() {
  if (!formTitle.value.trim() || !formAssignee.value) return
  const existing = editingId.value ? todos.value.find((t) => t.id === editingId.value) : null
  saveTodo(doc, actor(), {
    id: editingId.value ?? undefined,
    title: formTitle.value,
    status: existing?.status ?? 'todo',
    assigned_member_id: formAssignee.value,
    deadline: formDeadline.value || null,
  })
  formOpen.value = false
}

function toggle(todo) {
  const next = todo.status === 'done' ? 'todo' : 'done'
  saveTodo(doc, actor(), {
    id: todo.id,
    title: todo.title,
    status: next,
    assigned_member_id: todo.assigned_member_id,
    deadline: todo.deadline,
  })
}

function remove(id) {
  deleteTodo(doc, id)
  formOpen.value = false
}

// A one-tap "nudge" affordance, distinct from a normal edit/re-save: a
// quiet re-save doesn't register as a reminder, so this gives every
// assigned to-do a "distinct, deliberate" signal without requiring anyone
// to remember to compose+pin an announcement by hand.
// Deliberately does NOT call load()/mutate the local todo -- a nudge never
// changes the todo itself, only raises a notification for its assignee, so
// there's nothing on this page that needs to change after a successful call.
const nudgedIds = ref(new Set())
const nudgeErrors = ref({})

function nudge(todo) {
  if (nudgedIds.value.has(todo.id)) return // already showing feedback -- avoid a double-tap re-trigger
  try {
    const { nudged } = nudgeTodo(doc, actor(), todo.id)
    if (!nudged) return // nudging yourself is a silent no-op, same as before
    nudgeErrors.value = { ...nudgeErrors.value, [todo.id]: null }
    nudgedIds.value = new Set(nudgedIds.value).add(todo.id)
    setTimeout(() => {
      const next = new Set(nudgedIds.value)
      next.delete(todo.id)
      nudgedIds.value = next
    }, 2000)
  } catch (e) {
    // Cooldown (nudged too recently) or any other failure -- brief inline
    // message on the button itself instead of a silent no-op, same
    // lightweight feedback mechanism as the success path, just a different
    // message.
    nudgeErrors.value = { ...nudgeErrors.value, [todo.id]: e.message || 'Could not nudge' }
    setTimeout(() => {
      nudgeErrors.value = { ...nudgeErrors.value, [todo.id]: null }
    }, 2500)
  }
}

function isOverdue(todo) {
  if (!todo.deadline || todo.status === 'done') return false
  return todo.deadline < new Date().toISOString().slice(0, 10)
}
</script>

<template>
  <div class="module-page">
    <h2>To-Do</h2>

    <!-- The shared chip row (components.css .assignee-chips) wraps onto
         multiple lines by default, which makes a tall inline block -- so
         it's scoped here to a single horizontally scrollable row instead,
         page-local via :deep() rather than touching the shared
         component/CSS other modules also use. -->
    <FilterButton :count="filterSelection.length" title="Filter tasks" @clear="filterSelection = []">
      <AssigneeFilterChips
        v-model="filterSelection"
        :members="members"
        :current-member-id="core.familyMemberId"
      />
    </FilterButton>

    <AppButton variant="primary" class="add-pill" @click="openAdd">
      <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Add a task
    </AppButton>

    <ul class="module-list">
      <ListRow
        v-for="t in filteredTodos"
        :key="t.id" :data-item-id="t.id"
        :done="t.status === 'done'"
        deletable
        class="todo-row"
        @delete="remove(t.id)"
      >
        <!-- Done state is signaled non-color-alone: icon swaps shape
             (outline circle -> filled checkmark), the icon tile desaturates
             to a muted gray, and the title gets a strikethrough (the
             strikethrough + muted text color comes from the shared
             .list-row.done rule in components.css) -- three stacked signals,
             matching DashboardPage's todo-done card treatment (WCAG AA
             contrast standard). -->
        <button
          type="button"
          class="todo-check"
          :class="{ 'todo-check--done': t.status === 'done' }"
          :aria-label="t.status === 'done' ? 'Mark not done' : 'Mark done'"
          @click.stop="toggle(t)"
        >
          <CheckCircle2 v-if="t.status === 'done'" :size="26" />
          <Circle v-else :size="26" />
        </button>

        <!-- Tap-to-edit: the row body opens the same add/edit
             drawer, pre-filled -- matching Cook/Goals' existing pattern.
             The complete-toggle, reassign select, nudge and delete controls
             all stop propagation so they keep working on their own tap. -->
        <div class="todo-row__body" @click="openEdit(t)">
          <span class="todo-row__title">{{ t.title }}</span>
          <!-- The item row shows no assignee; reassigning is a field in
               the tap-to-edit drawer below (formAssignee), same as editing
               the title or deadline. -->
          <div class="todo-row__meta" v-if="t.deadline">
            <AppTag :class="{ 'app-tag--overdue': isOverdue(t) }">
              <CalendarClock :size="12" />
              Due {{ t.deadline }}
            </AppTag>
          </div>
        </div>

        <!-- Only shown when the item has a real assignee -- nothing
             to nudge on an unassigned item, and the data layer rejects it too
             (defense in depth, not the only guard). -->
        <button
          v-if="t.assigned_member_id"
          type="button"
          class="todo-nudge"
          :class="{ 'todo-nudge--error': nudgeErrors[t.id] }"
          :aria-label="`Nudge ${memberName(t.assigned_member_id)} about this to-do`"
          :title="nudgeErrors[t.id] || 'Nudge'"
          @click.stop="nudge(t)"
        >
          <span v-if="nudgedIds.has(t.id)" class="todo-nudge__label">Nudged!</span>
          <span v-else-if="nudgeErrors[t.id]" class="todo-nudge__label">Wait…</span>
          <Zap v-else :size="20" />
        </button>
      </ListRow>
    </ul>
    <EmptyState v-if="filteredTodos.length === 0 && todos.length > 0">No tasks match this filter.</EmptyState>
    <EmptyState v-if="todos.length === 0" illustration="checklist">No tasks yet. Add one above.</EmptyState>

    <AppModal :open="formOpen" :title="editingId ? 'Edit task' : 'Add a task'" @close="closeForm">
      <form class="todo-form" @submit.prevent="save">
        <FormField v-model="formTitle" label="Task" placeholder="Add a task…" required />
        <label class="form-field">
          <span class="form-field__label">Assignee</span>
          <select v-model="formAssignee" required>
            <option value="" disabled>Choose a member…</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ firstName(m.name) }}</option>
          </select>
        </label>
        <FormField v-model="formDeadline" type="date" label="Deadline (optional)" />
        <div class="todo-form__actions">
          <AppButton v-if="editingId" type="button" variant="danger" @click="remove(editingId)">Delete</AppButton>
          <AppButton type="submit" variant="primary">Save</AppButton>
        </div>
      </form>
    </AppModal>
  </div>
</template>

<style scoped>
.add-pill {
  display: inline-flex;
  align-items: center;
  margin-bottom: 16px;
}

.todo-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.todo-form__actions {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
}

/* Match DashboardPage's card language: white rounded card, soft shadow,
   generous padding -- ListRow's own base styling (components.css) stays a
   thinner bordered row for other modules, so the card look for To-Do is
   layered on here via a page-scoped class rather than changing the shared
   component. */
.todo-row {
  border: none;
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 14px 16px;
  gap: 12px;
  transition: box-shadow 120ms ease;
}

.todo-row:hover {
  box-shadow: var(--elevation-2);
  border-color: transparent;
}

.todo-row :deep(.list-row__main) {
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 12px;
  flex-wrap: nowrap;
}

/* Done rows read as visibly "settled": recessed flat tint instead of the
   crisp white/shadow of an open task -- a fourth non-color-alone signal
   (shape/elevation change) stacked on top of the icon swap + strikethrough
   below, echoing the comp's "completed cards look flatter" treatment. */
.todo-row.done {
  box-shadow: none;
  background: var(--surface-variant);
}

.todo-row.done:hover {
  box-shadow: none;
}

.todo-check {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: var(--accent-container);
  color: var(--accent);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.todo-check:hover {
  background: color-mix(in srgb, var(--accent-container) 80%, var(--accent) 20%);
}

/* Desaturated muted-gray tile (icon shape also swaps to a filled check via
   the template's v-if/v-else above) instead of the coral "open task" tile. */
.todo-check--done {
  background: var(--surface-variant);
  color: var(--text-muted);
}

.todo-check--done:hover {
  background: color-mix(in srgb, var(--surface-variant) 80%, var(--text) 8%);
}

/* Intentionally a different hue family (--complement, not
   --accent) from .todo-check above -- this is a distinct action (raise a
   notification), not another flavor of "mark done," and reusing the same
   accent color would blur that distinction. No dedicated
   "--complement-container" token exists yet (unlike --accent-container/
   --danger-container), so a tinted fill is mixed from the existing
   --complement token itself rather than inventing a new custom property or
   hardcoding a color. */
.todo-nudge {
  /* min-width (not a fixed width) -- the icon state is a plain 44x44
     square, but the "Nudged!"/"Wait…" text states need to grow wider than
     that without clipping, so the touch-target minimum is a floor, not a
     cap. flex: none with an explicit basis keeps this from being squeezed
     by its flex-wrap: nowrap siblings when the wider text state is showing. */
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  height: 44px;
  padding: 0 10px;
  border: none;
  border-radius: 12px;
  background: color-mix(in srgb, var(--complement) 16%, var(--surface));
  color: var(--complement);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.todo-nudge:hover {
  background: color-mix(in srgb, var(--complement) 28%, var(--surface));
}

.todo-nudge__label {
  font: var(--type-label);
  font-weight: 700;
  white-space: nowrap;
}

.todo-nudge--error {
  color: var(--danger);
  background: var(--danger-container);
}

.todo-row__body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
}

.todo-row__title {
  font: var(--type-title);
  color: var(--text);
  overflow-wrap: break-word;
}

.todo-row__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.app-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.app-tag--overdue {
  background: var(--danger-container);
  color: var(--danger);
}
</style>
