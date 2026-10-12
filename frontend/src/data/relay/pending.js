// A relay link that was opened but not yet confirmed. Shown in a banner on every
// screen. Nothing is saved until the person taps Join.
import { shallowRef } from 'vue'
import { loadRelayConfig, saveRelayConfig } from './config.js'

export const pendingRelay = shallowRef(null)

function sameKey(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

// -> true when the link is offered (not already joined).
export function offerRelayJoin(candidate, opts) {
  const current = loadRelayConfig(opts)
  if (current && current.url === candidate.url && sameKey(current.key, candidate.key)) return false
  pendingRelay.value = { url: candidate.url, key: candidate.key, replaces: !!current }
  return true
}

export function confirmRelayJoin(opts) {
  const offer = pendingRelay.value
  if (!offer) return
  saveRelayConfig({ url: offer.url, key: offer.key }, opts)
  pendingRelay.value = null
  globalThis.location?.reload()
}

export function dismissRelayJoin() {
  pendingRelay.value = null
}
