// Naive-UTC "YYYY-MM-DD HH:MM:SS" stamps -- the shape every consumer
// (lib/formatDate.js parseServerDate, string comparisons in pages) expects.
export function nowStamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export function stampMinutesAgo(minutes, now = new Date()) {
  return nowStamp(new Date(now.getTime() - minutes * 60000))
}
