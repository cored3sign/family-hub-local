<script setup>
import { useItemHighlight } from '../lib/highlight'

useItemHighlight()
import { ref, computed } from 'vue'
import { Cake, Plus, PartyPopper } from 'lucide-vue-next'
import { useFamily, useLive } from '../data/vue'
import { listBirthdays, saveBirthday, deleteBirthday, todayIso } from '../data/modules/birthdays'
import { listMembers } from '../data/members'

const { doc } = useFamily()

// The birthday list: which day each one falls on, and the age that makes when the year born is known.
const birthdays = useLive((d) => listBirthdays(d))
const members = useLive(listMembers)
const today = todayIso()
const thisYear = Number(today.slice(0, 4))

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Add and edit share one sheet (AppModal, a bottom sheet on mobile), like the other modules.
const formOpen = ref(false)
const editingId = ref(null)
const formName = ref('')
const formMonth = ref('')
const formDay = ref('')
const formYear = ref('')
const formAge = ref('')
const formMember = ref('')
const formError = ref('')

// February is offered in full, since the year born may not be known.
const dayOptions = computed(() => {
  const month = Number(formMonth.value)
  const count = month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31
  return Array.from({ length: count }, (_, i) => i + 1)
})

function clearForm() {
  formName.value = ''
  formMonth.value = ''
  formDay.value = ''
  formYear.value = ''
  formAge.value = ''
  formMember.value = ''
  formError.value = ''
}

function openAdd() {
  editingId.value = null
  clearForm()
  formOpen.value = true
}

