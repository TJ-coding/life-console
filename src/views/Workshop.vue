<script setup>
// S-97 Workshop (goal 7): editing mode, a separate place. Describe the plugin, copy the prompt to your own AI (no
// planner data in it), paste the file back, try it on demo data in a sandboxed preview, publish it (private by
// default) and install it through the trusted page. Drafts never run in the console itself.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api, trustUrl } from '../sdk/client.js'
import { workshopPrompt, STARTER } from '../sdk/prompt.js'
import { draftKey } from '../sdk/live.js'
import { ENTRY, canonical } from '../sdk/files.js'
import { auth } from '../auth'
import { toast } from '../store'

const DRAFT = 'life-console/workshop-draft'
const saved = (() => { try { return JSON.parse(localStorage.getItem(DRAFT) || 'null') } catch { return null } })()
const describe = ref(saved?.describe ?? '')
// the extension's files (index.js is the entry); the editor shows one at a time
const files = ref(saved?.files ?? { [ENTRY]: saved?.code ?? STARTER })
const current = ref(ENTRY)
const code = computed({ get: () => files.value[current.value] ?? '', set: (v) => { files.value = { ...files.value, [current.value]: v } } })
const isStarter = computed(() => Object.keys(files.value).length === 1 && files.value[ENTRY] === STARTER)
const fileNames = computed(() => [ENTRY, ...Object.keys(files.value).filter((n) => n !== ENTRY).sort()])
const allCode = () => (Object.keys(files.value).length === 1 ? files.value[ENTRY] : fileNames.value.map((n) => `// --- ${n} ---\n${files.value[n]}`).join('\n'))
const newFile = ref(null) // the name being typed for a new file, or null
function addFile() {
  const n = String(newFile.value ?? '').trim().replace(/^\.\//, '').replace(/(\.js)?$/, '.js')
  if (!/^(?:[a-z0-9_-]+\/){0,3}[a-z0-9_-]+\.js$/i.test(n)) return toast('A file name is letters, digits, - or _ (e.g. layout.js)')
  if (!(n in files.value)) files.value = { ...files.value, [n]: `// ${n}: import it from index.js with \`import { … } from './${n}'\`\n` }
  current.value = n
  newFile.value = null
  persist()
}
function removeFile(n) {
  if (n === ENTRY || !confirm(`Delete ${n}?`)) return
  const next = { ...files.value }
  delete next[n]
  files.value = next
  if (current.value === n) current.value = ENTRY
  run()
}
const slug = ref(saved?.slug ?? 'water')
const version = ref(saved?.version ?? '0.1.0')
const visibility = ref('private')
const changelog = ref('')
const frame = ref(null)
const result = ref(null)
const height = ref(320)
const published = ref(null)
const busy = ref(false)
const route = useRoute()
const SLOT_NAMES = { 'today.card': 'Today', 'week.strip': 'Plan week', 'strategy.plan': 'Strategic plans', 'todo.panel': 'Todo details', 'settings.section': 'Settings' }
const forkOf = ref(saved?.forkOf ?? null) // the extension this draft is a fork of (only its author changes the original)
const suggestion = ref(null) // reviewing a suggestion to your extension: { id, by, message, fromPackage, version, base }
const persist = () => {
  try { localStorage.setItem(DRAFT, JSON.stringify({ describe: describe.value, files: files.value, slug: slug.value, version: version.value, forkOf: forkOf.value })) } catch { /* storage off */ }
  sendDraft()
}

// live: Claude (or another AI app connected over MCP, server/mcp.mjs) changes this draft; the preview reports back
const aiAt = ref(0) // when Claude last changed something here
// the server keeps one draft per extension (server/workshop-live.mjs): Claude sessions working on other extensions
// never overwrite this one. drafts: [{ slug, at, from }], newest first; the switcher shows when there's more than one
const drafts = ref([])
let serverSlug = '' // the name the server has this page's draft under (a rename here moves it)
let typedAt = 0 // when the person last changed the draft here
let fromAi = false // the draft on screen is the one Claude sent (the server has it already)
let sentKey = ''
let sendTimer = 0
function postDraft() {
  const key = draftKey(canonical(files.value))
  if (key === sentKey && serverSlug === slugName(slug.value)) return
  sentKey = key
  return api('POST', '/api/workshop/live/draft', { files: files.value, slug: slug.value, was: serverSlug, forkOf: forkOf.value, editing: editing.value?.pkg ?? null })
    .then((r) => { if (r?.slug) serverSlug = r.slug }).catch(() => { sentKey = '' })
}
function sendDraft() {
  if (fromAi) return
  typedAt = Date.now()
  clearTimeout(sendTimer)
  sendTimer = setTimeout(postDraft, 150)
}
/** Send what's waiting right away (before switching to another draft). */
async function flushDraft() { if (sendTimer) { clearTimeout(sendTimer); sendTimer = 0; await postDraft() } }
const slugName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
async function switchDraft(to) {
  if (!to || to === serverSlug) return
  await flushDraft()
  try {
    const r = await api('POST', '/api/workshop/live/select', { slug: to })
    drafts.value = r.drafts ?? drafts.value
    showDraft(r.draft)
  } catch (e) { toast(e.message) }
}
async function discardDraft() {
  const s = serverSlug || slugName(slug.value)
  if (!confirm(`Throw away the draft ${s}? Its published versions stay.`)) return
  try {
    const r = await api('POST', '/api/workshop/live/discard', { slug: s })
    drafts.value = r.drafts ?? []
    if (r.draft) showDraft(r.draft)
  } catch (e) { toast(e.message) }
}
/** Show a draft from the server (switching, or Claude's) without sending it back. */
function showDraft(d, { ai = false } = {}) {
  fromAi = true
  sentKey = d.key
  serverSlug = d.slug
  if (d.slug && d.slug !== slug.value) { slugQuiet = true; slug.value = d.slug }
  // Claude opened one of theirs to edit (server/mcp.mjs open_extension), or started a new one
  if (d.editing && editing.value?.pkg !== d.editing) editing.value = { pkg: d.editing, mine: true }
  else if (!d.editing && editing.value) editing.value = null
  if ((d.forkOf ?? null) !== forkOf.value) forkOf.value = d.forkOf ?? null
  files.value = d.files ?? { [ENTRY]: d.code }
  if (!(current.value in files.value)) current.value = ENTRY
  if (ai) aiAt.value = Date.now()
  try { localStorage.setItem(DRAFT, JSON.stringify({ describe: describe.value, files: files.value, slug: slug.value, version: version.value, forkOf: forkOf.value })) } catch { /* storage off */ }
  run()
  fromAi = false
}
function applyAiDraft(d) {
  // Claude changed another draft while the person is working on this one: don't pull them away
  if (serverSlug && d.slug !== serverSlug && Date.now() - typedAt < 60000) { aiAt.value = Date.now(); toast(`Claude changed the draft ${d.slug}: switch to it above`); return }
  showDraft(d, { ai: true })
}
let source = null
let useAfterRun = false // Claude asked to use it while the preview was still running
function useWhenReady() {
  useAfterRun = false
  if (result.value?.ok && !busy.value) useIt()
  else toast('Claude asked to use it, but the preview has problems')
}
function listen() {
  if (typeof EventSource === 'undefined') return
  source = new EventSource('/api/workshop/live')
  source.onmessage = (e) => {
    let m
    try { m = JSON.parse(e.data) } catch { return }
    if (m.drafts) drafts.value = m.drafts
    if (m.type === 'hello') {
      if (m.aiAt) aiAt.value = m.aiAt
      if (m.draft) applyAiDraft(m.draft)
      // this page's own draft (from this browser) goes to the server under its name, as the current one
      else { const mine = slugName(slug.value); serverSlug = (m.drafts ?? []).some((x) => x.slug === mine) ? mine : ''; sentKey = ''; postDraft() }
    }
    else if (m.type === 'draft') applyAiDraft(m.draft)
    else if (m.type === 'open') { aiAt.value = Date.now(); load(m.pkg) }
    else if (m.type === 'use') { aiAt.value = Date.now(); if (result.value) useWhenReady(); else useAfterRun = true }
  }
}

// a plugin's own terms start with its name (water.Glass for a plugin called water): when the name changes, rename
// them too, and when they don't match, say so and offer both fixes
const ns = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '-')
const termPrefix = (s) => new RegExp(`(['"\`])${s.replace(/[-]/g, '\\-')}\\.(?=[A-Za-z])`, 'g')
function renameTerms(from, to) {
  if (!from || !to || from === to) return false
  const next = Object.fromEntries(Object.entries(files.value).map(([n, c]) => [n, c.replace(termPrefix(from), `$1${to}.`)]))
  if (canonical(next) === canonical(files.value)) return false
  files.value = next
  return true
}
watch(slug, (now, before) => {
  if (slugQuiet) { slugQuiet = false; return }
  if (renameTerms(ns(before), ns(now))) { toast(`Renamed ${ns(before)}.* to ${ns(now)}.* to match the extension's name`); run() }
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
let runKey = ''
function run() {
  persist()
  runKey = draftKey(canonical(files.value))
  result.value = null
  frame.value?.contentWindow?.postMessage({ type: 'run', files: JSON.parse(JSON.stringify(files.value)), name: slug.value, theme: document.documentElement.dataset.theme }, '*')
}
function onMessage(e) {
  if (e.source !== frame.value?.contentWindow || e.data?.source !== 'lc-preview') return
  if (e.data.type === 'ready') run()
  else if (e.data.type === 'result') {
    result.value = e.data
    if (e.data.height) height.value = Math.min(900, Math.max(240, e.data.height + 24))
    const { ok, errors, problems, manifest, parts } = e.data
    api('POST', '/api/workshop/live/result', { key: runKey, result: { ok, errors, problems, manifest, parts } }).catch(() => {})
    if (useAfterRun) useWhenReady()
  }
  else if (e.data.type === 'toast') toast(`Preview: ${e.data.text}`)
  else if (e.data.type === 'error') result.value = { ...(result.value ?? {}), ok: false, errors: [...(result.value?.errors ?? []), e.data.text] }
}
onMounted(() => {
  window.addEventListener('message', onMessage)
  listen()
  // ?edit=<yours> opens your extension (?suggestion=<id> to review a suggestion to it); anything else is forked
  const q = route.query
  const pkg = typeof q.edit === 'string' ? q.edit : typeof q.fork === 'string' ? q.fork : ''
  if (pkg) load(pkg, q.suggestion)
})
/** Open an extension here: yours to edit, anyone else's as your own copy. */
async function load(pkg, suggestionId = null) {
  const q = { suggestion: suggestionId }
  try {
    // every file of a version, as published
    const codeOf = async (hash) => (await api('GET', `/api/registry/files/${hash}`)).files
    // installed, or only published (then its newest version)
    let it = (await api('GET', '/api/plugins/installed')).plugins.find((p) => p.pkg === pkg)
    if (!it) { const r = await api('GET', `/api/registry/plugins/${pkg}`); if (!r.latest) return; it = { pkg, title: r.title, description: r.description, version: r.latest.version, hash: r.latest.hash, forkedFrom: r.forkedFrom } }
    let text = await codeOf(it.hash)
    const own = it.mine ?? (await api('GET', `/api/registry/plugins/${pkg}`)).mine
    suggestion.value = null
    if (own) {
      editing.value = it
      forkOf.value = it.forkedFrom ?? null
      if (q.suggestion) {
        const x = (await api('GET', '/api/registry/suggestions')).incoming.find((y) => String(y.id) === String(q.suggestion))
        if (x) { suggestion.value = { ...x, base: text[ENTRY] ?? '' }; text = await codeOf(x.fromHash) }
      }
      toast(suggestion.value ? `Reviewing ${suggestion.value.by}'s suggestion` : `Editing ${it.title}`)
    } else {
      editing.value = null
      forkOf.value = pkg
      toast(`Your own copy of ${it.title}`)
    }
    slugQuiet = true
    slug.value = pkg.split('/')[1]
    files.value = text
    current.value = ENTRY
    describe.value = it.description || describe.value
    persist()
    run()
  } catch (e) { toast(e.message) }
}
const editing = ref(null)
let slugQuiet = false
onBeforeUnmount(() => { window.removeEventListener('message', onMessage); source?.close(); clearTimeout(sendTimer) })

async function copyPrompt() {
  persist()
  const text = workshopPrompt(describe.value, isStarter.value ? '' : allCode())
  try { await navigator.clipboard.writeText(text); toast('Prompt copied: paste it into your AI, then paste its file below') } catch { toast("Couldn't copy: select the text in the prompt box instead") }
}
const showPrompt = ref(false)
const claudeLink = trustUrl('claude', {}, '/app#/m/extensions/workshop')
const promptText = computed(() => workshopPrompt(describe.value, isStarter.value ? '' : allCode()))
function pasteBack(text) {
  const t = String(text ?? '').replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim()
  if (t) { code.value = t + '\n'; run() }
}

const pasteClipboard = () => navigator.clipboard?.readText?.().then(pasteBack).catch(() => toast('Paste into the box instead'))

const manifestOf = () => { const m = result.value?.manifest ?? {}; return { title: m.title, description: m.description, icon: m.icon, sdk: m.sdk, says: m.says, replaces: m.replaces, shows: { slots: m.slots ?? [], pages: m.pages ?? 0 } } }
/** The preview's findings in plain words. */
const summary = computed(() => {
  const m = result.value?.manifest
  if (!m) return null
  const where = [...(m.pageTitles?.length ? m.pageTitles.map((t) => `its page "${t}"`) : []), ...(m.slots ?? []).map((x) => SLOT_NAMES[x] ?? x)]
  return { where: where.join(', ') || 'nowhere yet (runs in the background)', stores: (m.types ?? []).join(', '), internet: m.says?.internet?.length ? m.says.internet.join(', ') : 'none', replaces: (m.replaces ?? []).join(', ') }
})
// how far along you are: shown as steps at the top
const steps = computed(() => [
  { n: 1, label: 'Describe', done: !!describe.value.trim() || !isStarter.value },
  { n: 2, label: 'The file', done: !isStarter.value || !!editing.value || !!result.value?.ok },
  { n: 3, label: 'Preview', done: !!result.value?.ok },
  { n: 4, label: 'Use it', done: false },
])
/** "Use it": save this version (only you can see it) and install it, with one confirmation; you land on Today. */
async function useIt() {
  busy.value = true
  try {
    const r = await api('POST', '/api/registry/publish', { name: slug.value, files: files.value, visibility: 'private', manifest: manifestOf(), forkOf: forkOf.value, proposal: suggestion.value?.id })
    if (r.name && auth.user && !auth.user.handle) auth.user.handle = r.name.split('/')[0]
    persist()
    location.href = trustUrl('install', { pkg: r.name, hash: r.hash }, '/app#/')
  } catch (e) { toast(e.message); busy.value = false }
}
/** A fork: send this version to the original's author as a suggestion (it's saved under your name first). */
const suggestMsg = ref('')
const sent = ref(null)
async function suggestIt() {
  busy.value = true
  try {
    const r = await api('POST', '/api/registry/publish', { name: slug.value, files: files.value, visibility: 'private', manifest: manifestOf(), forkOf: forkOf.value })
    const x = await api('POST', `/api/registry/plugins/${forkOf.value}/suggest`, { hash: r.hash, message: suggestMsg.value })
    sent.value = { to: forkOf.value, version: r.version }
    toast(x.already ? 'Already suggested' : `Suggested to ${forkOf.value.split('/')[0]}`)
  } catch (e) { toast(e.message) }
  busy.value = false
}
// reviewing a suggestion: what changed, line by line (a plain LCS diff; extension files are small)
const changes = computed(() => {
  if (!suggestion.value) return []
  const a = suggestion.value.base.split('\n'), b = code.value.split('\n')
  if (a.length * b.length > 4e6) return [{ t: '~', s: 'Too long to compare here' }]
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out = []
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ t: ' ', s: a[i], n: j + 1 }); i++; j++ }
    else if (i < a.length && (j >= b.length || L[i + 1][j] >= L[i][j + 1])) { out.push({ t: '-', s: a[i] }); i++ }
    else { out.push({ t: '+', s: b[j], n: j + 1 }); j++ }
  }
  // only the changed lines and two lines around them
  const keep = new Set()
  out.forEach((l, k) => { if (l.t !== ' ') for (let d = -2; d <= 2; d++) keep.add(k + d) })
  return out.filter((_, k) => keep.has(k))
})
/** Share it with everyone: the same, public, with a note for people who update. */
async function shareIt() {
  busy.value = true
  try {
    const r = await api('POST', '/api/registry/publish', { name: slug.value, files: files.value, visibility: 'public', changelog: changelog.value, manifest: manifestOf(), forkOf: forkOf.value })
    published.value = r
    toast(r.reused ? `${r.name} ${r.version} is already published` : `Published ${r.name} ${r.version} for everyone`)
  } catch (e) { toast(e.message) }
  busy.value = false
}
</script>

