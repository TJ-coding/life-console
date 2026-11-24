<script setup>
// S-96 Plugins, kept to three things: what you have, finding more, making your own. Installing, updating and
// removing each take one confirmation on the trusted page, which opens here and brings you straight back.
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

async function refresh() {
  err.value = ''
  try {
    status.value = await api('GET', '/api/plugins/installed')
    found.value = (await api('GET', `/api/registry/plugins?q=${encodeURIComponent(q.value)}`)).plugins
    conns.value = await api('GET', '/api/connections')
  } catch (e) { err.value = e.status === 401 ? 'Sign in to use plugins.' : e.message }
}
let qTimer
watch(q, () => { clearTimeout(qTimer); qTimer = setTimeout(refresh, 250) })
onMounted(() => {
  refresh()
  // a plugin was removed with "also delete its data": do it here, where the planner lives
  const f = route.query.forget
  if (typeof f === 'string' && f) { door.forget(f); toast(`Deleted ${f}'s data from your planner`); router.replace('/m/plugins') }
})

const installed = computed(() => status.value?.plugins ?? [])
const isInstalled = (name) => installed.value.some((p) => p.pkg === name)
const toFind = computed(() => found.value.filter((p) => !isInstalled(p.name)))
const settingsOf = (pkg) => registry.settings.find((s) => registry.byId[s.module]?.pkg === pkg)
const mine = (p) => auth.user?.handle && p.name.startsWith(`${auth.user.handle}/`)
</script>

