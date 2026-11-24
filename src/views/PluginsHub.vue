<script setup>
// S-96 Plugins: what's installed, the registry, connections and your handle. Every yes (turning Public plugins on,
// installing, updating, removing, saving a key) opens the trusted page in its own tab: never a button in here.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, trustUrl } from '../sdk/client.js'
import { plugins, loadPlugins, leaveSafeMode } from '../sdk/loader.js'
import { door } from '../sdk/lc.js'
import { registry } from '../sdk'
import { auth } from '../auth'
import { toast } from '../store'
import PluginPart from '../components/PluginPart.vue'

const route = useRoute()
const router = useRouter()
const status = ref(null) // { publicPlugins, plugins: installed }
const found = ref([])
const q = ref('')
const conns = ref({ on: false, connections: [] })
const handle = ref('')
const err = ref('')
const loading = ref(false)
const newConn = ref({ name: '', site: '' })

async function refresh() {
  loading.value = true
  err.value = ''
  try {
    status.value = await api('GET', '/api/plugins/installed')
    found.value = (await api('GET', `/api/registry/plugins?q=${encodeURIComponent(q.value)}`)).plugins
    conns.value = await api('GET', '/api/connections')
  } catch (e) { err.value = e.status === 401 ? 'Sign in to use plugins.' : e.message }
  loading.value = false
}
let qTimer
watch(q, () => { clearTimeout(qTimer); qTimer = setTimeout(refresh, 250) })
// coming back from the trusted page: pick up what changed and load newly installed plugins
const onVisible = () => { if (document.visibilityState === 'visible') { refresh(); loadPlugins() } }
onMounted(() => {
  refresh()
  document.addEventListener('visibilitychange', onVisible)
  // the trusted page removed a plugin and asked to delete its data: do it here, where the planner lives
  const f = route.query.forget
  if (typeof f === 'string' && f) {
    door.forget(f)
    toast(`Deleted ${f}'s data from your planner`)
    router.replace('/m/plugins')
  }
})
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))

const installed = computed(() => status.value?.plugins ?? [])
const isInstalled = (name) => installed.value.some((p) => p.pkg === name)
const settingsOf = (pkg) => registry.settings.find((s) => registry.byId[s.module]?.pkg === pkg)
const recent = computed(() => door.activity.slice(-12).reverse())
async function saveHandle() {
  try { const r = await api('POST', '/api/registry/handle', { handle: handle.value }); auth.user.handle = r.handle; toast(`Your handle is ${r.handle}`) } catch (e) { toast(e.message) }
}
const conflictText = computed(() => plugins.conflicts.filter(Boolean))
</script>