<template>
  <div class="ws">
    <div class="ws-top row wrap">
      <ol class="steps mono" aria-label="Progress">
        <li v-for="st in steps" :key="st.n" :class="{ done: st.done }"><span aria-hidden="true">{{ st.done ? '✓' : st.n }}</span> {{ st.label }}<span v-if="st.done" class="sr"> (done)</span></li>
      </ol>
      <span class="spacer"></span>
      <span v-if="aiAt" class="mono small ai" role="status" title="Claude is connected and can change this draft">● Claude</span>
      <router-link to="/m/extensions" class="btn"><span class="icon sm" aria-hidden="true">arrow_back</span>Back to Extensions</router-link>
    </div>
    <div class="ws-grid">
      <div class="col stack">
        <section class="panel">
          <div class="panel-h"><span class="mono muted">1</span><h2>Describe it</h2></div>
          <div class="panel-b col">
            <label class="small name">Name <input v-model="slug" class="mono" @change="persist" /><span v-if="forkOf" class="tiny muted"> your copy of {{ forkOf }}</span></label>
            <div v-if="drafts.length > 1" class="row small drafts">
              <label class="row">Drafts
                <select class="mono" :value="slugName(slug)" aria-label="Switch to another draft" @change="switchDraft($event.target.value)">
                  <option v-for="d in drafts" :key="d.slug" :value="d.slug">{{ d.slug }}{{ d.from === 'ai' ? ' · Claude' : '' }}</option>
                </select>
              </label>
              <button class="btn sm" title="Throw this draft away" aria-label="Throw this draft away" @click="discardDraft"><span class="icon sm" aria-hidden="true">delete</span></button>
            </div>
            <label class="small col">What should it do?
              <textarea v-model="describe" rows="4" placeholder="e.g. Track my reading: books with a status, a Today card with what I'm reading, and a reminder at 21:00" @change="persist"></textarea>
            </label>
            <div class="row wrap">
              <button class="btn primary" @click="copyPrompt"><span class="icon sm" aria-hidden="true">content_copy</span>Copy prompt for your AI</button>
              <button class="btn" :aria-expanded="showPrompt" @click="showPrompt = !showPrompt">{{ showPrompt ? 'Hide' : 'Show' }} prompt</button>
              <a class="btn" :href="claudeLink" title="Let Claude write and change it here, with the preview updating as it works"><span class="icon sm" aria-hidden="true">link</span>Connect Claude</a>
            </div>
            <textarea v-if="showPrompt" class="mono small" rows="10" readonly :value="promptText" aria-label="Prompt for your AI"></textarea>
          </div>
        </section>
        <section class="panel">
          <div class="panel-h"><span class="mono muted">2</span><h2>Paste the file it gives you</h2><span class="spacer"></span><button class="btn" @click="pasteClipboard"><span class="icon sm" aria-hidden="true">content_paste</span>Paste</button></div>
          <div class="panel-b col">
            <div v-if="suggestion" class="review">
              <div class="small"><b class="mono">{{ suggestion.by }}</b> suggests <span class="mono muted">{{ suggestion.fromPackage }} {{ suggestion.version }}</span><span v-if="suggestion.message">: {{ suggestion.message }}</span></div>
              <pre class="diff mono" aria-label="Changes from your version"><span v-for="(l, k) in changes" :key="k" :class="l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''">{{ l.t }} {{ l.s }}</span><span v-if="!changes.length" class="muted">No changes from your version</span></pre>
            </div>
            <div v-if="mismatch" class="fix small" role="alert">
              <span><span class="icon sm" aria-hidden="true">build</span>Your extension is called <b class="mono">{{ mismatch.to }}</b>, but its types are named <b class="mono">{{ mismatch.from }}.…</b> They need to match.</span>
              <div class="row wrap"><button class="btn primary" @click="fixByRenaming">Rename them to {{ mismatch.to }}.…</button><button class="btn" @click="fixByName">Call the extension {{ mismatch.from }}</button></div>
            </div>
            <div class="files row wrap" role="tablist" aria-label="Files">
              <span v-for="n in fileNames" :key="n" class="file" :class="{ on: n === current }">
                <button role="tab" :aria-selected="n === current" class="mono small" @click="current = n">{{ n }}</button>
                <button v-if="n !== ENTRY" class="x" :aria-label="`Delete ${n}`" @click="removeFile(n)"><span class="icon sm" aria-hidden="true">close</span></button>
              </span>
              <input v-if="newFile !== null" v-model="newFile" class="mono small newfile" placeholder="layout.js" aria-label="New file name" @keydown.enter.prevent="addFile" @keydown.esc="newFile = null" @blur="newFile = null" />
              <button v-else class="btn sm" title="Add a file (index.js imports it with ./name.js)" @click="newFile = ''"><span class="icon sm" aria-hidden="true">add</span>File</button>
            </div>
            <textarea v-model="code" class="mono code" rows="20" spellcheck="false" :aria-label="`File ${current}`" @keydown.meta.enter="run" @keydown.ctrl.enter="run"></textarea>
            <div class="row wrap"><button class="btn primary" title="⌘/Ctrl + Enter" @click="run"><span class="icon sm" aria-hidden="true">play_arrow</span>Preview it</button></div>
          </div>
        </section>
      </div>
      <div class="col stack">
        <section class="panel">
          <div class="panel-h"><span class="mono muted">3</span><h2>Preview</h2><span class="spacer"></span>
            <span v-if="result" class="mono small" :class="result.ok ? 'ok' : 'bad'" role="status">{{ result.ok ? 'Works' : 'Has problems' }}</span>
          </div>
          <div class="panel-b col">
            <iframe ref="frame" class="preview" sandbox="allow-scripts" src="/preview.html" title="Extension preview" :style="{ height: height + 'px' }"></iframe>
            <ul v-if="result?.errors?.length" class="small bad"><li v-for="e in result.errors" :key="e">{{ e }}</li></ul>
            <ul v-if="!mismatch && result?.problems?.length" class="small warn"><li v-for="pr in result.problems" :key="pr">{{ pr }}</li></ul>
            <dl v-if="summary" class="facts small">
              <dt>Shows on</dt><dd>{{ summary.where }}</dd>
              <dt v-if="summary.stores">Keeps</dt><dd v-if="summary.stores" class="mono">{{ summary.stores }}</dd>
              <dt>Internet</dt><dd>{{ summary.internet }}</dd>
              <dt v-if="summary.replaces">Replaces</dt><dd v-if="summary.replaces" class="warn">{{ summary.replaces }}</dd>
            </dl>
          </div>
        </section>
        <section class="panel">
          <div class="panel-h"><span class="mono muted">4</span><h2>Use it</h2></div>
          <div class="panel-b col">
            <button class="btn primary big" :disabled="busy || !result?.ok" @click="useIt"><span class="icon sm" aria-hidden="true">check_circle</span>{{ suggestion ? 'Accept and update mine' : editing ? 'Save and update mine' : 'Use it' }}</button>
            <details v-if="forkOf && !suggestion" class="small">
              <summary class="muted">Suggest it to {{ forkOf.split('/')[0] }}</summary>
              <div class="col share">
                <input v-model="suggestMsg" placeholder="What does it change?" aria-label="What does it change?" />
                <div class="row wrap"><button class="btn" :disabled="busy || !result?.ok" @click="suggestIt"><span class="icon sm" aria-hidden="true">call_merge</span>Send suggestion</button></div>
                <p v-if="sent" class="muted">Sent {{ sent.version }} to {{ sent.to }}.</p>
              </div>
            </details>
            <details v-if="!suggestion" class="small">
              <summary class="muted">Share it with everyone</summary>
              <div class="col share">
                <input v-model="changelog" placeholder="What's new (people see this when they update)" aria-label="What's new" />
                <div class="row wrap"><button class="btn" :disabled="busy || !result?.ok" @click="shareIt"><span class="icon sm" aria-hidden="true">public</span>Share {{ slug }}</button></div>
                <p v-if="published" class="muted">Shared as <span class="mono">{{ published.name }} {{ published.version }}</span>. Others find it in Extensions → Add more.</p>
                <ul v-if="published?.checks?.warnings?.length" class="warn"><li v-for="w in published.checks.warnings" :key="w.id">{{ w.msg }}</li></ul>
              </div>
            </details>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ws { padding: 16px; }
