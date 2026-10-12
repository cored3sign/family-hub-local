<script setup>
// Notification bell + panel for the DashboardLayout topbar. Notifications
// live in the shared Yjs doc, so useLive keeps this current after every
// transaction (local edits and remote sync) -- no polling.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, X } from 'lucide-vue-next'
import { useFamily, useLive } from '../data/vue'
import { useCoreStore } from '../stores/core'
import { listNotifications, markNotificationsRead, clearNotifications } from '../data/notifications'
import { findAddon } from '../addons/registry'
import { formatTimestamp } from '../lib/formatDate'

const router = useRouter()
const { doc } = useFamily()
const core = useCoreStore()

// Maps a notification's `type` to the module-registry key
// (frontend/src/addons/registry.js) it should navigate to. Keyed on `type`,
// not on parsing `message` text, since `type` is the structured field
// every notification sets. one_on_one_requested is the one
// type with no dedicated list route of its own -- it routes to the
// Communication module page generally, same as every other module route
// here (no deep-link to the specific 1:1/todo/chore/etc. row).
const NOTIFICATION_TYPE_TO_MODULE_KEY = {
  todo_assigned: 'todos',
  todo_nudge: 'todos', // a nudge deep-links to the same module as assignment
  chore_assigned: 'chores_funds',
  goal_assigned: 'goals',
  wishlist_assigned: 'wishlist',
  one_on_one_requested: 'communication',
  // Completion notifies the assigner, symmetric to the assignment
  // types above -- same module-key targets as their *_assigned counterpart.
  todo_completed: 'todos',
  chore_completed: 'chores_funds',
  goal_completed: 'goals',
}

const notifications = useLive((d) => listNotifications(d, core.memberId))
const open = ref(false)
const rootEl = ref(null)

const unreadCount = computed(() => notifications.value.filter((n) => !n.read_at).length)
const badgeLabel = computed(() => (unreadCount.value > 9 ? '9+' : String(unreadCount.value)))

function toggle() {
  open.value = !open.value
}

function markRead(n) {
  if (n.read_at) return
  markNotificationsRead(doc, core.memberId, n.id)
}

// Tapping a notification (not its own clear button) marks it read,
// closes the panel, and navigates to the module it's about. Mapped via
// `type` (see NOTIFICATION_TYPE_TO_MODULE_KEY above), not the `message`
// text -- `type` is the structured field every notification already
// sets, so this covers every notification kind without any fragile
// string-matching.
function openNotification(n) {
  markRead(n)
  open.value = false
  const moduleKey = NOTIFICATION_TYPE_TO_MODULE_KEY[n.type]
  const addon = moduleKey && findAddon(moduleKey)
  if (addon) {
    router.push(addon.route)
  }
  // No mapping (or module was removed from the registry since the
  // notification was created): mark-read + close still happened above, so
  // the notification stays visible and correctly marked read -- we just
  // don't have anywhere sensible left to navigate to.
}

function markAllRead() {
  markNotificationsRead(doc, core.memberId)
}

// Clear my own already-read notifications. Only ever removes read
// rows (clearNotifications' own guard), so these are the only UI paths that
// need to exist — no "clear unread" affordance is offered.
const hasReadNotifications = computed(() => notifications.value.some((n) => n.read_at))

function clearOne(n) {
  if (!n.read_at) return
  clearNotifications(doc, core.memberId, n.id)
}

function clearAllRead() {
  clearNotifications(doc, core.memberId)
}

function onClickOutside(e) {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div class="notif-bell" ref="rootEl">
    <button type="button" class="notif-bell__trigger" @click="toggle" :aria-expanded="open" aria-label="Notifications">
      <Bell :size="20" />
      <span v-if="unreadCount > 0" class="notif-bell__badge">{{ badgeLabel }}</span>
    </button>

    <div v-if="open" class="notif-bell__panel">
      <div class="notif-bell__panel-header">
        <h3>Notifications</h3>
        <div class="notif-bell__panel-actions">
          <button
            v-if="unreadCount > 0"
            type="button"
            class="notif-bell__mark-all"
            @click="markAllRead"
          >
            Mark all read
          </button>
          <button
            v-if="hasReadNotifications"
            type="button"
            class="notif-bell__mark-all"
            @click="clearAllRead"
          >
            Clear read
          </button>
        </div>
      </div>

      <EmptyState v-if="notifications.length === 0">You're all caught up.</EmptyState>

      <ul v-else class="notif-bell__list">
        <li
          v-for="n in notifications"
          :key="n.id"
          class="notif-bell__item"
          :class="{ unread: !n.read_at }"
          @click="openNotification(n)"
        >
          <span class="notif-bell__dot" v-if="!n.read_at" />
          <div class="notif-bell__item-body">
            <p class="notif-bell__message">{{ n.message }}</p>
            <p class="notif-bell__time">{{ formatTimestamp(n.created_at) }}</p>
          </div>
          <button
            v-if="n.read_at"
            type="button"
            class="notif-bell__item-clear"
            aria-label="Clear notification"
            @click.stop="clearOne(n)"
          >
            <X :size="16" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
