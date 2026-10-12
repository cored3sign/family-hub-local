import { describe, it, expect } from 'vitest'
import { effectScope, ref } from 'vue'
import * as Y from 'yjs'
import { useLive } from './vue'
import { insert, all } from './collection'

describe('useLive', () => {
  it('re-evaluates after doc transactions and when Vue refs it reads change', () => {
    const doc = new Y.Doc()
    const filter = ref('a')
    const scope = effectScope()
    const live = scope.run(() => useLive((d) => all(d, 'things').filter((t) => t.kind === filter.value).length, doc))
    expect(live.value).toBe(0)
    insert(doc, 'things', { kind: 'a' })
    expect(live.value).toBe(1)
    filter.value = 'b'
    expect(live.value).toBe(0)
    scope.stop()
    insert(doc, 'things', { kind: 'b' })
    // After the scope stops the listener is gone; no throw, no leak.
    expect(doc._observers.get('afterTransaction')?.size ?? 0).toBe(0)
  })
})
