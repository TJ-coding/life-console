<script setup>
// S-97 Workshop (goal 7): editing mode, a separate place. Describe the plugin, copy the prompt to your own AI (no
// planner data in it), paste the file back, try it on demo data in a sandboxed preview, publish it (private by
// default) and install it through the trusted page. Drafts never run in the console itself.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { api, trustUrl } from '../sdk/client.js'
import { workshopPrompt, STARTER } from '../sdk/prompt.js'
import { auth } from '../auth'
import { toast } from '../store'

const DRAFT = 'life-console/workshop-draft'
const saved = (() => { try { return JSON.parse(localStorage.getItem(DRAFT) || 'null') } catch { return null } })()
const describe = ref(saved?.describe ?? '')
const code = ref(saved?.code ?? STARTER)
const slug = ref(saved?.slug ?? 'water')
const version = ref(saved?.version ?? '0.1.0')
const visibility = ref('private')
const changelog = ref('')
const frame = ref(null)
const result = ref(null)
const height = ref(320)
const published = ref(null)
const busy = ref(false)
const persist = () => { try { localStorage.setItem(DRAFT, JSON.stringify({ describe: describe.value, code: code.value, slug: slug.value, version: version.value })) } catch { /* storage off */ } }

// a plugin's own terms start with its name (water.Glass for a plugin called water): when the name changes, rename
// them too, and when they don't match, say so and offer both fixes
const ns = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '-')
const termPrefix = (s) => new RegExp(`(['"\`])${s.replace(/[-]/g, '\\-')}\\.(?=[A-Za-z])`, 'g')
function renameTerms(from, to) {
  if (!from || !to || from === to) return false
  const next = code.value.replace(termPrefix(from), `$1${to}.`)
  if (next === code.value) return false
  code.value = next
  return true
}
watch(slug, (now, before) => {
  if (renameTerms(ns(before), ns(now))) { toast(`Renamed ${ns(before)}.* to ${ns(now)}.* to match the plugin's name`); run() }
})
/** Terms named after something other than the plugin, from the preview's problems: { from, to } or null. */
const mismatch = computed(() => {
  for (const p of result.value?.problems ?? []) {
    const m = /"([a-z0-9-]+)\.[^"]+" must start with "([a-z0-9-]+)\."/.exec(p)
    if (m) return { from: m[1], to: m[2] }
  }
  return null
})
function fixByRenaming() { if (renameTerms(mismatch.value.from, mismatch.value.to)) run() }
function fixByName() { const f = mismatch.value.from; slug.value = f }

