<script setup>
defineProps({ modelValue: String })
const emit = defineEmits(['update:modelValue'])
</script>
<template>
  <span class="lsd" @click.stop>
    <button v-for="k in ['L', 'S', 'D']" :key="k" :class="{ on: modelValue === k }" :title="{ L: 'Large', S: 'Small', D: 'Daily' }[k]" @click="emit('update:modelValue', k)">{{ k }}</button>
  </span>
</template>
<style scoped>
.lsd { display: inline-flex; border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
button { width: 17px; height: 18px; border: 0; background: transparent; font: 600 10px/1 'JetBrains Mono', monospace; color: var(--muted); cursor: pointer; padding: 0; }
button + button { border-left: 1px solid var(--border); }
button:hover { background: var(--surface-2); }
button.on { background: color-mix(in srgb, var(--info) 22%, transparent); color: var(--info); }
</style>
