// Pure helpers for the family computer's own hub messages.
import { HubApiError } from '../data/sync/hubApi.js'

export function hubErrorMessage(err) {
  if (err instanceof HubApiError) return `Family Hub couldn't do that (error ${err.status}).`
  return "Couldn't reach Family Hub on this computer. Make sure it's running, then try again."
}
