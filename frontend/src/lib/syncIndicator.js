// Pure helpers for the header sync indicator and the Help page's Sync card.
// The state and its copy come from data/sync/status.js; "Synced" only ever
// comes from the main doc's synced flag.
import { formatTimestamp } from './formatDate'

// lucide-vue-next icon names, one per state.
export const SYNC_ICON = {
  connected: 'Cloud',
  waiting: 'CloudOff',
  offline: 'WifiOff',
  connecting: 'Loader',
  'needs-pairing': 'AlertTriangle',
}

export function lastSyncedText(lastSyncedAt, now = new Date()) {
  return formatTimestamp(lastSyncedAt, { now }) || 'Not yet'
}

// The full sentence for the indicator's title / live region.
export function syncMessage({ status, statusCopy, lastSyncedAt }, now = new Date()) {
  if (status === 'connecting') return 'Connecting to your family hub…'
  const message = statusCopy?.message ?? ''
  if (status === 'connected' && lastSyncedAt) return `${message} Last synced: ${lastSyncedText(lastSyncedAt, now)}.`
  return message
}
