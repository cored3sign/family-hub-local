// Checks GitHub's public releases page for a newer Yggltree. This is the one thing the desktop app
// sends to anyone: a plain request to api.github.com, which sees the computer's IP address and
// nothing else. The family can turn the daily check off in the menu.

export const RELEASES_URL = 'https://api.github.com/repos/cored3sign/yggltree/releases/latest'
export const DOWNLOAD_PAGE = 'https://github.com/cored3sign/yggltree/releases/latest'
export const DAY_MS = 24 * 60 * 60 * 1000

// 1 when a is newer than b, -1 when older, 0 when the same. Compares dotted numbers only.
export function compareVersions(a, b) {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

function parts(v) {
  return String(v ?? '')
    .replace(/^v/, '')
    .split('.')
    .map((p) => Number.parseInt(p, 10))
    .map((n) => (Number.isFinite(n) ? n : 0))
}

// The version and page of a release, from GitHub's answer. Null when the answer isn't a release.
export function parseLatestRelease(body) {
  if (!body || typeof body.tag_name !== 'string') return null
  const version = body.tag_name.replace(/^v/, '')
  if (!/^\d+(\.\d+)*$/.test(version)) return null
  return { version, url: typeof body.html_url === 'string' ? body.html_url : DOWNLOAD_PAGE }
}

// The newer release, or null when this app is up to date or the check can't tell.
export async function checkForUpdate({ currentVersion, fetchImpl = globalThis.fetch }) {
  let res
  try {
    res = await fetchImpl(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) })
  } catch {
    return null
  }
  if (!res.ok) return null
  const release = parseLatestRelease(await res.json().catch(() => null))
  if (!release || compareVersions(release.version, currentVersion) <= 0) return null
  return release
}

// Whether a daily check is due: never checked, or the last check is a day old or more.
export function dailyCheckDue({ enabled, lastCheckedAt, now = Date.now() }) {
  if (!enabled) return false
  return !lastCheckedAt || now - lastCheckedAt >= DAY_MS
}
