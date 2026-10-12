// Shared friendly-timestamp formatter. Timestamps are stored as
// naive "YYYY-MM-DD HH:MM:SS" UTC strings (notifications and
// announcements created_at, etc.) -- parse them as UTC
// (as CommunicationPage's daysAgo() does), then render relative for
// recent times and a short date for older ones, so a raw machine string
// never reaches the screen.
function parseServerDate(value) {
  if (!value) return null
  const iso = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + 'Z')
  return Number.isNaN(iso.getTime()) ? null : iso
}

export function formatTimestamp(value, { now = new Date() } = {}) {
  const date = parseServerDate(value)
  if (!date) return ''

  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.round(diffMs / 60000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24 && isSameDay(date, now)) return `${diffHr}h ago`

  if (isSameDay(date, now)) {
    return `Today at ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(date, yesterday)) {
    return `Yesterday at ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  }

  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  })
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
