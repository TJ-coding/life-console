<script setup>
// One plugin part in its own box (a slot entry, a page, a settings section). If it throws, only this box says so.
import { ref, onMounted, onBeforeUnmount, onErrorCaptured, watch } from 'vue'
import { mountPart } from '../sdk/mount.js'
import { publicIds } from '../sdk/publicIds.js'
import { registry } from '../sdk'
import { plugins } from '../sdk/loader.js'

const props = defineProps({ part: { type: [Object, Function], required: true }, module: { type: String, required: true }, data: { type: Object, default: () => ({}) } })
const el = ref(null)
const failed = ref(false)
let cleanup = () => {}
const title = () => registry.byId[props.module]?.title ?? props.module
function mount() {
  cleanup()
  failed.value = false
  cleanup = mountPart(el.value, props.part, { pluginId: registry.byId[props.module]?.pkg ?? props.module, props: props.data, publicPart: publicIds.has(props.module), onError: () => { failed.value = true } })
}
onMounted(mount)
watch(() => props.part, mount)
onBeforeUnmount(() => cleanup())
// just installed: scroll to it and pulse its outline (src/main.js showAdded)
const pkg = () => registry.byId[props.module]?.pkg
const fresh = ref(false)
watch(() => plugins.highlight, (h) => {
  fresh.value = !!h && h === pkg()
  if (fresh.value) requestAnimationFrame(() => el.value?.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
}, { immediate: true })
onErrorCaptured((e) => { console.warn(`[plugin] ${props.module}`, e); failed.value = true; return false })
</script>
<template>
  <div class="plugin-part" :class="{ fresh }" :data-plugin="module">
    <p v-if="failed" class="small muted plugin-off"><span class="icon sm">extension_off</span>{{ title() }} is unavailable</p>
    <div v-show="!failed" ref="el"></div>
  </div>
</template>
<style scoped>
.plugin-off { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
.plugin-part.fresh { border-radius: 4px; animation: plugin-fresh 1.2s ease-in-out 3; }
@keyframes plugin-fresh { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 0 3px var(--accent); } }
</style>
