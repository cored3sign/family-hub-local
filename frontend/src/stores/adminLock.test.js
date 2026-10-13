import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as Y from 'yjs'
import { memoryStorage, newFamilyDoc } from '../data/testing'
import { setFamilyForTests } from '../data/family'
import { setAdminPin } from '../data/members'
import { useAdminLockStore, UNLOCK_MS } from './adminLock'

let doc
let admin
let kid

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.stubGlobal('localStorage', memoryStorage())
  ;({ doc, admin, kid } = newFamilyDoc())
  setFamilyForTests({ doc, assets: new Y.Doc() })
  await setAdminPin(doc, admin.id, '482913')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('confirming an admin PIN', () => {
  it('resolves with the admin id once the right PIN is entered', async () => {
    const lock = useAdminLockStore()
    const asked = lock.confirmMember(admin.id, 'Open the admin profile.')
    expect(lock.prompt.memberId).toBe(admin.id)
    await lock.submit('482913')
    expect(await asked).toBe(admin.id)
    expect(lock.prompt).toBe(null)
  })

  it('stays open with an error on a wrong PIN', async () => {
    const lock = useAdminLockStore()
    const asked = lock.confirmMember(admin.id, 'Open the admin profile.')
    await lock.submit('000000')
    expect(lock.prompt.error).toBe('That PIN is wrong.')
    lock.cancel()
    expect(await asked).toBe(null)
  })

  it('locks for 30 seconds after five wrong PINs', async () => {
    const lock = useAdminLockStore()
    const asked = lock.confirmMember(admin.id, 'Open the admin profile.')
    for (let i = 0; i < 5; i++) await lock.submit('000000')
    expect(lock.prompt.error).toMatch(/Wait 30 seconds/)
    await lock.submit('482913')
    expect(lock.prompt.error).toMatch(/Too many wrong PINs/)
    lock.cancel()
    await asked
  })

  it('refuses an admin who has no PIN yet, and says so', async () => {
    const lock = useAdminLockStore()
    const asked = lock.confirmMember(kid.id, 'Open the profile.')
    await lock.submit('482913')
    expect(lock.prompt.error).toMatch(/has no PIN yet/)
    lock.cancel()
    await asked
  })
})

describe('the unlock window for sensitive changes', () => {
  it('stays unlocked for five minutes after a right PIN, then asks again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
    const lock = useAdminLockStore()

    const first = lock.confirmAdmin(admin.id, 'Export the data.')
    await lock.submit('482913')
    expect(await first).toBe(true)

    expect(await lock.confirmAdmin(admin.id, 'Export again.')).toBe(true)
    expect(lock.prompt).toBe(null)

    vi.setSystemTime(new Date(Date.now() + UNLOCK_MS + 1000))
    const again = lock.confirmAdmin(admin.id, 'Export after a while.')
    expect(lock.prompt).not.toBe(null)
    lock.cancel()
    expect(await again).toBe(false)
  })

  it('a cancelled prompt does not unlock anything', async () => {
    const lock = useAdminLockStore()
    const asked = lock.confirmAdmin(admin.id, 'Export the data.')
    lock.cancel()
    expect(await asked).toBe(false)
    expect(lock.unlockedUntil).toBe(0)
  })
})
