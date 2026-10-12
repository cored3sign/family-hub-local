// Asks the family computer whether this page is the newest build. The
// update prompt calls this before it reloads: a reload off the home network
// can never finish, so the prompt checks first and says so instead.
//
// -> 'current' (this page is the newest build) | 'stale' (a newer build is
//    there) | 'unreachable' (no answer in time, or a bad answer).
export async function checkBuild({ fetchImpl = globalThis.fetch, buildVersion, timeoutMs = 4000, now = () => Date.now() } = {}) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
  })
  try {
    const res = await Promise.race([fetchImpl(`/version.json?_=${now()}`, { cache: 'no-store' }), timeout])
    if (!res.ok) return 'unreachable'
    const data = await res.json()
    if (typeof data?.version !== 'string') return 'unreachable'
    return data.version === buildVersion ? 'current' : 'stale'
  } catch {
    return 'unreachable'
  } finally {
    clearTimeout(timer)
  }
}
