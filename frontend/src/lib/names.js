// Display-layer only: the stored member name is the full name (see
// members.name) -- this trims to first-name-only wherever a member's name
// renders in the UI.
export function firstName(fullName) {
  if (!fullName) return fullName
  return fullName.trim().split(/\s+/)[0] || fullName
}
