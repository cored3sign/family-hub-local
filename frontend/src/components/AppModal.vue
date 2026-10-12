<script setup>
import { X } from 'lucide-vue-next'

defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
})
defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="app-modal__backdrop" @click.self="$emit('close')">
      <div class="app-modal__panel" role="dialog" aria-modal="true">
        <header class="app-modal__header">
          <h3 v-if="title">{{ title }}</h3>
          <button type="button" class="app-modal__close" aria-label="Close" @click="$emit('close')">
            <X :size="20" />
          </button>
        </header>
        <div class="app-modal__body">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>
