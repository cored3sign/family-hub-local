<script setup>
// Settings. Not a toggleable module (no requireModuleEnabled gate on any
// of its actions), same "platform, not add-on" tier as member
// management/export -- manually routed in router.js, same precedent as
// /modules.
import { computed, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import {
  Home, UserRound, Users, Database,
  Camera, Download, AlertTriangle, Palette, Check,
  Smartphone,
} from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { useSyncStore } from '../stores/sync'
import { firstName } from '../lib/names'
import { applyColorTheme } from '../lib/theme'
import { useFamily, useLive } from '../data/vue'
import { assetUrl, putImageFile, removeAsset } from '../data/assets'
import { listMembers, addMember as addMemberRecord, updateMember } from '../data/members'
import { saveSettings as saveSettingsRecord, saveTheme as saveThemeRecord } from '../data/settings'
import { createBackup, exportJson } from '../data/backup'
import { family } from '../data/family'
import { loadRelayConfig, saveRelayConfig, clearRelayConfig, relayPairingUrl, relayDeviceId } from '../data/relay/config'
import { isStandaloneApp, isIosSafariTab } from '../lib/platform.js'
import { newFamilyKey, deriveRoomId, deriveAuth, toBase64Url } from '../data/relay/crypto'
import QRCode from 'qrcode'
import { createHubApi } from '../data/sync/hubApi.js'

const core = useCoreStore()
const sync = useSyncStore()
const router = useRouter()
const { doc, assets, actor } = useFamily()

const members = useLive(listMembers)

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function switchProfile() {
  core.switchProfile()
  router.push('/profiles')
}

const savingSettings = ref(false)
const settingsError = ref('')
const settingsSuccess = ref('')

// --- Hub name / week start day ---
const familyName = ref(core.config?.family_name ?? core.familyName ?? '')
const weekStartDay = ref(core.config?.week_start_day ?? 'sunday')

function saveSettings() {
  settingsError.value = ''
  settingsSuccess.value = ''
  savingSettings.value = true
  try {
    saveSettingsRecord(doc, actor(), { family_name: familyName.value, week_start_day: weekStartDay.value })
    settingsSuccess.value = 'Saved.'
  } catch (e) {
    settingsError.value = e.message
  } finally {
    savingSettings.value = false
  }
}

// --- Appearance colorway (admin only, family-wide) ---
const COLORWAYS = [
  { key: 'coral', label: 'Coral', swatches: ['#f4633a', '#0ca9d6', '#faf3ec', '#ffffff'] },
  { key: 'bold', label: 'Bold', swatches: ['#ff6347', '#1e4ca1', '#ffe066', '#ffffff'] },
  { key: 'garden', label: 'Garden', swatches: ['#556b2f', '#cc5959', '#e6b35a', '#e3dac9'] },
  { key: 'garage', label: 'Garage', swatches: ['#215f72', '#713d21', '#babcbc', '#f1f0ef'] },
  { key: 'fruit', label: 'Fruit', swatches: ['#e15335', '#97a868', '#262656', '#c6b98b'] },
  { key: 'breeze', label: 'Breeze', swatches: ['#1a5fa8', '#2ba38a', '#d99000', '#6a5acd'] },
  { key: 'carnival', label: 'Carnival', swatches: ['#e0457a', '#2196c9', '#d99000', '#00998a'] },
  { key: 'meadow', label: 'Meadow', swatches: ['#3a7d43', '#c15f76', '#3167a0', '#c98a3a'] },
]
const colorTheme = ref(core.config?.theme?.color_theme ?? 'coral')
const savingTheme = ref(false)
const themeError = ref('')

function chooseColorTheme(key) {
  if (key === colorTheme.value || savingTheme.value) return
  const previous = colorTheme.value
  themeError.value = ''
  colorTheme.value = key
  applyColorTheme(key) // optimistic -- feels instant, whole app re-renders on the token swap
  savingTheme.value = true
  try {
    saveThemeRecord(doc, actor(), key)
  } catch (e) {
    colorTheme.value = previous
    applyColorTheme(previous)
    themeError.value = e.message
  } finally {
    savingTheme.value = false
  }
}

// --- Member management (admin only) ---
const showAddMember = ref(false)
const newMemberName = ref('')
const newMemberRole = ref('member')
const addMemberError = ref('')

function addMember() {
  addMemberError.value = ''
  if (!newMemberName.value.trim()) {
    addMemberError.value = 'A name is required.'
    return
  }
  try {
    addMemberRecord(doc, { name: newMemberName.value, role: newMemberRole.value })
    newMemberName.value = ''
    newMemberRole.value = 'member'
    showAddMember.value = false
  } catch (e) {
    addMemberError.value = e.message
  }
}

const changeRoleError = ref('')

function changeRole(m, role) {
  changeRoleError.value = ''
  try {
    updateMember(doc, m.id, { role })
  } catch (e) {
    changeRoleError.value = e.message
  }
}

// --- My own profile ---
const myName = ref(core.memberName ?? '')
const savingProfile = ref(false)
const profileError = ref('')
const profileSuccess = ref('')

function saveProfile() {
  profileError.value = ''
  profileSuccess.value = ''
  if (!myName.value.trim()) {
    profileError.value = 'Name is required.'
    return
  }
  savingProfile.value = true
  try {
    updateMember(doc, core.memberId, { name: myName.value })
    profileSuccess.value = 'Saved.'
  } catch (e) {
    profileError.value = e.message
  } finally {
    savingProfile.value = false
  }
}

// Avatar upload, client-resized/capped BEFORE it is stored -- resizes to a
// max 256x256 square (cover-cropped) via canvas and re-encodes as JPEG at a
// fixed quality, so even a multi-MB phone photo becomes a tiny image.
const AVATAR_MAX_DIM = 256
const avatarUploading = ref(false)
const avatarError = ref('')
const avatarInputEl = ref(null)

function resizeImageToBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      const canvas = document.createElement('canvas')
      canvas.width = AVATAR_MAX_DIM
      canvas.height = AVATAR_MAX_DIM
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_MAX_DIM, AVATAR_MAX_DIM)
      URL.revokeObjectURL(objectUrl)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process image'))), 'image/jpeg', 0.85)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not read image file'))
    }
    img.src = objectUrl
  })
}

