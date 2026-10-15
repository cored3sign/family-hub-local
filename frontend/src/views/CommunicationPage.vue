<script setup>
import { useItemHighlight } from '../lib/highlight'

useItemHighlight()
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Megaphone, MessageCircle, Users, Pin, Pencil, Trash2, Plus,
} from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { firstName } from '../lib/names'
import { formatTimestamp } from '../lib/formatDate'
import { useFamily, useLive } from '../data/vue'
import { listMembers } from '../data/members'
import {
  listAnnouncements, saveAnnouncement, deleteAnnouncement, markAnnouncementRead,
  listCheckinPrompts, saveCheckinPrompt, respondCheckin, listCheckinResponses,
  saveOneOnOne, oneOnOnesFor,
} from '../data/modules/communication'

const core = useCoreStore()
const { doc, actor } = useFamily()
const router = useRouter()

const tab = ref('announcements') // announcements | checkins | one-on-ones
const members = useLive(listMembers)
const oneOnOnes = useLive((d) => oneOnOnesFor(d, core.myMemberId))
// A notification about a 1:1 opens this page on the 1:1 tab, with that 1:1 in view (see useItemHighlight).
const route = useRoute()
function showLinkedOneOnOne(id) {
  const rows = [...oneOnOnes.value.incoming, ...oneOnOnes.value.outgoing, ...oneOnOnes.value.upcoming]
  if (id && rows.some((o) => o.id === id)) tab.value = 'one-on-ones'
}
showLinkedOneOnOne(route.query.item)
watch(() => route.query.item, showLinkedOneOnOne)
const anyOneOnOnes = computed(() => oneOnOnes.value.incoming.length + oneOnOnes.value.outgoing.length + oneOnOnes.value.upcoming.length > 0)

// --- Announcements state ---
// No "show expired" toggle in this UI -- expired announcements simply drop
// off the list.
const announcements = useLive((d) => listAnnouncements(d, core.myMemberId))
const showNewAnnouncementModal = ref(false)
const newAnnouncementBody = ref('')
const newAnnouncementPinned = ref(false)
const newAnnouncementExpires = ref('')
// Edit affordance: saveAnnouncement supports update-by-id; these refs hold
// the edit form's state.
const editingAnnouncementId = ref(null)
const editAnnouncementBody = ref('')
const editAnnouncementPinned = ref(false)
const editAnnouncementExpires = ref('')

// --- Check-ins state ---
// No "show inactive" toggle in this UI -- retired prompts simply drop off
// the picker.
const prompts = useLive(listCheckinPrompts)
const responses = useLive((d) => listCheckinResponses(d, core.myMemberId))
const respondPromptId = ref('')
const respondValue = ref('')
const respondVisibility = ref('family')
const newPromptText = ref('')
const newPromptType = ref('scale')
const showPromptForm = ref(false)
// checkinView toggles between the flat feed and a "trends over time" view:
// grouped by day, then member, with a lightweight per-member sparkline
// for the numeric 'scale' prompt type (the only prompt type where a
// trend line makes sense -- text/emoji responses are grouped but not
// charted).
const checkinView = ref('feed') // 'feed' | 'trends'

// --- 1:1 state ---
// Asking for a 1:1 opens a drawer. The person asked answers it on their own answer screen, which is where
// a notification takes them.
const showOneOnOneModal = ref(false)
const newOneOnOneWith = ref('')
const newOneOnOneDate = ref('')
const newOneOnOneNotes = ref('')

function lookupMemberName(id) {
  return firstName(members.value.find((m) => m.id === id)?.name) ?? 'Unknown'
}

// respondPromptId defaults to the first prompt once prompts have loaded.
// Writable computed (rather than assigning into respondPromptId from a
// watcher) so the <select> below can v-model it directly and the member can
// still pick a different prompt afterwards.
const effectiveRespondPromptId = computed({
  get: () => respondPromptId.value || prompts.value[0]?.id || '',
  set: (value) => { respondPromptId.value = value },
})
const selectedPrompt = computed(() => prompts.value.find((p) => p.id === effectiveRespondPromptId.value))

// Grouped-by-day-then-member trends view. responses is already scoped
// (by listCheckinResponses) to what this member is allowed to see
// (family-visible + their own private ones) -- grouping here is purely a
// display transform over data that's already filtered, never a second
// privacy boundary.
function dayKey(createdAt) {
  return (createdAt || '').slice(0, 10) // 'YYYY-MM-DD' prefix of the timestamp string
}

