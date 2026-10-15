// Module registry: the frontend list of the app's modules. Each entry is a routed page, lazy-loaded so a phone only
// downloads the pages it opens (Vite code-splits each dynamic import automatically). Every module is available to
// every family; a member chooses which ones to pin to their bottom menu on a phone (see views/ModulesPage.vue).
// `short_description` is the one line the Modules page shows for it.

export const addons = [
  {
    key: 'todos',
    label: 'To-Do',
    icon: '✅',
    lucideIcon: 'CheckCircle2',
    short_description: 'Shared task lists with assignment and status tracking.',
    route: '/todos',
    component: () => import('../views/TodosPage.vue'),
  },
  {
    key: 'calendar',
    label: 'Calendar',
    icon: '📅',
    lucideIcon: 'Calendar',
    short_description: 'Family events and appointments in one shared calendar.',
    route: '/calendar',
    component: () => import('../views/CalendarPage.vue'),
  },
  {
    key: 'shopping',
    label: 'Shop',
    icon: '🛒',
    lucideIcon: 'ShoppingCart',
    short_description: 'A shared shopping list the whole family can add to.',
    route: '/shopping',
    component: () => import('../views/ShoppingPage.vue'),
  },
  {
    key: 'chores_funds',
    label: 'Chores',
    icon: '🪙',
    lucideIcon: 'Coins',
    short_description: 'Assign chores and track completion.',
    route: '/chores',
    component: () => import('../views/ChoresFundsPage.vue'),
  },
  {
    key: 'funds',
    label: 'Funds',
    icon: '🪙',
    lucideIcon: 'Coins',
    short_description: "Each family member's fund balance, editable and saved on update.",
    route: '/funds',
    component: () => import('../views/FundsPage.vue'),
  },
  {
    key: 'recipes',
    label: 'Cook',
    icon: '📖',
    lucideIcon: 'ChefHat',
    short_description: 'Save recipes and turn them into shopping list items.',
    route: '/recipes',
    component: () => import('../views/RecipesPage.vue'),
  },
  {
    key: 'communication',
    label: 'Speak',
    icon: '💬',
    lucideIcon: 'Megaphone',
    short_description: 'Family announcements, check-ins, and 1:1 time tracking.',
    route: '/communication',
    component: () => import('../views/CommunicationPage.vue'),
  },
  {
    key: 'goals',
    label: 'Goals',
    icon: '🎯',
    lucideIcon: 'Target',
    short_description: 'Set family or personal goals, track them to completion.',
    route: '/goals',
    component: () => import('../views/GoalsPage.vue'),
  },
  {
    key: 'wishlist',
    label: 'Wish',
    icon: '🎁',
    lucideIcon: 'Gift',
    short_description: 'Personal wishlists with priority, always assigned to a member.',
    route: '/wishlist',
    component: () => import('../views/WishlistPage.vue'),
  },
  {
    key: 'library',
    label: 'Books',
    icon: '📚',
    // Distinct from Family Binder's BookOpen glyph below: both are "book-shaped" and sit side by side in the nav.
    lucideIcon: 'Library',
    short_description: "Track books you own, who's reading what, and what's out on loan.",
    route: '/library',
    component: () => import('../views/LibraryPage.vue'),
  },
  {
    key: 'birthdays',
    label: 'Birthdays',
    icon: '🎂',
    lucideIcon: 'Cake',
    short_description: 'Names and birthdays. Everyone in the family is reminded on the day.',
    route: '/birthdays',
    component: () => import('../views/BirthdaysPage.vue'),
  },
  {
    key: 'family_binder',
    label: 'Binder',
    icon: '📔',
    lucideIcon: 'BookOpen',
    short_description: 'Family reference content -- values, rules, and other posts organized into sections.',
    route: '/binder',
    component: () => import('../views/BinderPage.vue'),
  },
]

// The modules a member can open: every entry here has a page to route to.
export const navigableAddons = addons.filter((a) => a.route && a.component)

export function findAddon(key) {
  return addons.find((a) => a.key === key)
}
