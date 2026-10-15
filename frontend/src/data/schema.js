import { insert, blankToNull } from './collection'
import { nowStamp } from './time'
import { addMember } from './members'
import { seedSettings } from './settings'
import { hasFamily } from './backupFormat.js'

export const SCHEMA_VERSION = 1

// Every record collection in the main doc (for JSON export and docs).
export const COLLECTIONS = [
  'members', 'todos', 'events', 'shopping_items', 'chores', 'fund_transactions', 'budget_items',
  'notifications', 'announcements', 'announcement_reads', 'checkin_prompts', 'checkin_responses',
  'one_on_ones', 'goals', 'recipes', 'meal_library', 'wishlist_items', 'books', 'reading_progress',
  'loans', 'binder_sections', 'binder_posts', 'binder_post_images', 'birthdays',
]

// Deterministic ids: if two devices ever both seed, the writes land on the
// same keys and merge instead of duplicating.
export const DEFAULT_CHECKIN_PROMPTS = [
  { id: 'checkin-default-1', prompt_text: 'How was your day?', prompt_type: 'scale' },
  { id: 'checkin-default-2', prompt_text: "One word for how you're feeling", prompt_type: 'text' },
  { id: 'checkin-default-3', prompt_text: 'Pick an emoji for your mood today', prompt_type: 'emoji' },
]

// Delegates to backupFormat.js's hasFamily (same logic; kept there too since
// the hub server's restore validation needs it without this module's other
// imports, which pull in collection.js/members.js/settings.js).
export function isSetUp(doc) {
  return hasFamily(doc)
}

export function setUpFamily(doc, { familyName, adminName, modules = [] }) {
  const name = blankToNull(familyName)
  if (!name) throw new Error('Family name is required')
  if (!blankToNull(adminName)) throw new Error('Your name is required')
  let adminId
  doc.transact(() => {
    doc.getMap('meta').set('schema_version', SCHEMA_VERSION)
    doc.getMap('meta').set('created_at', nowStamp())
    seedSettings(doc, { familyName: name, modules })
    adminId = addMember(doc, { name: adminName, role: 'admin' })
    for (const p of DEFAULT_CHECKIN_PROMPTS) {
      insert(doc, 'checkin_prompts', { prompt_text: p.prompt_text, prompt_type: p.prompt_type, active: true }, p.id)
    }
  })
  return adminId
}
