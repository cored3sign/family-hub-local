<script setup>
import RelayJoinBanner from './components/RelayJoinBanner.vue'
import PinPrompt from './components/PinPrompt.vue'
</script>

<template>
  <router-view />
  <!-- Mounted once at the app root (not per-page) so the
       interaction listener and any-time-visible banner cover the whole app,
       not just whichever module happens to be on screen. -->
  <UpdatePrompt />
  <RelayJoinBanner />
  <PinPrompt />
</template>
