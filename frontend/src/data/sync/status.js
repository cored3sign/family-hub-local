// The five sync states. Pure.
//
// Precedence: a revoked/room-gone/protocol problem beats offline; offline beats
// everything else. "connected" means the MAIN doc's provider is synced --
// never just "the socket is open" (the hub accepts the upgrade and only
// then may close with 4401). The assets doc is not part of it.

export const CONNECTING_GRACE_MS = 4000

export const STATUS_COPY = {
  'needs-pairing': {
    label: 'Not syncing',
    tone: 'red',
    message: "This device isn't connected to your family. Scan the family's QR code to join.",
  },
  offline: { label: 'Offline', tone: 'orange', message: 'You are offline. Changes are saved on this device.' },
  connected: { label: 'Synced', tone: 'green', message: 'Connected to your Yggltree.' },
  connecting: { label: 'Connecting…', tone: 'gray', message: '' },
  waiting: {
    label: 'Waiting for hub',
    tone: 'yellow',
    message: 'Changes are saved on this device and will sync when your Yggltree is reachable.',
  },
}

// needs-pairing messages that depend on why (the problem kind).
export const PROBLEM_COPY = {
  protocol: "This device can't talk to your Yggltree. Update Yggltree on the family computer, then reload this page.",
}

const HUB_MACHINE_WAITING = "Yggltree isn't running on this computer. Start it with npm start."
// The hub answers but this browser has no live connection to it (it kept
// its own family instead of uploading it, e.g. a canceled adopt).
export const HUB_MACHINE_NOT_UPLOADED = "This computer's family isn't on the hub yet. Reload to upload it."
// The hub machine was told its room is gone (4404 / 4410: a restore or a
// reset hub) or its token is no longer valid: a reload picks up the hub's
// current room. Nothing needs pairing on the family computer itself.
export const HUB_MACHINE_ROOM_GONE = 'Your Yggltree was restored or reset. Reload this page.'

// connectingSinceMs: when the current unsynced period began (boot, a lost
// connection, or a fresh attempt such as a token refresh) -- the
// connection's snapshot().attemptStartedAt. null counts as "just started".
export function deriveSyncStatus({ hasConfig, problem, online, mainSynced, connectingSinceMs, nowMs, role }) {
  if (problem && (problem.kind === 'revoked' || problem.kind === 'room-gone' || problem.kind === 'protocol')) return 'needs-pairing'
  if (online === false) return 'offline'
  if (!hasConfig && role !== 'hub-machine') return 'needs-pairing'
  if (mainSynced) return 'connected'
  if (connectingSinceMs == null || nowMs - connectingSinceMs < CONNECTING_GRACE_MS) return 'connecting'
  return 'waiting'
}

// STATUS_COPY[state], with the hub machine's own "waiting" and
// "needs-pairing" messages and the protocol (4400) needs-pairing message.
// hubRunning / hasConnection: the hub machine's "waiting" is "this
// computer's family isn't on the hub yet" when the hub answers but this
// browser has no live connection to it; otherwise (the hub doesn't answer,
// or a live connection can't sync) "the hub isn't running".
export function statusCopy(state, { role, problem, hubRunning = false, hasConnection = true } = {}) {
  const copy = STATUS_COPY[state]
  if (state === 'needs-pairing' && PROBLEM_COPY[problem?.kind]) return { ...copy, message: PROBLEM_COPY[problem.kind] }
  if (state === 'needs-pairing' && role === 'hub-machine' && (problem?.kind === 'room-gone' || problem?.kind === 'revoked')) {
    return { ...copy, message: HUB_MACHINE_ROOM_GONE }
  }
  if (state === 'waiting' && role === 'hub-machine' && hubRunning && !hasConnection) return { ...copy, message: HUB_MACHINE_NOT_UPLOADED }
  if (state === 'waiting' && role === 'hub-machine') return { ...copy, message: HUB_MACHINE_WAITING }
  return copy
}
