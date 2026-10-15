<script setup>
import { useItemHighlight } from '../lib/highlight'

useItemHighlight()
import { ref, computed } from 'vue'
import { Plus, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { firstName } from '../lib/names'
import { useFamily, useLive } from '../data/vue'
import { listEvents, saveEvent, deleteEvent } from '../data/modules/events'
import { listMembers } from '../data/members'

const core = useCoreStore()
const { doc } = useFamily()

const events = useLive(listEvents)
const members = useLive(listMembers)

// Month-grid view (desktop default — no mobile list-view).
const today = new Date()
const viewYear = ref(today.getFullYear())
const viewMonth = ref(today.getMonth()) // 0-indexed

// Same union-semantics assignee filter chip pattern as To-Do.
const filterSelection = ref([])

// Tapping a day opens a day-detail list first, not the add/edit form
// directly. One AppModal instance carries both contents -- modalMode
// switches its body between the day's event list and the add/edit form,
// so "list -> edit" reads as a content swap inside one sheet rather than
// stacking a second modal on top.
const modalOpen = ref(false)
const modalMode = ref('day') // 'day' | 'form'
const selectedDate = ref('')

const editingId = ref(null)
const formTitle = ref('')
const formDate = ref('')
const formTime = ref('')
const formCategory = ref('event')
const formAssignee = ref('') // '' = Everyone (the default for unassigned)

function memberName(id) {
  return firstName(members.value.find((m) => m.id === id)?.name) ?? 'Everyone'
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function isoDate(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

const monthLabel = computed(() =>
  new Date(viewYear.value, viewMonth.value, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
)

// Full formatted date for the day-detail modal title, e.g. "Wednesday,
// September 9" (not just the raw ISO string).
const selectedDateLabel = computed(() => {
  if (!selectedDate.value) return ''
  const [y, m, d] = selectedDate.value.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
})

function formatEventTime(time) {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

const filteredEvents = computed(() => {
  if (filterSelection.value.length === 0) return events.value
  return events.value.filter((e) => {
    const bucket = e.assigned_member_id ?? 'unassigned'
    return filterSelection.value.includes(bucket)
  })
})

const eventsByDate = computed(() => {
  const map = {}
  for (const e of filteredEvents.value) {
    ;(map[e.event_date] ??= []).push(e)
  }
  return map
})

// Events shown in the open day-detail modal. Uses the full (unfiltered) event
// list rather than filteredEvents -- the assignee chips filter which days show
// dots on the grid, but once a day is opened directly every event that day
// should be visible, not silently hidden by a filter picked for a different
// purpose.
const selectedDayEvents = computed(() => {
  if (!selectedDate.value) return []
  return events.value.filter((e) => e.event_date === selectedDate.value)
})

// Calendar grid cells: leading/trailing days from adjacent months fill the
// first/last week so the grid is always a clean 7-column table.
const gridCells = computed(() => {
  const y = viewYear.value
  const m = viewMonth.value
  const firstOfMonth = new Date(y, m, 1)
  const startWeekday = firstOfMonth.getDay() // 0=Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const daysInPrevMonth = new Date(y, m, 0).getDate()

  const cells = []
  for (let i = 0; i < startWeekday; i++) {
    const d = daysInPrevMonth - startWeekday + 1 + i
    const pm = m === 0 ? 11 : m - 1
    const py = m === 0 ? y - 1 : y
    cells.push({ date: isoDate(py, pm, d), day: d, inMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: isoDate(y, m, d), day: d, inMonth: true })
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const last = cells[cells.length - 1]
    const [ly, lm, ld] = last.date.split('-').map(Number)
    const nextDate = new Date(ly, lm - 1, ld + 1)
    cells.push({
      date: isoDate(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate()),
      day: nextDate.getDate(),
      inMonth: false,
    })
    if (cells.length >= 42) break
  }
  return cells
})

const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate())

function prevMonth() {
  if (viewMonth.value === 0) {
    viewMonth.value = 11
    viewYear.value -= 1
  } else {
    viewMonth.value -= 1
  }
}

function nextMonth() {
  if (viewMonth.value === 11) {
    viewMonth.value = 0
    viewYear.value += 1
  } else {
    viewMonth.value += 1
  }
}

function goToday() {
  viewYear.value = today.getFullYear()
  viewMonth.value = today.getMonth()
}

function resetForm(date = '') {
  editingId.value = null
  formTitle.value = ''
  formDate.value = date
  formTime.value = ''
  formCategory.value = 'event'
  formAssignee.value = ''
}

// Tapping/clicking a day opens the day-detail list (modalMode 'day')
// rather than the add/edit form directly. The add/edit form is reached one
// step deeper, via "Add event" or tapping a row.
function openDay(date) {
  selectedDate.value = date
  modalMode.value = 'day'
  modalOpen.value = true
}

function openNew() {
  resetForm(todayIso)
  modalMode.value = 'form'
  modalOpen.value = true
}

// "Add event" inside the day-detail modal: pre-fills the form with the
// currently open day's date (reuses resetForm) and swaps this same modal
// instance into form mode rather than closing/reopening.
function addForSelectedDay() {
  resetForm(selectedDate.value)
  modalMode.value = 'form'
}

function editEvent(e) {
  editingId.value = e.id
  formTitle.value = e.title
  formDate.value = e.event_date
  formTime.value = e.event_time || ''
  formCategory.value = e.category
  formAssignee.value = e.assigned_member_id || ''
  modalMode.value = 'form'
}

const modalTitle = computed(() => {
  if (modalMode.value === 'day') return selectedDateLabel.value
  return editingId.value ? 'Edit event' : 'Add event'
})

function closeModal() {
  modalOpen.value = false
}

function save() {
  if (!formTitle.value.trim() || !formDate.value) return
  saveEvent(doc, {
    id: editingId.value,
    title: formTitle.value,
    event_date: formDate.value,
    event_time: formTime.value || null,
    category: formCategory.value,
    assigned_member_id: formAssignee.value || null,
  })
  modalOpen.value = false
}

function remove(id) {
  deleteEvent(doc, id)
  modalOpen.value = false
}
</script>

<template>
  <div class="module-page calendar-page">
    <h2>Calendar</h2>

    <!-- AssigneeFilterChips (the shared chip mechanism) renders inside the
         shared FilterButton's modal rather than always-visible on the page.
         Filter + Add share one row, matching Todos's pattern. -->
    <div class="calendar-filter-row">
      <FilterButton :count="filterSelection.length" title="Filter events" @clear="filterSelection = []">
        <AssigneeFilterChips
          v-model="filterSelection"
          :members="members"
          :current-member-id="core.familyMemberId"
          my-label="My Events"
          unassigned-label="Everyone"
        />
      </FilterButton>
      <AppButton variant="primary" class="add-pill" @click="openNew">
        <Plus :size="18" />
        Add event
      </AppButton>
    </div>

    <div class="calendar-toolbar">
      <button type="button" class="calendar-toolbar__icon-btn" aria-label="Previous month" @click="prevMonth">
        <ChevronLeft :size="20" />
      </button>
      <strong class="calendar-month">{{ monthLabel }}</strong>
      <button type="button" class="calendar-toolbar__icon-btn" aria-label="Next month" @click="nextMonth">
        <ChevronRight :size="20" />
      </button>
      <AppButton variant="secondary" @click="goToday">Today</AppButton>
    </div>

    <div class="calendar-card">
      <div class="calendar-grid">
        <div class="calendar-weekday" v-for="wd in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="wd">{{ wd }}</div>
        <button
          v-for="cell in gridCells"
          :key="cell.date"
          type="button"
          class="calendar-cell"
          :class="{
            'calendar-cell--outside': !cell.inMonth,
            'calendar-cell--today': cell.date === todayIso,
            'calendar-cell--selected': modalOpen && modalMode === 'day' && cell.date === selectedDate,
          }"
          :aria-current="cell.date === todayIso ? 'date' : undefined"
          @click="openDay(cell.date)"
        >
          <span class="calendar-cell__day">
            <span class="calendar-cell__day-number">{{ cell.day }}</span>
          </span>
          <span class="calendar-cell__events">
            <span
              v-for="e in (eventsByDate[cell.date] || []).slice(0, 3)"
              :key="e.id"
              class="calendar-event-dot"
              aria-hidden="true"
            ></span>
            <span v-if="(eventsByDate[cell.date] || []).length > 3" class="calendar-more">
              +{{ eventsByDate[cell.date].length - 3 }}
            </span>
          </span>
        </button>
      </div>
    </div>
    <EmptyState v-if="filteredEvents.length === 0 && events.length > 0">No events match this filter.</EmptyState>
    <EmptyState v-if="events.length === 0" illustration="calendar">No events this month. Add one above.</EmptyState>

    <AppModal :open="modalOpen" :title="modalTitle" @close="closeModal">
      <!-- Day-detail list: tapping a day shows its events here
           first, rather than opening the add/edit form directly. -->
      <div v-if="modalMode === 'day'" class="day-detail">
        <AppButton variant="primary" class="day-detail__add" @click="addForSelectedDay">
          <Plus :size="18" />
          Add event
        </AppButton>

        <EmptyState v-if="selectedDayEvents.length === 0" illustration="calendar">No events on this day.</EmptyState>
        <ul v-else class="module-list day-detail__list">
          <ListRow v-for="e in selectedDayEvents" :key="e.id" :data-item-id="e.id">
            <button type="button" class="day-detail__row-btn" @click="editEvent(e)">
              <span class="day-detail__row-title">{{ e.title }}</span>
              <span class="day-detail__row-tags">
                <AppTag v-if="e.event_time">{{ formatEventTime(e.event_time) }}</AppTag>
                <AppTag class="app-tag--muted">{{ memberName(e.assigned_member_id) }}</AppTag>
              </span>
            </button>
          </ListRow>
        </ul>
      </div>

      <!-- Add/edit event form -- same markup as before, reached one step
           deeper now (day list -> edit form -> delete), swapped into the
           same AppModal instance instead of a second modal layer. -->
      <form v-else class="event-form" @submit.prevent="save">
        <FormField v-model="formTitle" label="Title" placeholder="Event title…" required />
        <FormField v-model="formDate" type="date" label="Date" required />
        <FormField v-model="formTime" type="time" label="Time (optional)" />
        <FormField v-model="formCategory" label="Category" placeholder="event, appointment…" />
        <label class="form-field">
          <span class="form-field__label">Assignee</span>
          <select v-model="formAssignee">
            <option value="">Everyone</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ firstName(m.name) }}</option>
          </select>
        </label>
        <div class="event-form__actions">
          <AppButton v-if="editingId" type="button" variant="danger" @click="remove(editingId)">Delete</AppButton>
          <AppButton type="submit" variant="primary">Save</AppButton>
        </div>
      </form>
    </AppModal>
  </div>
</template>

<style scoped>
.calendar-filter-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}

