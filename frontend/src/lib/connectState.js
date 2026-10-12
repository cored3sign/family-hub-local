// Which screen /connect shows. Pure; ConnectPage feeds it the sync store.
//
// -> 'confirm-replace' | 'confirm-adopt' | 'replace-failed' | 'needs-pairing'
//    | 'hub-not-running' | 'install-first' | 'not-paired' | 'hub-empty' | 'connecting'
//
// hub-empty: the main doc is synced with the hub and there is still no
// family, so the hub's room really is empty.
// replace-failed: a confirm-replace's wipe failed part-way; no Cancel.
// install-first: an iPhone Safari tab with no family yet. The family is joined
// from the Home Screen app, so this screen puts the app there first (pass
// installFirst only for an iPhone Safari tab; see IosInstallGuide.vue).
// not-paired: a device with no family yet. A phone joins by scanning the
// family's QR code (data/relay), or by reading the copied family link.
export function connectState({ pendingReplace, replaceStuck, problem, role, hubInfo, config, status, installFirst = false }) {
  if (pendingReplace && replaceStuck) return 'replace-failed'
  if (pendingReplace) return pendingReplace.adopt ? 'confirm-adopt' : 'confirm-replace'
  // On the family computer itself nothing else matters until the hub runs.
  if (role === 'hub-machine' && !hubInfo) return 'hub-not-running'
  if (problem) return 'needs-pairing'
  if (!config && role !== 'hub-machine') return installFirst ? 'install-first' : 'not-paired'
  if (status === 'connected') return 'hub-empty'
  return 'connecting'
}