async function onAvatarChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  avatarError.value = ''
  if (!file.type.startsWith('image/')) {
    avatarError.value = 'Please choose an image file.'
    return
  }
  avatarUploading.value = true
  try {
    const resizedBlob = await resizeImageToBlob(file)
    const resizedFile = new File([resizedBlob], 'avatar.jpg', { type: 'image/jpeg' })
    const prev = core.avatarAssetId
    const id = await putImageFile(assets, resizedFile, { maxDim: AVATAR_MAX_DIM })
    updateMember(doc, core.memberId, { avatar_asset_id: id })
    if (prev) removeAsset(assets, prev)
  } catch (err) {
    avatarError.value = err.message || 'Upload failed.'
  } finally {
    avatarUploading.value = false
    if (avatarInputEl.value) avatarInputEl.value.value = ''
  }
}

// --- Data export + import, admin only ---
// A full Yjs-state backup and a single JSON export, both computed
// synchronously from the local doc.
const exportError = ref('')

function todayStamp() {
  return new Date().toISOString().slice(0, 10)
}

function downloadBackup() {
  exportError.value = ''
  try {
    download(`yggltree-backup-${todayStamp()}.fhub.json`, createBackup(family()), 'application/json')
  } catch (e) {
    exportError.value = e.message
  }
}

function downloadJsonExport() {
  exportError.value = ''
  try {
    download(`yggltree-export-${todayStamp()}.json`, JSON.stringify(exportJson(doc), null, 2), 'application/json')
  } catch (e) {
    exportError.value = e.message
  }
}

// --- Family relay: phones sync through a relay the family runs on its own account.
const relayUrlInput = ref('')
const relay = ref(loadRelayConfig())
const relayError = ref('')
const relayLink = computed(() => (relay.value ? relayPairingUrl(relay.value.url, relay.value.key) : ''))
const relayQr = ref('')
watch(relayLink, async (link) => {
  relayQr.value = link ? await QRCode.toDataURL(link, { margin: 1, width: 220 }) : ''
}, { immediate: true })

function startRelay() {
  relayError.value = ''
  const url = relayUrlInput.value.trim().replace(/\/$/, '')
  if (!/^https:\/\/[^/\s]+$/.test(url) && !/^http:\/\/localhost(:\d+)?$/.test(url)) {
    relayError.value = 'Use the relay address, starting with https://'
    return
  }
  saveRelayConfig({ url, key: newFamilyKey() })
  window.location.reload()
}

