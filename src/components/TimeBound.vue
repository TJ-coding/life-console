<script setup>
// A goal's time bound: an end date (date picker) or Continuous (no end). Problems from `boundIssues` show as an amber mark.
import { computed } from 'vue'
import { CONTINUOUS } from '../glance'

const props = defineProps({ modelValue: { type: String, default: '' }, issues: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue'])
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '')
const cont = computed(() => props.modelValue === CONTINUOUS)
const toggle = () => emit('update:modelValue', cont.value ? '' : CONTINUOUS)
</script>

<template>
  <div class="tb" :class="{ bad: issues.length }" :title="issues.join('\n')" @click.stop>
    <span v-if="cont" class="cont mono">∞ Continuous</span>
    <input v-else type="date" class="input ghost mono tb-in" :value="isDate(modelValue) ? modelValue : ''" @change="emit('update:modelValue', $event.target.value)" />
    <button type="button" class="tb-btn" :class="{ on: cont }" :title="cont ? 'Give it an end date instead' : 'Make it continuous (no end date)'" @click="toggle">
      <span class="icon sm">{{ cont ? 'event' : 'all_inclusive' }}</span>
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
</style>
