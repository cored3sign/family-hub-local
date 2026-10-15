<script setup>
// The answer screen for one 1:1. The person asked accepts, on a date, or says they can't make it. The person who
// asked sees where it stands. Opened from the bell, a phone notification, or the Speak page.
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { MessageCircle } from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { useFamily, useLive } from '../data/vue'
import { firstName } from '../lib/names'
import { listOneOnOnes, respondOneOnOne } from '../data/modules/communication'

const route = useRoute()
const core = useCoreStore()
const { doc, actor } = useFamily()

const oneOnOnes = useLive((d) => listOneOnOnes(d))
const oneOnOne = computed(() => oneOnOnes.value.find((o) => o.id === route.params.id) ?? null)
const status = computed(() => oneOnOne.value?.status ?? 'scheduled')
const askedMe = computed(() => oneOnOne.value?.member_b_id === core.myMemberId)
const askedByMe = computed(() => oneOnOne.value?.member_a_id === core.myMemberId)
const pendingAnswer = computed(() => status.value === 'requested' && askedMe.value)
const askerFirst = computed(() => firstName(oneOnOne.value?.member_a_name ?? ''))
const askedFirst = computed(() => firstName(oneOnOne.value?.member_b_name ?? ''))

// The date to meet. It starts as the date that was proposed, so accepting as proposed is a single tap.
const date = ref('')
const error = ref('')
watch(
  oneOnOne,
  (o) => {
    if (o && !date.value) date.value = o.scheduled_date ?? ''
  },
  { immediate: true },
)

function formatDay(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function answer(accept) {
  error.value = ''
  try {
    respondOneOnOne(doc, actor(), oneOnOne.value.id, { accept, scheduled_date: date.value || null })
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="module-page one-on-one-page">
    <router-link to="/communication" class="one-on-one-page__back">← Speak</router-link>

    <EmptyState v-if="!oneOnOne">This 1:1 isn't here anymore.</EmptyState>

    <template v-else>
      <div class="one-on-one-page__header">
        <div class="one-on-one-page__tile">
          <MessageCircle :size="22" />
        </div>
        <h2 v-if="pendingAnswer">{{ askerFirst }} asked for 1:1 time with you</h2>
        <h2 v-else-if="askedByMe">You asked {{ askedFirst }} for 1:1 time</h2>
        <h2 v-else>1:1: {{ askerFirst }} and {{ askedFirst }}</h2>
      </div>

      <p v-if="status === 'requested' && oneOnOne.scheduled_date" class="one-on-one-page__line">
        Proposed for {{ formatDay(oneOnOne.scheduled_date) }}.
      </p>
      <p v-else-if="status === 'requested'" class="one-on-one-page__line">No date was proposed.</p>
      <p v-else-if="status === 'scheduled'" class="one-on-one-page__line one-on-one-page__line--done">
        Accepted. It's on the calendar for {{ formatDay(oneOnOne.scheduled_date) }}.
      </p>
      <p v-else-if="status === 'declined'" class="one-on-one-page__line">
        {{ askedByMe ? `${askedFirst} can't make this 1:1.` : "You said you can't make this 1:1." }}
      </p>
      <p v-if="oneOnOne.notes" class="one-on-one-page__notes">{{ oneOnOne.notes }}</p>

      <form v-if="pendingAnswer" class="one-on-one-page__answer" @submit.prevent="answer(true)">
        <label class="form-field">
          <span class="form-field__label">The day to meet</span>
          <input v-model="date" type="date" required />
        </label>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="one-on-one-page__actions">
          <AppButton variant="ghost" type="button" @click="answer(false)">Can't make it</AppButton>
          <AppButton variant="primary" type="submit">Accept</AppButton>
        </div>
      </form>
      <p v-else-if="askedByMe && status === 'requested'" class="one-on-one-page__line">Waiting for {{ askedFirst }} to answer.</p>
      <p v-if="error && !pendingAnswer" class="error">{{ error }}</p>
    </template>
  </div>
</template>

<style scoped>
.one-on-one-page__back {
  display: inline-block;
  margin-bottom: 12px;
  font: var(--type-label);
  color: var(--text-muted);
}

.one-on-one-page__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.one-on-one-page__header h2 {
  margin: 0;
}

.one-on-one-page__tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
  background: linear-gradient(135deg, var(--accent-soft), var(--accent));
}

.one-on-one-page__line {
  margin: 0 0 12px;
  font: var(--type-body);
}

.one-on-one-page__line--done {
  font-weight: 600;
}

.one-on-one-page__notes {
  margin: 0 0 16px;
  padding: 12px 14px;
  background: var(--surface-variant);
  border-radius: 12px;
  font: var(--type-body);
}

.one-on-one-page__answer {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.one-on-one-page__actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
</style>