const groupedByDay = computed(() => {
  const groups = new Map()
  for (const r of responses.value) {
    const key = dayKey(r.created_at)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  // Newest day first (responses already arrive newest-first, so insertion
  // order into the Map already matches).
  return Array.from(groups.entries()).map(([day, items]) => ({ day, items }))
})

// Per-member sparkline data for the 'scale' (1-5) prompt type only -- the
// one prompt type where a numeric trend line is meaningful. Oldest-first so
// the line reads left-to-right as "earlier -> later," the opposite order of
// the day-grouped feed above.
const scaleTrendsByMember = computed(() => {
  const byMember = new Map()
  for (const r of responses.value) {
    if (r.prompt_type !== 'scale') continue
    const n = Number(r.value)
    if (!Number.isFinite(n)) continue
    if (!byMember.has(r.member_name)) byMember.set(r.member_name, [])
    byMember.get(r.member_name).push({ value: n, created_at: r.created_at })
  }
  for (const points of byMember.values()) {
    points.reverse() // responses arrive DESC; flip to chronological for the sparkline
  }
  return Array.from(byMember.entries()).map(([member, points]) => ({ member, points }))
})

function sparklinePoints(points) {
  const w = 160
  const h = 32
  if (points.length === 0) return ''
  if (points.length === 1) return `${w / 2},${h / 2}`
  return points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w
      const y = h - ((p.value - 1) / 4) * h // scale is 1-5, map to y (5 -> top, 1 -> bottom)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function openNewAnnouncement() {
  showNewAnnouncementModal.value = true
}

function closeNewAnnouncement() {
  showNewAnnouncementModal.value = false
}

function addAnnouncement() {
  if (!newAnnouncementBody.value.trim()) return
  saveAnnouncement(doc, actor(), {
    body: newAnnouncementBody.value,
    pinned: newAnnouncementPinned.value,
    expires_at: newAnnouncementExpires.value || null,
  })
  newAnnouncementBody.value = ''
  newAnnouncementPinned.value = false
  newAnnouncementExpires.value = ''
  showNewAnnouncementModal.value = false
}

// markAnnouncementRead is idempotent, so the is_read guard here is just an
// optimization (skip the write when there's nothing to change), not a
// correctness requirement.
function markRead(a) {
  if (a.is_read) return
  markAnnouncementRead(doc, core.myMemberId, a.id)
}

// deleteAnnouncement throws "Announcement not found" for a non-author
// non-admin (editableAnnouncement's guard) -- the delete
// button is gated the same as edit (canEditAnnouncement below), and this
// still catches/surfaces any other failure instead of leaving it uncaught.
const announcementError = ref('')
function removeAnnouncement(id) {
  try {
    deleteAnnouncement(doc, actor(), id)
    announcementError.value = ''
  } catch (e) {
    announcementError.value = e.message
  }
}

// Only the author or an admin can actually save an edit (the data layer
// enforces this too -- saveAnnouncement throws if neither -- gating the
// button client-side avoids showing an edit affordance that would just
// throw on submit).
function canEditAnnouncement(a) {
  return core.isAdmin || a.author_member_id === core.myMemberId
}

function startEditAnnouncement(a) {
  editingAnnouncementId.value = a.id
  editAnnouncementBody.value = a.body
  editAnnouncementPinned.value = Boolean(a.pinned)
  editAnnouncementExpires.value = a.expires_at ? a.expires_at.slice(0, 10) : ''
}

function cancelEditAnnouncement() {
  editingAnnouncementId.value = null
}

function saveEditAnnouncement() {
  if (!editAnnouncementBody.value.trim()) return
  saveAnnouncement(doc, actor(), {
    id: editingAnnouncementId.value,
    body: editAnnouncementBody.value,
    pinned: editAnnouncementPinned.value,
    expires_at: editAnnouncementExpires.value || null,
  })
  editingAnnouncementId.value = null
}

function submitCheckin() {
  if (!effectiveRespondPromptId.value || !respondValue.value) return
  respondCheckin(doc, actor(), {
    prompt_id: effectiveRespondPromptId.value,
    value: respondValue.value,
    visibility: respondVisibility.value,
  })
  respondValue.value = ''
}

function openNewPrompt() {
  showPromptForm.value = true
}

function closeNewPrompt() {
  showPromptForm.value = false
}

function addPrompt() {
  if (!newPromptText.value.trim()) return
  saveCheckinPrompt(doc, actor(), { prompt_text: newPromptText.value, prompt_type: newPromptType.value })
  newPromptText.value = ''
  newPromptType.value = 'scale'
  showPromptForm.value = false
}

const otherMembers = computed(() => members.value.filter((m) => m.id !== core.myMemberId))

function openOneOnOne(id) {
  router.push(`/one-on-one/${encodeURIComponent(id)}`)
}

function formatDay(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function openOneOnOneModal() {
  showOneOnOneModal.value = true
}

function closeOneOnOneModal() {
  showOneOnOneModal.value = false
}

function requestOneOnOne() {
  if (!newOneOnOneWith.value) return
  saveOneOnOne(doc, actor(), {
    member_b_id: newOneOnOneWith.value,
    scheduled_date: newOneOnOneDate.value || null,
    notes: newOneOnOneNotes.value || null,
  })
  newOneOnOneWith.value = ''
  newOneOnOneDate.value = ''
  newOneOnOneNotes.value = ''
  showOneOnOneModal.value = false
}
</script>

<template>
  <div class="module-page comm-page">
    <h2>Speak</h2>

    <div class="comm-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="comm-tab"
        :aria-selected="tab === 'announcements'"
        :class="{ active: tab === 'announcements' }"
        @click="tab = 'announcements'"
      >
        <Megaphone :size="16" />
        Announce
      </button>
      <button
        type="button"
        role="tab"
        class="comm-tab"
        :aria-selected="tab === 'checkins'"
        :class="{ active: tab === 'checkins' }"
        @click="tab = 'checkins'"
      >
        <MessageCircle :size="16" />
        Check-ins
      </button>
      <button
        type="button"
        role="tab"
        class="comm-tab"
        :aria-selected="tab === 'one-on-ones'"
        :class="{ active: tab === 'one-on-ones' }"
        @click="tab = 'one-on-ones'"
      >
        <Users :size="16" />
        1:1
      </button>
    </div>

    <!-- 1a. Announcement board -->
    <section v-if="tab === 'announcements'" class="comm-section">
        <AppButton variant="primary" @click="openNewAnnouncement">
          <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Post an announcement
        </AppButton>
        <p v-if="announcementError" class="error">{{ announcementError }}</p>

        <ul class="module-list">
          <li
            v-for="a in announcements"
            :key="a.id" :data-item-id="a.id"
            class="comm-card"
            :class="{ 'comm-card--unread': !a.is_read, 'comm-card--pinned': a.pinned }"
          >
            <div v-if="editingAnnouncementId === a.id" class="announcement-edit" @click.stop>
              <FormField v-model="editAnnouncementBody" placeholder="Announcement text…" />
              <label class="comm-checkbox">
                <input type="checkbox" v-model="editAnnouncementPinned" />
                Pin
              </label>
              <FormField v-model="editAnnouncementExpires" type="date" label="Expires" />
              <div class="announcement-edit__actions">
                <AppButton type="button" @click="saveEditAnnouncement">Save</AppButton>
                <AppButton type="button" variant="ghost" @click="cancelEditAnnouncement">Cancel</AppButton>
              </div>
            </div>
            <template v-else>
              <!-- Pinned vs. plain uses a distinct tile shape (square vs. tag
                   pin) AND gradient AND the "Pinned" text tag together, never
                   color alone, per the WCAG non-color-signal requirement. -->
              <div class="comm-card__icon-tile" :class="{ 'comm-card__icon-tile--pinned': a.pinned }">
                <Pin v-if="a.pinned" :size="20" />
                <Megaphone v-else :size="20" />
              </div>
              <button type="button" class="announcement-row" @click="markRead(a)">
                <div class="announcement-row__meta">
                  <AppTag v-if="a.pinned" class="app-tag--pinned">Pinned</AppTag>
                  <AppTag v-if="!a.is_read" class="app-tag--unread">New</AppTag>
                  <span class="announcement-row__author">{{ lookupMemberName(a.author_member_id) }}</span>
                  <span class="announcement-row__date">{{ formatTimestamp(a.created_at) }}</span>
                </div>
                <p class="announcement-row__body">{{ a.body }}</p>
                <p v-if="a.expires_at" class="announcement-row__expires">Expires {{ a.expires_at }}</p>
              </button>
              <div class="comm-card__actions">
                <button
                  v-if="canEditAnnouncement(a)"
                  type="button"
                  class="comm-icon-btn"
                  aria-label="Edit announcement"
                  @click.stop="startEditAnnouncement(a)"
                >
                  <Pencil :size="18" />
                </button>
                <button
                  v-if="canEditAnnouncement(a)"
                  type="button"
                  class="comm-icon-btn comm-icon-btn--danger"
                  aria-label="Delete announcement"
                  @click.stop="removeAnnouncement(a.id)"
                >
                  <Trash2 :size="18" />
                </button>
              </div>
            </template>
          </li>
        </ul>
        <EmptyState v-if="announcements.length === 0" illustration="communication">
          No announcements yet. Post the first one for the family to see.
        </EmptyState>

        <AppModal :open="showNewAnnouncementModal" title="Post an announcement" @close="closeNewAnnouncement">
          <div class="announcement-form">
            <label class="form-field">
              <span class="form-field__label">Announcement text</span>
              <textarea v-model="newAnnouncementBody" rows="4" placeholder="What's the announcement?"></textarea>
            </label>
            <label class="comm-checkbox">
              <input type="checkbox" v-model="newAnnouncementPinned" />
              Pin to top
            </label>
            <FormField v-model="newAnnouncementExpires" type="date" label="Expires (optional)" />

            <div class="announcement-form__actions">
              <AppButton variant="primary" @click="addAnnouncement">Post announcement</AppButton>
              <AppButton variant="ghost" @click="closeNewAnnouncement">Cancel</AppButton>
            </div>
          </div>
        </AppModal>
      </section>

      <!-- 1b. Check-in prompts -->
      <section v-else-if="tab === 'checkins'" class="comm-section">
        <AppCard class="checkin-respond-card">
          <div class="comm-card-header">
            <div class="comm-card__icon-tile comm-card__icon-tile--checkin">
              <MessageCircle :size="20" />
            </div>
            <h3>Check in</h3>
          </div>
          <div class="checkin-respond-form">
            <label class="form-field">
              <span class="form-field__label">Prompt</span>
              <select v-model="effectiveRespondPromptId">
                <option v-for="p in prompts" :key="p.id" :value="p.id">{{ p.prompt_text }}</option>
              </select>
            </label>

            <template v-if="selectedPrompt">
              <div v-if="selectedPrompt.prompt_type === 'scale'" class="checkin-scale">
                <button
                  v-for="n in 5"
                  :key="n"
                  type="button"
                  class="checkin-scale__btn"
                  :class="{ active: respondValue === String(n) }"
                  @click="respondValue = String(n)"
                >
                  {{ n }}
                </button>
              </div>
              <FormField
                v-else-if="selectedPrompt.prompt_type === 'emoji'"
                v-model="respondValue"
                placeholder="🙂"
              />
              <FormField v-else v-model="respondValue" placeholder="Type your answer…" />
            </template>

            <div class="checkin-visibility">
              <label>
                <input type="radio" value="family" v-model="respondVisibility" />
                Visible to family
              </label>
              <label>
                <input type="radio" value="private" v-model="respondVisibility" />
                Private (only me)
              </label>
            </div>

            <AppButton type="button" @click="submitCheckin">Submit check-in</AppButton>
          </div>
        </AppCard>

        <div class="checkin-family-header">
          <h3>Family pulse</h3>
          <AppButton v-if="core.isAdmin" variant="ghost" @click="openNewPrompt">
            <Plus :size="14" style="vertical-align: -2px; margin-right: 4px" />New prompt
          </AppButton>
        </div>

        <p class="comm-hint">
          Private responses are visible only to the member who wrote them — not even shown here to admins.
        </p>

        <div class="comm-subtabs">
          <button
            type="button"
            class="comm-subtab"
            :class="{ active: checkinView === 'feed' }"
            @click="checkinView = 'feed'"
          >
            Feed
          </button>
          <button
            type="button"
            class="comm-subtab"
            :class="{ active: checkinView === 'trends' }"
            @click="checkinView = 'trends'"
          >
            Trends
          </button>
        </div>

        <ul v-if="checkinView === 'feed'" class="module-list">
          <li v-for="r in responses" :key="r.id" class="comm-card comm-card--compact">
            <div class="comm-card__icon-tile comm-card__icon-tile--checkin">
              <MessageCircle :size="18" />
            </div>
            <div class="checkin-row">
              <span class="checkin-row__member">{{ firstName(r.member_name) }}</span>
              <span class="checkin-row__prompt">{{ r.prompt_text }}</span>
              <AppTag>{{ r.value }}</AppTag>
              <span class="checkin-row__date">{{ formatTimestamp(r.created_at) }}</span>
            </div>
          </li>
        </ul>

        <!-- Trends-over-time -- grouped by day, then by member,
             plus a per-member sparkline for the numeric 'scale' prompts. -->
        <div v-else class="checkin-trends">
          <div v-if="scaleTrendsByMember.length" class="checkin-sparklines">
            <h4>Mood over time (1-5 scale prompts)</h4>
            <div v-for="mt in scaleTrendsByMember" :key="mt.member" class="checkin-sparkline-row">
              <span class="checkin-sparkline-row__member">{{ firstName(mt.member) }}</span>
              <svg class="checkin-sparkline" viewBox="0 0 160 32" preserveAspectRatio="none">
                <polyline :points="sparklinePoints(mt.points)" fill="none" stroke="var(--accent)" stroke-width="2" />
              </svg>
              <span class="checkin-sparkline-row__latest">{{ mt.points[mt.points.length - 1]?.value }}</span>
            </div>
          </div>

          <div v-for="group in groupedByDay" :key="group.day" class="checkin-day-group">
            <h4 class="checkin-day-group__heading">{{ group.day }}</h4>
            <ul class="module-list">
              <li v-for="r in group.items" :key="r.id" class="comm-card comm-card--compact">
                <div class="comm-card__icon-tile comm-card__icon-tile--checkin">
                  <MessageCircle :size="18" />
                </div>
                <div class="checkin-row">
                  <span class="checkin-row__member">{{ firstName(r.member_name) }}</span>
                  <span class="checkin-row__prompt">{{ r.prompt_text }}</span>
                  <AppTag>{{ r.value }}</AppTag>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <EmptyState v-if="responses.length === 0">
          No family-visible check-ins yet. Answer a prompt above to get started.
        </EmptyState>

        <AppModal :open="showPromptForm" title="New check-in prompt" @close="closeNewPrompt">
          <div class="prompt-form">
            <FormField v-model="newPromptText" label="Prompt text" placeholder="e.g. How was your day?" />
            <label class="form-field">
              <span class="form-field__label">Response type</span>
              <select v-model="newPromptType">
                <option value="scale">Scale (1-5)</option>
                <option value="emoji">Emoji</option>
                <option value="text">Text</option>
              </select>
            </label>

            <div class="prompt-form__actions">
              <AppButton variant="primary" @click="addPrompt">Add prompt</AppButton>
              <AppButton variant="ghost" @click="closeNewPrompt">Cancel</AppButton>
            </div>
          </div>
        </AppModal>
      </section>

      <!-- 1c. 1:1 time: ask another member for a 1:1, answer the ones asked of you, and see what's on the calendar.
           Each row opens its answer screen (OneOnOnePage). -->
      <section v-else class="comm-section">
        <AppButton variant="primary" @click="openOneOnOneModal">
          <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Ask for 1:1
        </AppButton>
        <p class="comm-hint">Asking sends the other member a notification. Once they accept, the 1:1 goes on the calendar.</p>

        <div v-if="oneOnOnes.incoming.length" class="one-on-one-group">
          <h3>Waiting for your answer</h3>
          <ul class="one-on-one-list">
            <li
              v-for="o in oneOnOnes.incoming"
              :key="o.id"
              class="one-on-one-row one-on-one-row--ask"
              :data-item-id="o.id"
              @click="openOneOnOne(o.id)"
            >
              <span class="one-on-one-row__title">{{ firstName(o.member_a_name) }} asked for 1:1 time</span>
              <span class="one-on-one-row__meta">{{ o.scheduled_date ? formatDay(o.scheduled_date) : 'No date proposed' }}</span>
            </li>
          </ul>
        </div>

        <div v-if="oneOnOnes.upcoming.length" class="one-on-one-group">
          <h3>Upcoming</h3>
          <ul class="one-on-one-list">
            <li
              v-for="o in oneOnOnes.upcoming"
              :key="o.id"
              class="one-on-one-row"
              :data-item-id="o.id"
              @click="openOneOnOne(o.id)"
            >
              <span class="one-on-one-row__title">{{ firstName(o.member_a_name) }} and {{ firstName(o.member_b_name) }}</span>
              <span class="one-on-one-row__meta">{{ formatDay(o.scheduled_date) }}</span>
            </li>
          </ul>
        </div>

        <div v-if="oneOnOnes.outgoing.length" class="one-on-one-group">
          <h3>Asked by you</h3>
          <ul class="one-on-one-list">
            <li
              v-for="o in oneOnOnes.outgoing"
              :key="o.id"
              class="one-on-one-row"
              :class="{ 'one-on-one-row--muted': o.status === 'declined' }"
              :data-item-id="o.id"
              @click="openOneOnOne(o.id)"
            >
              <span class="one-on-one-row__title">1:1 with {{ firstName(o.member_b_name) }}</span>
              <span class="one-on-one-row__meta">
                {{ o.status === 'declined' ? "Can't make it" : 'Waiting for an answer' }}
                <template v-if="o.scheduled_date"> · {{ formatDay(o.scheduled_date) }}</template>
              </span>
            </li>
          </ul>
        </div>

        <EmptyState v-if="!anyOneOnOnes">No 1:1s yet. Ask a family member to find a time.</EmptyState>

        <AppModal :open="showOneOnOneModal" title="Ask for 1:1" @close="closeOneOnOneModal">
          <div class="one-on-one-form">
            <label class="form-field">
              <span class="form-field__label">With</span>
              <select v-model="newOneOnOneWith">
                <option value="" disabled>Choose a family member…</option>
                <option v-for="m in otherMembers" :key="m.id" :value="m.id">{{ firstName(m.name) }}</option>
              </select>
            </label>
            <FormField v-model="newOneOnOneDate" type="date" label="Proposed date (optional)" />
            <FormField v-model="newOneOnOneNotes" label="Notes (optional)" placeholder="What's this about?" />

            <div class="one-on-one-form__actions">
              <AppButton variant="primary" :disabled="!newOneOnOneWith" @click="requestOneOnOne">Ask for 1:1</AppButton>
              <AppButton variant="ghost" @click="closeOneOnOneModal">Cancel</AppButton>
            </div>
          </div>
        </AppModal>
      </section>
  </div>
</template>

<style scoped>
.comm-page {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Underlined section tabs.
   The bottom border is a shared baseline (like a real tab strip) with the
   active tab's own underline drawn 2px thicker and in the accent color, so
   the active state reads via both weight/color AND a heavier rule, not
   color alone. */
.comm-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
}

.comm-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: var(--type-label);
  padding: 10px 14px;
  min-height: 44px;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}

.comm-tab:hover {
  color: var(--text);
}

.comm-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 700;
}

