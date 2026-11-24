<script setup>
// An extension running on demo data before you install it: the workshop's sandboxed preview (preview.html: its own
// nameless origin, no cookies, no network), fed one published version's code.
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({ hash: { type: String, required: true }, name: { type: String, required: true } })
const frame = ref(null)
const height = ref(200)
const err = ref('')
let code = null

function send() { if (code != null) frame.value?.contentWindow?.postMessage({ type: 'run', code, name: props.name.split('/').pop(), theme: document.documentElement.dataset.theme }, '*') }
function onMessage(e) {
  if (e.source !== frame.value?.contentWindow || e.data?.source !== 'lc-preview') return
  if (e.data.type === 'ready') send()
  else if (e.data.type === 'result') { if (e.data.height) height.value = Math.min(700, Math.max(120, e.data.height + 16)); if (!e.data.ok) err.value = (e.data.errors ?? []).join('; ') }
}
onMounted(async () => {
  window.addEventListener('message', onMessage)
  try {
    const r = await fetch(`/api/registry/code/${props.hash}.js`, { credentials: 'same-origin' })
    if (!r.ok) throw new Error(`couldn't load it (${r.status})`)
    code = await r.text()
    send()
  } catch (e) { err.value = e.message }
})
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <div class="ext-preview">
    <iframe ref="frame" sandbox="allow-scripts" src="/preview.html" :title="`Preview of ${name}`" :style="{ height: height + 'px' }"></iframe>
    <p v-if="err" class="small danger">{{ err }}</p>
  </div>
</template>

<style scoped>
iframe { width: 100%; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); display: block; }
.danger { color: var(--danger); margin: 4px 0 0; }
</style>
