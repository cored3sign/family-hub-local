<script setup>
defineProps({
  label: { type: String, default: '' },
  type: { type: String, default: 'text' },
  modelValue: { type: [String, Number], default: '' },
  placeholder: { type: String, default: '' },
  required: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  minlength: { type: [String, Number], default: null },
  step: { type: [String, Number], default: null },
  min: { type: [String, Number], default: null },
  max: { type: [String, Number], default: null },
})
defineEmits(['update:modelValue'])
</script>

<template>
  <label class="form-field">
    <span v-if="label" class="form-field__label">{{ label }}</span>
    <input
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :required="required"
      :disabled="disabled"
      :minlength="minlength ?? undefined"
      :step="step ?? undefined"
      :min="min ?? undefined"
      :max="max ?? undefined"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  </label>
</template>
