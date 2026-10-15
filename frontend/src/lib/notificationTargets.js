// Where a notification takes the person who taps it: the page where the change or new item is, with the item itself
// as `?item=<id>` so the page can point at it. A 1:1 request opens its answer screen instead. Used by the bell and by
// a tap on a phone's notification (see lib/pushOpen.js).
const TYPE_ROUTES = {
  todo_assigned: '/todos',
  todo_nudge: '/todos',
  todo_completed: '/todos',
  chore_assigned: '/chores',
  chore_completed: '/chores',
  goal_assigned: '/goals',
  goal_completed: '/goals',
  wishlist_assigned: '/wishlist',
  one_on_one_accepted: '/communication',
  one_on_one_declined: '/communication',
  birthday: '/birthdays',
}

export function notificationTarget(n) {
  if (n.type === 'one_on_one_requested') return n.related_id ? `/one-on-one/${encodeURIComponent(n.related_id)}` : '/communication'
  const route = TYPE_ROUTES[n.type]
  if (!route) return null
  return n.related_id ? `${route}?item=${encodeURIComponent(n.related_id)}` : route
}
