// Sync store, with every sync module stubbed (no network, no IndexedDB).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as Y from 'yjs'
import { memoryStorage } from '../data/testing'
import { setFamilyForTests } from '../data/family'
import { applyPairing as realApplyPairing } from '../data/sync/pairing.js'
import { loadHubConfig, setProblem } from '../data/sync/config.js'
import { HubApiError, createHubApi as realCreateHubApi } from '../data/sync/hubApi.js'
import { WipeError } from '../data/sync/wipe.js'
import { openFamily } from '../data/family'
import { setUpFamily, isSetUp } from '../data/schema'
import { listMembers } from '../data/members'
import { createBackup, parseBackup } from '../data/backupFormat.js'
import { connectState } from '../lib/connectState'
import { useSyncStore, setSyncDepsForTests, REPLACE_WIPE_MESSAGE, ALREADY_SET_UP_MESSAGE } from './sync'

const ROOM = 'r_' + 'A'.repeat(22)
const NEW_ROOM = 'r_' + 'B'.repeat(22)
const TOKEN = 'T'.repeat(43)
const ORIGIN = 'http://localhost:8787'

let storage
let session
let reloads
let claims
let claimAnswer
let applyCalls
let wipe
let clock
let shortCodeCalls
let shortCodeAnswer

function fakeApi() {
  return {
    claim: async (id) => {
      claims.push(id)
      if (claimAnswer === 409) throw new HubApiError(409, 'conflict')
      if (claimAnswer === 'down') throw new TypeError('Failed to fetch')
      return { ok: true }
    },
    restore: async () => ({ roomId: NEW_ROOM, token: TOKEN }),
    pairShortCode: async (shortCode) => {
      shortCodeCalls.push(shortCode)
      if (shortCodeAnswer instanceof Error) throw shortCodeAnswer
      return shortCodeAnswer
    },
  }
}

function setup({ bootResult = {}, ...over } = {}) {
  setSyncDepsForTests({
    bootSync: async (args) => ({ role: 'unpaired', config: null, hubInfo: null, pendingReplace: null, connection: null, ...bootResult, args }),
    createHubApi: fakeApi,
    applyPairing: (args) => {
      applyCalls.push(args)
      return realApplyPairing({ ...args, storage, wipe })
    },
    storage,
    session: () => session,
    location: { origin: ORIGIN, hostname: 'localhost' },
    reload: () => reloads++,
    now: () => clock,
    online: () => true,
    clearMemberId: () => storage.removeItem('fh.memberId'),
    ticker: false,
    ...over,
  })
  return useSyncStore()
}

beforeEach(() => {
  setActivePinia(createPinia())
  storage = memoryStorage()
  session = memoryStorage()
  reloads = 0
  claims = []
  claimAnswer = 200
  applyCalls = []
  wipe = async () => {}
  clock = 1_000_000
  shortCodeCalls = []
  shortCodeAnswer = { roomId: NEW_ROOM, token: TOKEN, familyExists: true }
  setFamilyForTests({ doc: new Y.Doc(), assets: new Y.Doc(), destroy: async () => {} })
})

afterEach(() => {
  useSyncStore().stop()
  setSyncDepsForTests(null)
  setFamilyForTests(null)
})

const adoptPending = { adopt: true, incoming: { roomId: ROOM, token: TOKEN, familyExists: false }, hubUrl: ORIGIN, role: 'hub-machine' }
const replacePending = { adopt: false, incoming: { roomId: NEW_ROOM, token: TOKEN, familyExists: true }, hubUrl: 'http://192.0.2.20:8787', role: 'device' }

