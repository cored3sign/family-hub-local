// Local-first: the app shell must load with no network. This service worker
// caches the app shell (HTML/JS/CSS) so the PWA reloads fully offline.
// - Navigations: network first (so new deploys are picked up), falling back
//   to the last cached index.html when offline.
// - /assets/*: Vite's content-hashed bundles never change under a given URL,
//   so cache-first is safe and makes offline reloads instant.
// - /api/ and /sync/ (the family hub) are never touched.
// - Everything else (including /version.json, which UpdatePrompt must always
//   fetch fresh) passes straight through to the network.
// Also handles push notifications.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Drop older shell caches (fh-shell-v1, ...) so they don't linger.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fh-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Fetch handler: cache the app shell and assets.
const SHELL_CACHE = 'fh-shell-v2'

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // The hub's API and sync sockets are never cached or answered offline:
  // a stale /api/hub/info or pairing answer would be wrong, not just old.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sync/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy))
          }
          return response
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
  }
})

self.addEventListener('push', (event) => {
  let data = { title: 'Family Hub', body: 'You have a new notification.' }
  if (event.data) {
    try {
      data = event.data.json()
    } catch {
      data.body = event.data.text()
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Family Hub', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    })
  )
})

// Clicking the notification focuses an already-open tab if one exists,
// otherwise opens a new one at the app root -- standard PWA notification
// click pattern, no app-specific deep-linking (the push payload today is
// just a title/body, no target URL).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow('/')
    })
  )
})