.ws-top { margin-bottom: 12px; gap: 12px; }
.ws-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
@media (max-width: 900px) { .ws-grid { grid-template-columns: 1fr; } }
textarea, input, select { width: 100%; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 8px; font: inherit; }
.row input, .row select { width: auto; }
.ver { width: 90px !important; }
.name input { width: 220px; margin-left: 6px; }
.drafts { gap: 6px; align-items: center; }
.drafts label { gap: 6px; align-items: center; }
.share { gap: 8px; margin-top: 8px; }
.big { padding: 10px 18px; font-size: 14px; }
.code { font-size: 12px; line-height: 1.45; tab-size: 2; white-space: pre; }
.files { gap: 4px; align-items: center; }
.files .file { display: inline-flex; align-items: stretch; border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
.files .file button { border: 0; background: transparent; color: var(--muted); padding: 3px 8px; cursor: pointer; }
.files .file.on { border-color: var(--accent); }
.files .file.on button { color: var(--text); background: var(--surface-2); }
.files .file .x { padding: 3px 4px; opacity: .5; }
.files .file .x:hover, .files .file .x:focus-visible { opacity: 1; }
.files .newfile { width: 140px; padding: 3px 6px; }
.preview { width: 100%; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); }
.chip.ok { color: var(--accent); } .chip.bad, .bad { color: var(--danger); } .warn { color: var(--warn); }
ul { margin: 0; padding-left: 18px; }
.steps { display: flex; gap: 0; list-style: none; margin: 0; padding: 0; flex-wrap: wrap; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.steps li + li::before { content: '→'; margin: 0 10px; color: var(--border); }
.steps li.done { color: var(--accent); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.stack { gap: 12px; }
.panel-h .mono { margin-right: 2px; }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
.facts dt { color: var(--muted); } .facts dd { margin: 0; }
label.col { gap: 4px; }
@media (max-width: 640px) { .hide-phone { display: none; } }
.review { display: flex; flex-direction: column; gap: 6px; }
.diff { margin: 0; max-height: 260px; overflow: auto; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); font-size: 11px; line-height: 1.5; white-space: pre; }
.diff span { display: block; min-height: 1.5em; }
.diff .add { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); display: block; }
.diff .del { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); display: block; }
.ai { color: var(--accent); }
.fix { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--warn); border-radius: 4px; }
</style>
