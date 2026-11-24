<script setup>
// S-96 Extensions. Questions, in order: what have I got and is it working? where does each one show up? what could
// I add? how do I make my own? Installing, updating, switching and removing each take one confirmation on the
// trusted page, which opens in this tab and brings you straight back.
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, trustUrl } from '../sdk/client.js'
import { plugins, leaveSafeMode } from '../sdk/loader.js'
import { door } from '../sdk/lc.js'
import { registry } from '../sdk'
import { auth } from '../auth'
import { toast } from '../store'
import PluginPart from '../components/PluginPart.vue'
import { whereShown } from '../sdk/whereShown.js'

const route = useRoute()
const router = useRouter()
const status = ref(null)
const found = ref([])
const q = ref('')
const conns = ref({ on: false, connections: [], providers: [] })
const newConn = ref({ name: '', site: '' })
const err = ref('')
const open = ref({}) // pkg → its settings are shown

async function refresh() {
  err.value = ''
  try {
    status.value = await api('GET', '/api/plugins/installed')
    found.value = (await api('GET', `/api/registry/plugins?q=${encodeURIComponent(q.value)}`)).plugins
    conns.value = await api('GET', '/api/connections')
  } catch (e) { err.value = e.status === 401 ? 'Sign in to use extensions.' : e.message }
}
let qTimer
watch(q, () => { clearTimeout(qTimer); qTimer = setTimeout(refresh, 250) })
onMounted(() => {
  refresh()
  // an extension was removed with "also delete its data": do it here, where the planner lives
  const f = route.query.forget
  if (typeof f === 'string' && f) { door.forget(f); toast(`Deleted ${f}'s data from your planner`); router.replace('/m/extensions') }
})

const installed = computed(() => status.value?.plugins ?? [])
const isInstalled = (name) => installed.value.some((p) => p.pkg === name)
const toFind = computed(() => found.value.filter((p) => !isInstalled(p.name)))
const settingsOf = (pkg) => registry.settings.find((s) => registry.byId[s.module]?.pkg === pkg)
const mine = (p) => auth.user?.handle && p.name.startsWith(`${auth.user.handle}/`)

/** One status line per extension, with colour only when something needs you. */
function stateOf(p) {
  if (p.pulled) return { text: `Removed from the registry: ${p.pulledReason || 'reported as harmful'}. It's switched off.`, tone: 'bad' }
  if (plugins.failed[p.pkg]) return { text: `Didn't load: ${plugins.failed[p.pkg]}`, tone: 'bad' }
  if (!p.enabled) return { text: 'Switched off', tone: 'muted' }
  return null
}
const attention = computed(() => installed.value.filter((p) => p.pulled || plugins.failed[p.pkg]).length)
const updates = computed(() => installed.value.filter((p) => p.update && !p.pulled).length)
const canConnect = computed(() => !!newConn.value.name.trim() && !!newConn.value.site.trim())
function addKey() { if (canConnect.value) location.href = trustUrl('vault-save', { name: newConn.value.name.trim().toLowerCase(), site: newConn.value.site.trim().toLowerCase() }) }
</script>

