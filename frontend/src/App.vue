<script setup>
import RelayJoinBanner from './components/RelayJoinBanner.vue'
</script>

<template>
  <router-view />
  <!-- Mounted once at the app root (not per-page) so the
       interaction listener and any-time-visible banner cover the whole app,
       not just whichever module happens to be on screen. -->
  <UpdatePrompt />
  <RelayJoinBanner />
</template>
