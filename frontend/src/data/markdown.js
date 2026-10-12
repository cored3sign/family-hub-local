// Frontmatter helpers for the Binder's Markdown import, run on-device.

export function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw }
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { frontmatter: {}, body: raw }
  const frontmatter = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '' || !line.includes(':')) continue
    const idx = line.indexOf(':')
    const key = line.slice(0, idx).trim()
    if (key === '') continue
    let value = line.slice(idx + 1).trim().replace(/<!--.*?-->/g, '').trim()
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1)
      frontmatter[key] = inner === '' ? [] : inner.split(',').map((s) => s.trim())
    } else {
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
      frontmatter[key] = value
    }
  }
  return { frontmatter, body: raw.slice(match[0].length).replace(/^\n+/, '') }
}

export function stripHintFields(frontmatter) {
  return Object.fromEntries(Object.entries(frontmatter).filter(([key]) => !/_hint$/i.test(key)))
}

export function derivePostTitle(frontmatter, filename) {
  for (const key of ['title', 'value', 'name']) {
    if (typeof frontmatter[key] === 'string' && frontmatter[key] !== '') return frontmatter[key]
  }
  if (frontmatter.type === 'family_resolutions' && frontmatter.year) return `${frontmatter.year} Resolutions`
  const base = filename.split('/').pop()
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

export function resolveImportSection(frontmatter) {
  const type = frontmatter.type
  if (['family_value', 'family_resolutions', 'family_rules'].includes(type)) return { section: 'Family Culture', is_wellbeing: false }
  if (type === 'wellbeing_resource') return { section: 'Wellbeing', is_wellbeing: true }
  return { section: 'Imported', is_wellbeing: false }
}
