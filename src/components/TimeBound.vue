<script setup>
// A goal's time bound: an end date (date picker) or Continuous (no end). Problems from `boundIssues` show as an amber mark.
// v-model:locked freezes it (no date edits here, no dragging in the goal flow); the lock button only shows on hover until used.
import { computed } from 'vue'
import { CONTINUOUS } from '../glance'

const props = defineProps({ modelValue: { type: String, default: '' }, issues: { type: Array, default: () => [] }, locked: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'update:locked'])
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '')
const cont = computed(() => props.modelValue === CONTINUOUS)
const toggle = () => emit('update:modelValue', cont.value ? '' : CONTINUOUS)
</script>

<template>
  <div class="tb" :class="{ bad: issues.length }" :title="issues.join('\n')" @click.stop>
    <span v-if="cont" class="cont mono">∞ Continuous</span>
    <input v-else type="date" class="input ghost mono tb-in" :disabled="locked" :value="isDate(modelValue) ? modelValue : ''" @change="emit('update:modelValue', $event.target.value)" />
    <button v-if="!locked" type="button" class="tb-btn" :class="{ on: cont }" :title="cont ? 'Give it an end date instead' : 'Make it continuous (no end date)'" @click="toggle">
      <span class="icon sm">{{ cont ? 'event' : 'all_inclusive' }}</span>
    </button>
    <button type="button" class="tb-btn lock" :class="{ on: locked }" :title="locked ? 'Time bound locked: click to unlock' : 'Lock the time bound (stops edits and dragging in the goal flow)'" @click="emit('update:locked', !locked)">
      <span class="icon sm">{{ locked ? 'lock' : 'lock_open' }}</span>
    </button>
    <span v-if="issues.length" class="icon sm warn">error</span>
  </div>
</template>

<style scoped>
.tb { display: flex; align-items: center; gap: 2px; min-width: 0; }
.tb-in { flex: 1; min-width: 0; height: 24px; font-size: 11px; padding: 0 2px; }
.tb-in::-webkit-calendar-picker-indicator { margin-left: 2px; padding: 0; opacity: 0.6; }
.cont { flex: 1; font-size: 11px; color: var(--muted); padding: 0 2px; white-space: nowrap; }
.tb-btn { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; height: 20px; display: inline-flex; align-items: center; }
.tb-btn:hover, .tb-btn.on { color: var(--accent); }
.tb-btn .icon, .warn.icon { font-size: 14px; }
.bad .tb-in { color: var(--warn); }
/* unlocked: the lock button stays out of sight until the cell is hovered (opacity, so it's still tappable) */
.lock:not(.on) { opacity: 0; }
.tb:hover .lock, .lock:focus-visible { opacity: 1; }
.lock.on { color: var(--muted); }
.lock.on:hover { color: var(--accent); }
.tb-in:disabled { opacity: 1; color: var(--muted); cursor: default; }
.tb-in:disabled::-webkit-calendar-picker-indicator { display: none; }
</style>
