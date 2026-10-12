import { describe, it, expect, afterEach, vi } from 'vitest'
import { newId } from './ids'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newId', () => {
  const originalCrypto = globalThis.crypto

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
  })

  it('uses the native path when crypto.randomUUID is available', () => {
    const spy = vi.fn(() => '11111111-1111-4111-8111-111111111111')
    Object.defineProperty(globalThis, 'crypto', {
      value: { ...originalCrypto, randomUUID: spy },
      configurable: true,
    })
    expect(newId()).toBe('11111111-1111-4111-8111-111111111111')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('falls back to a v4 UUID built from getRandomValues when randomUUID is unavailable', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: (arr) => originalCrypto.getRandomValues(arr) },
      configurable: true,
    })
    expect(newId()).toMatch(UUID_V4_RE)
  })

  it('generates 1000 unique ids via the fallback path', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: (arr) => originalCrypto.getRandomValues(arr) },
      configurable: true,
    })
    const ids = new Set()
    for (let i = 0; i < 1000; i++) {
      const id = newId()
      expect(id).toMatch(UUID_V4_RE)
      ids.add(id)
    }
    expect(ids.size).toBe(1000)
  })
})
