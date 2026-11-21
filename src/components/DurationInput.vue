<script setup>
// A minutes field that also takes hours (ISS-45): type 5h, 1.5h, 1h30, 1:30 or plain minutes (90).
// Shows the value as 45m / 5h / 1h30m; ↑/↓ step 5 min (⇧ 15). Anything unreadable reverts on blur.
import { ref, watch } from 'vue'
import { parseDuration, fmtDuration } from '../store'

const props = defineProps({ modelValue: { type: Number, default: 0 } })
const emit = defineEmits(['update:modelValue', 'change'])
const text = ref(fmtDuration(props.modelValue))
const bad = ref(false)
watch(() => props.modelValue, (v) => { if (parseDuration(text.value) !== v) text.value = fmtDuration(v) })

function commit() {
  const v = parseDuration(text.value)
  bad.value = false
  if (v === null) { text.value = fmtDuration(props.modelValue); return }
  text.value = fmtDuration(v)
  if (v !== props.modelValue) { emit('update:modelValue', v); emit('change', v) }
}
function step(e, dir) {
  const base = parseDuration(text.value) ?? props.modelValue ?? 0
  const v = Math.max(0, base + dir * (e.shiftKey ? 15 : 5))
  text.value = fmtDuration(v)
  emit('update:modelValue', v); emit('change', v)
}
</script>

<template>
  <input
    v-model="text" type="text" inputmode="text" autocomplete="off" spellcheck="false" class="input mono" :class="{ bad }"
    title="Minutes or hours: 45, 45m, 5h, 1.5h, 1h30, 1:30 · ↑/↓ ±5 min (⇧ ±15)"
    @input="bad = text.trim() !== '' && parseDuration(text) === null"
    @change="commit" @blur="commit" @keydown.enter.prevent="commit(); $event.target.blur()"
    @keydown.up.prevent="step($event, 1)" @keydown.down.prevent="step($event, -1)"
  />
</template>

<style scoped>
.bad { border-color: var(--danger); }
</style>
