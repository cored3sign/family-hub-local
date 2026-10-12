// Reveal-on-scroll. Sections are visible without this script; it only adds the
// fade-in state, and it turns animation off for people who prefer reduced motion.
document.documentElement.classList.add('js')

const items = document.querySelectorAll('.reveal')
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

if (reduceMotion || !('IntersectionObserver' in window)) {
  items.forEach((el) => el.classList.add('is-in'))
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  )
  items.forEach((el) => observer.observe(el))
}

// Tool panels: each tool row opens its own <template> in the shared dialog.
const toolDialog = document.getElementById('module-dialog')
if (toolDialog && typeof toolDialog.showModal === 'function') {
  let opener = null
  document.querySelectorAll('[data-module]').forEach((row) => {
    row.addEventListener('click', () => {
      const template = document.getElementById('module-' + row.dataset.module)
      if (!template) return
      opener = row
      toolDialog.querySelector('.module-dialog-art').replaceChildren(row.querySelector('svg.illus').cloneNode(true))
      toolDialog.querySelector('.module-dialog-title').textContent = row.querySelector('.ledger-name').textContent
      toolDialog.querySelector('.module-dialog-content').replaceChildren(template.content.cloneNode(true))
      toolDialog.showModal()
    })
  })
  toolDialog.addEventListener('click', (event) => {
    if (event.target === toolDialog) toolDialog.close()
  })
  toolDialog.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => toolDialog.close())
  })
  toolDialog.addEventListener('close', () => {
    if (opener) opener.focus()
    opener = null
  })
}

// Color themes: the eight colorways from the app's Settings. Each one sets the
// page's own tokens, so the text, buttons, dark band and illustrations follow.
const THEMES = {
  "coral": {
    "bg": "#faf3ec",
    "surface": "#ffffff",
    "surface-variant": "#f2e9df",
    "text": "#2b2622",
    "text-muted": "#726760",
    "border": "#e3d8cb",
    "border-strong": "#b5aca1",
    "accent": "#f4633a",
    "accent-deep": "#d6380c",
    "accent-soft": "#f89c82",
    "accent-container": "#fde3d8",
    "on-accent": "#ffffff",
    "complement": "#0ca9d6",
    "text-on-dark": "#d9d2cc",
    "line-on-dark": "#544f4a"
  },
  "bold": {
    "bg": "#f4f6fb",
    "surface": "#ffffff",
    "surface-variant": "#eef1f8",
    "text": "#1a2436",
    "text-muted": "#5b6579",
    "border": "#d8dde8",
    "border-strong": "#a8afbc",
    "accent": "#ff6347",
    "accent-deep": "#ce462c",
    "accent-soft": "#ff9a85",
    "accent-container": "#ffe066",
    "on-accent": "#ffffff",
    "complement": "#1e4ca1",
    "text-on-dark": "#d1d4db",
    "line-on-dark": "#464e5d"
  },
  "garden": {
    "bg": "#f4f0e3",
    "surface": "#fffdf7",
    "surface-variant": "#e3dac9",
    "text": "#33421f",
    "text-muted": "#566540",
    "border": "#cfc2a3",
    "border-strong": "#a8a282",
    "accent": "#556b2f",
    "accent-deep": "#3d4d20",
    "accent-soft": "#9ab073",
    "accent-container": "#e6b35a",
    "on-accent": "#ffffff",
    "complement": "#cc5959",
    "text-on-dark": "#d5d4c4",
    "line-on-dark": "#5a6546"
  },
  "garage": {
    "bg": "#f1f0ef",
    "surface": "#ffffff",
    "surface-variant": "#e3e2e1",
    "text": "#26282a",
    "text-muted": "#616465",
    "border": "#babcbc",
    "border-strong": "#959798",
    "accent": "#215f72",
    "accent-deep": "#17434f",
    "accent-soft": "#6c97a4",
    "accent-container": "#d8e6ea",
    "on-accent": "#ffffff",
    "complement": "#713d21",
    "text-on-dark": "#d1d0cf",
    "line-on-dark": "#4f5051"
  },
  "fruit": {
    "bg": "#f6f3e9",
    "surface": "#ffffff",
    "surface-variant": "#ece4cd",
    "text": "#262656",
    "text-muted": "#5b5b86",
    "border": "#d8ccab",
    "border-strong": "#aca296",
    "accent": "#e15335",
    "accent-deep": "#b53e24",
    "accent-soft": "#ec8a75",
    "accent-container": "#c6b98b",
    "on-accent": "#ffffff",
    "complement": "#97a868",
    "text-on-dark": "#d5d2d1",
    "line-on-dark": "#504f73"
  },
  "breeze": {
    "bg": "#eef5fa",
    "surface": "#ffffff",
    "surface-variant": "#dfebf3",
    "text": "#1a2f45",
    "text-muted": "#516a83",
    "border": "#c3d7e3",
    "border-strong": "#99adbc",
    "accent": "#1a5fa8",
    "accent-deep": "#123f70",
    "accent-soft": "#6699cc",
    "accent-container": "#ffe3ab",
    "on-accent": "#ffffff",
    "complement": "#2ba38a",
    "text-on-dark": "#ccd5dd",
    "line-on-dark": "#445769"
  },
  "carnival": {
    "bg": "#fdf2f6",
    "surface": "#ffffff",
    "surface-variant": "#fbe1ea",
    "text": "#3a2038",
    "text-muted": "#845a7c",
    "border": "#f0c4d6",
    "border-strong": "#c29bae",
    "accent": "#e0457a",
    "accent-deep": "#b8265a",
    "accent-soft": "#ee85ab",
    "accent-container": "#ffe6a3",
    "on-accent": "#ffffff",
    "complement": "#2196c9",
    "text-on-dark": "#ded0d8",
    "line-on-dark": "#614a5e"
  },
  "meadow": {
    "bg": "#f4f1e9",
    "surface": "#fffefb",
    "surface-variant": "#e7e0d0",
    "text": "#2e3b2e",
    "text-muted": "#5a675a",
    "border": "#d3c9b2",
    "border-strong": "#aaa691",
    "accent": "#3a7d43",
    "accent-deep": "#285a2f",
    "accent-soft": "#7eab84",
    "accent-container": "#d9e6da",
    "on-accent": "#ffffff",
    "complement": "#c15f76",
    "text-on-dark": "#d4d4cb",
    "line-on-dark": "#565f53"
  }
};

