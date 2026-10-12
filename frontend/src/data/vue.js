import { computed, getCurrentScope, onScopeDispose, shallowRef } from 'vue'
import { family } from './family'
import { currentMemberId } from './session'
import { actorFor } from './members'

// A computed over the Yjs doc: re-evaluates after every transaction (local
// edits and remote sync) and whenever a Vue ref read inside
// `select` changes (filters, selected section, etc.).
export function useLive(select, doc = family().doc) {
  const version = shallowRef(0)
  const bump = () => {
    version.value++
  }
  doc.on('afterTransaction', bump)
  if (getCurrentScope()) onScopeDispose(() => doc.off('afterTransaction', bump))
  return computed(() => {
    version.value
    return select(doc)
  })
}

export function useFamily() {
  const { doc, assets } = family()
  return { doc, assets, actor: () => actorFor(doc, currentMemberId()) }
}
