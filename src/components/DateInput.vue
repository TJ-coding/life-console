<script setup>
// A date field that only passes on dates you'd mean (ISS-34). While you type a year, Chrome's date input
// steps through 0002 → 0020 → 0202 → 2027 and also accepts years like 12020; writing each of those to the
// planner made deadlines jump to "overdue", re-sort, sync junk and break the countdown. Here a value is
// emitted only when it's a real date with a four-digit year from 1900 to 2199, or '' when the field is cleared.
import { ref } from 'vue'

defineProps({ modelValue: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const ok = (v) => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && +v.slice(0, 4) >= 1900 && +v.slice(0, 4) <= 2199)
// what's in the box while focused, so a re-render (the clock ticks every second) can't reset a half-typed date
const typing = ref(null)
function onInput(e) {
  typing.value = e.target.value
  if (ok(e.target.value)) emit('update:modelValue', e.target.value)
}
</script>

<template>
  <input type="date" :value="typing ?? modelValue ?? ''" max="2199-12-31" @focus="typing = $event.target.value" @input="onInput" @blur="typing = null" />
</template>
