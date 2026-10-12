// The router guard's decision, pure.
//
// state: { familyReady, memberId, enabledModules, canSetUp, pendingReplace }
//   memberId is core's RESOLVED member (getMember on the current doc), so a
//   stale fh.memberId from a replaced family is already null here.
//
// A device with no family yet goes to /connect, never /setup: a freshly
// paired phone has no family until sync step 2 lands, and
// only the hub machine with an empty hub may set up.
export function decideRoute(s, to) {
  if (s.pendingReplace) return to.name === 'connect' ? true : { name: 'connect' }
  if (!s.familyReady) {
    const target = s.canSetUp ? 'setup' : 'connect'
    return to.name === target ? true : { name: target }
  }
  if (to.name === 'setup' || to.name === 'connect') return { path: '/' }
  if (!s.memberId) return to.name === 'profiles' ? true : { name: 'profiles' }
  const key = to.meta?.moduleKey
  if (key && !s.enabledModules.includes(key)) return { path: '/' }
  return true
}
