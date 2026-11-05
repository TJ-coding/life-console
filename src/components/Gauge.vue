<script setup>
import { computed } from 'vue'
import { CAPACITY_H } from '../store'
const props = defineProps({ hours: Number, cap: { type: Number, default: CAPACITY_H }, height: { type: Number, default: 96 }, width: { type: Number, default: 14 }, horizontal: Boolean })
const pct = computed(() => Math.min(100, (props.hours / props.cap) * 100))
const level = computed(() => (props.hours > props.cap + 1 ? 'danger' : props.hours > props.cap ? 'warn' : 'ok'))
</script>
<template>
  <div v-if="horizontal" class="bar" :class="level === 'ok' ? '' : level" :title="`${hours.toFixed(1)} / ${cap} h`"><i :style="{ width: pct + '%' }"></i></div>
  <div v-else class="gauge" :style="{ height: height + 'px', width: width + 'px' }" :title="`${hours.toFixed(1)} / ${cap} h`">
    <div class="fill" :class="level" :style="{ height: pct + '%' }"></div>
    <i v-for="n in cap - 1" :key="n" class="tick" :style="{ bottom: (n / cap) * 100 + '%' }"></i>
  </div>
</template>
<style scoped>
.gauge { position: relative; background: var(--surface-2); border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
.fill { position: absolute; left: 0; right: 0; bottom: 0; background: var(--accent); transition: height 0.2s; }
.fill.warn { background: var(--warn); }
.fill.danger { background: var(--danger); }
.tick { position: absolute; left: 0; right: 0; height: 1px; background: var(--bg); opacity: 0.6; }
</style>