const name = computed(() => `${auth.user?.handle ?? 'you'}/${slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`)
function run() {
  persist()
  result.value = null
  frame.value?.contentWindow?.postMessage({ type: 'run', code: code.value, name: slug.value, theme: document.documentElement.dataset.theme }, '*')
}
function onMessage(e) {
  if (e.source !== frame.value?.contentWindow || e.data?.source !== 'lc-preview') return
  if (e.data.type === 'ready') run()
  else if (e.data.type === 'result') { result.value = e.data; if (e.data.height) height.value = Math.min(900, Math.max(240, e.data.height + 24)) }
  else if (e.data.type === 'toast') toast(`Preview: ${e.data.text}`)
  else if (e.data.type === 'error') result.value = { ...(result.value ?? {}), ok: false, errors: [...(result.value?.errors ?? []), e.data.text] }
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

async function copyPrompt() {
  persist()
  const text = workshopPrompt(describe.value, code.value === STARTER ? '' : code.value)
  try { await navigator.clipboard.writeText(text); toast('Prompt copied: paste it into your AI, then paste its file below') } catch { toast("Couldn't copy: select the text in the prompt box instead") }
}
const showPrompt = ref(false)
const promptText = computed(() => workshopPrompt(describe.value, code.value === STARTER ? '' : code.value))
function pasteBack(text) {
  const t = String(text ?? '').replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim()
  if (t) { code.value = t + '\n'; run() }
}

const pasteClipboard = () => navigator.clipboard?.readText?.().then(pasteBack).catch(() => toast('Paste into the box instead'))

const manifestOf = () => { const m = result.value?.manifest ?? {}; return { title: m.title, description: m.description, icon: m.icon, sdk: m.sdk, says: m.says, replaces: m.replaces } }
/** "Use it": save this version (only you can see it) and install it, with one confirmation; you land on Today. */
async function useIt() {
  busy.value = true
  try {
    const r = await api('POST', '/api/registry/publish', { name: slug.value, code: code.value, visibility: 'private', manifest: manifestOf() })
    if (r.name && auth.user && !auth.user.handle) auth.user.handle = r.name.split('/')[0]
    persist()
    location.href = trustUrl('install', { pkg: r.name, hash: r.hash }, '/app#/')
  } catch (e) { toast(e.message); busy.value = false }
}
/** Share it with everyone: the same, public, with a note for people who update. */
async function shareIt() {
  busy.value = true
  try {
    const r = await api('POST', '/api/registry/publish', { name: slug.value, code: code.value, visibility: 'public', changelog: changelog.value, manifest: manifestOf() })
    published.value = r
    toast(r.reused ? `${r.name} ${r.version} is already published` : `Published ${r.name} ${r.version} for everyone`)
  } catch (e) { toast(e.message) }
  busy.value = false
}
</script>

<template>
  <div class="ws">
    <div class="ws-bar"><span class="icon sm">construction</span><b>Workshop</b><span class="muted small">editing mode: drafts run on demo data in a sandbox, never on your planner</span><span class="spacer"></span><router-link to="/m/plugins" class="btn">Done</router-link></div>
    <div class="ws-grid">
      <section class="panel col">
        <div class="panel-h"><h2>1 · Name and describe it</h2></div>
        <div class="panel-b col">
          <label class="small name">Name <input v-model="slug" class="mono" aria-label="Plugin name" @change="persist" /></label>
          <textarea v-model="describe" rows="4" placeholder="e.g. Track my reading: books with a status, a Today card with what I'm reading, and a reminder at 21:00" @change="persist"></textarea>
          <div class="row wrap">
            <button class="btn primary" @click="copyPrompt"><span class="icon sm">content_copy</span>Copy prompt for your AI</button>
            <button class="btn" @click="showPrompt = !showPrompt">{{ showPrompt ? 'Hide' : 'Show' }} prompt</button>
          </div>
          <p class="small muted">The prompt has the SDK, the vocabulary and the culture, and none of your data. Paste the file your AI writes into step 2.</p>
          <textarea v-if="showPrompt" class="mono small" rows="10" readonly :value="promptText"></textarea>
        </div>
        <div class="panel-h"><h2>2 · The plugin file</h2><span class="spacer"></span><button class="btn" title="Paste from the clipboard" @click="pasteClipboard">Paste</button><button class="btn primary" @click="run"><span class="icon sm">play_arrow</span>Try it</button></div>
        <div class="panel-b col">
          <textarea v-model="code" class="mono code" rows="22" spellcheck="false" aria-label="Plugin file" @keydown.meta.enter="run" @keydown.ctrl.enter="run"></textarea>
          <p class="small muted">⌘/Ctrl + Enter to try it.</p>
        </div>
      </section>
      <section class="panel col">
        <div class="panel-h"><h2>3 · Preview on demo data</h2><span class="spacer"></span>
          <span v-if="result" class="chip" :class="result.ok ? 'ok' : 'bad'">{{ result.ok ? 'runs' : 'has problems' }}</span>
        </div>
        <div class="panel-b col">
          <iframe ref="frame" class="preview" sandbox="allow-scripts" src="/preview.html" title="Plugin preview" :style="{ height: height + 'px' }"></iframe>
          <ul v-if="result?.errors?.length" class="small bad"><li v-for="e in result.errors" :key="e">{{ e }}</li></ul>
          <div v-if="mismatch" class="fix small">
            <span>Your plugin is called <b class="mono">{{ mismatch.to }}</b>, but its types are named <b class="mono">{{ mismatch.from }}.…</b> A plugin's own names start with its name.</span>
            <div class="row wrap"><button class="btn primary" @click="fixByRenaming">Rename them to {{ mismatch.to }}.…</button><button class="btn" @click="fixByName">Call the plugin {{ mismatch.from }}</button></div>
          </div>
          <ul v-else-if="result?.problems?.length" class="small warn"><li v-for="p in result.problems" :key="p">{{ p }}</li></ul>
          <div v-if="result?.manifest" class="small muted">
            <b>{{ result.manifest.title }}</b> · {{ result.manifest.pages }} page(s) · slots: {{ result.manifest.slots.join(', ') || 'none' }} · types: {{ result.manifest.types.join(', ') || 'none' }}
            · talks to: {{ result.manifest.says.internet.join(', ') || 'no sites' }}<span v-if="result.manifest.replaces.length"> · replaces {{ result.manifest.replaces.join(', ') }}</span>
          </div>
        </div>
        <div class="panel-h"><h2>4 · Use it</h2></div>
        <div class="panel-b col">
          <div class="row wrap">
            <button class="btn primary big" :disabled="busy || !result?.ok" @click="useIt"><span class="icon sm">check_circle</span>Use it</button>
            <span class="small muted">Installs it for you (only you can see it). One confirmation, then you're back on Today.</span>
          </div>
          <details class="small">
            <summary class="muted">Share it with everyone</summary>
            <div class="col share">
              <input v-model="changelog" placeholder="What's new (people see this when they update)" aria-label="What's new" />
              <div class="row wrap"><button class="btn" :disabled="busy || !result?.ok" @click="shareIt"><span class="icon sm">public</span>Share {{ slug }}</button></div>
              <p v-if="published" class="muted">Shared as <span class="mono">{{ published.name }} {{ published.version }}</span>. Others find it in Plugins → Add plugins.</p>
              <ul v-if="published?.checks?.warnings?.length" class="warn"><li v-for="w in published.checks.warnings" :key="w.id">{{ w.msg }}</li></ul>
            </div>
          </details>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ws { padding: 0 16px 16px; }
.ws-bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin: 0 -16px 12px; background: var(--warn); color: #111; }
.ws-bar .muted { color: #333; }
.ws-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
@media (max-width: 900px) { .ws-grid { grid-template-columns: 1fr; } }
textarea, input, select { width: 100%; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 8px; font: inherit; }
.row input, .row select { width: auto; }
.ver { width: 90px !important; }
.name input { width: 220px; margin-left: 6px; }
.share { gap: 8px; margin-top: 8px; }
.big { padding: 10px 18px; font-size: 14px; }
.code { font-size: 12px; line-height: 1.45; tab-size: 2; white-space: pre; }
.preview { width: 100%; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
.chip.ok { color: var(--accent); } .chip.bad, .bad { color: var(--danger); } .warn { color: var(--warn); }
ul { margin: 0; padding-left: 18px; }
.fix { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--warn); border-radius: 8px; }
</style>
