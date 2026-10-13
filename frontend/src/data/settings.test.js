import { describe, it, expect } from 'vitest'
import { newFamilyDoc, forkDoc, syncDocs } from './testing'
import { getSettings, saveSettings, enableModule } from './settings'

describe('settings', () => {
  it('saves family settings (admin only, validated)', () => {
    const { doc, admin, kid } = newFamilyDoc()
    saveSettings(doc, admin, { family_name: 'The Riveras', week_start_day: 'monday' })
    expect(getSettings(doc)).toMatchObject({ family_name: 'The Riveras', week_start_day: 'monday' })
    expect(() => saveSettings(doc, admin, { family_name: 'x', week_start_day: 'friday' })).toThrow('week_start_day must be sunday or monday')
    expect(() => saveSettings(doc, kid, { family_name: 'x', week_start_day: 'sunday' })).toThrow('Only an admin can do that')
  })

  it('a new family starts on the coral theme', () => {
    const { doc } = newFamilyDoc()
    expect(getSettings(doc).theme.color_theme).toBe('coral')
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
