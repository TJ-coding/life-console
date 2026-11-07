<script setup>
// S-95 · Issues — things to fix or improve, reported per screen. Agents read the same list
// (`npm run issues`) and mark items fixed with the commit that fixed them.
import { computed, ref, onMounted } from 'vue'
import { issues, loadIssues, updateIssue, deleteIssue, openIssueDialog, KINDS, STATUSES } from '../issues'
import { toast } from '../store'
import { auth, isAdmin } from '../auth'
import { useRoute } from 'vue-router'

const route = useRoute()
// everyone sees their own reports; only admins (or local-only mode) change or delete them
const admin = computed(() => isAdmin() || auth.status === 'none')
const filter = ref('active') // active | fixed | wontfix | all
const screen = ref('')
const platform = ref('') // '' | mobile | web
const expanded = ref(null)

onMounted(loadIssues)

const ACTIVE = ['open', 'in-progress']
const kindIcon = (k) => KINDS.find((x) => x.key === k)?.icon ?? 'bug_report'
const SEV_ORDER = { high: 0, medium: 1, low: 2 }
const screens = computed(() => [...new Set(issues.list.map((i) => i.screen || '—'))].sort())
const visible = computed(() => issues.list.filter((i) =>
  (filter.value === 'all' || (filter.value === 'active' ? ACTIVE.includes(i.status) : i.status === filter.value)) &&
  (!screen.value || (i.screen || '—') === screen.value) &&
  (!platform.value || i.platform === platform.value)))
const groups = computed(() => {
  const by = {}
  for (const i of visible.value) (by[i.screen || '—'] ??= { screen: i.screen || '—', title: i.screenTitle, items: [] }).items.push(i)
  for (const g of Object.values(by)) g.items.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.createdAt.localeCompare(b.createdAt))
  return Object.values(by).sort((a, b) => a.screen.localeCompare(b.screen))
})
const counts = computed(() => ({
  active: issues.list.filter((i) => ACTIVE.includes(i.status)).length,
  fixed: issues.list.filter((i) => i.status === 'fixed').length,
}))
const when = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')

async function setStatus(i, status) {
  try { await updateIssue(i.id, { status }); toast(`${i.id} → ${status}`) } catch (e) { toast(`Couldn't update: ${e.message}`) }
}
async function remove(i) {
  if (!confirm(`Delete ${i.id} "${i.title}"?`)) return
  try { await deleteIssue(i.id) } catch (e) { toast(`Couldn't delete: ${e.message}`) }
}
</script>