describe('boot', () => {
  it('exposes the hub-machine result', async () => {
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: false, roomId: ROOM, token: TOKEN } } })
    await sync.boot({})
    expect(sync.role).toBe('hub-machine')
    expect(sync.isHubMachine).toBe(true)
    expect(sync.canSetUp).toBe(true)
  })

  it('canSetUp is false for a hub that already has a family, or with no hub answering', async () => {
    const a = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: true } } })
    await a.boot({})
    expect(a.canSetUp).toBe(false)
    setActivePinia(createPinia())
    const b = setup({ bootResult: { role: 'hub-machine', hubInfo: null } })
    await b.boot({})
    expect(b.canSetUp).toBe(false)
  })

  it('a bootSync failure never blocks the app', async () => {
    const sync = setup({ bootSync: async () => { throw new Error('boom') } })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(sync.boot({})).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('claimForSetup', () => {
  it('claims with an id kept in sessionStorage, reused on the next call', async () => {
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: false } } })
    await sync.boot({})
    await sync.claimForSetup()
    await sync.claimForSetup()
    expect(claims).toHaveLength(2)
    expect(claims[0]).toBe(claims[1])
    expect(session.getItem('fh.setupClaimId')).toBe(claims[0])
  })

  it('409 -> "Your family is already set up on this hub"', async () => {
    claimAnswer = 409
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: false } } })
    await sync.boot({})
    await expect(sync.claimForSetup()).rejects.toThrow(ALREADY_SET_UP_MESSAGE)
    expect(ALREADY_SET_UP_MESSAGE).toBe('Your family is already set up on this hub')
  })

  it('refuses off the hub machine without calling the hub', async () => {
    const sync = setup({ bootResult: { role: 'device' } })
    await sync.boot({})
    await expect(sync.claimForSetup()).rejects.toThrow()
    expect(claims).toHaveLength(0)
  })
})

describe('confirmReplace: adopt', () => {
  it('claims, then applies "adopt" with claimed: true, then reloads', async () => {
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: false }, pendingReplace: adoptPending } })
    await sync.boot({})
    await sync.confirmReplace()
    expect(claims).toHaveLength(1)
    expect(applyCalls).toHaveLength(1)
    expect(applyCalls[0]).toMatchObject({ plan: 'adopt', claimed: true, incoming: adoptPending.incoming, role: 'hub-machine' })
    expect(loadHubConfig({ storage })).toMatchObject({ roomId: ROOM, role: 'hub-machine' })
    expect(reloads).toBe(1)
  })

  it('a 409 claim never saves a config and never reloads', async () => {
    claimAnswer = 409
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: false }, pendingReplace: adoptPending } })
    await sync.boot({})
    await expect(sync.confirmReplace()).rejects.toThrow(ALREADY_SET_UP_MESSAGE)
    expect(applyCalls).toHaveLength(0)
    expect(loadHubConfig({ storage })).toBeNull()
    expect(reloads).toBe(0)
    expect(sync.pendingReplace).toEqual(adoptPending)
  })

  it('an unreachable hub never saves a config either', async () => {
    claimAnswer = 'down'
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: false }, pendingReplace: adoptPending } })
    await sync.boot({})
    await expect(sync.confirmReplace()).rejects.toThrow()
    expect(applyCalls).toHaveLength(0)
    expect(loadHubConfig({ storage })).toBeNull()
  })
})

