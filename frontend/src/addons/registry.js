// Add-on manifest registry: the frontend half of the
// module system. Each entry is a routed page, lazy-loaded so a family
// with 2 of N modules enabled only downloads those 2 chunks (Vite
// code-splits each dynamic import automatically). `category`,
// `short_description`, and `lifecycle` let the /modules catalog page
// render metadata for a module without loading its page. `coming_soon`/
// `flagged` modules have no route/component yet since there's no page to
// lazy-load.

export const addons = [
  {
    key: 'todos',
    label: 'To-Do',
    icon: '✅',
    lucideIcon: 'CheckCircle2',
    category: 'core',
    short_description: 'Shared task lists with assignment and status tracking.',
    lifecycle: 'available',
    route: '/todos',
    component: () => import('../views/TodosPage.vue'),
  },
  {
    key: 'calendar',
    label: 'Calendar',
    icon: '📅',
    lucideIcon: 'Calendar',
    category: 'core',
    short_description: 'Family events and appointments in one shared calendar.',
    lifecycle: 'available',
    route: '/calendar',
    component: () => import('../views/CalendarPage.vue'),
  },
  {
    key: 'shopping',
    label: 'Shop',
    icon: '🛒',
    lucideIcon: 'ShoppingCart',
    category: 'core',
    short_description: 'A shared shopping list the whole family can add to.',
    lifecycle: 'available',
    route: '/shopping',
    component: () => import('../views/ShoppingPage.vue'),
  },
  {
    key: 'chores_funds',
    label: 'Chores',
    icon: '🪙',
    lucideIcon: 'Coins',
    category: 'household',
    short_description: 'Assign chores and track completion.',
    lifecycle: 'available',
    route: '/chores',
    component: () => import('../views/ChoresFundsPage.vue'),
  },
  {
    key: 'funds',
    label: 'Funds',
    icon: '🪙',
    lucideIcon: 'Coins',
    category: 'household',
    short_description: "Each family member's fund balance, editable and saved on update.",
    lifecycle: 'available',
    route: '/funds',
    component: () => import('../views/FundsPage.vue'),
  },
  {
    key: 'recipes',
    label: 'Cook',
    icon: '📖',
    lucideIcon: 'ChefHat',
    category: 'household',
    short_description: 'Save recipes and turn them into shopping list items.',
    lifecycle: 'available',
    route: '/recipes',
    component: () => import('../views/RecipesPage.vue'),
  },
  {
    key: 'communication',
    label: 'Speak',
    icon: '💬',
    lucideIcon: 'Megaphone',
    category: 'communication',
    short_description: 'Family announcements, check-ins, and 1:1 time tracking.',
    lifecycle: 'available',
    route: '/communication',
    component: () => import('../views/CommunicationPage.vue'),
  },
  {
    key: 'goals',
    label: 'Goals',
    icon: '🎯',
    lucideIcon: 'Target',
    category: 'planning',
    short_description: 'Set family or personal goals, track them to completion.',
    lifecycle: 'available',
    route: '/goals',
    component: () => import('../views/GoalsPage.vue'),
  },
  {
    key: 'wishlist',
    label: 'Wish',
    icon: '🎁',
    lucideIcon: 'Gift',
    category: 'planning',
    short_description: 'Personal wishlists with priority, always assigned to a member.',
    lifecycle: 'available',
    route: '/wishlist',
    component: () => import('../views/WishlistPage.vue'),
  },
  {
    key: 'library',
    label: 'Books',
    icon: '📚',
    // Distinct from Family Binder's BookOpen glyph below -- both modules are
    // "book-shaped" concepts and sit side by side in the same nav/catalog,
    // so they need visually different icons, not just different labels.
    lucideIcon: 'Library',
    category: 'family_life',
    short_description: "Track books you own, who's reading what, and what's out on loan.",
    lifecycle: 'available',
    route: '/library',
    component: () => import('../views/LibraryPage.vue'),
  },
  {
    key: 'family_binder',
    label: 'Binder',
    icon: '📔',
    lucideIcon: 'BookOpen',
    category: 'family_life',
    short_description: 'Family reference content -- values, rules, and other posts organized into sections.',
    lifecycle: 'available',
    route: '/binder',
    component: () => import('../views/BinderPage.vue'),
  },
  // Placeholder for "Advisor/expert modules": a single module covering
  // multiple advisor domains (estate planner, financial planner, legal
  // expert, counselor, career coach, life coach), not 6 separate modules.
  // Whether it becomes AI-persona chat advisors or curated resource/link
  // libraries per domain is undecided, so there is no route/component yet,
  // same as any other coming_soon entry.
  {
    key: 'advisors',
    label: 'Advisors',
    icon: '🧭',
    lucideIcon: 'Compass',
    category: 'wellbeing',
    short_description: 'Guidance from family advisors -- coming soon.',
    lifecycle: 'coming_soon',
  },
]

export function findAddon(key) {
  return addons.find((a) => a.key === key)
}

// Category taxonomy — labels + display order for the catalog's grouped
// sections. Categories with no modules in them are omitted rather than
// rendered empty; add them here once a module actually lands in one.
export const categoryLabels = {
  core: 'Core',
  household: 'Household',
  family_life: 'Family Life & Records',
  communication: 'Communication',
  // The 'advisors' coming_soon entry above is the one module in this
  // category.
  wellbeing: 'Wellbeing',
  planning: 'Planning & Goals',
}

export const categoryOrder = Object.keys(categoryLabels)
