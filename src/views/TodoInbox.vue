<script setup>
// S-20 · Todo Inbox — every todo, with filters, smart quick-add and bulk actions.
import { computed, ref, reactive, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { state, ui, todayISO, mondayOf, addDays, diffDays, relDay, linkType, linkLabel, parseQuick, addTodo, updateTodo, toggleTodo, toast, CAPACITY_H, fmtSlash, wd, partLabel, isContainer, subCount, parentPath } from '../store'
import LsdToggle from '../components/LsdToggle.vue'
import Chip from '../components/Chip.vue'
import Prio from '../components/Prio.vue'
import { startDrag, endDrag, overRow, leaveRow, dropOnRow, dropClass } from '../dnd'

const T = computed(() => todayISO())
const weekStart = computed(() => mondayOf(T.value))
const inWeek = (d) => d && d >= weekStart.value && d <= addDays(weekStart.value, 6)

const VIEWS = {
  inbox: { label: 'Inbox', icon: 'inbox', fn: (t) => !t.done },
  today: { label: 'Today', icon: 'today', fn: (t) => !t.done && (t.scheduled?.date === T.value || t.due === T.value) },
  week: { label: 'This week', icon: 'date_range', fn: (t) => !t.done && (inWeek(t.scheduled?.date) || inWeek(t.due)) },
  scheduled: { label: 'Scheduled', icon: 'event_available', fn: (t) => !t.done && !!t.scheduled },
  unscheduled: { label: 'Unscheduled', icon: 'event_busy', fn: (t) => !t.done && !t.scheduled },
  done: { label: 'Done archive', icon: 'archive', fn: (t) => t.done },
}
const LINK_TYPES = { goal: 'Strategic (PSG/SIG)', course: 'Coursework', plan: 'Research plans', risk: 'Risks', ipb: 'IPB', kaizen: 'Kaizen' }

const route = useRoute()
const f = reactive({ view: VIEWS[route.query.view] ? route.query.view : 'inbox', links: [], lsd: [], prio: [] })
watch(() => route.query.view, (v) => { if (VIEWS[v]) f.view = v })
const toggleIn = (arr, v) => { const i = arr.indexOf(v); i >= 0 ? arr.splice(i, 1) : arr.push(v) }
function resetFilters() { f.links = []; f.lsd = []; f.prio = [] }

/* matching todos as a tree: subtasks right under their parent (indented); a subtask whose parent isn't
   in the view shows at the top level with its parent path as a breadcrumb */
const tree = computed(() => {
  const m = state.todos
    .filter(VIEWS[f.view].fn)
    .filter((t) => !f.links.length || t.links.some((l) => f.links.includes(linkType(l))))
    .filter((t) => !f.lsd.length || f.lsd.includes(t.lsd))
    .filter((t) => !f.prio.length || f.prio.includes(t.priority))
  const cmp = (a, b) => Number(a.done) - Number(b.done) || a.priority - b.priority || a.order - b.order
  const ids = new Set(m.map((t) => t.id))
  const out = []
  const depth = {}
  const visit = (t, d) => {
    if (t.id in depth) return
    depth[t.id] = d
    out.push(t)
    m.filter((c) => c.parent === t.id).sort((a, b) => Number(a.done) - Number(b.done) || a.order - b.order).forEach((c) => visit(c, d + 1))
  }
  m.filter((t) => !t.parent || !ids.has(t.parent)).sort(cmp).forEach((t) => visit(t, 0))
  m.forEach((t) => visit(t, 0)) // anything left (a parent cycle from bad data)
  return { out, depth }
})
const rows = computed(() => tree.value.out)
const depthOf = (t) => tree.value.depth[t.id] ?? 0
const crumbOf = (t) => (t.parent && !depthOf(t) ? parentPath(t) : '')
watchEffect(() => { ui.visibleIds = rows.value.map((t) => t.id) })
const count = (k) => state.todos.filter(VIEWS[k].fn).length
const linkCount = (k) => state.todos.filter((t) => !t.done && t.links.some((l) => linkType(l) === k)).length

/* quick add */
const quick = ref('')
const parsed = computed(() => parseQuick(quick.value))
function add() {
  const p = parsed.value
  if (!p.title) return
  const t = addTodo({ title: p.title, links: p.links, due: p.due, timeMin: p.timeMin ?? 30, priority: p.priority ?? 3, lsd: p.lsd ?? 'S' })
  ui.selectedId = t.id
  toast(`Added ${t.id} to inbox`)
  quick.value = ''
}

/* bulk */
const picked = ref([])
const allPicked = computed({
  get: () => rows.value.length > 0 && rows.value.every((r) => picked.value.includes(r.id)),
  set: (v) => { picked.value = v ? rows.value.map((r) => r.id) : [] },
})
const bulk = reactive({ date: '', prio: '', link: '' })
const goalIds = computed(() => state.plans.filter((p) => p.status !== 'archived').flatMap((p) => [...p.psgs.map((g) => g.no), ...p.sigs.map((s) => s.no)]))
function each(fn) { picked.value.forEach(fn); toast(`Updated ${picked.value.length} todos`) }
const bulkSchedule = () => { if (bulk.date) each((id) => updateTodo(id, { scheduled: { date: bulk.date, start: null } })); bulk.date = '' }
const bulkPrio = () => { if (bulk.prio) each((id) => updateTodo(id, { priority: +bulk.prio })); bulk.prio = '' }
const bulkLink = () => {
  if (bulk.link) each((id) => { const t = state.todos.find((x) => x.id === id); if (!t.links.includes(bulk.link)) t.links.push(bulk.link) })
  bulk.link = ''
}
const bulkDone = () => { each((id) => updateTodo(id, { done: true })); picked.value = [] }

/* footer stats */
const stats = computed(() => {
  const open = state.todos.filter((t) => !t.done)
  return {
    todayMin: open.filter((t) => t.scheduled?.date === T.value).reduce((s, t) => s + t.timeMin, 0),
    overdue: open.filter((t) => t.due && diffDays(T.value, t.due) < 0).length,
    dueToday: open.filter((t) => t.due === T.value).length,
    high: open.filter((t) => t.priority <= 2).length,
  }
})
function open(t) { ui.selectedId = t.id; ui.drawerId = t.id }
</script>

<template>
  <div class="inbox">
    <aside class="filters">
      <div class="fh"><span class="icon sm">filter_list</span><span class="mono upper small grow">Filter stack</span><button class="btn sm" @click="resetFilters">Reset</button></div>
      <div class="grp">
        <div class="tiny upper muted gh">Views</div>
        <button v-for="(v, k) in VIEWS" :key="k" class="fv" :class="{ on: f.view === k }" @click="f.view = k">
          <span class="icon sm">{{ v.icon }}</span><span class="grow">{{ v.label }}</span><span class="mono small">{{ count(k) }}</span>
        </button>
      </div>
      <div class="grp">
        <div class="tiny upper muted gh">Linked modules</div>
        <label v-for="(l, k) in LINK_TYPES" :key="k" class="fl">
          <input type="checkbox" :checked="f.links.includes(k)" @change="toggleIn(f.links, k)" />
          <span class="grow">{{ l }}</span><span class="mono small muted">{{ linkCount(k) }}</span>
        </label>
      </div>
      <div class="grp">
        <div class="tiny upper muted gh">Scope (L / S / D)</div>
        <div class="row">
          <button v-for="k in ['L', 'S', 'D']" :key="k" class="btn grow" :class="{ active: f.lsd.includes(k) }" @click="toggleIn(f.lsd, k)">[{{ k }}]</button>
        </div>
      </div>
      <div class="grp">
        <div class="tiny upper muted gh">Priority</div>
        <div class="row">
          <button v-for="p in 5" :key="p" class="btn sm grow" :class="{ active: f.prio.includes(p) }" @click="toggleIn(f.prio, p)">P{{ p }}</button>
        </div>
      </div>
    </aside>

    <section class="main">
      <form class="qa" @submit.prevent="add">
        <span class="mono ok prompt">&gt;</span>
        <input v-model="quick" class="mono grow" placeholder="Read chapter 3 #RUN 30m due:fri p2 @BASE" />
        <button class="btn primary" type="submit"><span class="icon sm">add_task</span>Add to inbox <span class="kbd">↵</span></button>
      </form>
      <div v-if="quick" class="parser">
        <span class="tiny upper muted">Live parser</span>
        <span class="pc">Title: <b>{{ parsed.title || '—' }}</b></span>
        <span class="pc mono">Est: <b>{{ parsed.timeMin ?? 30 }}m</b></span>
        <span class="pc mono">Due: <b>{{ parsed.due ?? '—' }}</b></span>
        <span class="pc mono">Prio: <b>P{{ parsed.priority ?? 3 }}</b></span>
        <Chip v-for="l in parsed.links" :key="l" :id="l" />
      </div>

      <div v-if="picked.length" class="bulkbar">
        <span class="mono small info">{{ picked.length }} selected</span>
        <input v-model="bulk.date" type="date" class="input mono small" @change="bulkSchedule" title="Schedule to day" />
        <select v-model="bulk.prio" class="select small" @change="bulkPrio"><option value="">Set priority…</option><option v-for="p in 5" :key="p" :value="p">P{{ p }}</option></select>
        <select v-model="bulk.link" class="select small" @change="bulkLink"><option value="">Link to goal…</option><option v-for="g in goalIds" :key="g" :value="g">{{ g }}{{ linkLabel(g) ? ' · ' + linkLabel(g) : '' }}</option></select>
        <button class="btn sm" @click="bulkDone"><span class="icon sm">done_all</span>Mark done</button>
        <span class="spacer"></span>
        <button class="btn sm" @click="picked = []">Clear</button>
      </div>

      <div class="tablewrap">
        <table class="tbl">
          <colgroup>
            <col style="width: 34px" /><col style="width: 40px" /><col style="width: 46px" /><col style="width: 74px" />
            <col /><col style="width: 60px" /><col style="width: 66px" /><col style="width: 100px" /><col style="width: 110px" /><col style="width: 170px" />
          </colgroup>
          <thead>
            <tr>
              <th><input v-model="allPicked" type="checkbox" title="Select all" /></th>
              <th>Done</th><th>Prio</th><th>ID</th><th>Title / vital points</th><th>Time</th><th>L/S/D</th><th>Due</th><th>Scheduled</th><th>Linked to</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="t in rows" :key="t.id" class="clickable" :class="[{ done: t.done, selected: ui.selectedId === t.id }, dropClass(t)]" :draggable="!isContainer(t)"
              @click="open(t)" @dragstart="startDrag($event, t)" @dragend="endDrag" @dragover="overRow($event, t)" @dragleave="leaveRow($event, t)" @drop="dropOnRow($event, t)"
            >
              <td @click.stop><input v-model="picked" type="checkbox" :value="t.id" /></td>
              <td @click.stop><input type="checkbox" :checked="t.done" @change="toggleTodo(t.id)" /></td>
              <td><Prio :p="t.priority" /></td>
              <td class="mono small muted"><span class="icon sm grip">drag_indicator</span>{{ t.id }}</td>
              <td :style="{ paddingLeft: 8 + depthOf(t) * 18 + 'px' }">
                <div class="title ellipsis">
                  <span v-if="depthOf(t)" class="sub-mark muted">↳</span>
                  <span v-if="crumbOf(t)" class="crumb muted" :title="crumbOf(t)">{{ crumbOf(t) }} › </span>
                  <span v-if="partLabel(t)" class="part mono">{{ partLabel(t) }}</span>{{ t.title }}
                  <span v-if="isContainer(t)" class="subc mono" :title="'subtasks done'">{{ subCount(t).done }}/{{ subCount(t).total }}</span>
                </div>
                <div v-if="t.vital" class="small muted ellipsis">{{ t.vital }}</div>
              </td>
              <td class="mono small">{{ t.timeMin }}m</td>
              <td><LsdToggle :model-value="t.lsd" @update:model-value="(v) => updateTodo(t.id, { lsd: v })" /></td>
              <td class="mono small" :class="t.due && !t.done && diffDays(T, t.due) < 0 ? 'danger' : t.due === T ? 'warn' : ''">{{ t.due ? relDay(t.due, T) : '—' }}</td>
              <td class="mono small">
                <template v-if="t.scheduled">{{ wd(t.scheduled.date) }} {{ fmtSlash(t.scheduled.date) }}<span v-if="t.scheduled.start" class="muted">&nbsp;{{ t.scheduled.start }}</span></template>
                <span v-else class="muted">{{ isContainer(t) ? 'via subtasks' : 'unscheduled' }}</span>
              </td>
              <td><div class="chips"><Chip v-for="l in t.links" :key="l" :id="l" /></div></td>
            </tr>
          </tbody>
        </table>
        <div v-if="!rows.length" class="empty">No todos match. Type above to add one, or press <span class="kbd">N</span>.</div>

        <!-- phone (ISS-10): the table's select/id columns waste the width, so cards instead —
             the name leads, then what's next: done · P · time · when · links; open = tap -->
        <div v-if="rows.length" class="cards">
          <div v-for="t in rows" :key="t.id" class="card" :class="{ done: t.done }" @click="open(t)">
            <div class="r1 row">
              <input type="checkbox" :checked="t.done" title="Done" @click.stop @change="toggleTodo(t.id)" />
              <Prio :p="t.priority" />
              <span class="ttl grow ellipsis" :style="{ paddingLeft: depthOf(t) * 14 + 'px' }"><span v-if="depthOf(t)" class="sub-mark muted">↳ </span><span v-if="partLabel(t)" class="part mono">{{ partLabel(t) }}</span>{{ t.title }}<span v-if="isContainer(t)" class="subc mono">{{ subCount(t).done }}/{{ subCount(t).total }}</span></span>
              <span class="mono small muted">{{ t.timeMin }}m</span>
            </div>
            <div class="r2 row small">
              <span class="mono" :class="t.scheduled ? 'ok' : 'muted'">{{ t.scheduled ? `${wd(t.scheduled.date)}${t.scheduled.start ? ' ' + t.scheduled.start : ''}` : 'inbox' }}</span>
              <span v-if="t.due" class="mono" :class="!t.done && diffDays(T, t.due) < 0 ? 'danger' : t.due === T ? 'warn' : 'muted'">due {{ relDay(t.due, T) }}</span>
              <Chip v-for="l in t.links.slice(0, 3)" :key="l" :id="l" />
              <span v-if="t.links.length > 3" class="mono muted">+{{ t.links.length - 3 }}</span>
            </div>
          </div>
        </div>
      </div>

      <footer class="stats mono small">
        <span><span class="muted">TAKT CAPACITY TODAY</span> {{ stats.todayMin }}m / {{ CAPACITY_H * 60 }}m</span>
        <span><span class="muted">OVERDUE</span> <b :class="stats.overdue ? 'danger' : ''">{{ stats.overdue }}</b></span>
        <span><span class="muted">DUE TODAY</span> <b :class="stats.dueToday ? 'warn' : ''">{{ stats.dueToday }}</b></span>
        <span><span class="muted">HIGH PRIO (P1/P2)</span> {{ stats.high }}</span>
        <span class="spacer"></span>
        <span class="muted">Drag rows or ⌥↑/⌥↓ to reprioritise · J/K move · ↵ open · X done</span>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.sub-mark { margin-right: 4px; }
.crumb { font-size: 0.9em; }
.subc { font-size: 10px; color: var(--info); border: 1px solid color-mix(in srgb, var(--info) 50%, var(--border)); border-radius: 2px; padding: 0 3px; margin-left: 6px; }
.inbox { display: grid; grid-template-columns: 250px 1fr; height: 100%; }
.filters { border-right: 1px solid var(--border); overflow: auto; background: var(--surface); }
.fh { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.grp { padding: 10px 8px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px; }
.gh { padding: 2px 6px 6px; }
.fv { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; border: 0; background: transparent; border-radius: 2px; cursor: pointer; color: var(--muted); text-align: left; }
.fv:hover { background: var(--surface-2); color: var(--text); }
.fv.on { background: var(--surface-2); color: var(--accent); box-shadow: inset 2px 0 0 var(--accent); }
.fl { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; cursor: pointer; }
.main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.qa { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
.qa input { height: 34px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 2px; padding: 0 10px; outline: none; font-size: 13px; }
.qa input:focus { border-color: var(--info); }
.prompt { font-size: 16px; font-weight: 700; }
.parser { display: flex; align-items: center; gap: 6px; padding: 8px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.pc { border: 1px solid var(--border); border-radius: 2px; padding: 2px 8px; font-size: 11px; color: var(--muted); }
.pc b { color: var(--text); }
.bulkbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: color-mix(in srgb, var(--info) 8%, var(--surface)); border-bottom: 1px solid var(--border); }
.input.small, .select.small { height: 24px; font-size: 11px; }
.tablewrap { flex: 1; overflow: auto; }
.tbl th { position: sticky; top: 0; z-index: 1; }
.part { font-size: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 2px; padding: 0 3px; margin-right: 6px; }
.grip { vertical-align: middle; margin-left: -6px; cursor: grab; opacity: 0.5; }
.chips { display: flex; gap: 4px; overflow: hidden; }
.stats { display: flex; gap: 18px; padding: 8px 16px; border-top: 1px solid var(--border); background: var(--surface); flex-wrap: wrap; }
/* phone card list (ISS-10): no select column, name first */
.cards { display: none; }
@media (max-width: 640px) {
  .tbl { display: none; }
  .cards { display: flex; flex-direction: column; }
  .card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--border); cursor: pointer; }
  .card:active { background: var(--surface-2); }
  .card.done .ttl { text-decoration: line-through; color: var(--muted); }
  .r2 { flex-wrap: wrap; gap: 10px; }
  .card .part { font-size: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 2px; padding: 0 3px; margin-right: 6px; }
  .qa button { display: none; } /* the input alone adds on Enter */
}
@media (max-width: 900px) { .inbox { grid-template-columns: 1fr; } .filters { display: none; } }
</style>
