<script setup>
// Celebration confetti for Goal completion. Canvas
// + plain 2D context, no npm library: this is a single one-off effect, not
// worth a dependency. Colors are read from the CURRENT theme's --accent/
// --accent-deep/--complement via getComputedStyle (not hardcoded hex) so it
// adapts across all 8 [data-theme] palettes in style.css. Fires once on
// mount and tears itself down — GoalsPage owns showing/hiding this
// component with v-if, this component just owns the burst itself.
import { onMounted, onBeforeUnmount, ref } from 'vue'

const emit = defineEmits(['done'])

const canvasEl = ref(null)
const DURATION_MS = 1600
const PARTICLE_COUNT = 40

let rafHandle = null
let doneTimer = null

function themeColors() {
  const styles = getComputedStyle(document.documentElement)
  return [
    styles.getPropertyValue('--accent').trim(),
    styles.getPropertyValue('--accent-deep').trim(),
    styles.getPropertyValue('--complement').trim(),
  ].filter(Boolean)
}

function makeParticles(width, colors) {
  const particles = []
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random() * width,
      y: -20 - Math.random() * 200,
      size: 5 + Math.random() * 5,
      color: colors[i % colors.length],
      speedY: 2 + Math.random() * 3,
      driftX: (Math.random() - 0.5) * 2,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.3,
    })
  }
  return particles
}

function runAnimation() {
  const canvas = canvasEl.value
  const ctx = canvas.getContext('2d')
  const width = (canvas.width = window.innerWidth)
  const height = (canvas.height = window.innerHeight)
  const particles = makeParticles(width, themeColors())
  const start = performance.now()

  function frame(now) {
    const elapsed = now - start
    ctx.clearRect(0, 0, width, height)
    for (const p of particles) {
      p.x += p.driftX
      p.y += p.speedY
      p.rotation += p.spin
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
      ctx.restore()
    }
    if (elapsed < DURATION_MS && height > 0) {
      rafHandle = requestAnimationFrame(frame)
    }
  }
  rafHandle = requestAnimationFrame(frame)
}

onMounted(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // No meaningful "reduced" version of a particle burst -- skip the
  // animation entirely rather than attempt a token version of it.
  if (!reduceMotion) {
    runAnimation()
  }
  doneTimer = setTimeout(() => emit('done'), reduceMotion ? 0 : DURATION_MS)
})

onBeforeUnmount(() => {
  if (rafHandle) cancelAnimationFrame(rafHandle)
  if (doneTimer) clearTimeout(doneTimer)
})
</script>

<template>
  <canvas ref="canvasEl" class="confetti-burst" aria-hidden="true"></canvas>
</template>

<style scoped>
.confetti-burst {
  position: fixed;
  inset: 0;
  z-index: 1000;
  pointer-events: none;
}
</style>
