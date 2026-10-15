import { requireAdmin } from './members'
import { requireText } from './collection'

const S = 'settings'
export const WEEK_START_DAYS = ['sunday', 'monday']

// Returns the config shape that pages read via core.config.*.
export function getSettings(doc) {
  const s = doc.getMap(S)
  return {
    family_name: s.get('family_name') ?? '',
    week_start_day: s.get('week_start_day') ?? 'sunday',
    timezone: s.get('timezone') ?? 'UTC',
    theme: { color_theme: s.get('color_theme') ?? 'coral' },
  }
}

export function saveSettings(doc, actor, { family_name, week_start_day }) {
  requireAdmin(doc, actor)
  const name = requireText(family_name, 'family_name is required')
  if (!WEEK_START_DAYS.includes(week_start_day)) throw new Error('week_start_day must be sunday or monday')
  doc.transact(() => {
    doc.getMap(S).set('family_name', name)
    doc.getMap(S).set('week_start_day', week_start_day)
  })
}

export function seedSettings(doc, { familyName }) {
  const s = doc.getMap(S)
  s.set('family_name', familyName)
  s.set('week_start_day', 'sunday')
  s.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  s.set('color_theme', 'coral')
}
