import { createRouter, createWebHistory } from 'vue-router'
import { useCoreStore } from './stores/core'
import { useSyncStore } from './stores/sync'
import { decideRoute } from './lib/guard'
import { addons } from './addons/registry'
import DashboardLayout from './views/DashboardLayout.vue'
import DashboardPage from './views/DashboardPage.vue'
import SetupPage from './views/SetupPage.vue'
import ConnectPage from './views/ConnectPage.vue'
import ProfilesPage from './views/ProfilesPage.vue'
import PinSetupPage from './views/PinSetupPage.vue'
import ModulesPage from './views/ModulesPage.vue'
import SettingsPage from './views/SettingsPage.vue'
import HelpPage from './views/HelpPage.vue'

// coming_soon/flagged registry entries (e.g. Recipes) intentionally have no
// route/component to lazy-load yet -- registering a route with path/component
// undefined crashes Vue Router 5's addRoute() at router-creation time
// (TypeError: Cannot read properties of undefined (reading 'startsWith')),
// which breaks the entire app's boot, not just that module's page. Filter
// them out here the same way DashboardLayout's nav and ModulesPage's
// openModule() already guard on `route` before using it.
const addonRoutes = addons
  .filter((a) => a.route && a.component)
  .map((a) => ({
    path: a.route,
    name: a.key,
    component: a.component,
    meta: { moduleKey: a.key },
  }))

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // No accounts. /setup creates the family doc locally (first device,
    // first run); /profiles picks which member is using this device. Both
    // are top-level, not nested under DashboardLayout -- neither assumes
    // a chosen profile.
    { path: '/setup', name: 'setup', component: SetupPage },
    // A device without a family yet (pairing, pulling from the
    // hub, a pending replace, or the hub not running) waits here.
    { path: '/connect', name: 'connect', component: ConnectPage },
    { path: '/profiles', name: 'profiles', component: ProfilesPage },
    { path: '/set-pin', name: 'set-pin', component: PinSetupPage },
    {
      path: '/',
      component: DashboardLayout,
      children: [
        // The default screen is the Dashboard feed: root always redirects
        // there, not to whichever module happens to be pinned to slot 1.
        // Dashboard itself has no pin/enablement
        // precondition (always reachable regardless of pinnedModules), so
        // there's no "nothing pinned yet" fallback case to handle here.
        { path: '', redirect: '/dashboard' },
        { path: '/dashboard', name: 'dashboard', component: DashboardPage },
        // Module catalog: a persistent link outside the 5 pinnable nav slots,
        // not itself a module --
        // manually added rather than generated from the addons registry.
        { path: '/modules', name: 'modules', component: ModulesPage },
        // Settings is platform-level (member management, hub
        // config, own profile), not a toggleable module -- manually
        // routed, same non-module-route precedent as /modules above rather
        // than generated from the addons registry.
        { path: '/settings', name: 'settings', component: SettingsPage },
        // Help is platform-level (tutorial replay, install instructions
        // and sync status), same non-module-route precedent as /modules and
        // /settings above rather than generated from the addons registry.
        { path: '/help', name: 'help', component: HelpPage },
        ...addonRoutes,
      ],
    },
  ],
})

// A device needs (1) a family in its local doc -- created on /setup (hub
// machine only) or pulled from the hub while it waits on /connect -- and
// (2) a chosen profile (device-local, /profiles). See lib/guard.js.
router.beforeEach((to) => {
  const core = useCoreStore()
  const sync = useSyncStore()
  return decideRoute(
    {
      familyReady: core.familyReady,
      memberId: core.memberId,
      enabledModules: core.enabledModules,
      canSetUp: sync.canSetUp,
      pendingReplace: sync.pendingReplace,
      needsAdminPin: core.needsAdminPin,
    },
    to,
  )
})

export default router