.calendar-filter-row .add-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* Month toolbar: a compact white bar echoing the card language (rounded,
   soft elevation) rather than a bare row of plain text controls. */
.calendar-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 8px 10px;
  margin: 12px 0;
}

.calendar-toolbar__icon-btn {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.calendar-toolbar__icon-btn:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
}

.calendar-toolbar__icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.calendar-month {
  flex: 1;
  text-align: center;
  font: var(--type-title);
  color: var(--text);
}

/* Grid card: the whole month grid lives inside one white rounded card,
   matching the card-forward language used across the rest of the app
   instead of a bare grid floating on the cream background. */
.calendar-card {
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 12px;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}

.calendar-weekday {
  text-align: center;
  font: var(--type-label);
  color: var(--text-muted);
  padding: 4px 0 8px;
}

/* Cells are background-only, no per-cell box. The cell sits directly
   on .calendar-card's own surface -- separation between cells comes from
   the grid gap and the hover/selected background, not borders. */
.calendar-cell {
  aspect-ratio: 1 / 1;
  min-height: 56px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 4px;
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  font: inherit;
  color: var(--text);
  text-align: left;
  overflow: hidden;
  transition: background-color 120ms ease;
}

.calendar-cell:hover {
  background: var(--surface-variant);
}

.calendar-cell:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Other-month days: no second background layer -- just lower text opacity. */
.calendar-cell--outside {
  color: var(--text-muted);
  opacity: 0.45;
}

