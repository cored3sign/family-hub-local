<script setup>
// Shared Filter button, so every module shows its filters (including by
// name of assigned member) the same way. It is Shopping's filter-btn +
// AppModal + filter-group markup, extracted so every module gets the
// identical button/badge/modal/footer shell -- callers only supply their
// own filter fields via the default slot, and the active-count badge via
// `count`.
import { ref } from 'vue'
import { SlidersHorizontal } from 'lucide-vue-next'

const props = defineProps({
  count: { type: Number, default: 0 },
  title: { type: String, default: 'Filter items' },
})
const emit = defineEmits(['clear'])

const open = ref(false)
function show() { open.value = true }
function hide() { open.value = false }
defineExpose({ show, hide })
</script>

<template>
  <div class="filter-button-group">
    <AppButton type="button" variant="secondary" class="filter-btn" @click="show">
      <SlidersHorizontal :size="15" />
      Filter<span v-if="count" class="filter-btn__count">{{ count }}</span>
    </AppButton>
    <AppButton
      v-if="count"
      type="button"
      variant="ghost"
      class="clear-btn"
      @click="emit('clear')"
    >
      Clear
    </AppButton>

    <AppModal :open="open" :title="title" @close="hide">
      <slot />
      <div class="filter-actions">
        <AppButton type="button" variant="ghost" @click="emit('clear')">Clear all</AppButton>
        <AppButton type="button" variant="primary" @click="hide">Done</AppButton>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.filter-button-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.filter-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.clear-btn {
  flex: none;
  white-space: nowrap;
}

.filter-btn__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--accent-contrast);
  color: var(--accent);
  font: var(--type-label);
  font-size: 11px;
  font-weight: 700;
}

.filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
