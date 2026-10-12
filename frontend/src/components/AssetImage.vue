<script setup>
// An image whose bytes live in the asset doc. Those bytes can sync in after
// the record that references them, so until they do this shows a
// placeholder; assetUrl is reactive, so the <img> appears on its own.
// Classes and other attributes fall through to whichever element renders,
// so the placeholder takes the same size as the image would.
import { computed } from 'vue'
import { Image as ImageIcon } from 'lucide-vue-next'
import { assetUrl } from '../data/assets'

const props = defineProps({
  assetId: { type: String, default: null },
  alt: { type: String, default: '' },
})

const url = computed(() => assetUrl(props.assetId))
</script>

<template>
  <img v-if="url" :src="url" :alt="alt" />
  <span v-else class="asset-placeholder" role="img" aria-label="Image loading">
    <ImageIcon :size="20" aria-hidden="true" />
  </span>
</template>

<style scoped>
.asset-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 24px;
  min-height: 24px;
  background: color-mix(in srgb, var(--text) 6%, var(--surface));
  color: var(--text-muted);
}
</style>
