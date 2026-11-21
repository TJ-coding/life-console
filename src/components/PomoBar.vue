<script setup>
// Progress bar for a pomodoro sitting (ISS-25): one piece per pomodoro, a gap for each break, so the
// shape of the block — and where you are in it — reads at a glance. Pieces are sized by minutes.
import { computed } from 'vue'

const props = defineProps({
  segs: { type: Array, required: true }, // [{ work, start, end, brk }] minutes from the block start
  elapsed: { type: Number, required: true }, // seconds since the block started
  outline: { type: Boolean, default: false }, // outline the piece you're in (the clock counts to its end)
})
const pieces = computed(() => props.segs.flatMap((s, i) => {
  const out = [{ key: `w${i}`, kind: 'work', min: s.work, now: props.elapsed >= s.start * 60 && props.elapsed < s.end * 60, pct: Math.max(0, Math.min(100, ((props.elapsed - s.start * 60) / (s.work * 60)) * 100)) }]
  if (s.brk) {
    const from = s.end * 60
    // ISS-40: a break fills left to right like a pomodoro does, so the dotted line shows time passing too
    const pct = Math.max(0, Math.min(100, ((props.elapsed - from) / (s.brk * 60)) * 100))
    out.push({ key: `b${i}`, kind: 'brk', min: s.brk, now: pct > 0 && pct < 100, past: pct >= 100, pct })
  }
  return out
}))
</script>

<template>
  <div class="pbar" role="progressbar" :aria-valuenow="Math.round(elapsed / 60)">
    <template v-for="p in pieces" :key="p.key">
      <div v-if="p.kind === 'work'" class="work" :class="{ cur: outline && p.now }" :style="{ flexGrow: p.min }"><i :style="{ width: p.pct + '%' }"></i></div>
      <div v-else class="brk" :class="{ now: p.now, past: p.past, cur: outline && p.now }" :style="{ flexGrow: p.min }" :title="`${p.min}m break`"><i class="gone" :style="{ flexGrow: p.pct }"></i><i class="left" :style="{ flexGrow: 100 - p.pct }"></i></div>
    </template>
  </div>
</template>

<style scoped>
.pbar { display: flex; align-items: center; gap: 4px; height: 8px; }
.work { flex-basis: 0; height: 100%; min-width: 6px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
.work > i { display: block; height: 100%; background: var(--c, var(--accent)); }
/* a break is a gap with a faint dotted line, so the bar still reads as one block */
.brk { flex-basis: 0; min-width: 8px; height: 100%; display: flex; align-items: center; border-radius: 2px; }
.brk > i { flex-basis: 0; border-top: 2px dotted var(--border); }
/* the part of the break that has passed: bright while it runs, faint once it's over */
.brk > .gone { border-top-color: var(--accent); }
.brk.past > .gone { border-top-color: color-mix(in srgb, var(--c, var(--accent)) 45%, transparent); }
/* the piece the clock counts down (ISS-25) */
.cur { outline: 1.5px solid color-mix(in srgb, var(--accent) 70%, transparent); outline-offset: 2px; } /* a muted accent (Settings → Accent colour) */
</style>