<template>
  <div class="ph col">
    <section v-if="plugins.safe" class="panel note">
      <div class="panel-b row wrap">
        <span class="icon sm warn">health_and_safety</span>
        <span class="grow">{{ plugins.crashed ? 'The console crashed while loading plugins last time, so it started without them (safe mode).' : 'Safe mode: Public plugins are not loaded.' }}</span>
        <button class="btn" @click="leaveSafeMode">Load plugins again</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-h"><span class="icon sm">extension</span><h2>Plugins</h2><span class="spacer"></span>
        <router-link class="btn" to="/m/plugins/workshop"><span class="icon sm">construction</span>Workshop</router-link>
      </div>
      <div class="panel-b col">
        <p v-if="err" class="danger small">{{ err }}</p>
        <template v-else-if="status && !status.publicPlugins">
          <p>Public plugins are made by other people. Once you turn them on, a plugin you install can see and change everything in your planner, so only install plugins from people you trust.</p>
          <div class="row"><a class="btn primary" :href="trustUrl('enable-plugins')" target="_blank" rel="noopener"><span class="icon sm">lock</span>Turn on Public plugins…</a></div>
          <p class="small muted">You'll confirm on the trusted page, which opens in a new tab.</p>
        </template>
        <template v-else-if="status">
          <p v-if="!installed.length" class="muted">No plugins installed yet. Find one below.</p>
          <div v-for="p in installed" :key="p.pkg" class="inst">
            <div class="row">
              <span class="icon">{{ p.icon }}</span>
              <div class="grow">
                <b>{{ p.title }}</b> <span class="mono small muted">{{ p.pkg }} {{ p.version }}</span>
                <div v-if="p.pulled" class="small danger">Pulled from the registry: {{ p.pulledReason || 'reported as harmful' }}. It doesn't load.</div>
                <div v-else-if="plugins.failed[p.pkg]" class="small danger">Didn't load: {{ plugins.failed[p.pkg] }}</div>
                <div v-else-if="!p.enabled" class="small muted">Switched off</div>
                <div v-if="p.says?.internet?.length" class="small muted">Talks to {{ p.says.internet.join(', ') }}</div>
              </div>
              <a v-if="p.update" class="btn" :href="trustUrl('install', { pkg: p.pkg, hash: p.update.hash })" target="_blank" rel="noopener">Update to {{ p.update.version }}</a>
              <a class="btn" :href="trustUrl('toggle', { pkg: p.pkg, on: p.enabled ? '0' : '1' })" target="_blank" rel="noopener">{{ p.enabled ? 'Switch off' : 'Switch on' }}</a>
              <a class="btn" :href="trustUrl('remove', { pkg: p.pkg })" target="_blank" rel="noopener">Remove</a>
            </div>
            <PluginPart v-if="settingsOf(p.pkg)" :part="settingsOf(p.pkg).part" :module="settingsOf(p.pkg).module" />
          </div>
          <details v-if="conflictText.length" class="small"><summary class="muted">{{ conflictText.length }} things plugins asked for but didn't get</summary><ul><li v-for="c in conflictText" :key="c" class="mono">{{ c }}</li></ul></details>
          <div class="row small muted"><a :href="trustUrl('disable-plugins')" target="_blank" rel="noopener">Turn off all Public plugins</a><span>·</span><a href="/app?safe=1">Open without plugins (safe mode)</a></div>
        </template>
      </div>
    </section>

    <section class="panel">
      <div class="panel-h"><span class="icon sm">storefront</span><h2>Registry</h2><span class="spacer"></span>
        <input v-model="q" class="search" type="search" placeholder="Search plugins" aria-label="Search plugins" />
      </div>
      <div class="panel-b col">
        <p v-if="!found.length && !loading" class="muted">{{ q ? 'Nothing matches.' : 'No plugins published yet. Be the first: open the workshop.' }}</p>
        <div v-for="p in found" :key="p.name" class="card">
          <div class="row">
            <span class="icon">{{ p.icon }}</span>
            <div class="grow">
              <b>{{ p.title }}</b> <span class="mono small muted">{{ p.name }} {{ p.latest?.version }}</span>
              <span v-if="p.visibility === 'private'" class="chip">private</span>
              <span v-if="p.worksWithEverything" class="chip ok" title="Uses only the SDK and the data door">works with everything</span>
              <div class="small">{{ p.description }}</div>
              <div class="small muted">{{ p.downloads }} installs<span v-if="p.reports"> · {{ p.reports }} reports</span><span v-if="p.latest?.says?.internet?.length"> · talks to {{ p.latest.says.internet.join(', ') }}</span></div>
              <ul v-if="p.latest?.checks?.warnings?.length" class="small warn"><li v-for="w in p.latest.checks.warnings" :key="w.id">{{ w.msg }}</li></ul>
            </div>
            <span v-if="isInstalled(p.name)" class="chip">installed</span>
            <a v-else-if="status?.publicPlugins" class="btn primary" :href="trustUrl('install', { pkg: p.name, hash: p.latest.hash })" target="_blank" rel="noopener">Install…</a>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-h"><span class="icon sm">key</span><h2>Connections</h2><span class="spacer"></span><span class="tiny muted">keys plugins can use, never read</span></div>
      <div class="panel-b col">
        <p v-if="!conns.on" class="muted small">Connections are off on this server (the admin sets VAULT_KEY).</p>
        <template v-else>
          <div v-for="c in conns.connections" :key="c.name" class="row">
            <span class="mono grow">{{ c.name }} → {{ c.site }}</span>
            <span class="small muted">{{ c.lastUsedAt ? 'used ' + new Date(c.lastUsedAt).toLocaleDateString() : 'not used yet' }}</span>
            <a class="btn" :href="trustUrl('vault-remove', { name: c.name })" target="_blank" rel="noopener">Remove</a>
          </div>
          <div v-if="conns.providers?.length" class="row wrap">
            <span class="small muted">Connect an account:</span>
            <a v-for="p in conns.providers" :key="p.name" class="btn" :href="trustUrl('connect', { provider: p.name })" target="_blank" rel="noopener"><span class="icon sm">link</span>{{ p.title }}</a>
          </div>
          <div class="row wrap">
            <input v-model="newConn.name" placeholder="name (strava)" aria-label="Connection name" />
            <input v-model="newConn.site" placeholder="site (www.strava.com)" aria-label="Site" />
            <a class="btn" :class="{ disabled: !newConn.name || !newConn.site }" :href="trustUrl('vault-save', { name: newConn.name.toLowerCase(), site: newConn.site.toLowerCase() })" target="_blank" rel="noopener">Add key…</a>
          </div>
          <p class="small muted">You paste the key on the trusted page. It's only ever sent to that site.</p>
        </template>
      </div>
    </section>

    <section class="panel">
      <div class="panel-h"><span class="icon sm">badge</span><h2>Publishing</h2></div>
      <div class="panel-b col">
        <p v-if="auth.user?.handle">Your handle is <b class="mono">{{ auth.user.handle }}</b>: your plugins are named <span class="mono">{{ auth.user.handle }}/…</span></p>
        <div v-else class="row wrap"><span>Choose a handle to publish plugins:</span><input v-model="handle" placeholder="alice" aria-label="Handle" /><button class="btn" :disabled="!handle" @click="saveHandle">Save</button></div>
      </div>
    </section>

    <section v-if="recent.length" class="panel">
      <div class="panel-h"><span class="icon sm">history</span><h2>Recent plugin activity</h2></div>
      <div class="panel-b col small mono">
        <div v-for="(a, i) in recent" :key="i" class="row"><span class="muted">{{ a.at.slice(11, 16) }}</span><span>{{ a.by }}</span><span>{{ a.op }}</span><span class="muted grow">{{ a.ref }}</span></div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ph { gap: 12px; padding: 16px; max-width: 980px; }
.inst + .inst, .card + .card { border-top: 1px solid var(--border); padding-top: 10px; }
.inst, .card { display: flex; flex-direction: column; gap: 6px; }
.search { min-width: 220px; }
.note { border-color: var(--warn); }
.chip.ok { color: var(--ok, var(--accent)); }
.btn.disabled { pointer-events: none; opacity: .5; }
ul { margin: 4px 0 0; padding-left: 18px; }
.warn { color: var(--warn); }
.danger { color: var(--danger); }
</style>
