// Links the app hands to the family's browser or mail app. Only secure web links and mail links go out;
// anything else (file:, app-specific schemes, plain http) stays where it is.
const OPENABLE_PROTOCOLS = new Set(['https:', 'mailto:'])

export function externalLinkOf(url) {
  try {
    const parsed = new URL(url)
    return OPENABLE_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null
  } catch {
    return null
  }
}
