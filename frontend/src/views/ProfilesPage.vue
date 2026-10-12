<script setup>
import { useRouter } from 'vue-router'
import { useCoreStore } from '../stores/core'
import { useLive } from '../data/vue'
import { listMembers } from '../data/members'
import { assetUrl } from '../data/assets'

// "Who's using this device?" -- stored locally (data/session.js), never in
// the shared doc. New members are added by an admin in Settings.
const core = useCoreStore()
const router = useRouter()
const members = useLive(listMembers)

function choose(id) {
  core.selectMember(id)
  router.push('/')
}

function initials(name) {
  return (name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
}
</script>

<template>
  <AppCard class="profiles-card">
    <h1>Who's using {{ core.familyName || 'Family Hub' }}?</h1>
    <ul class="profile-grid">
      <li v-for="m in members" :key="m.id">
        <button type="button" class="profile-tile" @click="choose(m.id)">
          <span class="profile-avatar" :style="{ background: m.avatar_color }">
            <img v-if="assetUrl(m.avatar_asset_id)" :src="assetUrl(m.avatar_asset_id)" alt="" />
            <span v-else>{{ initials(m.name) }}</span>
          </span>
          <span class="profile-name">{{ m.name }}</span>
        </button>
      </li>
    </ul>
  </AppCard>
</template>

<style scoped>
/* Wider than the default .app-card (login/setup's single-column form) --
   this page shows a grid of member tiles, which needs breathing room. */
.profiles-card {
  max-width: 480px;
}
.profile-grid { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 16px; }
.profile-tile { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; padding: 12px 4px; border: 0; background: none; cursor: pointer; border-radius: 12px; }
.profile-tile:hover, .profile-tile:focus-visible { background: var(--surface-variant); }
.profile-avatar { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 700; overflow: hidden; margin: 0 auto; }
.profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
.profile-name { font-weight: 600; }
</style>
