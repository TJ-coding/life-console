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
const keyOf = (p) => p.pkg ?? p.name
const isMine = (p) => p.mine ?? mine(p)
/** Like or unlike; the count updates in place. */
async function toggleLike(p) {
  try { const r = await api(p.liked ? 'DELETE' : 'PUT', `/api/registry/plugins/${keyOf(p)}/like`, {}); p.liked = r.liked; p.likes = r.likes } catch (e) { toast(e.message) }
}
// Details: the owner edits the listing (title, description, icon) and whether it's in the registry
const editing = ref(null) // { key, title, description, icon }
function openDetails(p) { editing.value = editing.value?.key === keyOf(p) ? null : { key: keyOf(p), title: p.title, description: p.description ?? '', icon: p.icon } }
async function saveDetails() {
  const d = editing.value
  try { await api('PATCH', `/api/registry/plugins/${d.key}`, { title: d.title, description: d.description, icon: d.icon }); editing.value = null; toast('Saved'); refresh() } catch (e) { toast(e.message) }
}
async function setListed(p, on) {
  try {
    await api('PATCH', `/api/registry/plugins/${keyOf(p)}`, { visibility: on ? 'public' : 'private' })
    toast(on ? `${p.title} is in the registry` : `${p.title} is out of the registry`, { label: 'Undo', run: () => setListed(p, !on) })
    refresh()
  } catch (e) { toast(e.message) }
}
const listing = (p) => p.visibility === 'public' ? 'in the registry' : p.visibility === 'unlisted' ? 'out of the registry (still works for people who have it)' : 'only you'
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

    <section class="panel" aria-labelledby="yours">
      <div class="panel-h">
        <span class="icon sm" aria-hidden="true">extension</span><h2 id="yours">Your extensions</h2>
        <span v-if="installed.length" class="mono small muted">{{ installed.length }}</span>
        <span v-if="attention" class="mono small danger">· {{ attention }} need{{ attention === 1 ? 's' : '' }} attention</span>
        <span v-if="updates" class="mono small warn">· {{ updates }} update{{ updates === 1 ? '' : 's' }}</span>
      </div>
      <div class="panel-b flush">
        <p v-if="status && !installed.length" class="empty muted">None yet.</p>
        <div v-for="p in installed" :key="p.pkg" class="ext" :class="{ off: !p.enabled }">
          <span class="icon ext-icon" aria-hidden="true">{{ p.icon }}</span>
          <div class="grow">
            <div class="ext-name"><b>{{ p.title }}</b> <span class="mono tiny muted">{{ p.version }}</span><span v-if="p.mine" class="tiny upper muted"> · yours, {{ listing(p) }}</span></div>
            <p v-if="p.description" class="small muted desc">{{ p.description }}</p>
            <p v-if="stateOf(p)" class="small" :class="stateOf(p).tone">{{ stateOf(p).text }}</p>
            <div v-else-if="whereShown(p.pkg).length" class="shows row wrap"><span class="tiny upper muted">Shows on</span><router-link v-for="w in whereShown(p.pkg)" :key="w.label" class="btn sm" :to="w.path">{{ w.label }}<span class="icon sm" aria-hidden="true">arrow_outward</span></router-link></div>
            <p v-else-if="plugins.status === 'ready'" class="small muted">Runs in the background</p>
            <div v-if="editing?.key === p.pkg" class="ext-settings"><form class="details" @submit.prevent="saveDetails">
              <label class="small muted" :for="`t-${editing.key}`">Name</label><input :id="`t-${editing.key}`" v-model="editing.title" maxlength="80" />
              <label class="small muted" :for="`d-${editing.key}`">Description</label><textarea :id="`d-${editing.key}`" v-model="editing.description" rows="2" maxlength="400"></textarea>
              <label class="small muted" :for="`i-${editing.key}`">Icon</label><span class="row"><span class="icon" aria-hidden="true">{{ editing.icon || 'extension' }}</span><input :id="`i-${editing.key}`" v-model="editing.icon" class="mono" placeholder="water_drop" /><a class="small" href="https://fonts.google.com/icons" target="_blank" rel="noopener">Find icons</a></span>
              <div class="row wrap"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" @click="editing = null">Cancel</button><router-link class="btn" :to="{ path: '/m/extensions/workshop', query: { edit: editing.key } }"><span class="icon sm" aria-hidden="true">code</span>Edit code</router-link><span class="spacer"></span>
                <button v-if="p.visibility === 'public'" class="btn danger-ghost" type="button" @click="setListed(p, false)">Remove from registry</button>
                <button v-else class="btn" type="button" @click="setListed(p, true)">Publish to registry</button></div>
            </form></div>
            <div v-if="open[p.pkg] && settingsOf(p.pkg)" class="ext-settings">
              <PluginPart :part="settingsOf(p.pkg).part" :module="settingsOf(p.pkg).module" />
            </div>
          </div>
          <div class="ext-actions row wrap">
            <span v-if="p.mine || p.likes || p.downloads" class="stats mono small muted" :title="`${p.downloads} install${p.downloads === 1 ? '' : 's'}, ${p.likes} like${p.likes === 1 ? '' : 's'}`"><span class="icon sm" aria-hidden="true">download</span>{{ p.downloads }}</span>
            <button v-if="!p.mine && !p.upstream" class="btn sm" :class="{ active: p.liked }" :aria-pressed="!!p.liked" :aria-label="p.liked ? 'Unlike' : 'Like'" @click="toggleLike(p)"><span class="icon sm" aria-hidden="true">favorite</span>{{ p.likes }}</button>
            <span v-else-if="p.mine" class="stats mono small muted"><span class="icon sm" aria-hidden="true">favorite</span>{{ p.likes }}</span>
            <a v-if="p.update && !p.pulled" class="btn primary" :href="trustUrl('install', { pkg: p.pkg, hash: p.update.hash })" :title="p.update.changelog || ''">Update to {{ p.update.version }}</a>
            <button v-if="settingsOf(p.pkg)" class="btn" :class="{ active: open[p.pkg] }" :aria-expanded="!!open[p.pkg]" @click="open[p.pkg] = !open[p.pkg]"><span class="icon sm" aria-hidden="true">tune</span>Settings</button>
            <button v-if="p.mine && !p.upstream" class="btn" :class="{ active: editing?.key === p.pkg }" :aria-expanded="editing?.key === p.pkg" @click="openDetails(p)"><span class="icon sm" aria-hidden="true">edit_note</span>Details</button>
            <a v-if="!p.pulled" class="btn" :href="trustUrl('toggle', { pkg: p.pkg, on: p.enabled ? '0' : '1' })">{{ p.enabled ? 'Switch off' : 'Switch on' }}</a>
            <a class="btn danger-ghost icon-only" :href="trustUrl('remove', { pkg: p.pkg })" :aria-label="`Remove ${p.title}`" title="Remove"><span class="icon sm" aria-hidden="true">delete</span></a>
          </div>
        </div>
        <div class="ext-new"><router-link class="btn" to="/m/extensions/workshop"><span class="icon sm" aria-hidden="true">add</span>New extension</router-link></div>
      </div>
    </section>

    <section class="panel" aria-labelledby="add">
      <div class="panel-h">
        <span class="icon sm" aria-hidden="true">add_circle</span><h2 id="add">Add extensions</h2><span class="spacer"></span>
        <input v-model="q" class="search" type="search" placeholder="Search" aria-label="Search extensions" />
      </div>
      <div class="panel-b flush">
        <p v-if="!toFind.length" class="empty muted">
          <template v-if="q">Nothing matches "{{ q }}".</template>
          <template v-else>Nothing to add yet.</template>
        </p>
        <div v-for="p in toFind" :key="p.name" class="ext">
          <span class="icon ext-icon" aria-hidden="true">{{ p.icon }}</span>
          <div class="grow">
            <div class="ext-name"><b>{{ p.title }}</b> <span class="tiny muted">by {{ mine(p) ? `you, ${listing(p)}` : p.name.split('/')[0] }}</span><span v-if="p.worksWithEverything" class="tiny upper ok" title="Uses only the SDK and the data route, so it works with other extensions"> · works with everything</span></div>
            <p class="small muted desc">{{ p.description }}</p>
            <p v-if="p.latest?.checks?.warnings?.length" class="small warn">Check first: {{ p.latest.checks.warnings.map((w) => w.msg).join('; ') }}</p>
            <div v-if="editing?.key === p.name" class="ext-settings"><form class="details" @submit.prevent="saveDetails">
              <label class="small muted" :for="`t-${editing.key}`">Name</label><input :id="`t-${editing.key}`" v-model="editing.title" maxlength="80" />
              <label class="small muted" :for="`d-${editing.key}`">Description</label><textarea :id="`d-${editing.key}`" v-model="editing.description" rows="2" maxlength="400"></textarea>
              <label class="small muted" :for="`i-${editing.key}`">Icon</label><span class="row"><span class="icon" aria-hidden="true">{{ editing.icon || 'extension' }}</span><input :id="`i-${editing.key}`" v-model="editing.icon" class="mono" placeholder="water_drop" /><a class="small" href="https://fonts.google.com/icons" target="_blank" rel="noopener">Find icons</a></span>
              <div class="row wrap"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" @click="editing = null">Cancel</button><router-link class="btn" :to="{ path: '/m/extensions/workshop', query: { edit: editing.key } }"><span class="icon sm" aria-hidden="true">code</span>Edit code</router-link><span class="spacer"></span>
                <button v-if="p.visibility === 'public'" class="btn danger-ghost" type="button" @click="setListed(p, false)">Remove from registry</button>
                <button v-else class="btn" type="button" @click="setListed(p, true)">Publish to registry</button></div>
            </form></div>
          </div>
          <div class="ext-actions row wrap">
            <span class="stats mono small muted" :title="`${p.downloads ?? 0} install${p.downloads === 1 ? '' : 's'}`"><span class="icon sm" aria-hidden="true">download</span>{{ p.downloads ?? 0 }}</span>
            <button v-if="!mine(p) && !p.source" class="btn sm" :class="{ active: p.liked }" :aria-pressed="!!p.liked" :aria-label="p.liked ? 'Unlike' : 'Like'" @click="toggleLike(p)"><span class="icon sm" aria-hidden="true">favorite</span>{{ p.likes ?? 0 }}</button>
            <span v-else class="stats mono small muted"><span class="icon sm" aria-hidden="true">favorite</span>{{ p.likes ?? 0 }}</span>
            <button v-if="mine(p) && !p.source" class="btn" :class="{ active: editing?.key === p.name }" :aria-expanded="editing?.key === p.name" @click="openDetails(p)"><span class="icon sm" aria-hidden="true">edit_note</span>Details</button>
            <a class="btn" :href="trustUrl('install', { pkg: p.name, hash: p.latest.hash })" :aria-label="`Install ${p.title}`">Install</a>
          </div>
        </div>
      </div>
    </section>

    <details class="panel more">
      <summary class="panel-h"><span class="icon sm" aria-hidden="true">tune</span><h2>Accounts and safety</h2></summary>
      <div class="panel-b col">
        <div class="tiny upper muted">Connected accounts</div>
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
        <div class="tiny upper muted">Safety</div>
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
.ph { gap: 12px; padding: 16px; }
.ext { display: flex; gap: 12px; align-items: flex-start; padding: 12px; }
.ext + .ext { border-top: 1px solid var(--border); }
.ext.off { opacity: .7; }
.ext-icon { margin-top: 1px; color: var(--muted); }
.ext-name { font-size: 15px; }
.ext p { margin: 3px 0 0; }
.desc { max-width: 80ch; }
.shows { gap: 6px; margin-top: 6px; }
.ext-actions { gap: 6px; flex: none; }
.ext-settings { border-top: 1px solid var(--border); margin-top: 10px; padding-top: 10px; }
.ext-new { display: flex; justify-content: center; padding: 10px 12px; border-top: 1px solid var(--border); }
.stats { display: inline-flex; align-items: center; gap: 3px; }
.details { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; align-items: center; max-width: 640px; }
.details textarea { resize: vertical; }
.details .row { grid-column: 2; }
.empty { margin: 0; padding: 12px; font-size: 13px; }
.search { width: 220px; height: 28px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 2px; padding: 0 8px; font: inherit; }
input, textarea { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; font: inherit; }
.note { padding: 10px 12px; border: 1px solid var(--warn); border-radius: 4px; }
.more summary { cursor: pointer; list-style: none; }
.more summary::-webkit-details-marker { display: none; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
ul { margin: 4px 0 0; padding-left: 18px; }
.ok { color: var(--accent); } .warn { color: var(--warn); } .danger, .bad { color: var(--danger); }
@media (max-width: 640px) {
  .ext { flex-wrap: wrap; }
  .ext-actions { width: 100%; padding-left: 30px; }
  .panel-h .search { width: 130px; }
}
</style>
