<script setup>
// S-30 · Strategic Plan (Goals Planner) — Vision → PSG → SIG cascade with tables and review widgets.
import { computed, ref, nextTick, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { state, ui, todayISO, sigsOf, psgPct, nextCheckDate, relDay, diffDays, planIds, addTodo, toggleTodo, toast, byPriority, findPlan, nextPsgNo, deletePlan, addDays, addDeadline, allSigs, sigWouldCycle } from '../store'
import PlanTabs from '../components/PlanTabs.vue'
import Chip from '../components/Chip.vue'
import Prio from '../components/Prio.vue'

const route = useRoute()
const router = useRouter()
const plan = computed(() => findPlan(route.params.planId))
// unknown plan id (deleted, or typo) → back to the plans overview
watch(plan, (p) => {
  if (!p) router.replace('/strategy')
  else try { localStorage.setItem('life-console/last-plan', p.id) } catch { /* ignore */ }
}, { immediate: true })
// tabs reuse this component: don't carry selection/filters over to another plan
watch(() => route.params.planId, () => { selected.value = null; psgFilter.value = '' })
// opened from the overview with ?goal=PSG-01 / SIG-01.2: select and scroll to that goal
watch(() => route.query.goal, (no) => { if (no) nextTick(() => { selected.value = null; select(String(no)) }) }, { immediate: true })
function removePlan() {
  const p = plan.value
  if (!confirm(`Delete ${p.planNo} "${p.title}" with its ${p.psgs.length} PSGs and ${p.sigs.length} SIGs?\n\nTip: set it to Archived to keep it out of the way without deleting.`)) return
  deletePlan(p.id)
  toast(`Deleted ${p.planNo}`)
  router.replace('/strategy')
}
const T = computed(() => todayISO())
const selected = ref(null)
const psgFilter = ref('')

const psgs = computed(() => [...plan.value.psgs].sort((a, b) => a.priority - b.priority))
const sigs = computed(() =>
  [...plan.value.sigs].filter((s) => !psgFilter.value || s.psg === psgFilter.value)
    .sort((a, b) => a.psg.localeCompare(b.psg) || a.priority - b.priority))
const overall = computed(() => {
  const p = psgs.value
  return p.length ? Math.round(p.reduce((s, x) => s + psgPct(x.no), 0) / p.length) : 0
})
const STATUS = ['open', 'doing', 'done']
const LABEL = { open: 'Open ◯', doing: 'Doing !', done: 'Done ✓' }
function cycle(obj) {
  obj.status = STATUS[(STATUS.indexOf(obj.status) + 1) % 3]
  if (obj.pct !== undefined) {
    if (obj.status === 'done') obj.pct = 100
    else if (obj.status === 'open' && obj.pct === 100) obj.pct = 0
  }
}
function setPct(s, v) {
  s.pct = Math.max(0, Math.min(100, Number(v) || 0))
  s.status = s.pct >= 100 ? 'done' : s.pct > 0 ? 'doing' : 'open'
}
async function select(no) {
  selected.value = selected.value === no ? null : no
  await nextTick()
  document.querySelector(`[data-row="${no}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function addPsg() {
  const no = nextPsgNo() // unique across all plans
  plan.value.psgs.push({ no, name: 'New strategic goal', priority: plan.value.psgs.length + 1, indicators: '', timeBound: '', status: 'open' })
  selected.value = no
}
function addSig(psgNo) {
  const sel = selected.value
  psgNo = psgNo || (sel?.startsWith('PSG') ? sel : plan.value.sigs.find((s) => s.no === sel)?.psg) || psgs.value[0]?.no
  if (!psgNo) return
  const n = Math.max(0, ...sigsOf(psgNo).map((s) => Number(s.no.split('.')[1]) || 0)) + 1
  const no = `SIG-${psgNo.slice(4)}.${n}`
  plan.value.sigs.push({ no, psg: psgNo, name: 'New indicator goal', priority: 3, criteria: '', timeBound: '', status: 'open', pct: 0 })
  selected.value = no
}
function todoFor(sig) {
  const t = addTodo({ title: `Advance ${sig.no}: ${sig.name}`, links: [sig.no], priority: sig.priority, lsd: 'L', timeMin: 60 })
  ui.selectedId = t.id
  ui.drawerId = t.id
  toast(`Created ${t.id} for ${sig.no}`)
}

/* deadlines tied to PSG / SIG (ISS-4): create one pre-linked to the goal, then open the edit dialog */
function goalDeadline(g) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(g.timeBound ?? '') ? g.timeBound : addDays(T.value, 7)
  const d = addDeadline({ title: `${g.no} · ${g.name}`, due: `${day}T18:00`, source: g.no, priority: Number(g.priority) || 3 })
  ui.deadlineId = d.id
  toast(`Deadline added for ${g.no}`)
}

/* SIG dependencies (ISS-5): optional `deps` array of SIG numbers, defaulted in normalizeState */
const sigNos = computed(() => allSigs().map((s) => s.no).sort())
function addDep(s, dep) {
  if (!dep) return
  if (!Array.isArray(s.deps)) s.deps = []
  if (s.deps.includes(dep)) { toast(`${dep} is already a dependency`); return }
  if (sigWouldCycle(s.no, dep)) { toast(`Depending on ${dep} would be circular`); return }
  s.deps.push(dep)
}
function removeDep(s, dep) {
  s.deps = (s.deps ?? []).filter((x) => x !== dep)
}

const linked = computed(() => {
  const ids = new Set(planIds(plan.value))
  return state.todos.filter((t) => t.links.some((l) => ids.has(l))).sort(byPriority)
})

/* check schedule */
const recentChecks = computed(() => plan.value.checkLog.slice(-4))
function logCheck() {
  plan.value.checkLog.push({ date: T.value, reminder: true, checked: true, updated: false })
  toast(`Check logged · next ${nextCheckDate(plan)}`)
}

/* events timetable */
const ev = reactive({ sym: '◆', event: '', date: '' })
const events = computed(() => [...plan.value.events].sort((a, b) => a.date.localeCompare(b.date)))
function addEvent() {
  if (!ev.event || !ev.date) return
  plan.value.events.push({ ...ev })
  ev.event = ''
  ev.date = ''
}
function removeEvent(e) {
  plan.value.events.splice(plan.value.events.indexOf(e), 1)
}
const pctClass = (n) => (n >= 100 ? 'ok' : n >= 40 ? 'info' : n > 0 ? 'warn' : 'muted')
const print = () => window.print()
</script>

<template>
  <div v-if="plan" class="sp">
    <PlanTabs />
    <header class="sp-head">
      <div class="row wrap">
        <h1 class="mono">Strategic Plan · <span class="muted">Plan No.</span> {{ plan.planNo }}</h1>
        <input v-model="plan.title" class="input ghost title-in mono" />
        <select v-model="plan.status" class="select mono status-sel" :class="plan.status" title="Plan status">
          <option value="active">● Active</option><option value="paused">● Paused</option><option value="archived">● Archived</option>
        </select>
        <input v-model="plan.health" class="input ghost health mono" title="Health label" placeholder="On-track" />
        <span class="spacer"></span>
        <button class="btn" @click="print"><span class="icon sm">picture_as_pdf</span>Export A4</button>
        <button class="btn icon-only danger-ghost" title="Delete this plan" @click="removePlan"><span class="icon sm">delete</span></button>
      </div>
      <div class="row wrap small">
        <span class="icon sm muted">schedule</span>
        <span class="muted mono">Next check date:</span>
        <b class="mono" :class="diffDays(T, nextCheckDate(plan)) <= 1 ? 'warn' : ''">{{ nextCheckDate(plan) }} ({{ relDay(nextCheckDate(plan), T) }})</b>
      </div>
      <div class="row intent"><b class="mono">INTENT:</b><input v-model="plan.intent" class="input ghost grow" /></div>
    </header>

    <div class="sp-body">
      <!-- cascading goal diagram -->
      <section class="tree panel">
        <div class="panel-h">
          <span class="icon sm ok">account_tree</span><h2>Cascading goal diagram</h2>
          <span class="spacer"></span>
          <button class="btn sm" @click="addPsg">+ PSG</button>
        </div>
        <div class="canvas">
          <div class="node vision">
            <div class="row tiny upper"><span class="chip goal">Vision</span><span class="spacer"></span><span class="muted mono">{{ plan.planNo }}</span></div>
            <input v-model="plan.vision" class="input ghost vis-in" />
            <div class="row small mono"><span class="muted">AGGREGATE</span><span class="spacer"></span><span :class="pctClass(overall)">{{ overall }}%</span></div>
            <div class="bar"><i :style="{ width: overall + '%' }"></i></div>
          </div>
          <div class="trunk"></div>
          <div v-for="p in psgs" :key="p.no" class="branch">
            <div class="node psg" :class="{ sel: selected === p.no }" @click="select(p.no)">
              <div class="row"><Prio :p="p.priority" /><span class="mono ok">{{ p.no }}</span><span class="spacer"></span><span class="mono small" :class="pctClass(psgPct(p.no))">{{ psgPct(p.no) }}%</span></div>
              <input v-model="p.name" class="input ghost nm-in" placeholder="PSG name" title="Edit PSG name" @click.stop />
              <div class="bar" :class="psgPct(p.no) < 40 ? 'warn' : ''"><i :style="{ width: psgPct(p.no) + '%' }"></i></div>
            </div>
            <div class="kids">
              <div v-for="s in sigsOf(p.no)" :key="s.no" class="node sig" :class="[s.status, { sel: selected === s.no }]" @click="select(s.no)">
                <div class="grow">
                  <div class="row sig-nm"><span class="mono small" :class="s.status === 'done' ? 'ok' : 'info'">{{ s.no }}</span><input v-model="s.name" class="input ghost sig-in" placeholder="SIG name" title="Edit SIG name" @click.stop /></div>
                  <div class="small muted ellipsis">{{ s.criteria || '—' }}</div>
                  <div v-if="(s.deps ?? []).length" class="tiny muted mono ellipsis" title="Depends on">⛓ {{ (s.deps ?? []).join(', ') }}</div>
                </div>
                <span class="status" :class="s.status">{{ s.pct }}% {{ s.status === 'done' ? '✓' : s.status === 'doing' ? '!' : '◯' }}</span>
              </div>
              <button class="btn sm add-sig" @click="addSig(p.no)">+ SIG</button>
            </div>
          </div>
        </div>
      </section>

      <div class="right">
        <!-- PSG table -->
        <section class="panel">
          <div class="panel-h"><span class="icon sm ok">flag</span><h2>Prioritised strategic goals (PSG)</h2><span class="spacer"></span><span class="mono small muted">PSG % = mean of SIGs</span></div>
          <div class="tw">
            <table class="tbl">
              <colgroup><col style="width: 58px" /><col style="width: 84px" /><col /><col style="width: 30%" /><col style="width: 100px" /><col style="width: 84px" /><col style="width: 64px" /><col style="width: 44px" /></colgroup>
              <thead><tr><th>Prio</th><th>PSG No.</th><th>PSG name</th><th>Indicators of success</th><th>Time bound</th><th>Status</th><th>Done %</th><th></th></tr></thead>
              <tbody>
                <tr v-for="p in psgs" :key="p.no" :data-row="p.no" :class="{ selected: selected === p.no }" @click="selected = p.no">
                  <td><select v-model.number="p.priority" class="input ghost mono"><option v-for="n in 5" :key="n" :value="n">P{{ n }}</option></select></td>
                  <td class="mono ok">{{ p.no }}</td>
                  <td><input v-model="p.name" class="input ghost w" /></td>
                  <td><input v-model="p.indicators" class="input ghost w small" /></td>
                  <td><input v-model="p.timeBound" class="input ghost w mono small" /></td>
                  <td><button class="status" :class="p.status" @click.stop="cycle(p)">{{ LABEL[p.status] }}</button></td>
                  <td class="mono" :class="pctClass(psgPct(p.no))">{{ psgPct(p.no) }}%</td>
                  <td><button class="btn sm icon-only" title="Add a deadline for this PSG" @click.stop="goalDeadline(p)"><span class="icon sm">alarm_add</span></button></td>
                </tr>
              </tbody>
              <tfoot>
                <tr><td colspan="8" class="td-add"><button class="add-row" @click="addPsg"><span class="icon sm">add</span>Add a new PSG…</button></td></tr>
              </tfoot>
            </table>
          </div>
        </section>

        <!-- SIG table -->
        <section class="panel">
          <div class="panel-h">
            <span class="icon sm info">rule</span><h2>Specific indicator goals (SIG)</h2>
            <span class="spacer"></span>
            <select v-model="psgFilter" class="select mono small"><option value="">All PSGs</option><option v-for="p in psgs" :key="p.no" :value="p.no">{{ p.no }}</option></select>
            <button class="btn sm" @click="addSig(psgFilter)">+ SIG</button>
          </div>
          <div class="tw">
            <table class="tbl wide">
              <colgroup><col style="width: 58px" /><col style="width: 88px" /><col style="width: 70px" /><col style="width: 24%" /><col /><col style="width: 140px" /><col style="width: 100px" /><col style="width: 84px" /><col style="width: 64px" /><col style="width: 72px" /></colgroup>
              <thead><tr><th>Prio</th><th>SIG No.</th><th>PSG</th><th>SIG name</th><th>Specific &amp; measurable criteria</th><th>Depends on</th><th>Time bound</th><th>Status</th><th>Done %</th><th></th></tr></thead>
              <tbody>
                <tr v-for="s in sigs" :key="s.no" :data-row="s.no" :class="{ selected: selected === s.no }" @click="selected = s.no">
                  <td><select v-model.number="s.priority" class="input ghost mono"><option v-for="n in 5" :key="n" :value="n">P{{ n }}</option></select></td>
                  <td class="mono info">{{ s.no }}</td>
                  <td class="mono small muted">{{ s.psg }}</td>
                  <td><input v-model="s.name" class="input ghost w" /></td>
                  <td><input v-model="s.criteria" class="input ghost w small" /></td>
                  <td @click="selected = s.no">
                    <div class="deps">
                      <span v-for="dp in s.deps ?? []" :key="dp" class="dep"><Chip :id="dp" /><button class="dep-x" :title="`Remove dependency on ${dp}`" @click.stop="removeDep(s, dp)"><span class="icon sm">close</span></button></span>
                      <select class="dep-add mono" title="Add a dependency (another SIG this one needs)" @click.stop @change="addDep(s, $event.target.value); $event.target.value = ''">
                        <option value="">＋ dep</option>
                        <option v-for="no in sigNos.filter((n) => n !== s.no)" :key="no" :value="no" :disabled="sigWouldCycle(s.no, no)">{{ no }}</option>
                      </select>
                    </div>
                  </td>
                  <td><input v-model="s.timeBound" class="input ghost w mono small" /></td>
                  <td><button class="status" :class="s.status" @click.stop="cycle(s)">{{ LABEL[s.status] }}</button></td>
                  <td><input :value="s.pct" type="number" min="0" max="100" step="5" class="input ghost w mono" :class="pctClass(s.pct)" @change="setPct(s, $event.target.value)" /></td>
                  <td>
                    <div class="row acts">
                      <button class="btn sm icon-only" title="Add a deadline for this SIG" @click.stop="goalDeadline(s)"><span class="icon sm">alarm_add</span></button>
                      <button class="btn sm icon-only" title="Create todo for this SIG" @click.stop="todoFor(s)"><span class="icon sm">add_task</span></button>
                    </div>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr><td colspan="10" class="td-add"><button class="add-row" @click="addSig(psgFilter)"><span class="icon sm">add</span>Add a new SIG{{ psgFilter ? ` under ${psgFilter}` : '…' }}</button></td></tr>
              </tfoot>
            </table>
          </div>
        </section>

        <div class="widgets">
          <!-- check schedule -->
          <section class="panel">
            <div class="panel-h"><span class="icon sm warn">event_repeat</span><h3>Check schedule</h3><span class="spacer"></span><button class="btn sm" @click="logCheck">Log check today</button></div>
            <table class="tbl">
              <thead><tr><th>Date</th><th>Reminder</th><th>Checked</th><th>Updated</th></tr></thead>
              <tbody>
                <tr v-for="c in recentChecks" :key="c.date">
                  <td class="mono small">{{ c.date }}</td>
                  <td><input v-model="c.reminder" type="checkbox" /></td>
                  <td><input v-model="c.checked" type="checkbox" /></td>
                  <td><input v-model="c.updated" type="checkbox" /></td>
                </tr>
              </tbody>
            </table>
            <div class="panel-b row small">
              <span class="muted">Check frequency: every</span>
              <input v-model.number="plan.checkEveryDays" type="number" min="1" class="input mono num-in" />
              <span class="muted">days</span><span class="spacer"></span>
              <span class="mono">next <b :class="diffDays(T, nextCheckDate(plan)) <= 1 ? 'warn' : 'ok'">{{ nextCheckDate(plan) }}</b></span>
            </div>
          </section>

          <!-- events timetable -->
          <section class="panel">
            <div class="panel-h"><span class="icon sm info">flag_circle</span><h3>Events timetable</h3></div>
            <div class="evs">
              <div v-for="e in events" :key="e.event + e.date" class="ev">
                <span class="sym">{{ e.sym }}</span><span class="grow ellipsis">{{ e.event }}</span>
                <span class="mono small" :class="diffDays(T, e.date) <= 14 ? 'warn' : 'muted'">{{ e.date }}</span>
                <button class="btn sm icon-only" title="Remove" @click="removeEvent(e)"><span class="icon sm">close</span></button>
              </div>
            </div>
            <form class="row ev-add" @submit.prevent="addEvent">
              <select v-model="ev.sym" class="select small sym-in"><option v-for="s in ['◆', '▲', '■', '●', '★']" :key="s">{{ s }}</option></select>
              <input v-model="ev.event" class="input small grow" placeholder="Event" />
              <input v-model="ev.date" type="date" class="input small mono" />
              <button class="btn sm" type="submit">Add</button>
            </form>
          </section>

          <!-- linked todos -->
          <section class="panel">
            <div class="panel-h"><span class="icon sm ok">checklist</span><h3>Linked todos</h3><span class="spacer"></span><span class="mono small muted">{{ linked.filter((t) => !t.done).length }} pending</span></div>
            <div class="lt">
              <div v-for="t in linked" :key="t.id" class="lt-row" :class="{ done: t.done }" @click="ui.drawerId = t.id">
                <input type="checkbox" :checked="t.done" @click.stop @change="toggleTodo(t.id)" />
                <span class="grow ellipsis">{{ t.title }}</span>
                <Chip :id="t.links.find((l) => planIds(plan).includes(l))" />
              </div>
              <div v-if="!linked.length" class="empty">No todos linked to this plan yet.</div>
            </div>
          </section>

          <!-- acronym legend -->
          <section class="panel">
            <details open>
              <summary class="panel-h"><span class="icon sm muted">info</span><h3>Acronym legend</h3></summary>
              <div class="panel-b small legend-b">
                <div><b class="mono ok">PSG</b> = Prioritised Strategic Goal</div>
                <div><b class="mono info">SIG</b> = Specific Indicator Goal</div>
                <div><b class="mono">◯ ! ✓</b> = Open · Doing · Done</div>
              </div>
            </details>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sp { display: flex; flex-direction: column; min-height: 100%; }
.status-sel { height: 26px; font-size: 11px; color: var(--accent); border-color: var(--accent); }
.status-sel.paused { color: var(--warn); border-color: var(--warn); }
.status-sel.archived { color: var(--muted); border-color: var(--border); }
.health { width: 120px; font-size: 12px; color: var(--muted); }
.sp-head { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.wrap { flex-wrap: wrap; }
h1 { margin: 0; font-size: 18px; font-weight: 600; }
.title-in { font-size: 16px; font-weight: 600; width: 260px; }
.intent .input { font-size: 13px; }
.sp-body { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 12px; padding: 12px; align-items: start; }
.tree { position: sticky; top: 12px; max-height: calc(100vh - 140px); }
.canvas {
  overflow: auto; padding: 16px;
  background-image: radial-gradient(var(--border) 1px, transparent 1px); background-size: 16px 16px;
}
.node { background: var(--surface); border: 1px solid var(--border); border-radius: 2px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
.node:hover { border-color: var(--muted); }
.node.sel { border-color: var(--info); box-shadow: 0 0 0 1px var(--info); }
.vision { border-color: var(--accent); cursor: default; }
.vis-in { font-weight: 600; font-size: 14px; height: 28px; }
.trunk { width: 1px; height: 18px; background: var(--border); margin-left: 20px; }
.branch { position: relative; margin-left: 20px; padding-left: 16px; border-left: 1px solid var(--border); padding-bottom: 14px; }
.branch::before { content: ''; position: absolute; left: 0; top: 18px; width: 16px; border-top: 1px solid var(--border); }
.nm-in { height: 24px; font-size: 13px; font-weight: 600; padding: 0 2px; }
.sig-nm { gap: 6px; align-items: baseline; }
.sig-in { height: 20px; font-size: 11px; flex: 1; min-width: 60px; padding: 0 2px; }
.deps { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; }
.dep { display: inline-flex; align-items: center; gap: 1px; border: 1px solid var(--border); border-radius: 2px; padding: 0 2px 0 4px; }
.dep-x { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; height: 16px; display: inline-flex; align-items: center; }
.dep-x:hover { color: var(--danger); }
.dep-x .icon { font-size: 12px; }
.dep-add { height: 20px; font-size: 10px; background: transparent; }
.acts { gap: 2px; flex-wrap: nowrap; }
.acts .btn { padding: 0 2px; }
/* add-new buttons at the bottom of each table (ISS-1) */
tfoot .td-add { padding: 0; border-bottom: 0; }
.add-row { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 0; border: 0; border-top: 1px dashed var(--border); background: transparent; color: var(--muted); font-size: 12px; cursor: pointer; }
.add-row:hover { color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
.kids { margin: 6px 0 0 14px; padding-left: 12px; border-left: 1px dashed var(--border); display: flex; flex-direction: column; gap: 6px; }
.sig { flex-direction: row; align-items: center; gap: 8px; }
.sig.doing { border-color: color-mix(in srgb, var(--info) 45%, var(--border)); }
.sig.done { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.add-sig { align-self: flex-start; }
.right { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.tw { overflow-x: auto; }
.tw .tbl { min-width: 760px; }
.tw .tbl.wide { min-width: 900px; }
.input.w { width: 100%; }
.select.small, .input.small { height: 24px; font-size: 11px; }
.widgets { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.num-in { width: 52px; height: 24px; }
.evs { display: flex; flex-direction: column; gap: 4px; padding: 8px; }
.ev { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 2px; padding: 4px 8px; }
.sym { color: var(--info); width: 14px; }
.ev-add { padding: 0 8px 10px; }
.sym-in { width: 44px; }
.lt { max-height: 220px; overflow: auto; }
.lt-row { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; border-bottom: 1px solid var(--border); cursor: pointer; }
.lt-row:hover { background: var(--surface-2); }
.lt-row.done span.grow { text-decoration: line-through; color: var(--muted); }
details summary { list-style: none; cursor: pointer; }
details summary::-webkit-details-marker { display: none; }
.legend-b { display: flex; flex-direction: column; gap: 6px; }
@media (max-width: 1200px) { .sp-body { grid-template-columns: 1fr; } .tree { position: static; max-height: none; } }
@media (max-width: 800px) { .widgets { grid-template-columns: 1fr; } }
</style>
