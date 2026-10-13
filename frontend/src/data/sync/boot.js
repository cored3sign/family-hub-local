// Startup sync decisions, run once before mount (after initFamily).
//
// Editing is never blocked: the only network awaited here is
//   - GET /api/hub/info on a loopback hostname, capped at hubInfoTimeoutMs.
// The websocket connection itself is never awaited.
//
// -> { role, config, hubInfo, pendingReplace, connection }
//   role: 'hub-machine' on a loopback hostname (the hub's own computer --
//         even when the hub isn't running), else 'device' with a config
//         (a phone that joined through the family relay), else 'unpaired'.
//   pendingReplace: null | { adopt, incoming: {roomId, token, familyExists},
//         hubUrl, role } -- the caller asks the user, then calls
//         applyPairing({ plan: adopt ? 'adopt' : 'confirm-replace', ... })
//         (adopt only after POST /api/hub/claim succeeds) and reloads.
// The returned object is live: after a hub-machine token refresh its
// `config` is replaced (and `connection` keeps the same object).
import { hasFamily } from '../backupFormat.js'
import { CLOSE, isValidRoomId, isValidToken } from './protocol.js'
import { loadHubConfig, setProblem } from './config.js'
import { planPairing, applyPairing } from './pairing.js'
import { connectFamily } from './connection.js'
import { createHubApi } from './hubApi.js'
import { loadRelayConfig, relayDeviceId, relayStatusConfig } from '../relay/config.js'
import { connectRelay } from '../relay/connection.js'
import { openOutbox } from '../relay/outbox.js'
import { combineConnections } from './combine.js'
import { startPresence, thisDeviceLabel } from '../presence.js'
import { currentMemberId } from '../session.js'

export const HUB_INFO_TIMEOUT_MS = 1500

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTNAMES.has(String(hostname ?? '').toLowerCase())
}

export async function bootSync({
  fam,
  location = globalThis.location,
  storage,
  fetchImpl,
  hubInfoTimeoutMs = HUB_INFO_TIMEOUT_MS,
  connect = connectFamily,
  connectOptions = {},
}) {
  const opts = { storage }
  // The family relay (data/relay): phones sync through it, and a family
  // computer that set one up uses it next to its own hub.
  const relay = loadRelayConfig(opts)
  const hubUrl = location.origin
  const loopback = isLoopbackHostname(location.hostname)
  const api = createHubApi({ baseUrl: hubUrl, fetchImpl })
  const hasLocalFamily = hasFamily(fam.doc)

  const result = { role: 'unpaired', config: loadHubConfig(opts), hubInfo: null, pendingReplace: null, connection: null }

  // Plans the incoming room; applies it, or leaves it pending for the user.
  async function take(incoming, role) {
    const plan = planPairing({ config: result.config, hasLocalFamily, incoming })
    if (plan === 'confirm-replace') {
      const adopt = role === 'hub-machine' && !incoming.familyExists && hasLocalFamily
      result.pendingReplace = { adopt, incoming, hubUrl, role }
      return
    }
    try {
      result.config = await applyPairing({ plan, incoming, hubUrl, role, storage })
    } catch {
      // Storage blocked: keep whatever config was stored. Boot must not fail.
    }
  }

  if (loopback) {
    result.hubInfo = await probeInfo(api, hubInfoTimeoutMs)
  }
  if (result.hubInfo) {
    const { roomId, token, familyExists } = result.hubInfo
    await take({ roomId, token, familyExists }, 'hub-machine')
  }

  if (result.hubInfo || loopback) result.role = 'hub-machine'
  else if (result.pendingReplace) result.role = result.pendingReplace.role
  else if (result.config) result.role = result.config.role
  else result.role = 'unpaired'

  // Hub machine + 4401: this browser's copy of the hub's token is out of
  // date. Fetch the current one and reconnect; only if that fails is this
  // browser really locked out.
  // Any failure (probe, storage) falls back to "revoked" so the status
  // never sits at "Waiting for hub" with both providers disconnected.
  async function onTerminalClose(code) {
    const config = result.config
    if (config.role !== 'hub-machine' || code !== CLOSE.BAD_TOKEN) return
    let kind = 'revoked'
    try {
      const info = await probeInfo(api, hubInfoTimeoutMs)
      if (result.connection.destroyed) return
      if (info && info.roomId === config.roomId && info.token !== config.token) {
        result.config = await applyPairing({ plan: 'update-token', incoming: info, hubUrl: config.hubUrl, role: 'hub-machine', storage })
        result.connection.reconnect(result.config.token)
        return
      }
      if (info && info.roomId !== config.roomId) kind = 'room-gone'
    } catch {
      // fall through to the problem flag
    }
    if (!result.connection.destroyed) setProblem({ kind, roomId: config.roomId }, opts)
  }

  if (result.config && !result.pendingReplace) {
    result.connection = connect(fam, result.config, { ...connectOptions, storage, onTerminalClose })
  }

  if (relay) {
    const relayConnection = connectRelay({ fam, relayConfig: relay, storage, src: relayDeviceId(opts), outbox: openOutbox() })
    result.connection = result.connection ? combineConnections([result.connection, relayConnection]) : relayConnection
    if (!result.config) result.config = relayStatusConfig(relay)
    if (result.role === 'unpaired') result.role = 'device'
  }

  // This device's entry in the family's device list (Settings → Devices). Same id the
  // relay uses for this device, so Settings can mark it as "This device".
  startPresence(fam.doc, { id: relayDeviceId(opts), label: thisDeviceLabel(), memberId: () => currentMemberId() })

  return result
}

// The loopback /api/hub/info probe: the info when the hub answers with a
// valid room, else null. Never throws.
export async function probeHubInfo(api, timeoutMs = HUB_INFO_TIMEOUT_MS) {
  return probeInfo(api, timeoutMs)
}

async function probeInfo(api, timeoutMs) {
  try {
    const info = await api.info({ timeoutMs })
    return isValidRoomId(info?.roomId) && isValidToken(info?.token) ? info : null
  } catch {
    return null
  }
}