.comm-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.comm-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.comm-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font: var(--type-label);
  color: var(--text-muted);
  white-space: nowrap;
}

.comm-hint {
  color: var(--text-muted);
  font: var(--type-label);
  font-size: 12px;
  margin: 0;
}

/* Shared card shell for announcements and check-in feed rows --
   same white rounded-16px + icon-tile language as Dashboard's .feed-card
   (icon-tile-forward, restrained coral usage). */
.comm-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 14px 16px;
  list-style: none;
}

.comm-card--compact {
  padding: 10px 14px;
  align-items: center;
}

/* Unread signal: shape (left accent bar) + weight (bold body text) + the
   "New" text tag together -- never color alone. */
.comm-card--unread {
  position: relative;
  border-left: 3px solid var(--accent);
  padding-left: 13px;
}

.comm-card--unread .announcement-row__body {
  font-weight: 600;
}

.comm-card__icon-tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
  background: var(--tile-communication);
}

/* Pinned signal: a distinct tile icon (Pin, swapped in via the template)
   plus this deeper gradient -- shape + color together, plus the "Pinned"
   text tag rendered alongside it in the card body. */
.comm-card__icon-tile--pinned {
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
}

.comm-card__icon-tile--checkin {
  background: linear-gradient(135deg, var(--complement-mid), var(--complement));
}