const THEME_STORE = 'family-hub-page-theme'
const themeTiles = document.querySelectorAll('.theme-tile')
const themeName = document.getElementById('theme-name')
let themeTimer = null

function showTheme(key, animate = true) {
  const tokens = THEMES[key]
  if (!tokens) return
  const root = document.documentElement
  if (animate && !reduceMotion) {
    root.classList.add('theme-changing')
    clearTimeout(themeTimer)
    themeTimer = setTimeout(() => root.classList.remove('theme-changing'), 600)
  }
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty('--' + name, value)
  }
  themeTiles.forEach((tile) => {
    const picked = tile.dataset.themeKey === key
    tile.setAttribute('aria-pressed', String(picked))
    if (picked && themeName) themeName.textContent = tile.querySelector('.theme-name').textContent
  })
}

// Remember the last choice on this device. Private windows can refuse storage, so the page still works without it.
function readStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORE)
  } catch {
    return null
  }
}

function storeTheme(key) {
  try {
    localStorage.setItem(THEME_STORE, key)
  } catch {
    // Not remembered; the page still changes theme.
  }
}

const savedTheme = readStoredTheme()
if (savedTheme && THEMES[savedTheme]) showTheme(savedTheme, false)

themeTiles.forEach((tile) => {
  tile.addEventListener('click', () => {
    showTheme(tile.dataset.themeKey)
    storeTheme(tile.dataset.themeKey)
  })
})

// Character scenes: each slot copies the tool's own illustration from the tool list,
// so the art lives in the page once and keeps following the theme colors.
document.querySelectorAll('[data-scene]').forEach((slot) => {
  const source = document.querySelector(`[data-module="${slot.dataset.scene}"] svg.illus`)
  if (source) slot.replaceChildren(source.cloneNode(true))
})