describe('confirmReplace: wipe and pull', () => {
  it('wipes, saves the new room, clears the stale member id, reloads', async () => {
    storage.setItem('fh.memberId', 'old-family-member')
    const sync = setup({ bootResult: { role: 'device', pendingReplace: replacePending } })
    await sync.boot({})
    await sync.confirmReplace()
    expect(applyCalls[0]).toMatchObject({ plan: 'confirm-replace', incoming: replacePending.incoming, hubUrl: replacePending.hubUrl, role: 'device' })
    expect(applyCalls[0].current).toBeTruthy()
    expect(claims).toHaveLength(0)
    expect(loadHubConfig({ storage })).toMatchObject({ roomId: NEW_ROOM })
    expect(storage.getItem('fh.memberId')).toBeNull()
    expect(reloads).toBe(1)
  })

  it('a WipeError gives the close-other-tabs message, saves nothing, and Retry works', async () => {
    storage.setItem('fh.memberId', 'old-family-member')
    wipe = async () => {
      throw new WipeError('blocked')
    }
    const sync = setup({ bootResult: { role: 'device', pendingReplace: replacePending } })
    await sync.boot({})
    await expect(sync.confirmReplace()).rejects.toThrow(REPLACE_WIPE_MESSAGE)
    expect(REPLACE_WIPE_MESSAGE).toBe(
      "Couldn't clear this device's old data. Close any other Yggltree tabs or windows on this device and try again."
    )
    expect(loadHubConfig({ storage })).toBeNull()
    expect(storage.getItem('fh.memberId')).toBe('old-family-member')
    expect(reloads).toBe(0)
    expect(sync.pendingReplace).toEqual(replacePending)

    expect(sync.replaceStuck).toBe(true)

    wipe = async () => {}
    await sync.confirmReplace()
    expect(loadHubConfig({ storage })).toMatchObject({ roomId: NEW_ROOM })
    expect(sync.replaceStuck).toBe(false)
    expect(reloads).toBe(1)
  })

  it('after a failed wipe: retry is offered, cancel is not and never resumes the app', async () => {
    wipe = async () => {
      throw new WipeError('blocked')
    }
    const sync = setup({ bootResult: { role: 'device', pendingReplace: replacePending } })
    await sync.boot({})
    await expect(sync.confirmReplace()).rejects.toThrow(REPLACE_WIPE_MESSAGE)
    expect(connectState({ ...sync.$state })).toBe('replace-failed')
    sync.cancelReplace()
    expect(sync.pendingReplace).toEqual(replacePending) // the guard keeps /connect
    expect(reloads).toBe(1) // reload, never resume on destroyed docs
  })

  it('a backup taken after the wipe destroyed the docs still round-trips the family', async () => {
    const fam = await openFamily({ persist: false })
    setUpFamily(fam.doc, { familyName: 'Test Family', adminName: 'Pat Parent', modules: ['todos'] })
    setFamilyForTests(fam)
    wipe = async ({ current }) => {
      await current.destroy() // what wipeLocalFamily does before deleting
      throw new WipeError('blocked')
    }
    const sync = setup({ bootResult: { role: 'device', pendingReplace: replacePending } })
    await sync.boot({})
    await expect(sync.confirmReplace()).rejects.toThrow(REPLACE_WIPE_MESSAGE)
    const { main } = parseBackup(createBackup(fam))
    const copy = new Y.Doc()
    Y.applyUpdate(copy, main)
    expect(isSetUp(copy)).toBe(true)
    expect(listMembers(copy).map((m) => m.name)).toEqual(['Pat Parent'])
  })
})

describe('status', () => {
  function fakeConnection(snap) {
    const listeners = new Set()
    return {
      snap,
      snapshot: () => ({ ...snap }),
      on: (_t, fn) => (listeners.add(fn), () => listeners.delete(fn)),
      fire() {
        for (const fn of listeners) fn(this.snapshot())
      },
      destroy() {},
      destroyed: false,
    }
  }
  const config = { v: 1, hubUrl: 'http://192.0.2.20:8787', roomId: ROOM, token: TOKEN, role: 'device', pairedAt: '2026-10-07 10:00:00' }

  it('follows the connection: connecting -> connected, with lastSyncedAt', async () => {
    const conn = fakeConnection({ mainSynced: false, attemptStartedAt: clock, lastSyncedAt: null })
    const sync = setup({ bootResult: { role: 'device', config, connection: conn } })
    await sync.boot({})
    expect(sync.status).toBe('connecting')
    conn.snap.mainSynced = true
    conn.snap.lastSyncedAt = '2026-10-07 10:00:05'
    conn.fire()
    expect(sync.status).toBe('connected')
    expect(sync.lastSyncedAt).toBe('2026-10-07 10:00:05')
    expect(sync.statusCopy.label).toBe('Synced')
  })

  it('the 1 s tick moves connecting -> waiting after 4 s; offline events win', async () => {
    const conn = fakeConnection({ mainSynced: false, attemptStartedAt: clock, lastSyncedAt: null })
    const sync = setup({ bootResult: { role: 'device', config, connection: conn } })
    await sync.boot({})
    clock += 4000
    sync.refreshStatus()
    expect(sync.status).toBe('waiting')
    sync.setOnline(false)
    expect(sync.status).toBe('offline')
  })

  it('the hub machine with no hub running: connecting, then the hub-machine waiting copy', async () => {
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: null } })
    await sync.boot({})
    expect(sync.status).toBe('connecting')
    clock += 4000
    sync.refreshStatus()
    expect(sync.status).toBe('waiting')
    expect(sync.statusCopy.message).toBe("Yggltree isn't running on this computer. Start it with npm start.")
  })

  it('the hub machine after a canceled adopt: "isn\'t on the hub yet", not "isn\'t running"', async () => {
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: false }, pendingReplace: adoptPending } })
    await sync.boot({})
    sync.cancelReplace()
    expect(reloads).toBe(0)
    expect(sync.pendingReplace).toBeNull()
    clock += 4000
    sync.refreshStatus()
    expect(sync.status).toBe('waiting')
    expect(sync.statusCopy.message).toBe("This computer's family isn't on the hub yet. Reload to upload it.")
  })

  it('a protocol problem (close 4400) is needs-pairing with the update message', async () => {
    const conn = fakeConnection({ mainSynced: false, attemptStartedAt: clock, lastSyncedAt: null, closeCode: 4400 })
    const sync = setup({ bootResult: { role: 'device', config, connection: conn } })
    await sync.boot({})
    setProblem({ kind: 'protocol', roomId: ROOM }, { storage })
    conn.fire()
    expect(sync.status).toBe('needs-pairing')
    expect(sync.problem).toMatchObject({ kind: 'protocol' })
    expect(sync.statusCopy.message).toBe(
      "This device can't talk to your Yggltree. Update Yggltree on the family computer, then reload this page."
    )
  })
})