<template>
  <div class="iss-page">
    <div class="toolbar">
      <div class="seg">
        <button class="btn sm" :class="{ active: filter === 'active' }" @click="filter = 'active'">Open <span class="mono">{{ counts.active }}</span></button>
        <button class="btn sm" :class="{ active: filter === 'fixed' }" @click="filter = 'fixed'">Fixed <span class="mono">{{ counts.fixed }}</span></button>
        <button class="btn sm" :class="{ active: filter === 'wontfix' }" @click="filter = 'wontfix'">Won't fix</button>
        <button class="btn sm" :class="{ active: filter === 'all' }" @click="filter = 'all'">All</button>
      </div>
      <div class="row">
        <span class="tiny upper muted">Screen</span>
        <select v-model="screen" class="select mono small"><option value="">All</option><option v-for="s in screens" :key="s" :value="s">{{ s }}</option></select>
      </div>
      <div class="row">
        <span class="tiny upper muted">From</span>
        <select v-model="platform" class="select mono small"><option value="">All</option><option value="mobile">Mobile</option><option value="web">Web</option></select>
      </div>
      <span class="spacer"></span>
      <span v-if="issues.queued" class="small warn row"><span class="icon sm">cloud_off</span>{{ issues.queued }} waiting to send</span>
      <button class="btn primary" @click="openIssueDialog(route)"><span class="icon sm">add</span>Report issue <span class="kbd">I</span></button>
    </div>

    <p class="hint small muted">
      Press <span class="kbd">I</span> on any screen (or the <span class="icon sm">bug_report</span> button in the top bar) to report what should change there.
      Claude reads open issues with <code class="mono">npm run issues</code>, fixes them, and marks them fixed with the commit.
    </p>

    <div v-if="issues.error" class="err small danger row"><span class="icon sm">error</span>Couldn't load issues ({{ issues.error }}).</div>
    <div v-else-if="issues.loaded && !groups.length" class="empty muted">No {{ filter === 'all' ? '' : filter === 'active' ? 'open ' : filter + ' ' }}issues.</div>

    <section v-for="g in groups" :key="g.screen" class="grp">
      <div class="gh row"><b class="mono">{{ g.screen }}</b><span class="muted">{{ g.title }}</span><span class="mono small muted">{{ g.items.length }}</span></div>
      <div v-for="i in g.items" :key="i.id" class="item" :class="[i.status, `sev-${i.severity}`]">
        <div class="line" @click="expanded = expanded === i.id ? null : i.id">
          <span class="icon sm kind" :title="i.kind">{{ kindIcon(i.kind) }}</span>
          <span class="mono small muted iid">{{ i.id }}</span>
          <span class="mono tiny upper sev">{{ i.severity }}</span>
          <span class="grow ttl">{{ i.title }}</span>
          <span class="icon sm muted" :title="i.platform === 'mobile' ? 'Reported from mobile' : 'Reported from the web (desktop)'">{{ i.platform === 'mobile' ? 'smartphone' : 'computer' }}</span>
          <span class="mono tiny muted">{{ when(i.createdAt) }}</span>
          <select v-if="admin" :value="i.status" class="select mono small" @click.stop @change="setStatus(i, $event.target.value)">
            <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>
          <span v-else class="mono tiny upper muted">{{ i.status }}</span>
        </div>
        <div v-if="expanded === i.id" class="more small">
          <p v-if="i.details" class="details">{{ i.details }}</p>
          <div class="meta mono tiny muted">
            <router-link :to="i.route || '/'">{{ i.route || '/' }}</router-link>
            <span>platform: {{ i.platform }}</span>
            <span v-for="(v, k) in i.context" :key="k" v-show="k !== 'userAgent'">{{ k }}: {{ v }}</span>
          </div>
          <p v-if="i.resolution || i.commit" class="res">
            <span class="icon sm ok">task_alt</span>{{ i.resolution }}
            <span v-if="i.commit" class="mono tiny muted"> · {{ i.commit }}</span>
            <span v-if="i.resolvedAt" class="mono tiny muted"> · {{ when(i.resolvedAt) }}</span>
          </p>
          <div v-if="admin" class="row">
            <span v-if="i.reporter" class="mono tiny muted">reported by {{ i.reporter }}</span>
            <span class="spacer"></span>
            <button class="btn sm danger-ghost" @click="remove(i)"><span class="icon sm">delete</span>Delete</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.iss-page { max-width: 1000px; }
.toolbar { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.seg { display: flex; gap: 4px; }
.hint { padding: 10px 16px 0; margin: 0; }
.hint .icon { vertical-align: -3px; }
.err, .empty { padding: 24px 16px; }
.grp { padding: 12px 16px 0; }
.gh { gap: 10px; padding: 4px 0 6px; border-bottom: 1px solid var(--border); }
.item { border-bottom: 1px solid var(--border); }
.line { display: flex; align-items: center; gap: 10px; min-height: 36px; cursor: pointer; }
.line:hover { background: var(--surface-2); }
.iid { width: 52px; flex: none; }
.sev { width: 52px; flex: none; color: var(--muted); }
.sev-high .sev { color: var(--danger); }
.sev-medium .sev { color: var(--warn); }
.ttl { min-width: 0; }
.item.fixed .ttl, .item.wontfix .ttl { color: var(--muted); text-decoration: line-through; }
.item.in-progress .kind { color: var(--info); }
.more { padding: 4px 0 10px 30px; display: flex; flex-direction: column; gap: 6px; }
.details { white-space: pre-wrap; margin: 0; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.res { margin: 0; display: flex; align-items: center; gap: 6px; }
@media (max-width: 640px) {
  .toolbar { padding: 8px 10px; gap: 8px; }
  .grp, .hint { padding-left: 10px; padding-right: 10px; }
  .iid, .line .tiny.muted { display: none; }
  .sev { width: 44px; }
  .more { padding-left: 0; }
}
</style>
