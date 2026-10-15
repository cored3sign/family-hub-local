<script setup>
import { ref, computed } from 'vue'
import { Cake, Plus, PartyPopper } from 'lucide-vue-next'
import { useFamily, useLive } from '../data/vue'
import { listBirthdays, saveBirthday, deleteBirthday, todayIso, parseIsoDate } from '../data/modules/birthdays'

const { doc } = useFamily()

// Shown in the birthday list: which day it is, and how old the person turns that day.
const birthdays = useLive((d) => listBirthdays(d))
const today = todayIso()

// Add and edit share one sheet (AppModal, a bottom sheet on mobile), like the other modules.
const formOpen = ref(false)
const editingId = ref(null)
const formName = ref('')
const formDate = ref('')
const formError = ref('')

function openAdd() {
  editingId.value = null
  formName.value = ''
  formDate.value = ''
  formError.value = ''
  formOpen.value = true
}

function openEdit(b) {
  editingId.value = b.id
  formName.value = b.name
  formDate.value = b.birth_date
  formError.value = ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

function save() {
  formError.value = ''
  try {
    saveBirthday(doc, { id: editingId.value ?? undefined, name: formName.value, birth_date: formDate.value }, today)
    formOpen.value = false
  } catch (e) {
    formError.value = e.message
  }
}

function remove() {
  deleteBirthday(doc, editingId.value)
  formOpen.value = false
}

function longDate(iso) {
  const p = parseIsoDate(iso)
  return new Date(p.year, p.month - 1, p.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function shortDate(iso) {
  const p = parseIsoDate(iso)
  return new Date(p.year, p.month - 1, p.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

// "Today", "Tomorrow", "In 3 days", then the date.
function whenLabel(b) {
  if (b.days_until === 0) return 'Today'
  if (b.days_until === 1) return 'Tomorrow'
  if (b.days_until <= 6) return `In ${b.days_until} days`
  return shortDate(b.next_date)
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
      >
        <button type="button" class="birthday-card__body" @click="openEdit(b)">
          <div class="birthday-card__name">
            <PartyPopper v-if="b.days_until === 0" :size="16" class="birthday-card__party" />
            {{ b.name }}
          </div>
          <div class="birthday-card__meta">Born {{ longDate(b.birth_date) }}</div>
        </button>
        <div class="birthday-card__when">
          <span class="birthday-card__label">{{ whenLabel(b) }}</span>
          <AppTag>Turns {{ b.turns }}</AppTag>
        </div>
      </li>
    </ul>

    <EmptyState v-else>
      No birthdays yet. Add one above, and the family is reminded on the day.
    </EmptyState>

    <AppModal :open="formOpen" :title="editingId ? 'Edit birthday' : 'Add a birthday'" @close="closeForm">
      <form class="birthdays-form" @submit.prevent="save">
        <FormField v-model="formName" label="Name" placeholder="Ana, Grandma Rose…" required />
        <label class="form-field">
          <span class="form-field__label">Birth date</span>
          <input v-model="formDate" type="date" :max="today" required />
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

.birthdays-form__actions {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
}
</style>
