import { describe, it, expect } from 'vitest'
import { newFamilyDoc, forkDoc, syncDocs } from './testing'
import { getSettings, saveSettings, saveTheme, enableModule } from './settings'

describe('settings', () => {
  it('saves family settings and theme (admin only, validated)', () => {
    const { doc, admin, kid } = newFamilyDoc()
    saveSettings(doc, admin, { family_name: 'The Riveras', week_start_day: 'monday' })
    saveTheme(doc, admin, 'garden')
    expect(getSettings(doc)).toMatchObject({ family_name: 'The Riveras', week_start_day: 'monday', theme: { color_theme: 'garden' } })
    expect(() => saveTheme(doc, admin, 'neon')).toThrow('Unknown color theme')
    expect(() => saveSettings(doc, admin, { family_name: 'x', week_start_day: 'friday' })).toThrow('week_start_day must be sunday or monday')
    expect(() => saveTheme(doc, kid, 'coral')).toThrow('Only an admin can do that')
  })

  it('modules enabled on two devices at once both survive', () => {
    const { doc: a, admin } = newFamilyDoc()
    const b = forkDoc(a)
    enableModule(a, admin, 'goals')
    enableModule(b, admin, 'library')
    syncDocs(a, b)
    expect(getSettings(a).modules_enabled).toEqual(expect.arrayContaining(['todos', 'shopping', 'goals', 'library']))
  })
})
