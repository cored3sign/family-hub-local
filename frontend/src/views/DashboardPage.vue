<script setup>
// Dashboard: a data dashboard with headline numbers, a progress ring, and
// hand-rolled inline-SVG charts summarizing the family's actual data.
// Each module's data is read independently via its own data-layer list
// function, exactly as that module's own page does -- no new data code,
// so modules stay uncoupled at the data layer; displaying more than one
// module's data on one screen is not coupling.
//
// Visual direction: flat, modern chart UI using the coral/sky token
// palette, with no paper/pin/cork textures.
//
// Chart conventions: the form is picked by job (a meter for a single
// ratio, a hero number for one headline value, single-hue bars for
// magnitude-by-named-entity rather than a categorical palette -- see the
// per-chart comments below for why), a legend only where 2+ series
// genuinely share one chart, and hover/tap tooltips.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import FinishSetup from '../components/FinishSetup.vue'
import {
  Circle, Calendar, ShoppingCart, Target, Wallet, PiggyBank, ChevronRight, Flame,
} from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { firstName } from '../lib/names'
import { useFamily, useLive } from '../data/vue'
import { listTodos, saveTodo } from '../data/modules/todos'
import { listEvents } from '../data/modules/events'
import { listChores } from '../data/modules/chores'
import { membersWithBalances } from '../data/modules/funds'
import { listBudgets } from '../data/modules/budgets'
import { listMembers } from '../data/members'

const core = useCoreStore()
const router = useRouter()
const { doc, actor } = useFamily()

// Dashboard chart-cards are a jumping-off point into their module, not a
// dead end. Each card that maps to a real module route
// navigates on click; interactive elements inside a card (the to-do
// checkbox, chart hover targets) stop propagation so they don't also fire
// the card-level navigation.
function goTo(path) {
  router.push(path)
}

// Reads are synchronous local-doc lookups, so there is nothing to
// await and no loading state to track. Every module is available to every
// family, so every card renders.
const todos = useLive(listTodos)
const events = useLive(listEvents)
const chores = useLive(listChores)
const members = useLive(listMembers)
// chores carry no member-list of their own here (listChores returns just
// the chores table); member identity for the chores-by-member chart comes
// from `members` above. Funds balances need their own read since
// listMembers doesn't carry funds_balance.
const fundsMembers = useLive(membersWithBalances)
const budgetItems = useLive(listBudgets)

onMounted(() => {
  shuffleCardOrder()
})

const todayIso = computed(() => new Date().toISOString().slice(0, 10))

const greetingPart = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
})

// Personalize the dashboard to the viewer -- "mine" means either assigned to the logged-in member, or
// unassigned/"Everyone". The headline numbers below lead with the
// viewer's own to-dos, not the whole family's, for the same reason.
const isMine = (assignedId) => assignedId == null || assignedId === core.myMemberId

function toggleTodo(todo) {
  const next = todo.status === 'done' ? 'todo' : 'done'
  saveTodo(doc, actor(), {
    id: todo.id,
    title: todo.title,
    status: next,
    assigned_member_id: todo.assigned_member_id,
    deadline: todo.deadline,
  })
}

// ---------------------------------------------------------------------
// Chart 1: To-dos — hero number + progress ring (form: a single ratio
// against a limit -> a meter; not a categorical donut since there's only
// one series -- done vs. remaining is one ratio, not two identities).
// Personalized: the viewer's own to-dos, per the personalization rule
// above.
const myTodos = computed(() => todos.value.filter((t) => isMine(t.assigned_member_id)))
const myTodosDone = computed(() => myTodos.value.filter((t) => t.status === 'done').length)
const myTodosTotal = computed(() => myTodos.value.length)
const myTodosPct = computed(() =>
  myTodosTotal.value ? myTodosDone.value / myTodosTotal.value : 0
)