describe('restoreOnHub', () => {
  it('destroys the connection, restores on the hub, then confirm-replaces into the new room and reloads', async () => {
    const order = []
    const conn = { snapshot: () => ({ mainSynced: true }), on: () => () => {}, destroy: () => order.push('destroy'), destroyed: false }
    const sync = setup({
      bootResult: { role: 'hub-machine', hubInfo: { familyExists: false }, connection: conn },
      createHubApi: () => ({ ...fakeApi(), restore: async (text) => (order.push(['restore', text.length > 0]), { roomId: NEW_ROOM, token: TOKEN }) }),
    })
    await sync.boot({})
    const { createBackup } = await import('../data/backupFormat.js')
    const doc = new Y.Doc()
    doc.getMap('meta').set('schema_version', 1)
    const text = createBackup({ doc, assets: new Y.Doc() })
    await sync.restoreOnHub({ text: async () => text })
    expect(order).toEqual(['destroy', ['restore', true]])
    expect(applyCalls[0]).toMatchObject({ plan: 'confirm-replace', incoming: { roomId: NEW_ROOM, token: TOKEN }, role: 'hub-machine', hubUrl: ORIGIN })
    expect(loadHubConfig({ storage })).toMatchObject({ roomId: NEW_ROOM })
    expect(reloads).toBe(1)
  })

  it('a hub that rejects the restore (400 / 413 / down) leaves sync running again', async () => {
    for (const [failure, message] of [
      [new HubApiError(400, 'bad-backup'), "The hub couldn't read that backup file."],
      [new HubApiError(413), 'That backup file is too large for the hub.'],
      [new TypeError('Failed to fetch'), "Couldn't reach Yggltree on this computer to restore."],
    ]) {
      setActivePinia(createPinia())
      applyCalls = []
      const connections = []
      const sync = setup({
        bootSync: async () => {
          const conn = { snapshot: () => ({ mainSynced: true }), on: () => () => {}, destroyed: false }
          conn.destroy = () => (conn.destroyed = true)
          connections.push(conn)
          return { role: 'hub-machine', config: null, hubInfo: { familyExists: false }, pendingReplace: null, connection: conn }
        },
        createHubApi: () => ({ ...fakeApi(), restore: async () => { throw failure } }),
      })
      await sync.boot({})
      const { createBackup } = await import('../data/backupFormat.js')
      const doc = new Y.Doc()
      doc.getMap('meta').set('schema_version', 1)
      const text = createBackup({ doc, assets: new Y.Doc() })
      await expect(sync.restoreOnHub({ text: async () => text })).rejects.toThrow(message)
      expect(connections).toHaveLength(2)
      expect(connections[0].destroyed).toBe(true)
      expect(connections[1].destroyed).toBe(false) // a fresh, live connection
      expect(applyCalls).toHaveLength(0)
      expect(reloads).toBe(0)
      sync.stop()
    }
  })

  it('rejects a bad file before touching the connection or the hub', async () => {
    const order = []
    const conn = { snapshot: () => ({}), on: () => () => {}, destroy: () => order.push('destroy'), destroyed: false }
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: false }, connection: conn } })
    await sync.boot({})
    await expect(sync.restoreOnHub({ text: async () => 'not json' })).rejects.toThrow()
    expect(order).toEqual([])
    expect(applyCalls).toHaveLength(0)
  })
})

