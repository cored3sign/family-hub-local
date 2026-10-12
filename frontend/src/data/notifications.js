import { all, insert, patch, removeWhere } from './collection'
import { nowStamp } from './time'

const T = 'notifications'
const LIST_LIMIT = 50

// The ACTING device writes the record, the recipient's device shows it once
// synced (in-app only, no push). The "don't notify yourself" guard lives
// here once instead of at every call site.
export function notify(doc, actor, { recipientId, type, message, relatedId = null }) {
  if (!recipientId || recipientId === actor?.id) return null
  return insert(doc, T, { recipient_member_id: recipientId, type, message, related_id: relatedId, read_at: null })
}

export function listNotifications(doc, memberId) {
  return all(doc, T)
    .filter((n) => n.recipient_member_id === memberId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, LIST_LIMIT)
}

export function markNotificationsRead(doc, memberId, id = null) {
  const stamp = nowStamp()
  doc.transact(() => {
    for (const n of all(doc, T)) {
      if (n.recipient_member_id === memberId && !n.read_at && (id === null || n.id === id)) patch(doc, T, n.id, { read_at: stamp })
    }
  })
}

export function clearNotifications(doc, memberId, id = null) {
  removeWhere(doc, T, (n) => n.recipient_member_id === memberId && n.read_at && (id === null || n.id === id))
}