// Editing shows the year born. The age is only ever typed in, so it starts blank.
function openEdit(b) {
  editingId.value = b.id
  clearForm()
  formName.value = b.name
  formMonth.value = String(b.birth_month)
  formDay.value = String(b.birth_day)
  formYear.value = b.birth_year == null ? '' : String(b.birth_year)
  formMember.value = b.member_id ?? ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

function save() {
  formError.value = ''
  try {
    saveBirthday(
      doc,
      {
        id: editingId.value ?? undefined,
        name: formName.value,
        birth_month: formMonth.value,
        birth_day: formDay.value,
        birth_year: formYear.value,
        age: formAge.value,
        member_id: formMember.value,
      },
      today,
    )
    formOpen.value = false
  } catch (e) {
    formError.value = e.message
  }
}

function remove() {
  deleteBirthday(doc, editingId.value)
  formOpen.value = false
}

// The year 2000 is a leap year, so a 29 February birthday displays correctly.
function dayAndMonth(month, day) {
  return new Date(2000, month - 1, day).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}

// "Born 14 March 2018" when the year is known, otherwise "Birthday 14 March".
function metaLabel(b) {
  if (b.birth_year == null) return `Birthday ${dayAndMonth(b.birth_month, b.birth_day)}`
  const born = new Date(b.birth_year, b.birth_month - 1, b.birth_day)
  return `Born ${born.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`
}

// "Today", "Tomorrow", "In 3 days", then the date.
function whenLabel(b) {
  if (b.days_until === 0) return 'Today'
  if (b.days_until === 1) return 'Tomorrow'
  if (b.days_until <= 6) return `In ${b.days_until} days`
  const [y, m, d] = b.next_date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
</script>

<template>
  <div class="module-page">
    <div class="birthdays-header">
      <div class="birthdays-header__tile">
        <Cake :size="22" />
      </div>
      <h2>Birthdays</h2>
    </div>

    <p class="birthdays-intro">
      Add a name and a birthday. On the day, everyone in the family gets a reminder.
    </p>

    <AppButton variant="primary" class="add-pill" @click="openAdd">
      <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Add a birthday
    </AppButton>

    <ul v-if="birthdays.length" class="module-list birthdays-list">
      <li
        v-for="b in birthdays"
        :key="b.id"
        class="birthday-card"
        :class="{ 'birthday-card--today': b.days_until === 0 }"
        :data-item-id="b.id"
      >
        <button type="button" class="birthday-card__body" @click="openEdit(b)">
          <div class="birthday-card__name">
            <PartyPopper v-if="b.days_until === 0" :size="16" class="birthday-card__party" />
            {{ b.name }}
          </div>
          <div class="birthday-card__meta">{{ metaLabel(b) }}</div>
        </button>
        <div class="birthday-card__when">
          <span class="birthday-card__label">{{ whenLabel(b) }}</span>
          <AppTag v-if="b.turns !== null">Turns {{ b.turns }}</AppTag>
        </div>
      </li>
    </ul>

    <EmptyState v-else illustration="birthdays">
      No birthdays yet. Add one above, and the family is reminded on the day.
    </EmptyState>

    <AppModal :open="formOpen" :title="editingId ? 'Edit birthday' : 'Add a birthday'" @close="closeForm">
      <form class="birthdays-form" @submit.prevent="save">
        <FormField v-model="formName" label="Name" placeholder="Ana, Grandma Rose…" required />
        <label class="form-field">
          <span class="form-field__label">In the family? <span class="birthdays-form__optional">(optional)</span></span>
          <select v-model="formMember">
            <option value="">Not a family member</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </label>
        <fieldset class="birthdays-form__date">
          <legend class="form-field__label">Birthday</legend>
          <div class="birthdays-form__row">
            <label class="form-field">
              <span class="form-field__label">Month</span>
              <select v-model="formMonth" required>
                <option value="" disabled>Choose…</option>
                <option v-for="(name, i) in MONTHS" :key="name" :value="String(i + 1)">{{ name }}</option>
              </select>
            </label>
            <label class="form-field">
              <span class="form-field__label">Day</span>
              <select v-model="formDay" required>
                <option value="" disabled>Choose…</option>
                <option v-for="d in dayOptions" :key="d" :value="String(d)">{{ d }}</option>
              </select>
            </label>
          </div>
        </fieldset>
        <label class="form-field">
          <span class="form-field__label">Year born <span class="birthdays-form__optional">(optional)</span></span>
          <input v-model="formYear" type="number" inputmode="numeric" :min="1900" :max="thisYear" placeholder="e.g. 2018" />
        </label>
        <label class="form-field">
          <span class="form-field__label">Or age now <span class="birthdays-form__optional">(optional)</span></span>
          <input v-model="formAge" type="number" inputmode="numeric" min="0" max="130" placeholder="e.g. 8" />
        </label>
        <p v-if="formError" class="error">{{ formError }}</p>
        <div class="birthdays-form__actions">
          <AppButton v-if="editingId" type="button" variant="danger" @click="remove">Delete</AppButton>
          <AppButton type="submit" variant="primary">Save</AppButton>
        </div>
      </form>
    </AppModal>
  </div>
</template>

<style scoped>
/* Header: icon tile + title, the same treatment as the other module pages. */
.birthdays-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.birthdays-header__tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
  background: linear-gradient(135deg, var(--tile-birthday-start), var(--tile-birthday-end));
}

.birthdays-header h2 {
  margin: 0;
}

.birthdays-intro {
  margin: 0 0 16px;
  font: var(--type-label);
  color: var(--text-muted);
}

.add-pill {
  display: inline-flex;
  align-items: center;
  margin-bottom: 16px;
}

.birthdays-list {
  gap: 10px;
}

.birthday-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 12px 14px;
}

/* The day itself gets a tinted card, so it stands out in the list without relying on color alone:
   the "Today" label and the party icon say the same thing. */
.birthday-card--today {
  background: color-mix(in srgb, var(--tile-birthday-start) 22%, var(--surface));
}

.birthday-card__body {
  flex: 1;
  min-width: 0;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
}

.birthday-card__name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.birthday-card__party {
  color: var(--accent);
}

.birthday-card__meta {
  margin-top: 2px;
  font: var(--type-label);
  color: var(--text-muted);
}

.birthday-card__when {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.birthday-card__label {
  font: var(--type-label);
  font-weight: 600;
  color: var(--text);
}

.birthdays-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.birthdays-form__date {
  margin: 0;
  padding: 0;
  border: none;
}

.birthdays-form__row {
  display: flex;
  gap: 12px;
}

.birthdays-form__row .form-field {
  flex: 1;
}

.birthdays-form__optional {
  font-weight: 400;
  color: var(--text-muted);
}

.birthdays-form__actions {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
}
</style>