// A Settings restore whose local wipe fails after the hub restored.
function fakeWindow() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
    count: (type) => (listeners.get(type) ?? []).length,
    fire(type) {
      const event = { defaultPrevented: false, returnValue: undefined, preventDefault() { this.defaultPrevented = true } }
      for (const fn of listeners.get(type) ?? []) fn(event)
      return event
    },
  }
}

function backupText() {
  const doc = new Y.Doc()
  doc.getMap('meta').set('schema_version', 1)
  return createBackup({ doc, assets: new Y.Doc() })
}

describe('restoreOnHub: stuck after the hub restored', () => {
  function stuckSetup(win, restores) {
    const conn = { snapshot: () => ({ mainSynced: true }), on: () => () => {}, destroy: () => {}, destroyed: false }
    return setup({
      bootResult: { role: 'hub-machine', hubInfo: { familyExists: true }, connection: conn },
      createHubApi: () => ({
        ...fakeApi(),
        restore: async () => {
          restores.push(1)
          return { roomId: NEW_ROOM, token: TOKEN }
        },
      }),
      unloadTarget: () => win,
    })
  }

  it('a failed wipe sets restoreStuck, saves nothing, and does not reload', async () => {
    const win = fakeWindow()
    const restores = []
    wipe = async () => {
      throw new WipeError('blocked')
    }
    const sync = stuckSetup(win, restores)
    await sync.boot({})
    const text = backupText()
    await expect(sync.restoreOnHub({ text: async () => text })).rejects.toThrow(REPLACE_WIPE_MESSAGE)
    expect(sync.restoreStuck).toBe(true)
    expect(sync.stuck).toBe(true)
    expect(restores).toHaveLength(1)
    expect(loadHubConfig({ storage })).toBeNull()
    expect(reloads).toBe(0)
  })

  it('Retry reuses the hub answer: no second hub restore, then saves the new room and reloads', async () => {
    const win = fakeWindow()
    const restores = []
    wipe = async () => {
      throw new WipeError('blocked')
    }
    const sync = stuckSetup(win, restores)
    await sync.boot({})
    const text = backupText()
    await expect(sync.restoreOnHub({ text: async () => text })).rejects.toThrow(REPLACE_WIPE_MESSAGE)
    // still blocked: stays stuck, still one hub restore
    await expect(sync.retryRestore()).rejects.toThrow(REPLACE_WIPE_MESSAGE)
    expect(sync.restoreStuck).toBe(true)
    expect(restores).toHaveLength(1)

    wipe = async () => {}
    await sync.retryRestore()
    expect(restores).toHaveLength(1)
    expect(applyCalls).toHaveLength(3)
    for (const call of applyCalls) expect(call.incoming).toMatchObject({ roomId: NEW_ROOM, token: TOKEN })
    expect(loadHubConfig({ storage })).toMatchObject({ roomId: NEW_ROOM, role: 'hub-machine' })
    expect(sync.restoreStuck).toBe(false)
    expect(reloads).toBe(1)
  })

  it('while stuck, a different file is refused (no new hub room); the same file just retries', async () => {
    const win = fakeWindow()
    const restores = []
    wipe = async () => {
      throw new WipeError('blocked')
    }
    const sync = stuckSetup(win, restores)
    await sync.boot({})
    const text = backupText()
    await expect(sync.restoreOnHub({ text: async () => text })).rejects.toThrow(REPLACE_WIPE_MESSAGE)
    const other = backupText().replace('}', ', "x": 1}')
    await expect(sync.restoreOnHub({ text: async () => other })).rejects.toThrow(/Press Retry to finish it/)
    expect(restores).toHaveLength(1)
    wipe = async () => {}
    await sync.restoreOnHub({ text: async () => text })
    expect(restores).toHaveLength(1)
    expect(reloads).toBe(1)
  })

  it('retryRestore with nothing to retry throws and changes nothing', async () => {
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: true } } })
    await sync.boot({})
    await expect(sync.retryRestore()).rejects.toThrow()
    expect(applyCalls).toHaveLength(0)
    expect(reloads).toBe(0)
  })
})

