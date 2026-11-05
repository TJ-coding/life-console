<script setup>
import { computed } from 'vue'
import { getStamps, toggleStamp, STAMPS, STAMP_NAMES, hhmm } from '../store'
const props = defineProps({ date: { type: String, required: true }, size: { type: Number, default: 28 }, showTimes: Boolean })
const stamps = computed(() => getStamps(props.date))
const tilt = [-4, 3, -2, 4]
</script>
<template>
  <div class="stamps">
    <div v-for="(g, i) in STAMPS" :key="i" class="cell">
      <button
        class="stamp" :class="{ on: stamps[i] }"
        :style="{ width: size + 'px', height: size + 'px', fontSize: (g.length > 1 ? size * 0.32 : size * 0.46) + 'px', transform: stamps[i] ? `rotate(${tilt[i]}deg)` : 'none' }"
        :title="`${STAMP_NAMES[i]}${stamps[i] ? ' · ' + hhmm(stamps[i]) : ''}`"
        @click.stop="toggleStamp(date, i)"
      >{{ g }}</button>
      <span v-if="showTimes" class="t mono" :class="{ on: stamps[i] }">{{ stamps[i] ? hhmm(stamps[i]) : '--:--' }}</span>
    </div>
  </div>
</template>
<style scoped>
.stamps { display: flex; gap: 6px; align-items: flex-start; }
.cell { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.stamp {
  border-radius: 50%; border: 1.5px dashed color-mix(in srgb, var(--stamp) 70%, transparent); background: transparent;
  color: color-mix(in srgb, var(--stamp) 45%, transparent); font-family: 'Noto Sans JP', sans-serif; font-weight: 700;
  display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; letter-spacing: -0.05em; line-height: 1;
  transition: transform 0.12s;
}
.stamp:hover { color: var(--stamp); }
.stamp.on { border-style: solid; color: var(--stamp); background: color-mix(in srgb, var(--stamp) 10%, transparent); }
.t { font-size: 10px; color: var(--muted); }
.t.on { color: var(--stamp); }
</style>
