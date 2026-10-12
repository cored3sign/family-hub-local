<script setup>
import AppButton from './AppButton.vue'

defineProps({
  buttonLabel: { type: String, default: 'Add' },
})
defineEmits(['submit'])
</script>

<template>
  <form class="add-row" @submit.prevent="$emit('submit')">
    <slot />
    <AppButton type="submit">{{ buttonLabel }}</AppButton>
  </form>
</template>