describe('beforeunload while stuck', () => {
  it('is added when a restore gets stuck and removed before the success reload', async () => {
    const win = fakeWindow()
    let listenersAtReload = null
    wipe = async () => {
      throw new WipeError('blocked')
    }
    const conn = { snapshot: () => ({}), on: () => () => {}, destroy: () => {}, destroyed: false }
    const sync = setup({
      bootResult: { role: 'hub-machine', hubInfo: { familyExists: true }, connection: conn },
      unloadTarget: () => win,
      reload: () => {
        listenersAtReload = win.count('beforeunload')
        reloads++
      },
    })
    await sync.boot({})
    expect(win.count('beforeunload')).toBe(0)
    const text = backupText()
    await expect(sync.restoreOnHub({ text: async () => text })).rejects.toThrow()
    expect(win.count('beforeunload')).toBe(1)
    const event = win.fire('beforeunload')
    expect(event.defaultPrevented).toBe(true)

    // a second failure does not stack a second listener
    await expect(sync.retryRestore()).rejects.toThrow()
    expect(win.count('beforeunload')).toBe(1)

    wipe = async () => {}
    await sync.retryRestore()
    expect(win.count('beforeunload')).toBe(0)
    expect(listenersAtReload).toBe(0) // the success reload is never prompted
  })

  it('covers a stuck confirm-replace too (/connect), and clears on a successful retry', async () => {
    const win = fakeWindow()
    wipe = async () => {
      throw new WipeError('blocked')
    }
    const sync = setup({ bootResult: { role: 'device', pendingReplace: replacePending }, unloadTarget: () => win })
    await sync.boot({})
    await expect(sync.confirmReplace()).rejects.toThrow(REPLACE_WIPE_MESSAGE)
    expect(sync.stuck).toBe(true)
    expect(win.count('beforeunload')).toBe(1)
    wipe = async () => {}
    await sync.confirmReplace()
    expect(win.count('beforeunload')).toBe(0)
  })

  it('is never added when nothing is stuck', async () => {
    const win = fakeWindow()
    const conn = { snapshot: () => ({}), on: () => () => {}, destroy: () => {}, destroyed: false }
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: true }, connection: conn }, unloadTarget: () => win })
    await sync.boot({})
    await sync.restoreOnHub({ text: async () => backupText() })
    expect(win.count('beforeunload')).toBe(0)
    expect(reloads).toBe(1)
  })
})