// Ring geometry: a single meter with rounded stroke ends (thin marks,
// rounded data-ends). r=54 keeps the whole ring (with its
// 10px stroke) inside a 128px box with room for the surface gap around it.
// A true 0% ring renders no arc at all, which reads as a broken/unloaded ring rather than "0 done", so a 0-but-nonzero-
// total state keeps a small fixed sliver visible (a real minimum mark, not
// a fabricated value: the number/label beside it still say "0 of N").
const RING_R = 54
const RING_CIRC = 2 * Math.PI * RING_R
const ringDashoffset = computed(() => {
  const pct = myTodosTotal.value && myTodosPct.value === 0 ? 0.02 : myTodosPct.value
  return RING_CIRC * (1 - pct)
})

// Completion streak -- consecutive calendar
// days (ending today or yesterday) with at least one of the viewer's own
// to-dos completed on that day. completed_at is a real column (distinct
// from updated_at, which any edit touches) so this only counts genuine
// completions. If today has no completion yet, the streak still counts
// through yesterday rather than resetting to 0 -- someone who hasn't
// opened the app yet today shouldn't lose their streak for it; it only
// truly breaks once a full day passes with nothing done.
const myCompletedDays = computed(() => {
  const days = new Set()
  for (const t of myTodos.value) {
    if (!t.completed_at) continue
    days.add(t.completed_at.slice(0, 10))
  }
  return days
})
const completionStreak = computed(() => {
  const days = myCompletedDays.value
  if (!days.size) return 0
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  if (!days.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1)
  }
  let streak = 0
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
})
const showStreak = computed(() => completionStreak.value >= 3)

// ---------------------------------------------------------------------
// Chart 2: Chores by member — a bar chart comparing magnitude across a
// handful of named people. This is a NOMINAL category axis (member
// identity), not a value to encode in hue, so (one series -> one color for
// every bar, for nominal categories) every
// bar uses the same single accent hue; each member's own avatar_color
// carries identity as a small dot beside their name label instead of as
// the bar fill. This was a deliberate choice, not a shortcut: the app's
// avatar_color values as chart-mark fills fail chroma-floor and
// normal-vision-separation checks (soft/pastel avatar colors read fine as
// a small swatch behind white initials, but are too low-chroma/close
// together to serve as data-ink for bars) -- so identity stays on the
// label, not the mark.
const choresByMember = computed(() => {
  const counts = new Map()
  for (const m of members.value) counts.set(m.id, { member: m, done: 0, open: 0 })
  for (const c of chores.value) {
    if (c.assigned_member_id == null) continue
    const entry = counts.get(c.assigned_member_id)
    if (!entry) continue
    if (c.status === 'done') entry.done += 1
    else entry.open += 1
  }
  return [...counts.values()]
    .filter((e) => e.done + e.open > 0)
    .sort((a, b) => b.done - a.done)
})
const maxChoreCount = computed(() =>
  Math.max(1, ...choresByMember.value.map((e) => e.done))
)

const choreTooltip = ref(null) // { x, y, name, done, open }
function showChoreTooltip(evt, entry) {
  const rect = evt.currentTarget.closest('.chart-card').getBoundingClientRect()
  choreTooltip.value = {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top,
    name: firstName(entry.member.name),
    done: entry.done,
    open: entry.open,
  }
}
function hideChoreTooltip() {
  choreTooltip.value = null
}

// ---------------------------------------------------------------------
// Chart 3: Events this week — hero count + a 7-bar sparkline (form: trend
// across a short fixed span, single series -> single hue). Today is marked with a ring
// (non-color signal, not just a highlighted fill) so it reads without
// relying on color alone.
const weekDays = computed(() => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - start.getDay()) // Sunday-start week
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
})
const weekDayIsos = computed(() => weekDays.value.map((d) => d.toISOString().slice(0, 10)))

const eventsThisWeekCount = computed(() =>
  events.value.filter((e) => weekDayIsos.value.includes(e.event_date)).length
)

