// Side-effect module: main.js imports it FIRST, before ./router and
// ./App.vue. ES modules evaluate in import order, and router.js calls
// createWebHistory() at evaluation time, which copies the current URL
// (fragment included) into history.state and its own location. Stripping
// the #relay= link here, before that, keeps it out of the address bar,
// history.state and the router (the fragment is never sent to a server;
// it must not linger on the device either).
import { readRelayFragment } from './data/relay/config.js'
import { offerRelayJoin } from './data/relay/pending.js'

// A relay link (#relay=1.<key>) is removed from the address bar and offered to the person to confirm. Nothing is saved yet.
const relayCandidate = typeof window === 'undefined' ? null : readRelayFragment(window.location, window.history)
if (relayCandidate) offerRelayJoin(relayCandidate)