<template>
  <div class="ph col">
    <div v-if="plugins.safe" class="note row wrap">
      <span class="icon sm">health_and_safety</span>
      <span class="grow">{{ plugins.crashed ? 'Plugins were switched off for this visit because the console crashed while loading them.' : 'Plugins are switched off for this visit (safe mode).' }}</span>
      <button class="btn" @click="leaveSafeMode">Switch them back on</button>
    </div>
    <p v-if="err" class="danger small">{{ err }}</p>

    <section class="panel">
      <div class="panel-h"><span class="icon sm">extension</span><h2>Your plugins</h2><span class="spacer"></span>
        <router-link class="btn" to="/m/plugins/workshop"><span class="icon sm">construction</span>Make your own</router-link>
      </div>
      <div class="panel-b col">
        <p v-if="status && !installed.length" class="muted">None yet. Plugins add things to Life Console: a card on Today, a new page, a connection to another app. Find one below, or make your own.</p>
        <div v-for="p in installed" :key="p.pkg" class="item">
          <div class="row">
            <span class="icon">{{ p.icon }}</span>
            <div class="grow">
              <b>{{ p.title }}</b>
              <span v-if="p.pulled" class="small danger"> · removed from the registry ({{ p.pulledReason || 'reported as harmful' }}), so it's off</span>
              <span v-else-if="plugins.failed[p.pkg]" class="small danger"> · didn't load: {{ plugins.failed[p.pkg] }}</span>
              <span v-else-if="!p.enabled" class="small muted"> · switched off</span>
              <div v-if="p.enabled && !p.pulled && whereShown(p.pkg).length" class="small muted">Shows on:
                <template v-for="(w, i) in whereShown(p.pkg)" :key="w.label">{{ i ? ', ' : ' ' }}<router-link v-if="w.path" :to="w.path">{{ w.label }}</router-link><span v-else>{{ w.label }}</span></template>
              </div>
              <div v-else-if="p.enabled && !p.pulled && plugins.status === 'ready' && !plugins.failed[p.pkg]" class="small muted">Loaded, but it doesn't add anything to a screen.</div>
            </div>
            <a v-if="p.update" class="btn primary" :href="trustUrl('install', { pkg: p.pkg, hash: p.update.hash })">Update</a>
            <a class="btn" :href="trustUrl('toggle', { pkg: p.pkg, on: p.enabled ? '0' : '1' })">{{ p.enabled ? 'Switch off' : 'Switch on' }}</a>
            <a class="btn" :href="trustUrl('remove', { pkg: p.pkg })">Remove</a>
          </div>
          <PluginPart v-if="settingsOf(p.pkg)" :part="settingsOf(p.pkg).part" :module="settingsOf(p.pkg).module" />
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-h"><span class="icon sm">add_circle</span><h2>Add plugins</h2><span class="spacer"></span>
        <input v-model="q" class="search" type="search" placeholder="Search" aria-label="Search plugins" />
      </div>
      <div class="panel-b col">
        <p v-if="!toFind.length" class="muted small">{{ q ? 'Nothing matches.' : 'Nothing new to add right now.' }}</p>
        <div v-for="p in toFind" :key="p.name" class="item row">
          <span class="icon">{{ p.icon }}</span>
          <div class="grow">
            <b>{{ p.title }}</b> <span class="small muted">by {{ mine(p) ? 'you' : p.name.split('/')[0] }}</span>
            <span v-if="p.worksWithEverything" class="chip ok" title="Uses only the SDK and the data route, so it works with other plugins">works with everything</span>
            <div class="small">{{ p.description }}</div>
            <div v-if="p.latest?.checks?.warnings?.length" class="small warn">Check before installing: {{ p.latest.checks.warnings.map((w) => w.msg).join('; ') }}</div>
          </div>
          <a class="btn primary" :href="trustUrl('install', { pkg: p.name, hash: p.latest.hash })">Install</a>
        </div>
      </div>
    </section>

    <details class="panel more">
      <summary class="panel-h"><span class="icon sm">tune</span><h2>More</h2></summary>
      <div class="panel-b col">
        <h3>Connections</h3>
        <p class="small muted">Accounts plugins can use without ever seeing your password or key.</p>
        <p v-if="!conns.on" class="small muted">Off on this server (its admin sets VAULT_KEY).</p>
        <template v-else>
          <div v-for="c in conns.connections" :key="c.name" class="row small"><span class="mono grow">{{ c.name }} → {{ c.site }}</span><a class="btn" :href="trustUrl('vault-remove', { name: c.name })">Remove</a></div>
          <div v-if="conns.providers?.length" class="row wrap"><a v-for="p in conns.providers" :key="p.name" class="btn" :href="trustUrl('connect', { provider: p.name })"><span class="icon sm">link</span>Connect {{ p.title }}</a></div>
          <div class="row wrap">
            <input v-model="newConn.name" placeholder="name (e.g. todoist)" aria-label="Connection name" />
            <input v-model="newConn.site" placeholder="site (api.todoist.com)" aria-label="Site" />
            <a class="btn" :class="{ disabled: !newConn.name || !newConn.site }" :href="trustUrl('vault-save', { name: newConn.name.toLowerCase(), site: newConn.site.toLowerCase() })">Add a key</a>
          </div>
        </template>
        <h3>Safety</h3>
        <div class="row wrap small">
          <a :href="trustUrl('disable-plugins')">Switch off every plugin</a>
          <span class="muted">·</span>
          <a href="/app?safe=1">Open once without plugins</a>
        </div>
        <details v-if="plugins.conflicts.length" class="small"><summary class="muted">{{ plugins.conflicts.length }} things plugins asked for but didn't get</summary><ul><li v-for="c in plugins.conflicts" :key="c" class="mono">{{ c }}</li></ul></details>
        <p v-if="auth.user?.handle" class="small muted">You publish plugins as <span class="mono">{{ auth.user.handle }}</span>.</p>
      </div>
    </details>
  </div>
</template>

<style scoped>
.ph { gap: 12px; padding: 16px; max-width: 900px; }
.item { display: flex; flex-direction: column; gap: 6px; }
.item.row { flex-direction: row; align-items: center; }
.item + .item { border-top: 1px solid var(--border); padding-top: 10px; }
.search { min-width: 200px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; font: inherit; }
input { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font: inherit; }
.note { padding: 10px 12px; border: 1px solid var(--warn); border-radius: 8px; }
.more summary { cursor: pointer; list-style: none; }
.more summary::-webkit-details-marker { display: none; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 8px 0 0; }
.chip.ok { color: var(--accent); }
.btn.disabled { pointer-events: none; opacity: .5; }
ul { margin: 4px 0 0; padding-left: 18px; }
.warn { color: var(--warn); } .danger { color: var(--danger); }
</style>