describe('hub-machine re-probe while waiting (keeps hubRunning fresh)', () => {
  const INFO = { roomId: ROOM, token: TOKEN, familyExists: true, devicesConnected: 1, addresses: [], publicUrl: null, dataDir: '/data' }
  const flush = () => new Promise((r) => setTimeout(r, 0))
  let fetches
  let answer

  function probeSetup(bootResult, over = {}) {
    fetches = []
    answer = 'down'
    const fetchImpl = async (url, init) => {
      fetches.push({ url, init })
      if (answer === 'down') throw new TypeError('Failed to fetch')
      if (answer === 'hang') return new Promise(() => {})
      return { ok: true, status: 200, json: async () => answer }
    }
    return setup({ bootResult, createHubApi: (o) => realCreateHubApi({ ...o, fetchImpl }), ...over })
  }

  it('re-probes /api/hub/info at most every 15 s and updates hubInfo and the copy', async () => {
    const boot0 = clock
    let boots = 0
    // bootSync sees whatever the hub currently answers (no room saved here).
    const bootSync = async () => {
      boots++
      const hubInfo = answer === 'down' ? null : answer
      return { role: 'hub-machine', config: null, hubInfo, pendingReplace: null, connection: null }
    }
    const sync = probeSetup({}, { bootSync })
    await sync.boot({})
    clock = boot0 + 4000
    sync.refreshStatus()
    expect(sync.status).toBe('waiting')
    expect(sync.statusCopy.message).toBe("Yggltree isn't running on this computer. Start it with npm start.")
    expect(fetches).toHaveLength(0) // the boot probe counts: nothing before 15 s

    answer = INFO
    clock = boot0 + 15000
    sync.refreshStatus()
    expect(fetches).toHaveLength(1)
    expect(fetches[0].url).toBe(`${ORIGIN}/api/hub/info`)
    expect(fetches[0].init.signal).toBeDefined() // bounded by the loopback probe timeout
    await flush()
    expect(sync.hubInfo).toMatchObject({ familyExists: true, devicesConnected: 1 })
    // The hub came back and nothing is connected: sync booted again.
    expect(boots).toBe(2)
    // The hub answers but this browser has no room saved.
    clock = boot0 + 19000
    sync.refreshStatus()
    expect(sync.statusCopy.message).toBe("This computer's family isn't on the hub yet. Reload to upload it.")

    clock = boot0 + 20000
    sync.refreshStatus()
    clock = boot0 + 29999
    sync.refreshStatus()
    expect(fetches).toHaveLength(1)

    // The hub stops: one miss could be a slow answer, so hubInfo is kept
    // (canSetUp must not flicker); the second miss in a row clears it.
    answer = 'down'
    clock = boot0 + 30000
    sync.refreshStatus()
    expect(fetches).toHaveLength(2)
    await flush()
    expect(sync.hubInfo).not.toBeNull()
    clock = boot0 + 45000
    sync.refreshStatus()
    expect(fetches).toHaveLength(3)
    await flush()
    expect(sync.hubInfo).toBeNull()
    expect(sync.statusCopy.message).toBe("Yggltree isn't running on this computer. Start it with npm start.")
  })

  it('never overlaps probes while one is in flight', async () => {
    const boot0 = clock
    const sync = probeSetup({ role: 'hub-machine', hubInfo: null })
    await sync.boot({})
    answer = 'hang'
    clock = boot0 + 15000
    sync.refreshStatus()
    clock = boot0 + 60000
    sync.refreshStatus()
    expect(fetches).toHaveLength(1)
  })

  it('does not probe when connected, offline, or off the hub machine', async () => {
    const boot0 = clock
    const connected = {
      on: () => () => {},
      snapshot: () => ({ mainSynced: true, attemptStartedAt: boot0, lastSyncedAt: null }),
      destroy() {},
      destroyed: false,
    }
    const cfg = { v: 1, hubUrl: ORIGIN, roomId: ROOM, token: TOKEN, role: 'hub-machine', pairedAt: '2026-10-07 10:00:00' }
    const a = probeSetup({ role: 'hub-machine', hubInfo: INFO, config: cfg, connection: connected })
    await a.boot({})
    clock = boot0 + 60000
    a.refreshStatus()
    expect(a.status).toBe('connected')
    a.setOnline(false)
    expect(a.status).toBe('offline')
    expect(fetches).toHaveLength(0)

    setActivePinia(createPinia())
    clock = boot0
    const dev = { ...cfg, hubUrl: 'http://192.0.2.20:8787', role: 'device' }
    const b = probeSetup({ role: 'device', config: dev })
    await b.boot({})
    clock = boot0 + 60000
    b.refreshStatus()
    expect(b.status).toBe('waiting')
    expect(fetches).toHaveLength(0)
  })
})

