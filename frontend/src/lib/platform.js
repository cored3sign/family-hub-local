// Browser checks for the join flow. Each takes the globals it reads as an
// argument, so tests can pass fakes; the defaults are the real browser.

// True inside the Yggltree desktop app (its own window and menu bar). The app's preload sets
// window.yggltreeDesktop; a page opened in a browser has no such flag.
export function inDesktopApp(env = globalThis) {
  return env.yggltreeDesktop?.desktop === true
}

// True when the page runs as a Home Screen app (iPhone or Android).
export function isStandaloneApp(env = globalThis) {
  return env.matchMedia?.('(display-mode: standalone)').matches || env.navigator?.standalone === true
}

// iPhone and iPad. iPadOS 13+ reports a desktop Mac user agent, so a Mac
// with a touch screen counts as an iPad too.
export function isIosDevice(nav = globalThis.navigator) {
  const ua = nav?.userAgent ?? ''
  return /iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)
}

// An iPhone or iPad page that is a Safari tab, not a Home Screen app. iOS keeps
// a Home Screen app's storage apart from Safari, so a join made in Safari
// never reaches the app.
export function isIosSafariTab(env = globalThis) {
  return isIosDevice(env.navigator) && !isStandaloneApp(env)
}