<template>
  <div class="ph col">
    <div v-if="plugins.safe" class="note row wrap" role="status">
      <span class="icon sm" aria-hidden="true">health_and_safety</span>
      <span class="grow">{{ plugins.crashed ? 'Extensions were switched off for this visit because the console crashed while loading them.' : 'Extensions are switched off for this visit (safe mode).' }}</span>
      <button class="btn" @click="leaveSafeMode">Switch them back on</button>
    </div>
    <p v-if="err" class="danger small" role="alert">{{ err }}</p>

    <header class="ph-head row wrap">
      <div class="grow">
        <h1>Extensions</h1>
        <p class="muted small">Add things to Life Console: a card on Today, a new page, a link to another app.</p>
      </div>
      <router-link class="btn primary" to="/m/extensions/workshop"><span class="icon sm" aria-hidden="true">construction</span>Make your own</router-link>
    </header>

    <!-- only what needs you: things that broke, then updates -->
    <p v-if="attention || updates" class="sum small" role="status">
      <span v-if="attention" class="danger"><span class="icon sm" aria-hidden="true">error</span>{{ attention }} need{{ attention === 1 ? 's' : '' }} attention</span>
      <span v-if="updates" class="warn"><span class="icon sm" aria-hidden="true">update</span>{{ updates }} update{{ updates === 1 ? '' : 's' }} ready</span>
    </p>

    <section aria-labelledby="yours">
      <h2 id="yours" class="sec">Yours <span v-if="installed.length" class="mono">{{ installed.length }}</span></h2>
      <div v-if="status && !installed.length" class="empty">
        <span class="icon" aria-hidden="true">extension</span>
        <p>No extensions yet. Pick one below, or make your own in a few minutes: describe it, let your AI write it, try it on demo data.</p>
      </div>
      <article v-for="p in installed" :key="p.pkg" class="card" :class="{ off: !p.enabled }">
        <div class="card-top">
          <span class="ext-icon icon" aria-hidden="true">{{ p.icon }}</span>
          <div class="grow">
            <h3>{{ p.title }} <span class="mono tiny muted">{{ p.version }}</span><span v-if="p.mine" class="chip tiny">yours{{ p.visibility === 'public' ? ', shared' : '' }}</span></h3>
            <p v-if="p.description" class="small muted desc">{{ p.description }}</p>
            <div v-if="p.enabled && !p.pulled && whereShown(p.pkg).length" class="shows small">
              <span class="muted">Shows on</span>
              <template v-for="w in whereShown(p.pkg)" :key="w.label"><router-link class="pill" :to="w.path">{{ w.label }}<span class="icon sm" aria-hidden="true">arrow_outward</span></router-link></template>
            </div>
            <p v-else-if="p.enabled && !p.pulled && plugins.status === 'ready' && !plugins.failed[p.pkg]" class="small muted">Runs in the background</p>
          </div>
        </div>
        <p v-if="stateOf(p)" class="small state" :class="stateOf(p).tone">{{ stateOf(p).text }}</p>
        <div class="card-actions row wrap">
          <a v-if="p.update && !p.pulled" class="btn primary" :href="trustUrl('install', { pkg: p.pkg, hash: p.update.hash })" :title="p.update.changelog || ''"><span class="icon sm" aria-hidden="true">download</span>Update to {{ p.update.version }}</a>
          <button v-if="settingsOf(p.pkg)" class="btn" :aria-expanded="!!open[p.pkg]" @click="open[p.pkg] = !open[p.pkg]"><span class="icon sm" aria-hidden="true">tune</span>Settings</button>
          <router-link v-if="p.mine" class="btn" :to="{ path: '/m/extensions/workshop', query: { edit: p.pkg } }"><span class="icon sm" aria-hidden="true">edit</span>Edit</router-link>
          <span class="spacer"></span>
          <a v-if="!p.pulled" class="btn" :href="trustUrl('toggle', { pkg: p.pkg, on: p.enabled ? '0' : '1' })"><span class="icon sm" aria-hidden="true">{{ p.enabled ? 'toggle_on' : 'toggle_off' }}</span>{{ p.enabled ? 'Switch off' : 'Switch on' }}</a>
          <a class="btn danger-ghost" :href="trustUrl('remove', { pkg: p.pkg })" :aria-label="`Remove ${p.title}`" title="Remove"><span class="icon sm" aria-hidden="true">delete</span></a>
        </div>
        <div v-if="open[p.pkg] && settingsOf(p.pkg)" class="card-settings">
          <PluginPart :part="settingsOf(p.pkg).part" :module="settingsOf(p.pkg).module" />
        </div>
      </article>
    </section>

    <section aria-labelledby="add">
      <div class="row wrap sec-row">
        <h2 id="add" class="sec grow">Add more</h2>
        <input v-model="q" class="search" type="search" placeholder="Search extensions" aria-label="Search extensions" />
      </div>
      <div v-if="!toFind.length" class="empty small">
        <span class="icon" aria-hidden="true">travel_explore</span>
        <p v-if="q">Nothing matches "{{ q }}".</p>
        <p v-else>Nothing new to add on this server yet. <router-link to="/m/extensions/workshop">Make the first one</router-link>, and share it if others could use it.</p>
      </div>
      <div class="grid">
        <article v-for="p in toFind" :key="p.name" class="card find">
          <div class="card-top">
            <span class="ext-icon icon" aria-hidden="true">{{ p.icon }}</span>
            <div class="grow">
              <h3>{{ p.title }}</h3>
              <p class="tiny muted">by {{ mine(p) ? 'you' : p.name.split('/')[0] }}</p>
            </div>
          </div>
          <p class="small grow">{{ p.description }}</p>
          <p v-if="p.worksWithEverything" class="tiny ok" title="Uses only the SDK and the data route, so it works with other extensions"><span class="icon sm" aria-hidden="true">verified</span>Works with everything</p>
          <p v-if="p.latest?.checks?.warnings?.length" class="tiny warn">Check first: {{ p.latest.checks.warnings.map((w) => w.msg).join('; ') }}</p>
          <a class="btn" :href="trustUrl('install', { pkg: p.name, hash: p.latest.hash })" :aria-label="`Install ${p.title}`"><span class="icon sm" aria-hidden="true">download</span>Install</a>
        </article>
      </div>
    </section>

    <details class="panel more">
      <summary class="panel-h"><span class="icon sm" aria-hidden="true">tune</span><h2>Accounts and safety</h2></summary>
      <div class="panel-b col">
        <h3>Connected accounts</h3>
        <p class="small muted">Extensions can use these without ever seeing your password or key.</p>
        <p v-if="!conns.on" class="small muted">Not available on this server (its admin sets VAULT_KEY).</p>
        <template v-else>
          <div v-for="c in conns.connections" :key="c.name" class="row small"><span class="mono grow">{{ c.name }} → {{ c.site }}</span><a class="btn" :href="trustUrl('vault-remove', { name: c.name })">Remove</a></div>
          <div v-if="conns.providers?.length" class="row wrap"><a v-for="p in conns.providers" :key="p.name" class="btn" :href="trustUrl('connect', { provider: p.name })"><span class="icon sm" aria-hidden="true">link</span>Connect {{ p.title }}</a></div>
          <form class="row wrap" @submit.prevent="addKey">
            <input v-model="newConn.name" placeholder="name (e.g. todoist)" aria-label="Connection name" />
            <input v-model="newConn.site" placeholder="site (api.todoist.com)" aria-label="Site" />
            <button class="btn" type="submit" :disabled="!canConnect">Add a key…</button>
          </form>
        </template>
        <h3>Safety</h3>
        <div class="row wrap small">
          <a :href="trustUrl('disable-plugins')">Switch off every extension</a>
          <span class="muted" aria-hidden="true">·</span>
          <a href="/app?safe=1">Open once without extensions</a>
        </div>
        <details v-if="plugins.conflicts.length" class="small"><summary class="muted">{{ plugins.conflicts.length }} things extensions asked for but didn't get</summary><ul><li v-for="c in plugins.conflicts" :key="c" class="mono">{{ c }}</li></ul></details>
        <p v-if="auth.user?.handle" class="small muted">You publish extensions as <span class="mono">{{ auth.user.handle }}</span>.</p>
      </div>
    </details>
  </div>
