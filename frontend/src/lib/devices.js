// Pure helpers for the family computer's own hub messages.
import { HubApiError } from '../data/sync/hubApi.js'

export function hubErrorMessage(err) {
  if (err instanceof HubApiError) return `Yggltree couldn't do that (error ${err.status}).`
  return "Couldn't reach Yggltree on this computer. Make sure it's running, then try again."
}
