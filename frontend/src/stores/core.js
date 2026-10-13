import { defineStore } from 'pinia'
import { family } from '../data/family'
import { isSetUp, setUpFamily } from '../data/schema'
import { blankToNull } from '../data/collection'
import { getSettings, enableModule } from '../data/settings'
import { actorFor, getMember, updateMember, pinModule, unpinModule, reorderPinned } from '../data/members'
import { currentMemberId, setCurrentMemberId } from '../data/session'
import { refreshPresence } from '../data/presence.js'
import { firstName } from '../lib/names'
import { applyTheme, effectiveTheme } from '../lib/theme'
import { addons } from '../addons/registry'
import { useOnboardingStore } from './onboarding'
import { useSyncStore, ALREADY_SET_UP_MESSAGE } from './sync'

// Core store: a read-model of the shared Yjs doc plus which member is
// using this device. The doc is the source of truth; refresh() re-derives
// everything after every transaction (local edits and remote sync).
export const useCoreStore = defineStore('core', {
  state: () => ({
    familyReady: false,
    memberId: null,
    familyName: null,
    memberName: null,
    memberRole: null,
    avatarAssetId: null,
    hasSeenOnboarding: false,
    todoDefaultView: null,
    config: null,
    moduleRegistry: Object.fromEntries(addons.map((a) => [a.key, a])),
    enabledModules: [],
    pinnedModules: [],
    // This member's own theme pick, or null for the default (coral).
    memberTheme: null,
    appliedTheme: undefined,
  }),

  getters: {
    isAdmin: (state) => state.memberRole === 'admin',
    myFirstName: (state) => firstName(state.memberName),
    // Aliases for names that pages already read.
    familyMemberId: (state) => state.memberId,
    myMemberId: (state) => state.memberId,
    isAuthenticated: (state) => state.memberId !== null,
  },

  actions: {
    start() {
      this.refresh()
      family().doc.on('afterTransaction', () => this.refresh())
    },

    refresh() {
      const { doc } = family()
      this.familyReady = isSetUp(doc)
      const settings = getSettings(doc)
      this.config = settings
      this.familyName = settings.family_name || null
      this.enabledModules = settings.modules_enabled
      // An fh.memberId that isn't in this family (e.g. left over from a
      // family this device replaced) resolves to no member -> /profiles.
      const member = this.familyReady ? getMember(doc, currentMemberId()) : null
      this.memberId = member?.id ?? null
      this.memberName = member?.name ?? null
      this.memberRole = member?.role ?? null
      this.avatarAssetId = member?.avatar_asset_id ?? null
      this.hasSeenOnboarding = Boolean(member?.has_seen_onboarding)
      this.todoDefaultView = member?.todo_default_view ?? null
      this.pinnedModules = member?.nav_pinned ?? []
      this.memberTheme = member?.theme_preference ?? null
      const theme = this.familyReady ? effectiveTheme(this.memberTheme) : null
      if (theme !== this.appliedTheme) {
        applyTheme(theme)
        this.appliedTheme = theme
      }
    },

    // Seeding invariant: only the hub machine seeds, and only after its
    // POST /api/hub/claim succeeded (claimForSetup throws "Your family is
    // already set up on this hub" on 409, and nothing is written).
    async createFamily({ familyName, adminName }) {
      // Same checks as setUpFamily, made before a claim is taken.
      if (!blankToNull(familyName)) throw new Error('Family name is required')
      if (!blankToNull(adminName)) throw new Error('Your name is required')
      const sync = useSyncStore()
      await sync.claimForSetup()
      // A duplicated tab shares this tab's claim id, so the hub accepts it
      // twice; if the other tab's family has already synced in, stop here.
      if (isSetUp(family().doc)) {
        this.refresh()
        throw new Error(ALREADY_SET_UP_MESSAGE)
      }
      const available = addons.filter((a) => a.route && a.component).map((a) => a.key)
      // The claim id is kept until the family has synced to the hub (the
      // sync store releases it then), so a hub restart before the upload
      // can still accept this tab's claim.
      const adminId = setUpFamily(family().doc, { familyName, adminName, modules: available })
      this.selectMember(adminId)
    },

    selectMember(id) {
      setCurrentMemberId(id)
      refreshPresence()
      this.refresh()
      if (this.memberId && !this.hasSeenOnboarding) useOnboardingStore().start()
    },

    switchProfile() {
      setCurrentMemberId(null)
      refreshPresence()
      this.refresh()
    },

    addModule(moduleKey) {
      enableModule(family().doc, actorFor(family().doc, this.memberId), moduleKey)
    },

    pinModule(moduleKey) {
      pinModule(family().doc, this.memberId, moduleKey)
    },

    unpinModule(moduleKey) {
      unpinModule(family().doc, this.memberId, moduleKey)
    },

    reorderPinnedModules(newOrder) {
      reorderPinned(family().doc, this.memberId, newOrder)
    },

    markOnboardingSeen() {
      if (this.memberId) updateMember(family().doc, this.memberId, { has_seen_onboarding: true })
    },
  },
})
