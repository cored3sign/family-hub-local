import { requireAdmin } from './members'
import { requireText } from './collection'

const S = 'settings'
// Its own Y.Map (key -> true) rather than an array value, so two devices
// enabling different modules at once both win.
const MODULES = 'modules_enabled'
export const WEEK_START_DAYS = ['sunday', 'monday']

// Returns the config shape that pages read via core.config.*.
export function getSettings(doc) {
  const s = doc.getMap(S)
  const modules = doc.getMap(MODULES)
  return {
    family_name: s.get('family_name') ?? '',
    week_start_day: s.get('week_start_day') ?? 'sunday',
    timezone: s.get('timezone') ?? 'UTC',
    theme: { color_theme: s.get('color_theme') ?? 'coral' },
    modules_enabled: [...modules.entries()].filter(([, on]) => on).map(([key]) => key).sort(),
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

export function enableModule(doc, actor, key) {
  requireAdmin(doc, actor)
  doc.getMap(MODULES).set(key, true)
}

export function seedSettings(doc, { familyName, modules }) {
  const s = doc.getMap(S)
  s.set('family_name', familyName)
  s.set('week_start_day', 'sunday')
  s.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  s.set('color_theme', 'coral')
  for (const key of modules) doc.getMap(MODULES).set(key, true)
}
