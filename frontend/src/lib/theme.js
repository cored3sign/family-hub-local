// Applies the family's color_theme as a data-theme attribute on
// <html>, matching the [data-theme="..."] blocks in style.css. This is a
// family-wide setting stored on the local doc (settings.theme.color_theme,
// see data/settings.js), not a per-device preference, so it's applied from
// the doc's settings every time core's store refreshes rather than read
// from localStorage.
export const COLOR_THEMES = ['coral', 'bold', 'garden', 'garage', 'fruit', 'breeze', 'carnival', 'meadow']

// 'coral' (and any unrecognized value, e.g. a retired "blue"
// placeholder) means "no data-theme attribute" -- style.css's unscoped
// :root already IS the coral palette, so coral isn't a [data-theme="coral"]
// block of its own.
export function applyColorTheme(colorTheme) {
  const root = document.documentElement
  if (colorTheme && colorTheme !== 'coral' && COLOR_THEMES.includes(colorTheme)) {
    root.setAttribute('data-theme', colorTheme)
  } else {
    root.removeAttribute('data-theme')
  }
}