.comm-card__actions {
  flex: none;
  display: flex;
  gap: 2px;
  align-self: center;
}

/* Icon-only buttons: explicit 44x44px hit area (WCAG 2.5.5/2.5.8) with the
   glyph itself drawn smaller and centered inside. */
.comm-icon-btn {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.comm-icon-btn:hover {
  background: color-mix(in srgb, var(--text) 8%, transparent);
  color: var(--text);
}

.comm-icon-btn--danger:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.comm-icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.comm-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.comm-card-header h3 {
  margin: 0;
}

.announcement-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.announcement-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

.announcement-row__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.app-tag--pinned {
  color: var(--on-accent-container);
  background: var(--accent-container);
}

.app-tag--unread {
  color: var(--accent-contrast);
  background: var(--accent);
  font-weight: 700;
}

.app-tag--done {
  color: var(--text-muted);
  background: var(--surface-variant);
}

.announcement-row__author {
  font: var(--type-label);
  color: var(--text-muted);
  font-weight: 600;
}

.announcement-row__date,
.announcement-row__expires {
  font: var(--type-label);
  font-size: 11px;
  color: var(--text-muted);
}

.announcement-row__body {
  margin: 0;
  font: var(--type-body);
  color: var(--text);
}

.announcement-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.announcement-edit__actions {
  display: flex;
  gap: 8px;
}

.announcement-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.announcement-form__actions {
  display: flex;
  gap: 8px;
}

.checkin-respond-card {
  max-width: none;
  margin: 0;
  padding: 16px;
  text-align: left;
}

.checkin-respond-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.checkin-scale {
  display: flex;
  gap: 8px;
}

.checkin-scale__btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font: var(--type-body);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}

