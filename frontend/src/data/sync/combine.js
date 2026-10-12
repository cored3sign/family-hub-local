// Two sync connections over the same family documents (the home hub and the relay),
// presented to the sync store as one. The status is the best of the two: any synced
// side counts as synced, and any connected side counts as connected.
export function combineConnections(parts) {
  const listeners = new Set()
  const emit = () => {
    for (const fn of Array.from(listeners)) fn()
  }
  const offs = parts.map((part) => part.on('change', emit))
  let destroyed = false

  return {
    get destroyed() {
      return destroyed
    },
    snapshot() {
      const live = parts.filter((part) => !part.destroyed).map((part) => part.snapshot())
      if (live.length === 0) {
        return { mainSynced: false, assetsSynced: false, wsStatus: 'disconnected', closeCode: null, attemptStartedAt: null, lastSyncedAt: null }
      }
      const starts = live.map((s) => s.attemptStartedAt).filter((v) => typeof v === 'number')
      const stamps = live.map((s) => s.lastSyncedAt).filter(Boolean).sort()
      return {
        mainSynced: live.some((s) => s.mainSynced),
        assetsSynced: live.some((s) => s.assetsSynced),
        wsStatus: live.some((s) => s.wsStatus === 'connected') ? 'connected' : live[0].wsStatus,
        closeCode: live.find((s) => s.closeCode != null)?.closeCode ?? null,
        attemptStartedAt: starts.length ? Math.min(...starts) : null,
        lastSyncedAt: stamps.length ? stamps[stamps.length - 1] : null,
      }
    },
    on(type, fn) {
      if (type !== 'change') throw new Error(`Unknown connection event: ${type}`)
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      for (const off of offs) off()
      for (const part of parts) part.destroy()
      listeners.clear()
    },
  }
}