const eventsPerDay = computed(() =>
  weekDayIsos.value.map((iso, i) => ({
    iso,
    label: weekDays.value[i].toLocaleDateString(undefined, { weekday: 'narrow' }),
    isToday: iso === todayIso.value,
    count: events.value.filter((e) => e.event_date === iso).length,
  }))
)
const maxEventsPerDay = computed(() => Math.max(1, ...eventsPerDay.value.map((d) => d.count)))

const eventTooltip = ref(null) // { x, y, label, count }
function showEventTooltip(evt, day) {
  const rect = evt.currentTarget.closest('.chart-card').getBoundingClientRect()
  eventTooltip.value = {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top,
    label: day.label,
    count: day.count,
  }
}
function hideEventTooltip() {
  eventTooltip.value = null
}

function formatEventDate(dateIso) {
  const [y, m, d] = dateIso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

const upcomingEventsList = computed(() =>
  events.value
    .filter((e) => e.event_date >= todayIso.value)
    .sort((a, b) => a.event_date.localeCompare(b.event_date))
    .slice(0, 3)
)

// ---------------------------------------------------------------------
// Funds/Budgets highlight. Two plain stat
// tiles, not a spend-vs-budget ring: budget_items only tracks a planned
// monthly amount per category, there is no expense/spend ledger anywhere
// in the data to compare it against, so a "$ spent of $ budgeted" ring
// would have to fabricate the spent half. Total family funds balance and
// total monthly budgeted are both real, already-read aggregates.
const totalFundsBalance = computed(() =>
  fundsMembers.value.reduce((sum, m) => sum + Number(m.funds_balance || 0), 0)
)
const totalMonthlyBudget = computed(() =>
  budgetItems.value.reduce((sum, b) => sum + Number(b.monthly_amount || 0), 0)
)

function formatMoney(n) {
  return `$${Number(n).toFixed(2)}`
}

const hasAnyData = computed(() =>
  todos.value.length || events.value.length || chores.value.length
)

// The dashboard reconfigures on each visit to keep it fresh. The
// hero to-dos ring always leads (it's the viewer's own most-actionable
// number, not a shuffle candidate), but the order of the summary cards
// below it is reshuffled once per page load -- a fixed shuffle for the
// lifetime of this visit (not re-rolled on every reactive update, which
// would make the layout jump around while charts re-render after a
// toggle/save). Each card's own v-if gating is unchanged; a card simply
// isn't in `cardOrder` if it has no data.
const CARD_KEYS = ['chores', 'calendar', 'funds']
const cardOrder = ref([...CARD_KEYS])
function shuffleCardOrder() {
  const arr = [...CARD_KEYS]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  cardOrder.value = arr
}
// Offset by 1 so the shuffled group always sits between the hero (order 0)
// and the fixed-position sections after it (order 4+) -- flex `order`
// compares across ALL siblings in the container, so every section needs an
// explicit value once any of them has one, or unstyled siblings (default
// order: 0) interleave with the shuffled ones instead of framing them.
function cardStyle(key) {
  return { order: cardOrder.value.indexOf(key) + 1 }
}
</script>

<template>
  <div class="dashboard">
    <FinishSetup v-if="core.isAdmin" />
    <div class="dash-greeting">
      <span class="dash-greeting__title">Good {{ greetingPart }}, {{ core.myFirstName }}</span>
      <span v-if="showStreak" class="streak-badge" :title="`${completionStreak}-day completion streak`">
        <Flame :size="14" />
        {{ completionStreak }}
      </span>
    </div>

      <EmptyState v-if="!hasAnyData" illustration="dashboard">
        Nothing to show yet — add a to-do, event, or chore to see your dashboard come alive.
      </EmptyState>

      <!-- To-dos: hero number + progress ring. Single meter, no legend
           needed (one series -- the title/label names it). Clickable
           through to the To-do module (dashboard tiles are a
           jumping-off point, not just a display). -->
      <section
        class="chart-card chart-card--hero chart-card--link"
        role="link"
        tabindex="0"
        style="order: 0"
        @click="goTo('/todos')"
        @keydown.enter="goTo('/todos')"
      >
        <div class="hero-stat">
          <div class="hero-stat__value">
            <span class="hero-stat__num">{{ myTodosDone }}</span>
            <span class="hero-stat__of">of {{ myTodosTotal }}</span>
          </div>
          <div class="hero-stat__label">your to-dos done</div>
          <div v-if="myTodosTotal === 0" class="hero-stat__label hero-stat__label--muted">
            Nothing assigned to you right now
          </div>
        </div>
        <svg class="progress-ring" viewBox="0 0 128 128" role="img" :aria-label="`${myTodosDone} of ${myTodosTotal} to-dos done`">
          <circle class="progress-ring__track" cx="64" cy="64" :r="RING_R" />
          <circle
            class="progress-ring__fill"
            cx="64" cy="64" :r="RING_R"
            :stroke-dasharray="RING_CIRC"
            :stroke-dashoffset="myTodosTotal ? ringDashoffset : RING_CIRC"
          />
        </svg>
        <ChevronRight :size="18" class="chart-card__link-chevron" />
      </section>

      <!-- Chores by member: single-hue bar chart, identity via avatar-dot
           label (see the computed's comment above for why, not a fresh
           categorical palette). Clickable through to Chores; the bar hover
           targets stop propagation so hovering for a tooltip doesn't also
           navigate. Order shuffled per visit alongside This Week / Funds. -->
      <section
        v-if="choresByMember.length"
        class="chart-card chart-card--link"
        role="link"
        tabindex="0"
        :style="cardStyle('chores')"
        @click="goTo('/chores')"
        @keydown.enter="goTo('/chores')"
      >
        <h2 class="chart-card__heading">Chores by member</h2>
        <div class="bar-chart">
          <div v-for="entry in choresByMember" :key="entry.member.id" class="bar-row">
            <div class="bar-row__label">
              <span class="bar-row__dot" :style="{ background: entry.member.avatar_color || 'var(--accent-container)' }" />
              <span>{{ firstName(entry.member.name) }}</span>
            </div>
            <div class="bar-row__track">
              <div
                class="bar-row__fill"
                :style="{ '--bar-scale': entry.done / maxChoreCount }"
                tabindex="0"
                @click.stop
                @pointermove="showChoreTooltip($event, entry)"
                @pointerleave="hideChoreTooltip"
                @focus="showChoreTooltip($event, entry)"
                @blur="hideChoreTooltip"
              />
              <span class="bar-row__value">{{ entry.done }}<template v-if="entry.open"> · {{ entry.open }} open</template></span>
            </div>
          </div>
        </div>
        <div v-if="choreTooltip" class="chart-tooltip" :style="{ left: choreTooltip.x + 'px', top: choreTooltip.y + 'px' }">
          <strong>{{ choreTooltip.name }}</strong>
          <span>{{ choreTooltip.done }} done{{ choreTooltip.open ? ` · ${choreTooltip.open} open` : '' }}</span>
        </div>
        <ChevronRight :size="18" class="chart-card__link-chevron" />
      </section>

      <!-- Events this week: hero count + 7-bar sparkline, single hue.
           Clickable through to Calendar. -->
      <section
        class="chart-card chart-card--link"
        role="link"
        tabindex="0"
        :style="cardStyle('calendar')"
        @click="goTo('/calendar')"
        @keydown.enter="goTo('/calendar')"
      >
        <h2 class="chart-card__heading">This week</h2>
        <div class="week-stat">
          <div class="week-stat__num">{{ eventsThisWeekCount }}</div>
          <div class="week-stat__label">event{{ eventsThisWeekCount === 1 ? '' : 's' }} this week</div>
        </div>
        <div class="sparkline">
          <div v-for="day in eventsPerDay" :key="day.iso" class="sparkline__col">
            <div class="sparkline__bar-track">
              <div
                class="sparkline__bar"
                :class="{ 'sparkline__bar--today': day.isToday }"
                :style="{ '--bar-scale': (day.count ? Math.max(day.count / maxEventsPerDay, 0.12) : 0.02) }"
                tabindex="0"
                @click.stop
                @pointermove="showEventTooltip($event, day)"
                @pointerleave="hideEventTooltip"
                @focus="showEventTooltip($event, day)"
                @blur="hideEventTooltip"
              />
            </div>
            <span class="sparkline__day-label" :class="{ 'sparkline__day-label--today': day.isToday }">{{ day.label }}</span>
          </div>
        </div>
        <div v-if="eventTooltip" class="chart-tooltip" :style="{ left: eventTooltip.x + 'px', top: eventTooltip.y + 'px' }">
          <span>{{ eventTooltip.count }} event{{ eventTooltip.count === 1 ? '' : 's' }}</span>
        </div>
        <div v-if="upcomingEventsList.length" class="week-list">
          <div v-for="e in upcomingEventsList" :key="e.id" class="week-list__row">
            <Calendar :size="16" class="week-list__icon" />
            <span class="week-list__title">{{ e.title }}</span>
            <span class="week-list__date">{{ formatEventDate(e.event_date) }}</span>
          </div>
        </div>
        <ChevronRight :size="18" class="chart-card__link-chevron" />
      </section>

      <!-- Funds/Budgets highlight: two plain stat tiles (see the computed's
           comment above for why not a spend-vs-budget ring). Looks
           complete on its own even without Chores enabled. Clickable
           through to Funds. -->
      <section
        class="chart-card chart-card--link"
        role="link"
        tabindex="0"
        :style="cardStyle('funds')"
        @click="goTo('/funds')"
        @keydown.enter="goTo('/funds')"
      >
        <h2 class="chart-card__heading">Funds &amp; budgets</h2>
        <div class="stat-tile-row">
          <div class="stat-tile">
            <div class="stat-tile__icon"><Wallet :size="18" /></div>
            <div class="stat-tile__value">{{ formatMoney(totalFundsBalance) }}</div>
            <div class="stat-tile__label">total family funds</div>
          </div>
          <div class="stat-tile stat-tile--complement">
            <div class="stat-tile__icon"><PiggyBank :size="18" /></div>
            <div class="stat-tile__value">{{ formatMoney(totalMonthlyBudget) }}</div>
            <div class="stat-tile__label">budgeted / month</div>
          </div>
        </div>
        <ChevronRight :size="18" class="chart-card__link-chevron" />
      </section>

      <!-- Your to-dos (list): the primary actionable surface for the
           viewer's own open items — the charts above summarize, this lets
           you act. -->
      <section
        v-if="myTodos.filter((t) => t.status !== 'done').length"
        class="chart-card chart-card--link"
        role="link"
        tabindex="0"
        style="order: 4"
        @click="goTo('/todos')"
        @keydown.enter="goTo('/todos')"
      >
        <h2 class="chart-card__heading">Your open to-dos</h2>
        <div v-for="todo in myTodos.filter((t) => t.status !== 'done').slice(0, 4)" :key="todo.id" class="todo-row">
          <button class="todo-row__check" @click.stop="toggleTodo(todo)" aria-label="Mark done">
            <Circle :size="20" />
          </button>
          <div class="todo-row__body">
            <div class="todo-row__title">{{ todo.title }}</div>
            <div class="todo-row__meta"><template v-if="todo.deadline">Due {{ todo.deadline }}</template><template v-else>No due date</template></div>
          </div>
        </div>
        <ChevronRight :size="18" class="chart-card__link-chevron" />
      </section>

      <!-- Module shortcuts: unchanged utility, demoted below the data
           summary since it's navigation, not data. -->
      <section class="dash-shortcuts" style="order: 5">
        <router-link to="/shopping" class="dash-shortcut">
          <div class="dash-shortcut__icon dash-shortcut__icon--shopping">
            <ShoppingCart :size="20" />
          </div>
          <span>Shopping</span>
        </router-link>
        <router-link to="/goals" class="dash-shortcut">
          <div class="dash-shortcut__icon dash-shortcut__icon--goal">
            <Target :size="20" />
          </div>
          <span>Goals</span>
        </router-link>
      </section>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dash-greeting {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.dash-greeting__title {
  font: var(--type-headline);
  font-weight: 800;
  color: var(--text);
}

/* Quiet by design -- a streak is a nice-to-notice aside, not a competing
   headline number next to the hero to-dos ring, so it's small text-size
   with a soft container fill rather than a bold accent-filled pill. */
.streak-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--accent-container);
  color: var(--accent-deep);
  font: var(--type-label);
  font-size: 12px;
  font-weight: 700;
}