.checkin-scale__btn:hover {
  border-color: var(--accent);
}

/* Selected-scale signal: fill + border color change together with a bolder
   weight on the number glyph -- shape stays a circle throughout so the
   "active" state reads via fill/weight, not fill alone. */
.checkin-scale__btn.active {
  background: var(--accent);
  color: var(--accent-contrast);
  border-color: var(--accent);
  font-weight: 700;
}

.checkin-scale__btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.checkin-visibility {
  display: flex;
  gap: 16px;
  font: var(--type-label);
  color: var(--text-muted);
}

.checkin-visibility label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.checkin-family-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.checkin-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
  min-width: 0;
}

.checkin-row__member {
  font: var(--type-title);
  font-size: 15px;
}

.checkin-row__prompt {
  color: var(--text-muted);
  font-size: 14px;
}

.checkin-row__date {
  margin-left: auto;
  font: var(--type-label);
  font-size: 11px;
  color: var(--text-muted);
}

.comm-subtabs {
  display: flex;
  gap: 8px;
}

.comm-subtab {
  font: var(--type-label);
  padding: 8px 14px;
  min-height: var(--control-min);
  border: 1px solid var(--border);
  border-radius: 16px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.comm-subtab.active {
  background: var(--accent);
  color: var(--accent-contrast);
  border-color: var(--accent);
  font-weight: 700;
}

.checkin-trends {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.checkin-sparklines {
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.checkin-sparklines h4 {
  margin: 0;
  font: var(--type-label);
  color: var(--text-muted);
}

.checkin-sparkline-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.checkin-sparkline-row__member {
  width: 90px;
  flex-shrink: 0;
  font: var(--type-label);
  font-weight: 600;
}

.checkin-sparkline {
  flex: 1;
  height: 32px;
  max-width: 200px;
}

.checkin-sparkline-row__latest {
  width: 20px;
  text-align: right;
  font: var(--type-label);
  color: var(--text-muted);
}

.prompt-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompt-form__actions {
  display: flex;
  gap: 8px;
}

.checkin-day-group__heading {
  margin: 0 0 6px;
  font: var(--type-label);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 11px;
}

.one-on-one-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.one-on-one-form__actions {
  display: flex;
  gap: 8px;
}

.one-on-one-group {
  margin-top: 18px;
}

.one-on-one-group h3 {
  margin: 0 0 8px;
}

.one-on-one-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.one-on-one-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--surface);
  border-radius: 14px;
  box-shadow: var(--elevation-1);
  padding: 12px 14px;
  cursor: pointer;
}

.one-on-one-row--ask {
  box-shadow: inset 4px 0 0 var(--accent), var(--elevation-1);
}

.one-on-one-row--muted {
  background: var(--surface-variant);
  box-shadow: none;
}

.one-on-one-row__title {
  font-weight: 600;
}

.one-on-one-row__meta {
  font: var(--type-label);
  color: var(--text-muted);
}
</style>