// --- Set up the relay from this computer. The Cloudflare token stays on this computer, and the
// hub creates or deletes the relay on the family's Cloudflare account.
const hubRelay = createHubApi({ baseUrl: globalThis.location?.origin ?? '' })
const cloudflare = ref({ tokenSaved: false, accountName: null })
const cloudflareToken = ref('')
const relayNameInput = ref('')
const relaySetupBusy = ref('') // '' | connect | create | replace | erase
const relaySetupError = ref('')
const RELAY_NAME_SHAPE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/

function relaySetupFailure(err) {
  relaySetupError.value = err?.userMessage || 'Something went wrong. Check the connection on this computer, then try again.'
}

async function loadCloudflareStatus() {
  if (!core.isAdmin) return
  try {
    cloudflare.value = await hubRelay.relayStatus()
  } catch {
    cloudflare.value = { tokenSaved: false, accountName: null }
  }
}

async function connectCloudflare() {
  relaySetupError.value = ''
  relaySetupBusy.value = 'connect'
  try {
    cloudflare.value = await hubRelay.saveRelayToken(cloudflareToken.value.trim())
    cloudflareToken.value = ''
  } catch (err) {
    relaySetupFailure(err)
  } finally {
    relaySetupBusy.value = ''
  }
}

async function forgetCloudflare() {
  relaySetupError.value = ''
  try {
    cloudflare.value = await hubRelay.forgetRelayToken()
  } catch (err) {
    relaySetupFailure(err)
  }
}

// Creates a relay under the chosen name, or replaces the current one: the old relay is deleted first.
async function buildRelay({ replacing }) {
  relaySetupError.value = ''
  const name = relayNameInput.value.trim()
  if (!RELAY_NAME_SHAPE.test(name)) {
    relaySetupError.value = 'Use 3 to 63 lowercase letters, digits or hyphens for the relay name.'
    return
  }
  relaySetupBusy.value = replacing ? 'replace' : 'create'
  try {
    const { url } = await hubRelay.createRelay({ name, replace: replacing ? relay.value.url : null })
    saveRelayConfig({ url, key: newFamilyKey() })
    window.location.reload()
  } catch (err) {
    relaySetupFailure(err)
  } finally {
    relaySetupBusy.value = ''
  }
}

async function eraseRelay() {
  relaySetupError.value = ''
  const sure = window.confirm(
    "Erase the relay? This deletes everything it has stored on Cloudflare. Each phone keeps its own copy of the family's data. This can't be undone.",
  )
  if (!sure) return
  relaySetupBusy.value = 'erase'
  try {
    await hubRelay.deleteRelay(relay.value.url)
    clearRelayConfig()
    window.location.reload()
  } catch (err) {
    relaySetupFailure(err)
  } finally {
    relaySetupBusy.value = ''
  }
}

async function turnOffRelay() {
  // Stop this device's notifications first. Once the relay is off, nothing reaches this device from the
  // family. The relay forgets the subscription the next time a push to it fails.
  if (notifyState.value === 'on') await turnOffNotifications().catch(() => {})
  clearRelayConfig()
  window.location.reload()
}

// --- Notifications on this phone (relay mode). A notification only says that something
// changed, and tapping it opens the app. On iPhone this works from the Home Screen app.
const notifyState = ref('checking') // checking | on | off | unsupported | add-to-home | other-origin
const notifyError = ref('')

function urlBase64ToBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

async function refreshNotify() {
  if (!relay.value) return
  if (globalThis.location.origin !== relay.value.url) return (notifyState.value = 'other-origin')
  if (!('serviceWorker' in navigator) || !('PushManager' in globalThis) || !('Notification' in globalThis)) {
    return (notifyState.value = 'unsupported')
  }
  if (isIosSafariTab()) return (notifyState.value = 'add-to-home')
  const reg = await navigator.serviceWorker.ready
  notifyState.value = (await reg.pushManager.getSubscription()) ? 'on' : 'off'
}

