// Which family member is using THIS device. Device-local on purpose (never
// in the shared doc): each phone/iPad picks its own profile, like Netflix
// profiles. Not a security boundary (the room token is).
const KEY = 'fh.memberId'

export function currentMemberId() {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setCurrentMemberId(id) {
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch {
    // Storage blocked (private mode): the profile picker just reappears next load.
  }
}