.chart-card {
  position: relative;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 18px;
}

.chart-card__heading {
  margin: 0 0 14px;
  font: var(--type-label);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 11px;
}

/* Cards are a jumping-off point into their module, not a
   dead end -- a chevron signals it, the whole card is the tap target
   (interactive children inside stop propagation, see template). */
.chart-card--link {
  cursor: pointer;
  padding-right: 40px;
  transition: box-shadow 120ms ease, transform 120ms ease;
}

.chart-card--link:hover {
  box-shadow: var(--elevation-2);
}

.chart-card--link:active {
  transform: scale(0.99);
}

.chart-card--link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.chart-card__link-chevron {
  position: absolute;
  top: 18px;
  right: 14px;
  color: var(--text-muted);
}

/* --- Hero to-do ring --- */

.chart-card--hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.hero-stat {
  min-width: 0;
}

.hero-stat__value {
  display: flex;
  align-items: baseline;
  gap: 6px;
  /* Proportional figures, not tabular-nums, on a hero number per
     marks-and-anatomy (tabular-nums is for column alignment only). */
  font-variant-numeric: proportional-nums;
}

.hero-stat__num {
  font: var(--type-headline);
  font-size: 48px;
  font-weight: 800;
  color: var(--accent);
  line-height: 1;
}

