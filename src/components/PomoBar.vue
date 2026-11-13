<script setup>
// Progress bar for a pomodoro sitting (ISS-25): one piece per pomodoro, a lighter piece for each break, so the
// shape of the block — and where you are in it — reads at a glance. Pieces are sized by minutes.
import { computed } from 'vue'

const props = defineProps({
  segs: { type: Array, required: true }, // [{ work, start, end, brk }] minutes from the block start
  elapsed: { type: Number, required: true }, // seconds since the block started
})
const pieces = computed(() => props.segs.flatMap((s, i) => {
  const out = [{ key: `w${i}`, kind: 'work', min: s.work, pct: Math.max(0, Math.min(100, ((props.elapsed - s.start * 60) / (s.work * 60)) * 100)) }]
  if (s.brk) {
    const from = s.end * 60
    out.push({ key: `b${i}`, kind: 'brk', min: s.brk, pct: Math.max(0, Math.min(100, ((props.elapsed - from) / (s.brk * 60)) * 100)) })
  }
  return out
}))
</script>

<template>
  <div class="pbar" role="progressbar" :aria-valuenow="Math.round(elapsed / 60)">
    <template v-for="p in pieces" :key="p.key">
      <div v-if="p.kind === 'work'" class="work" :style="{ flexGrow: p.min }"><i :style="{ width: p.pct + '%' }"></i></div>
      <div v-else class="brk" :style="{ flexGrow: p.min }" :title="`${p.min}m break`"><i :style="{ width: p.pct + '%' }"></i></div>
    </template>
  </div>
</template>

<style scoped>
.pbar { display: flex; align-items: center; gap: 4px; height: 8px; }
.work { flex-basis: 0; height: 100%; min-width: 6px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
.work > i { display: block; height: 100%; background: var(--c, var(--accent)); }
/* a break: same thickness, a lighter line between the gaps, so the bar still reads as one block */
.brk { flex-basis: 0; min-width: 8px; height: 100%; background: color-mix(in srgb, var(--text) 30%, transparent); border-radius: 2px; overflow: hidden; }
.brk > i { display: block; height: 100%; background: color-mix(in srgb, var(--c, var(--accent)) 45%, #fff); }
/* light theme: "lighter" means a pale tint of the task colour, not near-white on a white card */
:root[data-theme='light'] .brk { background: color-mix(in srgb, var(--c, var(--accent)) 18%, var(--surface)); }
:root[data-theme='light'] .brk > i { background: color-mix(in srgb, var(--c, var(--accent)) 45%, var(--surface)); }
</style>
