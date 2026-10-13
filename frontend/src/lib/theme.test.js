import { describe, it, expect } from 'vitest'
import { effectiveTheme, DEFAULT_THEME } from './theme.js'

describe('the theme a member sees', () => {
  it('is coral by default', () => {
    expect(DEFAULT_THEME).toBe('coral')
    expect(effectiveTheme(null)).toBe('coral')
    expect(effectiveTheme(undefined)).toBe('coral')
  })

  it("uses the member's own pick", () => {
    expect(effectiveTheme('garden')).toBe('garden')
  })

  it("ignores a pick that isn't a real theme", () => {
    expect(effectiveTheme('blue')).toBe('coral')
  })
})
