// Applies the member's theme as a data-theme attribute on <html>, matching the
// [data-theme="..."] blocks in style.css. Each member picks their own theme
// (members.theme_preference), and it follows them to every device they sign in
// on. A member who hasn't picked one sees the default, coral.
export const THEMES = ['coral', 'bold', 'garden', 'garage', 'fruit', 'breeze', 'carnival', 'meadow']
export const DEFAULT_THEME = 'coral'

// The theme a member sees: their own pick when it is a real theme, else the default.
export function effectiveTheme(memberPick) {
  return THEMES.includes(memberPick) ? memberPick : DEFAULT_THEME
}

// 'coral' (and any unrecognized value, e.g. a retired "blue"
// placeholder) means "no data-theme attribute" -- style.css's unscoped
// :root already IS the coral palette, so coral isn't a [data-theme="coral"]
// block of its own.
export function applyTheme(theme) {
  const root = document.documentElement
  if (theme && theme !== DEFAULT_THEME && THEMES.includes(theme)) {
    root.setAttribute('data-theme', theme)
  } else {
    root.removeAttribute('data-theme')
  }
}
