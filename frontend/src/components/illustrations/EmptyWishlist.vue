<template>
  <svg viewBox="0 0 600 480" aria-hidden="true">
    <!-- A wrapped present with a bow and a few sparkles: the Wish module's empty state. -->
    <path class="fh-line" d="M120 424 L480 424" />
    <rect class="fh-shirt" x="170" y="230" width="260" height="190" rx="8" />
    <rect class="fh-shirt" x="156" y="180" width="288" height="52" rx="8" />
    <rect class="fh-ribbon" x="282" y="230" width="36" height="190" />
    <rect class="fh-ribbon" x="282" y="180" width="36" height="52" />
    <path class="fh-ribbon" d="M300 180 C262 118 200 110 210 150 C218 178 270 182 300 180 Z" />
    <path class="fh-ribbon" d="M300 180 C338 118 400 110 390 150 C382 178 330 182 300 180 Z" />
    <ellipse class="fh-ribbon" cx="300" cy="178" rx="16" ry="12" />
    <path class="fh-spark" :d="star(92, 150, 22)" />
    <path class="fh-spark" :d="star(500, 116, 16)" />
    <path class="fh-spark" :d="star(528, 262, 18)" />
    <path class="fh-spark" :d="star(70, 306, 12)" />
    <circle class="fh-spark" cx="140" cy="96" r="5" />
    <circle class="fh-spark" cx="470" cy="196" r="5" />
    <circle class="fh-spark" cx="116" cy="382" r="5" />
    <circle class="fh-spark" cx="486" cy="392" r="5" />
  </svg>
</template>

<script setup>
// A four-pointed sparkle centred on (x, y) with arm length s.
function star(x, y, s) {
  const k = s * 0.15
  return `M${x} ${y - s} Q${x + k} ${y - k} ${x + s} ${y} Q${x + k} ${y + k} ${x} ${y + s} Q${x - k} ${y + k} ${x - s} ${y} Q${x - k} ${y - k} ${x} ${y - s} Z`
}
</script>

<style scoped>
.fh-line {
  fill: none;
  stroke: var(--fh-illustration-primary, var(--accent));
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.fh-shirt {
  fill: var(--fh-illustration-secondary, var(--complement));
  stroke: var(--fh-illustration-primary, var(--accent));
  stroke-width: 6;
  stroke-linejoin: round;
}

.fh-ribbon {
  fill: var(--fh-illustration-primary, var(--accent));
  stroke: var(--fh-illustration-primary, var(--accent));
  stroke-width: 6;
  stroke-linejoin: round;
}

.fh-spark {
  fill: var(--fh-illustration-primary, var(--accent));
}
</style>