</template>

<style scoped>
.ph { gap: 14px; padding: 16px; }
.ph-head h1 { font-size: 22px; margin: 0 0 2px; }
.ph-head p { margin: 0; }
.sum { display: flex; gap: 16px; margin: 0; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.sum span { display: inline-flex; align-items: center; gap: 4px; }
.sec { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 4px 0 8px; display: flex; gap: 8px; align-items: baseline; }
.sec-row { align-items: center; margin-bottom: 8px; }
.sec-row .sec { margin: 0; }
.card { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.card + .card { margin-top: 10px; }
.card.off { opacity: .75; }
.card-top { display: flex; gap: 12px; align-items: flex-start; }
.card h3 { font-size: 15px; margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; text-transform: none; letter-spacing: 0; color: var(--text); }
.card p { margin: 2px 0 0; }
.ext-icon { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); flex: none; }
.shows { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.desc { max-width: 72ch; }
.pill { display: inline-flex; align-items: center; gap: 2px; padding: 3px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--text); text-decoration: none; }
.pill:hover, .pill:focus-visible { border-color: var(--accent); color: var(--accent); }
.state { margin: 0; }
.card-actions { gap: 8px; align-items: center; flex-wrap: wrap; }
.card-settings { border-top: 1px solid var(--border); padding-top: 10px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.grid:empty { display: none; }
.grid .card + .card { margin-top: 0; }
.find .btn { justify-content: center; }
.empty { display: flex; gap: 12px; align-items: center; padding: 14px; border: 1px dashed var(--border); border-radius: 10px; color: var(--muted); }
.empty p { margin: 0; }
.search { min-width: 220px; }
input { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font: inherit; }
.note { padding: 10px 12px; border: 1px solid var(--warn); border-radius: 8px; }
.more summary { cursor: pointer; list-style: none; }
.more summary::-webkit-details-marker { display: none; }
.more h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 8px 0 0; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
ul { margin: 4px 0 0; padding-left: 18px; }
.ok { color: var(--accent); display: inline-flex; align-items: center; gap: 4px; }
.warn { color: var(--warn); } .danger, .bad { color: var(--danger); } .muted.state { color: var(--muted); }
@media (max-width: 640px) {
  .search { min-width: 0; width: 100%; }
  .sec-row { flex-direction: column; align-items: stretch; gap: 8px; }
  .card-actions .spacer { display: none; }
}
</style>