/* Selected day (currently open in the day-detail modal): the only cell with
   a persistent tinted fill outside of today/hover. */
.calendar-cell--selected {
  background: var(--accent-container);
}

.calendar-cell--selected .calendar-cell__day-number {
  color: var(--on-accent-container);
}

.calendar-cell__day {
  display: flex;
  align-items: center;
  width: 100%;
}

.calendar-cell__day-number {
  font: var(--type-label);
  font-size: 12px;
}

/* Today: a solid-fill circle badge around the day number instead of a
   cell-level border. Shape + fill change (not color alone) plus
   aria-current="date" on the cell covers the non-color-alone requirement
   without a separate cramped text badge. */
.calendar-cell--today .calendar-cell__day-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 800;
}

/* Selected + today together: keep the circle badge legible over the
   selected-day tint. */
.calendar-cell--selected.calendar-cell--today .calendar-cell__day-number {
  color: var(--accent-contrast);
}

.calendar-cell__events {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 100%;
  min-height: 6px;
}

/* Events render as a row of small solid dots, one per event
   capped at 3, then a "+N" label -- no per-event pill/text, no per-category
   color coding. Titles only ever appear in the day-detail modal. */
.calendar-event-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.calendar-more {
  font: var(--type-label);
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1;
}

/* Day-detail modal body */
.day-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.day-detail__add {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.day-detail__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Row content is a plain button filling ListRow's slot so the whole row is
   tappable (edit-on-tap), matching ListRow's established "tap row to edit,
   delete lives inside the form" pattern used elsewhere (e.g. Wishlist). A
   real 200px min-width on the title block plus flex-wrap keeps the time/
   assignee tags from collapsing the title to nothing on narrow widths --
   min-width: 0 is never paired with wrap here. */
.day-detail__row-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.day-detail__row-title {
  min-width: 200px;
  flex: 1;
  font: var(--type-title);
  font-size: 15px;
  color: var(--text);
  overflow-wrap: break-word;
}

.day-detail__row-tags {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.event-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.event-form__actions {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
}

/* Desktop: bigger cells, more breathing room -- this view is desktop-default
   (no mobile list-view).

   .calendar-cell's aspect-ratio: 1/1 (base rule, above) means
   cell HEIGHT is driven by cell WIDTH, and width grows with the desktop
   content pane -- on a wide monitor, 6 rows of proportionally-tall cells
   routinely exceeds the viewport, forcing .content's scroll even though
   this view's whole point is "desktop-default, no mobile fallback needed."
   min-height alone only sets a FLOOR, never a ceiling, so it can't fix
   this by itself -- it can only make cells bigger, never smaller, than
   aspect-ratio already demands.

   So at this breakpoint, aspect-ratio no longer drives height at all --
   height instead comes from a max-height derived from actual available
   space (viewport minus the topbar/toolbar/filter-row/padding this page's
   other chrome already occupies, mirroring the same 100vh-relative math
   .app-shell itself already uses for the desktop shell). Width still comes
   from the grid's own 7-column 1fr track sizing, so cells can still be
   wider than tall on an ultra-wide monitor -- intentional; a calendar cell
   reading a little short is far less broken than the grid overflowing the
   screen it was specifically built not to need scrolling on. */
@media (min-width: 900px) {
  .calendar-grid {
    gap: 8px;
  }

  .calendar-cell {
    aspect-ratio: unset;
    /* ~64px topbar + ~24px*2 .content padding + ~48px toolbar row +
       ~40px filter row + ~24px card padding + 6 rows' worth of the grid's
       own 8px gap, then split across 6 rows -- an estimate, not a pixel-
       perfect measurement (the exact chrome height varies slightly by
       content), generous enough that cells still comfortably clear their
       own min-height floor on a typical 800-900px-tall laptop viewport
       while guaranteeing the grid as a whole no longer grows past it. */
    height: max(56px, calc((100dvh - 260px) / 6));
    min-height: 56px;
    max-height: 140px;
    padding: 6px;
  }
}
</style>
