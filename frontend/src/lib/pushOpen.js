// Where a tap on a phone's "New family update" notification should take the person. The push itself carries no
// content (the relay can't read the family's data, and neither can the push service), so the app works out what
// changed from its own sync: the newest change another device made that has a page to open.
import { get } from '../data/collection'
import { listNotifications } from '../data/notifications'
import { recentRemoteChanges } from '../data/recentChanges'
import { nowStamp } from '../data/time'
import { notificationTarget } from './notificationTargets'

// When this app session started. A notification tapped to open the app looks back a little before this, so a
// change that synced in just before the page loaded still counts.
export const appLoadedAt = Date.now()

// The page each collection's records are shown on. A member reading an announcement is not news, so the
// bookkeeping collections are left out.
const COLLECTION_ROUTES = {
  todos: '/todos',
  events: '/calendar',
  shopping_items: '/shopping',
  chores: '/chores',
  fund_transactions: '/funds',
  budget_items: '/funds',
  goals: '/goals',
  wishlist_items: '/wishlist',
  recipes: '/recipes',
  meal_library: '/recipes',
  books: '/library',
  reading_progress: '/library',
  loans: '/library',
  binder_sections: '/binder',
  binder_posts: '/binder',
  binder_post_images: '/binder',
  announcements: '/communication',
  checkin_responses: '/communication',
  one_on_ones: '/communication',
  birthdays: '/birthdays',
}

// Where a changed record is shown, with the record as `?item=<id>`. A notification opens what it is about, and
// only if it is this member's own.
export function targetForChange(doc, change, memberId) {
  if (change.collection === 'notifications') {
    const row = get(doc, 'notifications', change.id)
    if (!row || row.recipient_member_id !== memberId) return null
    return notificationTarget(row)
  }
  const route = COLLECTION_ROUTES[change.collection]
  return route ? `${route}?item=${encodeURIComponent(change.id)}` : null
}

// The place to open after a notification: the newest change from another device that has a page, else the newest
// unread notification from the last two hours, else null (the app stays where it is).
export function targetAfterPush(doc, memberId, { since = 0 } = {}) {
  for (const change of recentRemoteChanges({ since })) {
    const target = targetForChange(doc, change, memberId)
    if (target) return target
  }
  const twoHoursAgo = nowStamp(new Date(Date.now() - 2 * 60 * 60 * 1000))
  const unread = listNotifications(doc, memberId).find((n) => !n.read_at && n.created_at >= twoHoursAgo)
  return unread ? notificationTarget(unread) : null
}

// Resolves true as soon as `check()` holds, or false once `ms` has passed.
export function waitFor(check, ms) {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (check()) return resolve(true)
      if (Date.now() - started >= ms) return resolve(false)
      setTimeout(tick, 250)
    }
    tick()
  })
}

// Opens the place a notification is about. A cold start from a notification waits up to `waitMs` for the first
// change with a page to sync in; a notification tapped while the app is already open needs no wait.
export async function openAfterPush({ router, doc, memberId, since, waitMs = 0 }) {
  if (waitMs) {
    await waitFor(() => recentRemoteChanges({ since }).some((c) => targetForChange(doc, c, memberId)), waitMs)
  }
  const target = targetAfterPush(doc, memberId, { since })
  if (target) await router.push(target)
  return target
}