.hero-stat__of {
  font: var(--type-title);
  color: var(--text-muted);
}

.hero-stat__label {
  margin-top: 4px;
  font: var(--type-label);
  color: var(--text-muted);
}

.hero-stat__label--muted {
  margin-top: 8px;
  font-style: italic;
}

.progress-ring {
  flex: none;
  width: 96px;
  height: 96px;
  transform: rotate(-90deg);
}

.progress-ring__track {
  fill: none;
  stroke: var(--accent-container);
  stroke-width: 10;
}

.progress-ring__fill {
  fill: none;
  stroke: var(--accent);
  stroke-width: 10;
  stroke-linecap: round;
  transition: stroke-dashoffset 400ms ease;
}

/* --- Chores-by-member bar chart --- */

.bar-chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bar-row__label {
  flex: none;
  width: 64px;
  display: flex;
  align-items: center;
  gap: 6px;
  font: var(--type-label);
  color: var(--text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bar-row__dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.bar-row__track {
  position: relative;
  flex: 1;
  height: 20px;
  background: var(--surface-variant);
  border-radius: 10px;
  display: flex;
  align-items: center;
}

.bar-row__fill {
  height: 100%;
  min-width: 20px;
  width: 100%;
  transform-origin: left center;
  background: var(--accent);
  border-radius: 10px;
  /* transform, not width -- animating width forces layout on every frame;
     scaleX composites instead. The bar's actual data-driven length is set
     inline via --bar-scale (see the template's :style binding) and applied
     here as a transform so the paint cost stays constant regardless of
     value. */
  transform: scaleX(var(--bar-scale, 1));
  transition: transform 300ms ease;
  cursor: default;
}

.bar-row__fill:focus-visible {
  outline: 2px solid var(--complement);
  outline-offset: 2px;
}

.bar-row__value {
  margin-left: 8px;
  font: var(--type-label);
  color: var(--text-muted);
  white-space: nowrap;
}

/* --- Events sparkline --- */

.week-stat {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 14px;
}

.week-stat__num {
  font: var(--type-headline);
  font-size: 36px;
  font-weight: 800;
  color: var(--complement);
  line-height: 1;
  font-variant-numeric: proportional-nums;
}

.week-stat__label {
  font: var(--type-label);
  color: var(--text-muted);
}

.sparkline {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 64px;
}

.sparkline__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  height: 100%;
}

.sparkline__bar-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.sparkline__bar {
  width: 100%;
  max-width: 22px;
  height: 100%;
  transform-origin: bottom center;
  background: var(--complement-soft);
  border-radius: 4px 4px 0 0;
  cursor: default;
  /* transform, not height -- see .bar-row__fill's identical reasoning
     above. --bar-scale (0-1) is set inline per bar from the template. */
  transform: scaleY(var(--bar-scale, 1));
  transition: transform 300ms ease, background-color 120ms ease;
}

.sparkline__bar--today {
  background: var(--complement);
}

.sparkline__bar:hover,
.sparkline__bar:focus-visible {
  background: var(--complement-mid);
  outline: none;
}

.sparkline__day-label {
  font: var(--type-label);
  font-size: 11px;
  color: var(--text-muted);
}

.sparkline__day-label--today {
  color: var(--complement);
  font-weight: 700;
}

.week-list {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.week-list__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.week-list__icon {
  flex: none;
  color: var(--complement);
}

.week-list__title {
  flex: 1;
  min-width: 0;
  font: var(--type-label);
  color: var(--text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.week-list__date {
  flex: none;
  font: var(--type-label);
  color: var(--text-muted);
}

/* --- Funds/Budgets stat tiles --- */

.stat-tile-row {
  display: flex;
  gap: 12px;
}

.stat-tile {
  flex: 1;
  min-width: 0;
  background: var(--accent-container);
  border-radius: 12px;
  padding: 12px 14px;
}

.stat-tile--complement {
  background: color-mix(in srgb, var(--complement) 16%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--complement) 35%, transparent);
}

.stat-tile__icon {
  color: var(--accent-deep);
  margin-bottom: 6px;
}

.stat-tile--complement .stat-tile__icon {
  color: var(--complement);
}

.stat-tile__value {
  font: var(--type-title);
  font-size: 20px;
  font-weight: 800;
  color: var(--text);
  font-variant-numeric: proportional-nums;
}

.stat-tile__label {
  margin-top: 2px;
  font: var(--type-label);
  font-size: 11px;
  color: var(--text-muted);
}

/* --- Tooltip (shared by bar-chart and sparkline) --- */

.chart-tooltip {
  position: absolute;
  transform: translate(-50%, -110%);
  background: var(--text);
  color: var(--surface);
  padding: 6px 10px;
  border-radius: 8px;
  font: var(--type-label);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 2;
  box-shadow: var(--elevation-2);
}

/* --- Your open to-dos list --- */

.todo-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.todo-row + .todo-row {
  border-top: 1px solid var(--border);
}

.todo-row__check {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  border: none;
  border-radius: 10px;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  transition: background-color 120ms ease;
}

.todo-row__check:hover {
  background: color-mix(in srgb, var(--accent) 20%, var(--surface));
}

.todo-row__body {
  min-width: 0;
  flex: 1;
}

.todo-row__title {
  font: var(--type-title);
  font-size: 15px;
  color: var(--text);
}

.todo-row__meta {
  font: var(--type-label);
  color: var(--text-muted);
  margin-top: 2px;
}

/* --- Module shortcuts --- */

.dash-shortcuts {
  display: flex;
  gap: 12px;
}

.dash-shortcut {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 14px;
  text-decoration: none;
  color: var(--text);
  font: var(--type-label);
  transition: background-color 120ms ease;
}

.dash-shortcut:hover {
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}

.dash-shortcut__icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
}

.dash-shortcut__icon--shopping { background: linear-gradient(135deg, var(--tile-shopping), var(--accent-soft)); }
.dash-shortcut__icon--goal { background: linear-gradient(135deg, var(--accent), var(--accent-deep)); }
</style>
