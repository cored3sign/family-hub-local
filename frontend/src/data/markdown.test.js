import { describe, it, expect } from 'vitest'
import { parseFrontmatter, stripHintFields, derivePostTitle, resolveImportSection } from './markdown'

describe('markdown frontmatter', () => {
  it('parses scalars, quoted values, lists and strips HTML comments', () => {
    const raw = '---\ntype: family_value\ntitle: "Be kind"\ntags: [a, b]\nempty: []\nnote: hi <!-- hint -->\n---\n\nBody text\n'
    const { frontmatter, body } = parseFrontmatter(raw)
    expect(frontmatter).toEqual({ type: 'family_value', title: 'Be kind', tags: ['a', 'b'], empty: [], note: 'hi' })
    expect(body).toBe('Body text\n')
  })

  it('treats missing or malformed frontmatter as body', () => {
    expect(parseFrontmatter('# Hi')).toEqual({ frontmatter: {}, body: '# Hi' })
    expect(parseFrontmatter('---\nno close')).toEqual({ frontmatter: {}, body: '---\nno close' })
  })

  it('titles, hint stripping and section routing', () => {
    expect(stripHintFields({ a: 1, value_hint: 'x', Other_HINT: 'y' })).toEqual({ a: 1 })
    expect(derivePostTitle({ value: 'Honesty' }, 'x.md')).toBe('Honesty')
    expect(derivePostTitle({ type: 'family_resolutions', year: '2026' }, 'x.md')).toBe('2026 Resolutions')
    expect(derivePostTitle({}, 'notes/Bedtime.md')).toBe('Bedtime')
    expect(resolveImportSection({ type: 'family_rules' })).toEqual({ section: 'Family Culture', is_wellbeing: false })
    expect(resolveImportSection({ type: 'wellbeing_resource' })).toEqual({ section: 'Wellbeing', is_wellbeing: true })
    expect(resolveImportSection({})).toEqual({ section: 'Imported', is_wellbeing: false })
  })
})
