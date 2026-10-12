// FIRST: takes any #relay= link out of the URL before ./router's createWebHistory() reads it.
import './pairingBoot'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import './components/components.css'
import App from './App.vue'
import router from './router'
import { initFamily } from './data/family'
import { useCoreStore } from './stores/core'
import { useSyncStore } from './stores/sync'
import { addons } from './addons/registry'
import AppButton from './components/AppButton.vue'
import AppCard from './components/AppCard.vue'
import AppModal from './components/AppModal.vue'
import AppTag from './components/AppTag.vue'
import AddRow from './components/AddRow.vue'
import AssigneeFilterChips from './components/AssigneeFilterChips.vue'
import EmptyState from './components/EmptyState.vue'
import FormField from './components/FormField.vue'
import ListRow from './components/ListRow.vue'
import NotificationBell from './components/NotificationBell.vue'
import ModuleCard from './components/ModuleCard.vue'
import BarcodeScanner from './components/BarcodeScanner.vue'
import FilterButton from './components/FilterButton.vue'
import UpdatePrompt from './components/UpdatePrompt.vue'

const app = createApp(App)
// Safety net for any error that escapes a component's own handling: the
// last-resort catch, so a miss still reaches the user instead of failing
// silently. No toast component exists in this codebase, so a plain alert is
// the minimal option.
app.config.errorHandler = (err) => {
  console.error(err)
  window.alert(err?.message || String(err))
}
app.component('AppButton', AppButton)
app.component('AppCard', AppCard)
app.component('AppModal', AppModal)
app.component('AppTag', AppTag)
app.component('AddRow', AddRow)
app.component('AssigneeFilterChips', AssigneeFilterChips)
app.component('EmptyState', EmptyState)
app.component('FormField', FormField)
app.component('ListRow', ListRow)
app.component('NotificationBell', NotificationBell)
app.component('ModuleCard', ModuleCard)
app.component('BarcodeScanner', BarcodeScanner)
app.component('FilterButton', FilterButton)
app.component('UpdatePrompt', UpdatePrompt)
// The family's Yjs docs (IndexedDB) must be loaded before the
// first route guard runs -- every screen reads from them synchronously.
// Boot order: any relay link was taken (and stripped from the URL) by
// ./pairingBoot before the router existed. Open the family, then the sync
// boot (bounded: the 1.5 s loopback hub probe), then the core read-model,
// then mount.
app.use(createPinia())
initFamily()
  .then(async () => {
    await useSyncStore().boot()
    useCoreStore().start()
    app.use(router).mount('#app')
  })
  .catch((err) => {
    // If IndexedDB is unavailable (private window, site data blocked, etc.)
    // the app can't mount. Render a plain message straight into #app so
    // the person sees what's wrong instead of a blank page.
    console.error('Failed to open local storage:', err)
    const el = document.getElementById('app')
    if (el) {
      el.textContent = "Yggltree couldn't open its storage on this device. Check that this browser allows site data (not a private window) and reload."
    }
  })

// Service worker (PWA + push notifications). Registered unconditionally
// on load (not gated on the push toggle) -- installability itself needs a
// registered service worker regardless of whether the user ever opts into
// push. Feature-detect rather than assume every browser supports the API.
// Secure-context note: service worker registration is
// itself secure-context-gated by the browser, so `.register()` simply never
// runs over plain LAN http -- the `'serviceWorker' in navigator` check above
// already makes that harmless (no throw, no broken PWA feature on http;
// installability just isn't offered there).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service worker registration failed:', err)
    })
  })

  // A lazily-imported module page (addons/registry.js's
  // `component()` dynamic imports) is only ever cached if the person
  // actually visits it while online -- offline-first before that first
  // visit would otherwise just 404. Once a service worker actually controls the
  // page, warm every module's chunk by importing it: the browser's fetch for
  // each /assets/* chunk is what the SW's fetch handler caches, same as any
  // other navigation.
  navigator.serviceWorker.ready.then((registration) => {
    if (registration.active || navigator.serviceWorker.controller) {
      addons.filter((a) => a.component).forEach((a) => a.component().catch(() => {}))
    }
  })
}