describe('hub machine edge cases', () => {
  const INFO = { roomId: ROOM, token: TOKEN, familyExists: true, devicesConnected: 1, addresses: [], publicUrl: null, dataDir: '/data' }
  const flush = () => new Promise((r) => setTimeout(r, 0))

  function liveConnection(snap = { mainSynced: false, attemptStartedAt: clock, lastSyncedAt: null }) {
    const listeners = new Set()
    return {
      snap,
      snapshot: () => ({ ...snap }),
      on: (_t, fn) => (listeners.add(fn), () => listeners.delete(fn)),
      fire() {
        for (const fn of listeners) fn(this.snapshot())
      },
      destroy() {
        this.destroyed = true
      },
      destroyed: false,
    }
  }

  it('Setup restore: claims first, then restores on the hub', async () => {
    const order = []
    const sync = setup({
      bootResult: { role: 'hub-machine', hubInfo: { familyExists: false } },
      createHubApi: () => ({
        ...fakeApi(),
        claim: async (id) => (order.push('claim'), claims.push(id), { ok: true }),
        restore: async () => (order.push('restore'), { roomId: NEW_ROOM, token: TOKEN }),
      }),
    })
    await sync.boot({})
    await sync.restoreForSetup({ text: async () => backupText() })
    expect(order).toEqual(['claim', 'restore'])
    expect(reloads).toBe(1)
  })

  it('Setup restore while stuck: Retry skips the claim (it would 409) and never restores twice', async () => {
    const restores = []
    wipe = async () => {
      throw new WipeError('blocked')
    }
    const sync = setup({
      bootResult: { role: 'hub-machine', hubInfo: { familyExists: false } },
      createHubApi: () => ({
        ...fakeApi(),
        restore: async () => (restores.push(1), { roomId: NEW_ROOM, token: TOKEN }),
      }),
      unloadTarget: () => fakeWindow(),
    })
    await sync.boot({})
    const text = backupText()
    await expect(sync.restoreForSetup({ text: async () => text })).rejects.toThrow(REPLACE_WIPE_MESSAGE)
    expect(sync.restoreStuck).toBe(true)
    expect(claims).toHaveLength(1)
    claimAnswer = 409 // the hub's new room has a family now
    await expect(sync.restoreForSetup({ text: async () => text })).rejects.toThrow(REPLACE_WIPE_MESSAGE)
    expect(claims).toHaveLength(1)
    wipe = async () => {}
    await sync.restoreForSetup({ text: async () => text })
    expect(claims).toHaveLength(1)
    expect(restores).toHaveLength(1)
    expect(reloads).toBe(1)
  })

  it('never re-probes while a restore is stuck or in flight, so /setup is not swapped out mid-restore', async () => {
    let infos = 0
    let release
    const sync = setup({
      bootResult: { role: 'hub-machine', hubInfo: null },
      createHubApi: () => ({
        ...fakeApi(),
        info: async () => (infos++, INFO),
        restore: () => new Promise((resolve) => (release = () => resolve({ roomId: NEW_ROOM, token: TOKEN }))),
      }),
    })
    await sync.boot({})
    const pending = sync.restoreOnHub({ text: async () => backupText() })
    await flush()
    clock += 60_000
    sync.refreshStatus()
    expect(sync.status).toBe('waiting')
    expect(infos).toBe(0)
    release()
    await pending

    setActivePinia(createPinia())
    const stuck = setup({ bootResult: { role: 'hub-machine', hubInfo: null }, createHubApi: () => ({ ...fakeApi(), info: async () => (infos++, INFO) }) })
    await stuck.boot({})
    stuck.setStuck('replace', true)
    clock += 60_000
    stuck.refreshStatus()
    expect(infos).toBe(0)
    stuck.setStuck('replace', false)
  })

  it('stop() drops a probe in flight and lets the next one start', async () => {
    let infos = 0
    let answer = null
    const sync = setup({
      bootResult: { role: 'hub-machine', hubInfo: null },
      createHubApi: () => ({ ...fakeApi(), info: () => (infos++, new Promise((r) => (answer = r))) }),
    })
    await sync.boot({})
    clock += 15_000
    sync.refreshStatus()
    expect(infos).toBe(1)
    sync.stop()
    answer(INFO)
    await flush()
    expect(sync.hubInfo).toBeNull() // the stopped probe's answer is ignored
    clock += 15_000
    sync.refreshStatus()
    expect(infos).toBe(2) // not wedged behind the dropped probe
  })

  it('a hub that comes back while a connection is live does not re-run boot', async () => {
    let boots = 0
    const conn = liveConnection()
    const sync = setup({
      bootSync: async () => (boots++, { role: 'hub-machine', config: null, hubInfo: null, pendingReplace: null, connection: conn }),
      createHubApi: () => ({ ...fakeApi(), info: async () => INFO }),
    })
    await sync.boot({})
    clock += 15_000
    sync.refreshStatus()
    await flush()
    expect(sync.hubInfo).toMatchObject({ familyExists: true })
    expect(boots).toBe(1)
  })

  it('keeps the setup claim id until the family has synced to the hub once', async () => {
    const conn = liveConnection()
    const doc = new Y.Doc()
    setFamilyForTests({ doc, assets: new Y.Doc(), destroy: async () => {} })
    const sync = setup({ bootResult: { role: 'hub-machine', hubInfo: { familyExists: false }, connection: conn } })
    await sync.boot({})
    await sync.claimForSetup()
    const id = session.getItem('fh.setupClaimId')
    expect(id).toBeTruthy()
    conn.snap.mainSynced = true
    conn.fire()
    expect(session.getItem('fh.setupClaimId')).toBe(id) // connected, but no family yet
    setUpFamily(doc, { familyName: 'Test Family', adminName: 'Pat Parent' })
    conn.fire()
    expect(session.getItem('fh.setupClaimId')).toBeNull()
  })

})
