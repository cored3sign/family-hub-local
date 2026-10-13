<script setup>
// Sets an admin's own PIN: typed twice. Used by the first-run PIN page and by Settings → Family → Admin PIN.
import { ref } from 'vue'
import { family } from '../data/family'
import { PIN_LENGTH, isValidPin, setAdminPin } from '../data/members'

const props = defineProps({
  memberId: { type: String, required: true },
})
const emit = defineEmits(['saved'])

const pin = ref('')
const again = ref('')
const error = ref('')
const saving = ref(false)

async function save() {
  error.value = ''
  if (!isValidPin(pin.value)) {
    error.value = `Use exactly ${PIN_LENGTH} digits.`
    return
  }
  if (pin.value !== again.value) {
    error.value = "The two PINs don't match."
    return
  }
  saving.value = true
  try {
    await setAdminPin(family().doc, props.memberId, pin.value)
    pin.value = ''
    again.value = ''
    emit('saved')
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="pin-form" @submit.prevent="save">
    <FormField v-model="pin" type="password" label="New PIN" :placeholder="`${PIN_LENGTH} digits`" required />
    <FormField v-model="again" type="password" label="Type it again" :placeholder="`${PIN_LENGTH} digits`" required />
    <p v-if="error" class="error">{{ error }}</p>
    <AppButton type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save PIN' }}</AppButton>
  </form>
</template>
