// Whether the family's relay serves the same Yggltree build as this app. Phones get the app from
// the relay, so an older relay means phones run an older app. Pure: the hub answers the question
// (GET /api/relay/version), and this only says what the answer means.

// 'current' when the relay serves this build, 'outdated' when it serves another, and 'unknown'
// when either side couldn't say (no network, or no build here).
export function relayVersionState({ upToDate, relayBuild, localBuild } = {}) {
  if (!relayBuild || !localBuild) return 'unknown'
  return upToDate ? 'current' : 'outdated'
}

// The relay's name, which is the first part of its address: https://<name>.<account>.workers.dev.
// The hub checks it again before anything runs.
export function relayNameOf(address) {
  const m = /^https:\/\/([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9]))\.[a-z0-9-]+\.workers\.dev$/.exec(String(address ?? '').replace(/\/$/, ''))
  return m ? m[1] : null
}
