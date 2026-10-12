<script setup>
// Shared assignee filter chips (To-Do and Calendar use the same chip
// pattern). One component rather than each module hand-rolling its own
// chip row.
//
// Multi-select, union semantics: selecting two chips shows items matching
// EITHER (not both) — e.g. "My Tasks" + "Unassigned" shows mine and
// unassigned items together. An empty selection means "no filter" (show
// everything), which the caller is expected to treat as such.
//
// v-model is an array of selected values. "My Tasks" resolves to the
// current member's family-local id at select time (so the array only ever
// holds real member ids and the sentinel unassignedValue — no separate
// "me" marker to keep in sync elsewhere).
import { computed } from 'vue'
import { firstName } from '../lib/names'

const props = defineProps({
  modelValue: { type: Array, required: true },
  members: { type: Array, required: true }, // [{ id, name, avatar_color }]
  currentMemberId: { type: [Number, String, null], default: null },
  // Label for the "mine" chip. The default, "My Tasks", names the wrong
  // noun on other callers (Calendar, Goals, Wishlist), so each caller can
  // override it. Same override pattern as unassignedLabel below, just for
  // this chip.
  myLabel: { type: String, default: 'My Tasks' },
  // Label + sentinel value for the "no assignee" chip. Todos calls this
  // "Unassigned"; Calendar's unassigned state reads as "Everyone"
  // so it passes a different label for the identical mechanic.
  unassignedLabel: { type: String, default: 'Unassigned' },
  unassignedValue: { type: String, default: 'unassigned' },
  // Wishlist has no "unassigned" state at all, ever --
  // assignment is mandatory there, so showing an Unassigned chip would be a
  // filter option that can never match anything. Set false to omit it
  // entirely rather than rendering a chip that's silently always empty.
  showUnassigned: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue'])

const hasCurrentMember = computed(() => props.currentMemberId !== null && props.currentMemberId !== undefined)

function isSelected(value) {
  return props.modelValue.includes(value)
}

function toggle(value) {
  const next = isSelected(value)
    ? props.modelValue.filter((v) => v !== value)
    : [...props.modelValue, value]
  emit('update:modelValue', next)
}

</script>

<template>
  <div class="assignee-chips">
    <button
      v-if="hasCurrentMember"
      type="button"
      class="assignee-chip"
      :class="{ 'assignee-chip--active': isSelected(currentMemberId) }"
      @click="toggle(currentMemberId)"
    >
      {{ myLabel }}
    </button>
    <button
      v-for="m in members"
      :key="m.id"
      type="button"
      class="assignee-chip"
      :class="{ 'assignee-chip--active': isSelected(m.id) }"
      @click="toggle(m.id)"
    >
      {{ firstName(m.name) }}
    </button>
    <button
      v-if="showUnassigned"
      type="button"
      class="assignee-chip"
      :class="{ 'assignee-chip--active': isSelected(unassignedValue) }"
      @click="toggle(unassignedValue)"
    >
      {{ unassignedLabel }}
    </button>
  </div>
</template>
