<script setup>
import { ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'

defineProps({
  done: { type: Boolean, default: false },
  deletable: { type: Boolean, default: false },
})
const emit = defineEmits(['delete'])

// Tapping the x on an item row asks for confirmation before it deletes
// the row, rather than deleting on the very first click. This lives in the
// shared component rather than per-module -- the confirming state is
// entirely inside this component, so no caller needs to handle it (a
// caller still just uses `deletable @delete="..."`).
const confirming = ref(false)

function handleDeleteClick() {
  if (confirming.value) {
    confirming.value = false
    emit('delete')
    return
  }
  confirming.value = true
}

function cancelDelete() {
  confirming.value = false
}
</script>

<template>
  <li class="list-row" :class="{ done }">
    <div class="list-row__main">
      <slot />
    </div>
    <button
      v-if="deletable"
      type="button"
      class="list-row__del"
      :class="{ 'list-row__del--confirming': confirming }"
      :aria-label="confirming ? 'Confirm delete' : 'Delete'"
      @click="handleDeleteClick"
    >
      <Trash2 :size="18" />
    </button>
    <p v-if="deletable && confirming" class="list-row__confirm-hint" @click.stop>
      <span class="list-row__confirm-hint-text">Tap the trash icon again to delete.</span>
      <button type="button" class="list-row__confirm-hint-cancel" @click="cancelDelete">Cancel</button>
    </p>
  </li>
</template>

<style scoped>
.list-row {
  position: relative;
}

.list-row__del--confirming {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}

/* Same layout as .list-row itself (flex-wrap, full row width) so the hint
   drops below the row's existing content instead of squeezing into
   whatever space the flex children left -- a plain block element spanning
   the row's own flex-basis: 100% would do the same, but this keeps the hint
   visually attached without depending on .list-row's own flex-wrap timing. */
.list-row__confirm-hint {
  flex-basis: 100%;
  margin: 8px 0 0;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid var(--danger);
  border-radius: 8px;
  font: var(--type-label);
  color: var(--danger);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Real pixel min-width (never 0) so this text wraps onto its own line above
   the fixed-width Cancel button on narrow screens instead of either
   overlapping or shrinking indefinitely -- the known flex-wrap footgun in
   this codebase's own history. */
.list-row__confirm-hint-text {
  flex: 1;
  min-width: 160px;
}

.list-row__confirm-hint-cancel {
  flex: none;
  border: 1px solid var(--danger);
  background: transparent;
  color: var(--danger);
  border-radius: 999px;
  padding: 4px 12px;
  min-height: 44px;
  font: var(--type-label);
  font-weight: 700;
  cursor: pointer;
}

.list-row__confirm-hint-cancel:hover {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}
</style>