async function turnOnNotifications() {
  notifyError.value = ''
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    notifyError.value = `Notifications are ${permission}. Allow them for Yggltree in the phone's Settings.`
    return
  }
  const reg = await navigator.serviceWorker.ready
  const { key } = await (await fetch('/vapid-public-key')).json()
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) })
  const res = await fetch(`/room/${deriveRoomId(relay.value.key, 'main')}/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), src: relayDeviceId(), auth: toBase64Url(deriveAuth(relay.value.key)) }),
  })
  if (!res.ok) {
    notifyError.value = `Could not turn notifications on (HTTP ${res.status}).`
    return
  }
  notifyState.value = 'on'
}

async function turnOffNotifications() {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) await sub.unsubscribe()
  notifyState.value = 'off'
}

onMounted(() => refreshNotify().catch(() => (notifyState.value = 'unsupported')))
onMounted(loadCloudflareStatus)

const showRestoreModal = ref(false)
const restoreFile = ref(null)
const restoreConfirmText = ref('')
const restoreError = ref('')
const restoreSuccess = ref('')
const restoring = ref(false)
const restoreInputEl = ref(null)

// Restore goes through the hub (a new room and token), so it is only
// offered on the hub machine; other devices restore from the family
// computer. If this browser's wipe fails after the hub restored
// (sync.restoreStuck) the open family is destroyed: the modal can't be
// closed and only "Download a backup first" and Retry are offered. The
// sync store keeps a beforeunload warning up meanwhile.
function openRestoreModal() {
  restoreFile.value = null
  restoreConfirmText.value = ''
  restoreError.value = ''
  restoreSuccess.value = ''
  showRestoreModal.value = true
}

function onRestoreFileChange(e) {
  restoreFile.value = e.target.files?.[0] || null
}

function closeRestoreModal() {
  if (restoring.value || sync.restoreStuck) return
  showRestoreModal.value = false
}

async function confirmRestore() {
  restoreError.value = ''
  if (!sync.isHubMachine) {
    restoreError.value = 'Restore from the family computer.'
    return
  }
  if (!restoreFile.value) {
    restoreError.value = 'Choose a backup file to restore.'
    return
  }
  if (restoreConfirmText.value !== 'REPLACE') {
    restoreError.value = 'Type REPLACE exactly to confirm.'
    return
  }
  restoring.value = true
  try {
    await sync.restoreOnHub(restoreFile.value) // reloads on success
    restoreSuccess.value = 'Data restored. Reloading…'
  } catch (e) {
    restoreError.value = e.message
  } finally {
    restoring.value = false
  }
}

// Retry reuses the hub's answer: it never restores into another room.
async function retryRestore() {
  restoreError.value = ''
  restoring.value = true
  try {
    await sync.retryRestore() // reloads on success
    restoreSuccess.value = 'Data restored. Reloading…'
  } catch (e) {
    restoreError.value = e.message
  } finally {
    restoring.value = false
  }
}

// The family behind this page is destroyed while stuck: don't let an
// in-app navigation carry on with it.
onBeforeRouteLeave(() => !sync.restoreStuck)

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
</script>

<template>
  <div class="module-page settings-page">
    <h2>Settings</h2>

    <AppCard v-if="core.isAdmin" class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--household">
            <Home :size="20" />
          </span>
          <h3>Household</h3>
        </div>
        <form class="settings-form" @submit.prevent="saveSettings">
          <FormField v-model="familyName" label="Family name" required />
          <label class="form-field">
            <span class="form-field__label">Week starts on</span>
            <select v-model="weekStartDay">
              <option value="sunday">Sunday</option>
              <option value="monday">Monday</option>
            </select>
          </label>
          <p v-if="settingsError" class="error">{{ settingsError }}</p>
          <p v-if="settingsSuccess" class="success">{{ settingsSuccess }}</p>
          <AppButton type="submit" :disabled="savingSettings">{{ savingSettings ? 'Saving…' : 'Save' }}</AppButton>
        </form>
      </AppCard>

      <!-- Appearance colorway (admin only, family-wide) -->
      <AppCard v-if="core.isAdmin" class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--appearance">
            <Palette :size="20" />
          </span>
          <h3>Appearance</h3>
        </div>
        <p class="hint">Choose a colorway for the whole family — everyone sees this on every device.</p>
        <div class="colorway-grid" role="radiogroup" aria-label="Colorway">
          <button
            v-for="c in COLORWAYS"
            :key="c.key"
            type="button"
            role="radio"
            :aria-checked="colorTheme === c.key"
            class="colorway-swatch"
            :class="{ 'colorway-swatch--selected': colorTheme === c.key }"
            :disabled="savingTheme"
            @click="chooseColorTheme(c.key)"
          >
            <span class="colorway-swatch__dots">
              <span v-for="(hex, i) in c.swatches" :key="i" class="colorway-swatch__dot" :style="{ background: hex }" />
            </span>
            <span class="colorway-swatch__label">{{ c.label }}</span>
            <Check v-if="colorTheme === c.key" :size="16" class="colorway-swatch__check" />
          </button>
        </div>
        <p v-if="themeError" class="error">{{ themeError }}</p>
      </AppCard>

      <!-- My profile -->
      <AppCard class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--profile">
            <UserRound :size="20" />
          </span>
          <h3>My profile</h3>
        </div>
        <div class="avatar-row">
          <div class="avatar-preview">
            <img v-if="assetUrl(core.avatarAssetId)" :src="assetUrl(core.avatarAssetId)" alt="" />
            <span v-else>{{ initials(core.memberName) }}</span>
          </div>
          <div class="avatar-actions">
            <label class="app-btn app-btn--secondary avatar-upload-btn">
              <Camera :size="16" />
              {{ avatarUploading ? 'Uploading…' : 'Change photo' }}
              <input
                ref="avatarInputEl"
                type="file"
                accept="image/*"
                class="avatar-upload-input"
                :disabled="avatarUploading"
                @change="onAvatarChange"
              />
            </label>
            <p v-if="avatarError" class="error">{{ avatarError }}</p>
          </div>
        </div>
        <form class="settings-form" @submit.prevent="saveProfile">
          <FormField v-model="myName" label="Name" required />
          <p v-if="profileError" class="error">{{ profileError }}</p>
          <p v-if="profileSuccess" class="success">{{ profileSuccess }}</p>
          <AppButton type="submit" :disabled="savingProfile">{{ savingProfile ? 'Saving…' : 'Save profile' }}</AppButton>
        </form>
        <AppButton variant="ghost" type="button" @click="switchProfile">Switch profile</AppButton>
      </AppCard>

      <!-- Member management (admin only) -->
      <AppCard v-if="core.isAdmin" class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--members">
            <Users :size="20" />
          </span>
          <h3>Family members</h3>
        </div>
        <ul class="module-list">
          <ListRow v-for="m in members" :key="m.id">
            <div class="member-row">
              <div class="member-row__avatar">
                <img v-if="assetUrl(m.avatar_asset_id)" :src="assetUrl(m.avatar_asset_id)" alt="" />
                <span v-else :style="{ background: m.avatar_color || 'var(--accent-container)' }">{{ initials(m.name) }}</span>
              </div>
              <div class="member-row__body">
                <div class="member-row__name-line">
                  <span class="member-row__name">{{ firstName(m.name) }}</span>
                </div>
              </div>
              <select
                class="member-role-select"
                :value="m.role"
                @change="changeRole(m, $event.target.value)"
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
            </div>
          </ListRow>
        </ul>
        <p v-if="changeRoleError" class="error">{{ changeRoleError }}</p>

        <AppButton v-if="!showAddMember" variant="secondary" @click="showAddMember = true">+ Add member</AppButton>

        <AddRow v-else button-label="Add member" @submit="addMember">
          <FormField v-model="newMemberName" placeholder="Name" required />
          <select v-model="newMemberRole">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </AddRow>
        <p v-if="addMemberError" class="error">{{ addMemberError }}</p>
      </AppCard>

      <!-- Data export + import, admin only -->
      <AppCard v-if="core.isAdmin" class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--data">
            <Database :size="20" />
          </span>
          <h3>Data export &amp; import</h3>
        </div>
        <p class="hint">
          Your family's data belongs to you — download it any time in an open, portable format, or restore from a
          previous backup.
        </p>

        <div class="export-grid">
          <div class="export-option">
            <div class="export-option__body">
              <strong>Full backup</strong>
              <p class="hint">The exact state of your family's data — for a full restore later, or moving to another install.</p>
            </div>
            <AppButton variant="secondary" @click="downloadBackup">
              <Download :size="16" style="vertical-align: -3px; margin-right: 4px" />Download full backup
            </AppButton>
          </div>
          <div class="export-option">
            <div class="export-option__body">
              <strong>Export data (JSON)</strong>
              <p class="hint">A readable copy of everything — announcements, to-dos, check-ins, and more.</p>
            </div>
            <AppButton variant="secondary" @click="downloadJsonExport">
              <Download :size="16" style="vertical-align: -3px; margin-right: 4px" />Export data (JSON)
            </AppButton>
          </div>
        </div>
        <p v-if="exportError" class="error">{{ exportError }}</p>

        <div v-if="sync.isHubMachine" class="restore-section">
          <strong>Restore from backup</strong>
          <p class="hint">
            Replaces ALL of your family's current data with the contents of a backup file, including photos —
            a full backup includes every photo you've uploaded, and restoring one replaces the photos on every
            device with the photos from the backup.
          </p>
          <AppButton variant="danger" @click="openRestoreModal">
            <Upload :size="16" style="vertical-align: -3px; margin-right: 4px" />Restore from backup…
          </AppButton>
        </div>
        <div v-else class="restore-section">
          <strong>Restore from the family computer</strong>
          <p class="hint">
            Backups are restored through Yggltree on the family computer. Open Settings there to restore one.
          </p>
        </div>
      </AppCard>

      <!-- Family relay: sync through a relay the family runs on its own account. Setting it up and adding
           phones is for admins. Any phone that uses the relay can turn it off for itself. -->
      <AppCard v-if="core.isAdmin || relay" class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--data">
            <Database :size="20" />
          </span>
          <h3>Family relay</h3>
        </div>
        <template v-if="relay">
          <template v-if="core.isAdmin">
            <p class="hint">
              A relay lets phones sync when they're away from home, without a home computer. The relay only ever
              sees encrypted data. Add phones by scanning the QR code below.
            </p>
            <p class="hint">Relay: <strong>{{ relay.url }}</strong></p>
            <p class="hint">Scan this code with the phone's Camera app. On iPhone, the page then walks you through adding the app to the Home Screen, and you scan once more inside the new icon. Or open this link in Chrome on Android:</p>
            <p class="add-device__url">{{ relayLink }}</p>
            <img v-if="relayQr" :src="relayQr" alt="Family relay link" width="220" height="220" />
            <p class="hint">Keep this private: the link contains the family key.</p>
          </template>
          <p class="hint">
            This only affects this device. It stops syncing and notifications here. This device keeps its copy of
            the family's data.
          </p>
          <AppButton variant="danger" @click="turnOffRelay">Turn off the relay on this device</AppButton>
        </template>
        <template v-else>
          <p class="hint">
            A relay lets phones sync when they're away from home, without a home computer. The relay only ever
            sees encrypted data. Set it up once, then add phones by scanning the QR code below.
          </p>
          <label class="form-field">
            <span class="form-field__label">Relay address</span>
            <input v-model="relayUrlInput" type="url" placeholder="https://your-relay.workers.dev" autocomplete="off" />
          </label>
          <AppButton variant="secondary" @click="startRelay">Start the family relay</AppButton>
          <p v-if="relayError" class="error">{{ relayError }}</p>
        </template>

        <div v-if="core.isAdmin" class="relay-setup">
          <h4>Set up a relay from this computer</h4>
          <p class="hint">
            Yggltree can create the relay on your Cloudflare account for you. You'll need a Cloudflare API token
            first. The setup guide, section 5, shows how to make one.
          </p>
          <template v-if="!cloudflare.tokenSaved">
            <label class="form-field">
              <span class="form-field__label">Cloudflare API token</span>
              <input v-model="cloudflareToken" type="password" autocomplete="off" />
            </label>
            <AppButton
              variant="secondary"
              :disabled="!cloudflareToken.trim() || relaySetupBusy !== ''"
              @click="connectCloudflare"
            >
              {{ relaySetupBusy === 'connect' ? 'Checking the token…' : 'Connect Cloudflare' }}
            </AppButton>
          </template>
          <template v-else>
            <p class="hint">Connected to the Cloudflare account <strong>{{ cloudflare.accountName }}</strong>.</p>
            <AppButton variant="secondary" :disabled="relaySetupBusy !== ''" @click="forgetCloudflare">
              Forget this token
            </AppButton>
            <label class="form-field">
              <span class="form-field__label">Relay name</span>
              <input v-model="relayNameInput" type="text" placeholder="smith-family-relay" autocomplete="off" />
            </label>
            <p class="hint">
              The name becomes the start of the relay's address. Use lowercase letters, digits and hyphens.
            </p>
            <div class="relay-setup__actions">
              <AppButton
                v-if="!relay"
                variant="secondary"
                :disabled="relaySetupBusy !== ''"
                @click="buildRelay({ replacing: false })"
              >
                {{ relaySetupBusy === 'create' ? 'Creating the relay… this takes a few minutes' : 'Create the relay' }}
              </AppButton>
              <template v-else>
                <AppButton
                  variant="secondary"
                  :disabled="relaySetupBusy !== ''"
                  @click="buildRelay({ replacing: true })"
                >
                  {{ relaySetupBusy === 'replace' ? 'Replacing the relay… this takes a few minutes' : 'Replace the relay with a new one' }}
                </AppButton>
                <AppButton variant="danger" :disabled="relaySetupBusy !== ''" @click="eraseRelay">
                  {{ relaySetupBusy === 'erase' ? 'Erasing…' : 'Erase the relay' }}
                </AppButton>
              </template>
            </div>
          </template>
          <p v-if="relaySetupError" class="error">{{ relaySetupError }}</p>
        </div>
      </AppCard>

      <!-- Notifications on this phone: only for devices that use the family relay. -->
      <AppCard v-if="relay" class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--data">
            <Smartphone :size="20" />
          </span>
          <h3>Notifications on this phone</h3>
        </div>
        <p class="hint">
          Get a notification when something changes in your family's lists, even when the app is closed. The
          notification doesn't say what changed. Tap it to open the app.
        </p>
        <p v-if="notifyState === 'other-origin'" class="hint">
          Turn notifications on from the phone itself, using the family relay link (not from this computer).
        </p>
        <p v-else-if="notifyState === 'unsupported'" class="hint">This browser can't show notifications.</p>
        <p v-else-if="notifyState === 'add-to-home'" class="hint">
          On iPhone, first add Yggltree to the Home Screen (Share → Add to Home Screen), open it from its icon,
          then come back to this screen.
        </p>
        <template v-else-if="notifyState === 'on'">
          <p class="hint"><strong>On</strong> for this phone.</p>
          <AppButton variant="ghost" @click="turnOffNotifications">Turn off</AppButton>
        </template>
        <AppButton v-else-if="notifyState === 'off'" variant="secondary" @click="turnOnNotifications">
          Turn on notifications
        </AppButton>
        <p v-if="notifyError" class="error">{{ notifyError }}</p>
      </AppCard>

    <AppModal :open="showRestoreModal || sync.restoreStuck" title="Restore from backup" @close="closeRestoreModal">
      <div v-if="sync.restoreStuck" class="restore-modal">
        <p class="restore-warning">
          <AlertTriangle :size="18" class="restore-warning__icon" />
          <span>Restoring didn't finish on this computer.</span>
        </p>
        <p class="restore-stuck__copy">
          Download a backup now, then close any other Yggltree tabs or windows and press Retry. Don't reload or
          close this page until it succeeds.
        </p>
        <p v-if="exportError" class="error">{{ exportError }}</p>
        <p v-if="restoreError" class="error">{{ restoreError }}</p>
        <p v-if="restoreSuccess" class="success">{{ restoreSuccess }}</p>
        <div class="restore-modal__actions">
          <AppButton variant="secondary" type="button" :disabled="restoring" @click="downloadBackup">
            <Download :size="16" style="vertical-align: -3px; margin-right: 4px" />Download a backup first
          </AppButton>
          <AppButton variant="danger" type="button" :disabled="restoring" @click="retryRestore">
            {{ restoring ? 'Retrying…' : 'Retry' }}
          </AppButton>
        </div>
      </div>
      <div v-else class="restore-modal">
        <p class="restore-warning">
          <AlertTriangle :size="18" class="restore-warning__icon" />
          <span>
            This will permanently replace every to-do, event, shopping item, chore, message, check-in, and photo
            currently stored for your family with the contents of the file you upload. This cannot be undone.
          </span>
        </p>
        <p class="restore-stuck__copy">
          Other browsers on this computer just need to reload.
        </p>
        <label class="form-field">
          <span class="form-field__label">Backup file (.fhub.json)</span>
          <input ref="restoreInputEl" type="file" accept=".json,.fhub.json,application/json" @change="onRestoreFileChange" />
        </label>
        <FormField
          v-model="restoreConfirmText"
          label='Type "REPLACE" to confirm'
          placeholder="REPLACE"
        />
        <p v-if="restoreError" class="error">{{ restoreError }}</p>
        <p v-if="restoreSuccess" class="success">{{ restoreSuccess }}</p>
        <div class="restore-modal__actions">
          <AppButton variant="ghost" type="button" :disabled="restoring" @click="closeRestoreModal">Cancel</AppButton>
          <AppButton
            variant="danger"
            type="button"
            :disabled="restoring || restoreConfirmText !== 'REPLACE' || !restoreFile"
            @click="confirmRestore"
          >
            {{ restoring ? 'Restoring…' : 'Replace all data' }}
          </AppButton>
        </div>
      </div>
    </AppModal>

  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Card language match (DashboardPage/TodosPage/BinderPage precedent): white
   rounded-16px surface + soft elevation shadow instead of AppCard's default
   centered-modal look, which this page overrides the same way BinderPage's
   .binder-help / .binder-section do. */
.settings-card {
  max-width: none;
  margin: 0;
  padding: 20px;
  text-align: left;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
}

.settings-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.settings-card__header h3 {
  margin: 0;
}

/* Icon tiles: 44x44px rounded-12px squares with a gradient background and a
   white lucide icon, matching DashboardPage/BinderPage/TodosPage's shared
   icon-tile language. Each section gets a distinct gradient identity from
   the token families (accent/complement) rather than a new hex. */
.settings-icon-tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
}

.settings-icon-tile--household { background: linear-gradient(135deg, var(--accent-soft), var(--accent)); }
.settings-icon-tile--profile { background: linear-gradient(135deg, var(--complement-mid), var(--complement)); }
.settings-icon-tile--members { background: linear-gradient(135deg, var(--tile-recipe-start), var(--accent)); }
.settings-icon-tile--data { background: linear-gradient(135deg, var(--tile-library), var(--tile-library-deep)); }
.settings-icon-tile--appearance { background: linear-gradient(135deg, var(--accent-soft), var(--complement)); }

/* Colorway picker -- a grid of swatch buttons (radiogroup) rather than a
   native <select>, since this is a visual picker and native controls are
   avoided app-wide. Each button shows the theme's 4 raw hexes as small
   dots (so the choice is
   recognizable before it's applied), independent of the CSS variables the
   selection actually swaps app-wide. */
.colorway-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}

.colorway-swatch {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-height: var(--control-min);
  padding: 12px 10px;
  border: 2px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  font: var(--type-label);
  color: var(--text);
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
}

.colorway-swatch:hover {
  border-color: color-mix(in srgb, var(--text) 30%, var(--border));
}

.colorway-swatch:disabled {
  cursor: default;
  opacity: 0.7;
}

.colorway-swatch--selected {
  border-color: var(--accent);
  background: var(--accent-container);
  color: var(--on-accent-container);
}

.colorway-swatch__dots {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--elevation-1);
  flex: none;
}

.colorway-swatch__dot {
  width: 100%;
  height: 100%;
}

.colorway-swatch__label {
  font-weight: 600;
}

.colorway-swatch__check {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--accent);
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.success {
  color: var(--accent);
  font-size: 14px;
}

.hint {
  color: var(--text-muted);
  font: var(--type-label);
  font-size: 12px;
  margin: 0 0 8px;
}

.avatar-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.avatar-preview {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--accent-container);
  color: var(--on-accent-container);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 20px;
  flex-shrink: 0;
}

.avatar-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.avatar-upload-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.avatar-upload-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* This row wraps at narrow widths (avatar + name/email block
   + role select all fixed/shrinking together would otherwise overlap on a
   real phone viewport -- min-width:0 defeats flex-wrap). .member-row__body gets a real min-width
   below so it triggers the wrap instead of shrinking indefinitely. */
.member-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  width: 100%;
}

.member-row__avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.member-row__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.member-row__avatar span {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--on-accent-container);
  font-weight: 600;
  font-size: 14px;
}

.member-row__body {
  flex: 1;
  /* Real min-width (not 0) so this block triggers .member-row's flex-wrap
     instead of shrinking indefinitely against the fixed-width role select
     next to it -- the min-width:0-defeats-wrap bug documented above. */
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.member-row__name-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.member-row__name {
  font-weight: 600;
}

.member-role-select {
  flex: none;
  font: var(--type-label);
}

.export-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 8px;
}

/* Flex-wrap fix: title/hint block wraps onto its own line above the
   Download button at narrow widths instead of both being squeezed until
   they overlap -- .export-option__body gets a real min-width below so it
   actually triggers the wrap (the min-width:0-defeats-wrap bug documented
   on .member-row above). */
.export-option {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px 16px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.export-option__body {
  flex: 1;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.export-option .app-btn {
  flex: none;
}

.export-option__body .hint {
  margin: 0;
}

.restore-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.restore-modal {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 320px;
}

.restore-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--danger);
  font: var(--type-body);
  margin: 0;
}

.restore-warning__icon {
  flex: none;
  margin-top: 2px;
}

.restore-modal__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.restore-stuck__copy {
  font: var(--type-body);
  margin: 0;
}

.add-device__url {
  font: var(--type-label);
  text-align: center;
  overflow-wrap: anywhere;
  margin: 0;
}

.relay-setup {
  display: grid;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}

.relay-setup h4 {
  margin: 0;
  font-size: 1rem;
}

.relay-setup__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

</style>
