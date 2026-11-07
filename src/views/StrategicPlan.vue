<script setup>
// S-30 · Strategic Plan (Goals Planner) — Vision → PSG → SIG cascade with tables and review widgets.
import { computed, ref, nextTick, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { state, ui, todayISO, sigsOf, psgPct, nextCheckDate, relDay, diffDays, planIds, addTodo, toggleTodo, toast, byPriority, findPlan, nextPsgNo, deletePlan, addDays, addDeadline, allSigs, sigWouldCycle, unlinkGoal, linkLabel, moveSig, renameGoalNo, nextSigNo, isPsgNo, GOAL_NO_MAX } from '../store'
import PlanTabs from '../components/PlanTabs.vue'
import Chip from '../components/Chip.vue'
import Prio from '../components/Prio.vue'
import TimeBound from '../components/TimeBound.vue'
import GoalFlow from '../components/GoalFlow.vue'
import TaskNode from '../components/TaskNode.vue'
import { boundIssues, countdown, urgency, effDue, minsTo } from '../glance'

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
/* Focus: selecting a goal lights up what's below it and dims the rest of the page (never its parents).
   PSG → its SIGs; then every SIG those depend on, all the way down the chain. Tasks (with their subtasks)
   and deadlines count when linked to the selected goal itself or, for a PSG, to one of its SIGs. */
const focus = computed(() => {
  const sel = selected.value
  if (!sel) return null
  const p = plan.value
  const goals = new Set([sel])
  const own = new Set([sel])
  if (p.psgs.some((x) => x.no === sel)) {
    for (const s of p.sigs) if (s.psg === sel) { goals.add(s.no); own.add(s.no) }
  } else {
    const s = p.sigs.find((x) => x.no === sel)
    if (!s) return null
  }
  // dependencies, transitively (SIGs only; a dependency may live in another plan)
  const sigs = new Map(allSigs().map((s) => [s.no, s]))
  const stack = [...goals]
  while (stack.length) for (const d of sigs.get(stack.pop())?.deps ?? []) if (!goals.has(d)) { goals.add(d); stack.push(d) }
  const todos = new Set(state.todos.filter((t) => t.links.some((l) => own.has(l))).map((t) => t.id))
  for (let grew = true; grew;) {
    grew = false
    for (const t of state.todos) if (t.parent && todos.has(t.parent) && !todos.has(t.id)) { todos.add(t.id); grew = true }
  }
  const deadlines = new Set(state.deadlines.filter((d) => own.has(d.source)).map((d) => d.id))
  return { sel, goals, todos, deadlines }
})
/** '' with nothing selected (or for the selected goal itself), else fx-rel / fx-dim. */
const fx = (kind, id) => (!focus.value || id === focus.value.sel ? '' : focus.value[kind].has(id) ? 'fx-rel' : 'fx-dim')
const focusSummary = computed(() => {
  const f = focus.value
  if (!f) return ''
  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`
  const openTodos = state.todos.filter((t) => f.todos.has(t.id) && !t.done).length
  const openDl = state.deadlines.filter((d) => f.deadlines.has(d.id) && !d.done).length
  return `${n(f.goals.size - 1, 'goal')} · ${n(openTodos, 'task')} · ${n(openDl, 'deadline')}`
})
// Esc clears the focus when nothing else (dialog, drawer, palette) is open; runs before App's window handler
function onEsc(e) {
  if (e.key !== 'Escape' || !selected.value) return
  if (ui.deadlineId || ui.drawerId || ui.blockId || ui.splitId || ui.palette || document.querySelector('dialog[open], .modal')) return
  selected.value = null
}
onMounted(() => document.addEventListener('keydown', onEsc))
onBeforeUnmount(() => document.removeEventListener('keydown', onEsc))
async function select(no) {
  selected.value = selected.value === no ? null : no
  await nextTick()
  document.querySelector(`[data-row="${no}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
/* table rows: a click toggles the focus; clicks into a row's fields only select it, so editing never deselects */
function rowClick(no, e) {
  if (e.target.closest('input, select, textarea, button, a, label, [contenteditable]')) selected.value = no
  else selected.value = selected.value === no ? null : no
}
/* goal flow: a click highlights in place (no scrolling away from the flow); a double-click jumps to the table row */
const selectInFlow = (no) => { selected.value = selected.value === no ? null : no }
function showInTable(no) {
  selected.value = no
  nextTick(() => document.querySelector(`[data-row="${no}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
}

function addPsg() {
  const no = nextPsgNo() // unique across all plans
  plan.value.psgs.push({ no, name: 'New strategic goal', priority: plan.value.psgs.length + 1, indicators: '', timeBound: '', status: 'open' })
  selected.value = no
}
function addSig(psgNo) {
  const sel = selected.value
  psgNo = psgNo || (plan.value.psgs.some((p) => p.no === sel) ? sel : plan.value.sigs.find((s) => s.no === sel)?.psg) || psgs.value[0]?.no
  if (!psgNo) return
  const no = nextSigNo(psgNo)
  plan.value.sigs.push({ no, psg: psgNo, name: 'New indicator goal', priority: 3, criteria: '', timeBound: '', status: 'open', pct: 0 })
  selected.value = no
}
/* move a SIG to another PSG after creation: renumbered under the new PSG, links/deps/selection follow */
function changePsg(sig, psgNo) {
  const r = moveSig(sig, psgNo)
  if (!r) return
  if (selected.value === r.from) selected.value = r.to
  toast(`${r.from} → ${r.to}${r.edits ? ` · ${r.edits} link${r.edits > 1 ? 's' : ''} updated` : ''}`)
}
/* editable goal numbers (the whole "No."): links, deps, a PSG's SIGs, the selection and the filter follow */
function setNo(goal, e) {
  const r = renameGoalNo(goal, e.target.value)
  if (r?.error) toast(r.error)
  if (!r || r.error) { e.target.value = goal.no; return }
  if (selected.value === r.from) selected.value = r.to
  if (psgFilter.value === r.from) psgFilter.value = r.to
  toast(`${r.from} → ${r.to}${r.edits ? ` · ${r.edits} link${r.edits > 1 ? 's' : ''} updated` : ''}`)
}
const resetNo = (goal, e) => { e.target.value = goal.no; e.target.blur() }
function todoFor(sig) {
  const t = addTodo({ title: `Advance ${sig.no}: ${sig.name}`, links: [sig.no], priority: sig.priority, lsd: 'L', timeMin: 60 })
  ui.selectedId = t.id
  ui.drawerId = t.id
  toast(`Created ${t.id} for ${sig.no}`)
}

/* ISS-20: deleting a PSG or SIG with a confirm; linked todos/deadlines are cleaned up (unlinkGoal) */
function removePsg(p) {
  const kids = sigsOf(p.no)
  const linked = unlinkCount(p.no) + kids.reduce((n, k) => n + unlinkCount(k.no), 0)
  const msg = kids.length ? `Delete ${p.no} "${p.name}" and its ${kids.length} SIG${kids.length > 1 ? 's' : ''}?` : `Delete ${p.no} "${p.name}"?`
  const note = linked ? `\n\n${linked} link${linked > 1 ? 's' : ''} to it on todos/deadlines will be removed too.` : ''
  if (!confirm(`${msg}${note}`)) return
  const ids = kids.map((k) => k.no).concat(p.no)
  for (const no of ids) unlinkGoal(no)
  const arr = plan.value.psgs
  arr.splice(arr.findIndex((x) => x.no === p.no), 1)
  plan.value.sigs = plan.value.sigs.filter((x) => x.psg !== p.no)
  cleanDeps(ids)
  if (ids.includes(selected.value)) selected.value = null
  toast(`Deleted ${p.no}${kids.length ? ` and its ${kids.length} SIG${kids.length > 1 ? 's' : ''}` : ''}`)
}
function removeSig(s) {
  const linked = unlinkCount(s.no)
  if (!confirm(`Delete ${s.no} "${s.name}"?${linked ? `\n\n${linked} link${linked > 1 ? 's' : ''} to it on todos/deadlines will be removed too.` : ''}`)) return
  unlinkGoal(s.no)
  const arr = plan.value.sigs
  arr.splice(arr.findIndex((x) => x.no === s.no), 1)
  cleanDeps([s.no])
  if (selected.value === s.no) selected.value = null
  toast(`Deleted ${s.no}`)
}
/** How many todos/deadlines currently reference this goal (for the confirm message). */
function unlinkCount(no) {
  return state.todos.filter((t) => t.links.includes(no)).length + state.deadlines.filter((d) => d.source === no).length
}
/** Drop dependencies that point at deleted SIGs. */
function cleanDeps(ids) {
  for (const s of plan.value.sigs) if (s.deps?.some((d) => ids.includes(d))) s.deps = s.deps.filter((d) => !ids.includes(d))
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

/* Tasks shown in the cascade diagram under the goal they move. A todo linked to a SIG shows under that SIG
   only (not again under its PSG); one linked to the PSG alone shows under the PSG. Done ones become a count. */
const tasksByGoal = computed(() => {
  const sigNosHere = new Set(plan.value.sigs.map((s) => s.no))
  const psgOfSig = Object.fromEntries(plan.value.sigs.map((s) => [s.no, s.psg]))
  const m = {}
  const put = (no, t) => { (m[no] ??= { open: [], done: 0, doneIds: new Set() }); if (t.done) { m[no].done++; m[no].doneIds.add(t.id) } else m[no].open.push(t) }
  for (const t of linked.value) {
    const sigLinks = t.links.filter((l) => sigNosHere.has(l))
    for (const no of sigLinks) put(no, t)
    const covered = new Set(sigLinks.map((no) => psgOfSig[no]))
    for (const l of t.links) if (!covered.has(l) && plan.value.psgs.some((p) => p.no === l)) put(l, t)
  }
  // a subtask shows nested under its parent when the parent is listed under the same goal
  for (const g of Object.values(m)) {
    const here = new Set(g.open.map((t) => t.id))
    g.open = g.open.filter((t) => !t.parent || !here.has(t.parent) && !g.doneIds?.has(t.parent))
  }
  return m
})
/* deadlines tied to this plan, its PSGs or SIGs (source = goal / plan number): open soonest first, then done */
const planDeadlines = computed(() => {
  const ids = new Set(planIds(plan.value))
  return state.deadlines.filter((d) => ids.has(d.source))
    .sort((a, b) => Number(a.done) - Number(b.done) || effDue(a).localeCompare(effDue(b)))
})
const openPlanDeadlines = computed(() => planDeadlines.value.filter((d) => !d.done))
const dlOf = (no) => openPlanDeadlines.value.filter((d) => d.source === no)
const dlLeft = (d) => (minsTo(effDue(d)) <= 0 ? 'overdue' : countdown(effDue(d)))
function planDeadline() {
  goalDeadline({ no: plan.value.planNo, name: plan.value.title, priority: 3, timeBound: '' })
}
const tasksOf = (no) => tasksByGoal.value[no] ?? { open: [], done: 0 }
let showTasksInit = true
try { showTasksInit = localStorage.getItem('life-console/strategy-tasks') !== '0' } catch { /* ignore */ }
const showTasks = ref(showTasksInit)
watch(showTasks, (v) => { try { localStorage.setItem('life-console/strategy-tasks', v ? '1' : '0') } catch { /* ignore */ } })
const fmtMin = (m) => (!m ? '' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`)

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
/* time-bound problems across the plan, summarised in the flow header */
const flowIssueList = computed(() => [...plan.value.psgs, ...plan.value.sigs].flatMap((g) => boundIssues(g).map((x) => `${g.no}: ${x}`)))
const flowIssues = computed(() => flowIssueList.value.length)
const flowIssueText = computed(() => flowIssueList.value.join('\n'))
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
          <button class="btn sm" :class="{ on: showTasks }" title="Show the tasks linked to each goal" @click="showTasks = !showTasks"><span class="icon sm">checklist</span>Tasks</button>
          <button class="btn sm" @click="addPsg">+ PSG</button>
        </div>
        <div v-if="focus" class="fx-bar small">
          <span class="icon sm info">filter_center_focus</span><b class="mono info fx-id">{{ focus.sel }}</b>
          <span class="muted ellipsis">{{ focusSummary }}</span><span class="spacer"></span>
          <button class="btn sm icon-only" title="Show everything again (Esc)" @click="selected = null"><span class="icon sm">close</span></button>
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
            <div class="node psg" :class="[fx('goals', p.no), { sel: selected === p.no }]" @click="select(p.no)">
              <div class="row"><Prio :p="p.priority" /><span class="mono ok">{{ p.no }}</span><span class="spacer"></span><span class="mono small" :class="pctClass(psgPct(p.no))">{{ psgPct(p.no) }}%</span></div>
              <input v-model="p.name" class="input ghost nm-in" placeholder="PSG name" title="Edit PSG name" @click.stop />
              <div class="bar" :class="psgPct(p.no) < 40 ? 'warn' : ''"><i :style="{ width: psgPct(p.no) + '%' }"></i></div>
            </div>
            <div v-if="dlOf(p.no).length" class="gdl psg-dl">
              <button v-for="d in dlOf(p.no)" :key="d.id" class="gdl-row" :class="fx('deadlines', d.id)" :title="`${d.title} · due ${d.due.replace('T', ' ')} — click to edit`" @click.stop="ui.deadlineId = d.id">
                <span class="icon sm" :class="urgency(effDue(d))">alarm</span><span class="mono gdl-cd" :class="urgency(effDue(d))">{{ dlLeft(d) }}</span><span class="ellipsis">{{ d.title }}</span>
              </button>
            </div>
            <div v-if="showTasks && (tasksOf(p.no).open.length || tasksOf(p.no).done)" class="tasks psg-tasks">
              <TaskNode v-for="t in tasksOf(p.no).open" :key="t.id" :todo="t" :focus="focus?.todos" />
              <div v-if="tasksOf(p.no).done" class="tiny muted mono task-done">✓ {{ tasksOf(p.no).done }} done</div>
            </div>
            <div class="kids">
              <template v-for="s in sigsOf(p.no)" :key="s.no">
              <div class="node sig" :class="[s.status, fx('goals', s.no), { sel: selected === s.no }]" @click="select(s.no)">
                <div class="grow">
                  <div class="row sig-nm"><span class="mono small" :class="s.status === 'done' ? 'ok' : 'info'">{{ s.no }}</span><input v-model="s.name" class="input ghost sig-in" placeholder="SIG name" title="Edit SIG name" @click.stop /></div>
                  <div class="small muted ellipsis">{{ s.criteria || '—' }}</div>
                  <div v-if="(s.deps ?? []).length" class="tiny muted mono ellipsis" title="Depends on">⛓ {{ (s.deps ?? []).join(', ') }}</div>
                </div>
                <span class="status" :class="s.status">{{ s.pct }}% {{ s.status === 'done' ? '✓' : s.status === 'doing' ? '!' : '◯' }}</span>
              </div>
              <div v-if="dlOf(s.no).length" class="gdl">
                <button v-for="d in dlOf(s.no)" :key="d.id" class="gdl-row" :class="fx('deadlines', d.id)" :title="`${d.title} · due ${d.due.replace('T', ' ')} — click to edit`" @click.stop="ui.deadlineId = d.id">
                  <span class="icon sm" :class="urgency(effDue(d))">alarm</span><span class="mono gdl-cd" :class="urgency(effDue(d))">{{ dlLeft(d) }}</span><span class="ellipsis">{{ d.title }}</span>
                </button>
              </div>
              <div v-if="showTasks" class="tasks">
                <TaskNode v-for="t in tasksOf(s.no).open" :key="t.id" :todo="t" :focus="focus?.todos" />
                <div class="row task-foot">
                  <span v-if="tasksOf(s.no).done" class="tiny muted mono">✓ {{ tasksOf(s.no).done }} done</span>
                  <span v-else-if="!tasksOf(s.no).open.length && s.status !== 'done'" class="tiny muted">No tasks yet</span>
                  <span class="spacer"></span>
                  <button v-if="s.status !== 'done'" class="add-task" :title="`Create a todo for ${s.no}`" @click.stop="todoFor(s)">+ task</button>
                </div>
              </div>
              </template>
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
              <colgroup><col style="width: 58px" /><col style="width: 100px" /><col /><col style="width: 30%" /><col style="width: 164px" /><col style="width: 84px" /><col style="width: 64px" /><col style="width: 68px" /></colgroup>
              <thead><tr><th>Prio</th><th>PSG No.</th><th>PSG name</th><th>Indicators of success</th><th>Time bound</th><th>Status</th><th>Done %</th><th></th></tr></thead>
              <tbody>
                <tr v-for="p in psgs" :key="p.no" :data-row="p.no" :class="[fx('goals', p.no), { selected: selected === p.no }]" @click="rowClick(p.no, $event)">
                  <td><select v-model.number="p.priority" class="input ghost mono prio-in" :class="'p' + p.priority" title="Priority"><option v-for="n in 5" :key="n" :value="n">P{{ n }}</option></select></td>
                  <td class="mono ok" title="PSG number: type any short name (letters, digits, - . _); every link follows"><input :value="p.no" class="input ghost mono no-in" :maxlength="GOAL_NO_MAX" spellcheck="false" aria-label="PSG number" @change="setNo(p, $event)" @keydown.enter="$event.target.blur()" @keydown.esc.stop="resetNo(p, $event)" /></td>
                  <td><input v-model="p.name" class="input ghost w" /></td>
                  <td><input v-model="p.indicators" class="input ghost w small" /></td>
                  <td><TimeBound v-model="p.timeBound" v-model:locked="p.boundLocked" :issues="boundIssues(p)" /></td>
                  <td><button class="status" :class="p.status" @click.stop="cycle(p)">{{ LABEL[p.status] }}</button></td>
                  <td class="mono" :class="pctClass(psgPct(p.no))">{{ psgPct(p.no) }}%</td>
                  <td>
                    <div class="row acts">
                      <button class="btn sm icon-only" title="Add a deadline for this PSG" @click.stop="goalDeadline(p)"><span class="icon sm">alarm_add</span></button>
                      <button class="btn sm icon-only danger-ghost" title="Delete this PSG (and its SIGs)" @click.stop="removePsg(p)"><span class="icon sm">delete</span></button>
                    </div>
                  </td>
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
              <colgroup><col style="width: 58px" /><col style="width: 100px" /><col style="width: 84px" /><col style="width: 24%" /><col /><col style="width: 160px" /><col style="width: 164px" /><col style="width: 84px" /><col style="width: 64px" /><col style="width: 72px" /></colgroup>
              <thead><tr><th>Prio</th><th>SIG No.</th><th>PSG</th><th>SIG name</th><th>Specific &amp; measurable criteria</th><th>Depends on</th><th>Time bound</th><th>Status</th><th>Done %</th><th></th></tr></thead>
              <tbody>
                <tr v-for="s in sigs" :key="s.no" :data-row="s.no" :class="[fx('goals', s.no), { selected: selected === s.no }]" @click="rowClick(s.no, $event)">
                  <td><select v-model.number="s.priority" class="input ghost mono prio-in" :class="'p' + s.priority" title="Priority"><option v-for="n in 5" :key="n" :value="n">P{{ n }}</option></select></td>
                  <td class="mono info" title="SIG number: type any short name (letters, digits, - . _); every link follows"><input :value="s.no" class="input ghost mono no-in" :maxlength="GOAL_NO_MAX" spellcheck="false" aria-label="SIG number" @change="setNo(s, $event)" @keydown.enter="$event.target.blur()" @keydown.esc.stop="resetNo(s, $event)" /></td>
                  <td><select :value="s.psg" class="input ghost mono small psg-in" title="Move this SIG under another PSG (it is renumbered; links follow)" @click.stop @change="changePsg(s, $event.target.value)"><option v-for="p in psgs" :key="p.no" :value="p.no">{{ p.no }}</option></select></td>
                  <td><input v-model="s.name" class="input ghost w" /></td>
                  <td><input v-model="s.criteria" class="input ghost w small" /></td>
                  <td>
                    <div class="deps">
                      <Chip v-for="dp in s.deps ?? []" :key="dp" :id="dp" removable @remove="removeDep(s, dp)" />
                      <select class="dep-add mono" title="Add a dependency — a PSG or another SIG this one needs" @click.stop @change="addDep(s, $event.target.value); $event.target.value = ''">
                        <option value="">{{ s.deps?.length ? '＋' : '＋ dep' }}</option>
                        <option v-for="p in psgs.filter((x) => x.no !== s.psg)" :key="p.no" :value="p.no" :disabled="sigWouldCycle(s.no, p.no)">✦ {{ p.no }}</option>
                        <option v-for="no in sigNos.filter((n) => n !== s.no)" :key="no" :value="no" :disabled="sigWouldCycle(s.no, no)">{{ no }}</option>
                      </select>
                    </div>
                  </td>
                  <td><TimeBound v-model="s.timeBound" v-model:locked="s.boundLocked" :issues="boundIssues(s)" /></td>
                  <td><button class="status" :class="s.status" @click.stop="cycle(s)">{{ LABEL[s.status] }}</button></td>
                  <td><input :value="s.pct" type="number" min="0" max="100" step="5" class="input ghost w mono" :class="pctClass(s.pct)" @change="setPct(s, $event.target.value)" /></td>
                  <td>
                    <div class="row acts">
                      <button class="btn sm icon-only" title="Add a deadline for this SIG" @click.stop="goalDeadline(s)"><span class="icon sm">alarm_add</span></button>
                      <button class="btn sm icon-only" title="Create todo for this SIG" @click.stop="todoFor(s)"><span class="icon sm">add_task</span></button>
                      <button class="btn sm icon-only danger-ghost" title="Delete this SIG" @click.stop="removeSig(s)"><span class="icon sm">delete</span></button>
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
          <!-- deadlines tied to this plan and its goals -->
          <section class="panel">
            <div class="panel-h"><span class="icon sm danger">alarm</span><h3>Deadlines</h3><span class="spacer"></span>
              <span class="mono small muted">{{ openPlanDeadlines.length }} open</span>
              <button class="btn sm icon-only" title="Add a deadline for this plan" @click="planDeadline"><span class="icon sm">alarm_add</span></button>
            </div>
            <div class="lt">
              <div v-for="d in planDeadlines" :key="d.id" class="lt-row" :class="[fx('deadlines', d.id), { done: d.done }]" :title="`${d.title}${d.vital ? ' · ' + d.vital : ''} — click to edit`" @click="ui.deadlineId = d.id">
                <span class="mono small dl-cd" :class="d.done ? 'muted' : urgency(effDue(d))">{{ d.done ? 'done' : dlLeft(d) }}</span>
                <span class="grow ellipsis">{{ d.title }}</span>
                <span class="mono small muted">{{ d.due.slice(5, 10) }}</span>
                <Chip :id="d.source" />
              </div>
              <div v-if="!planDeadlines.length" class="empty">No deadlines for this plan yet. Use <span class="icon sm">alarm_add</span> on a goal.</div>
            </div>
          </section>

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

          <!-- linked todos: left of the events timetable in the widget grid -->
          <section class="panel">
            <div class="panel-h"><span class="icon sm ok">checklist</span><h3>Linked todos</h3><span class="spacer"></span><span class="mono small muted">{{ linked.filter((t) => !t.done).length }} pending</span></div>
            <div class="lt">
              <div v-for="t in linked" :key="t.id" class="lt-row" :class="[fx('todos', t.id), { done: t.done }]" @click="ui.drawerId = t.id">
                <input type="checkbox" :checked="t.done" @click.stop @change="toggleTodo(t.id)" />
                <span class="grow ellipsis">{{ t.title }}</span>
                <Chip :id="t.links.find((l) => planIds(plan).includes(l))" />
              </div>
              <div v-if="!linked.length" class="empty">No todos linked to this plan yet.</div>
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

    <!-- goal flow: dependencies left → right, merging into PSGs and the vision -->
    <section class="panel flow-panel">
      <div class="panel-h">
        <span class="icon sm info">schema</span><h2>Goal flow</h2>
        <span class="mono small muted flow-hint">click: trace what a goal needs · double-click: open it in the table</span>
        <span class="spacer"></span>
        <span v-if="flowIssues" class="mono small warn" :title="flowIssueText">{{ flowIssues }} time-bound issue{{ flowIssues > 1 ? 's' : '' }}</span>
      </div>
      <GoalFlow :plan="plan" :selected="selected" @select="selectInFlow" @open="showInTable" />
    </section>
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
.node.sel { border-color: var(--info); box-shadow: 0 0 0 2px var(--info); background: color-mix(in srgb, var(--info) 14%, var(--surface)); }
.vision { border-color: var(--accent); cursor: default; }
.vis-in { font-weight: 600; font-size: 14px; height: 28px; }
.trunk { width: 1px; height: 18px; background: var(--border); margin-left: 20px; }
.branch { position: relative; margin-left: 20px; padding-left: 16px; border-left: 1px solid var(--border); padding-bottom: 14px; }
.branch::before { content: ''; position: absolute; left: 0; top: 18px; width: 16px; border-top: 1px solid var(--border); }
.nm-in { height: 24px; font-size: 13px; font-weight: 600; padding: 0 2px; }
.sig-nm { gap: 6px; align-items: baseline; }
.sig-in { height: 20px; font-size: 11px; flex: 1; min-width: 60px; padding: 0 2px; }
/* ── table polish: quiet until you reach for it ── */
.deps { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 3px 0; }
.dep-add {
  appearance: none; -webkit-appearance: none; height: 20px; padding: 0 6px; border: 1px solid transparent; border-radius: 999px;
  background: transparent; color: var(--muted); font-size: 10px; cursor: pointer; outline: none;
}
.dep-add:hover, .dep-add:focus { color: var(--info); border-color: color-mix(in srgb, var(--info) 45%, var(--border)); }
.dep-add option { background: var(--surface); color: var(--text); }
/* ghost selects (priority, PSG): no native arrow or box until hovered */
.tbl select.input.ghost { appearance: none; -webkit-appearance: none; cursor: pointer; width: 100%; }
.tbl select.input.ghost option { background: var(--surface); color: var(--text); }
.prio-in { font-weight: 700; color: var(--muted); }
.prio-in.p1 { color: var(--danger); }
.prio-in.p2 { color: var(--warn); }
.psg-in { color: var(--accent); }
/* number inputs: no spinners */
.tbl input[type='number'] { appearance: textfield; -moz-appearance: textfield; }
.tbl input[type='number']::-webkit-inner-spin-button, .tbl input[type='number']::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
/* row actions: borderless, faint until the row is hovered, focused or selected (always shown on touch) */
.acts { gap: 2px; flex-wrap: nowrap; }
.acts .btn { border-color: transparent; background: transparent; color: var(--muted); }
.acts .btn:hover { border-color: var(--border); color: var(--text); }
.acts .btn.danger-ghost:hover { border-color: var(--danger); color: var(--danger); }
@media (hover: hover) {
  /* time bound: the ∞ / calendar toggle and the date picker icon only on the row you're on */
  .tbl tbody tr:not(:hover):not(.selected):not(:focus-within) :deep(.tb-btn:not(.lock)) { opacity: 0; }
  .tbl tbody tr:not(:hover):not(.selected):not(:focus-within) :deep(.tb-in::-webkit-calendar-picker-indicator) { opacity: 0; }
  /* with chips present, the add control floats at the cell's right edge instead of wrapping onto a new line */
  .deps { position: relative; }
  .deps .chip ~ .dep-add { position: absolute; right: -6px; top: 50%; transform: translateY(-50%); width: 20px; padding: 0; text-align: center; text-align-last: center; background: var(--surface-2); border-color: var(--border); }
  .tbl tbody tr .acts, .tbl tbody tr .dep-add { opacity: 0; transition: opacity 0.12s; }
  .tbl tbody tr:hover .acts, .tbl tbody tr:hover .dep-add, .tbl tbody tr.selected .acts, .tbl tbody tr.selected .dep-add,
  .tbl tbody tr:focus-within .acts, .tbl tbody tr:focus-within .dep-add { opacity: 1; }
}
.acts { gap: 2px; flex-wrap: nowrap; }
.acts .btn { padding: 0 2px; }
/* add-new buttons at the bottom of each table (ISS-1) */
tfoot .td-add { padding: 0; border-bottom: 0; }
.add-row { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 0; border: 0; border-top: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 12px; cursor: pointer; }
.add-row:hover { color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
.kids { margin: 6px 0 0 14px; padding-left: 12px; border-left: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
/* tasks linked to a goal, hanging under its node */
.tasks { margin: -3px 0 2px 10px; padding-left: 8px; border-left: 2px solid var(--surface-2); display: flex; flex-direction: column; }
.psg-tasks { margin: 4px 0 0 24px; }
.task { display: flex; align-items: center; gap: 6px; min-height: 24px; font-size: 12.5px; cursor: pointer; border-radius: 2px; padding: 0 4px; }
.task:hover { background: var(--surface-2); }
.task input { margin: 0; }
.task-foot { gap: 6px; min-height: 20px; padding: 0 4px; }
.task-done { padding: 2px 4px; }
.add-task { border: 0; background: transparent; color: var(--muted); font-size: 11px; cursor: pointer; padding: 0 2px; }
.add-task:hover { color: var(--accent); }
/* deadlines hanging under a goal node */
.gdl { margin: -3px 0 2px 10px; padding-left: 8px; border-left: 2px solid var(--surface-2); display: flex; flex-direction: column; }
.psg-dl { margin: 4px 0 0 24px; }
.gdl-row { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 4px; border: 0; border-radius: 2px; background: transparent; color: var(--text); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; min-width: 0; }
.gdl-row:hover { background: var(--surface-2); }
.gdl-row .icon { font-size: 14px; }
.gdl-cd { flex: none; min-width: 52px; font-size: 11.5px; }
.dl-cd { flex: none; width: 62px; }
/* focus: related items lit, the rest dimmed (names avoid the global .dim / .rel) */
.fx-dim { opacity: 0.32; transition: opacity 0.15s; }
.fx-dim:hover { opacity: 0.7; }
.node.fx-rel { border-color: color-mix(in srgb, var(--info) 60%, var(--border)); }
.gdl-row.fx-rel, .lt-row.fx-rel { background: color-mix(in srgb, var(--info) 8%, transparent); }
.tbl tr.fx-rel { background: color-mix(in srgb, var(--info) 5%, transparent); }
/* the selected goal itself: a solid ring and a stronger tint, so it stands out from the related rows it lights */
.tbl tr.selected { outline: 2px solid var(--info); outline-offset: -2px; box-shadow: none; background: color-mix(in srgb, var(--info) 14%, transparent); }
.tbl tr.selected > td:first-child { box-shadow: inset 4px 0 0 var(--info); }
.lt-row.fx-rel { box-shadow: inset 2px 0 0 var(--info); }
.fx-id { white-space: nowrap; flex: none; }
.input.ghost.no-in { width: 100%; height: 22px; padding: 0 3px; margin-left: -4px; color: inherit; font: inherit; }
.fx-bar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--info) 6%, transparent); min-width: 0; }
.btn.on { color: var(--accent); border-color: var(--accent); }
.sig { flex-direction: row; align-items: center; gap: 8px; }
.sig.doing { border-color: color-mix(in srgb, var(--info) 45%, var(--border)); }
.sig.done { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.add-sig { align-self: flex-start; }
.flow-panel { margin: 0 12px 12px; }
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
@media (max-width: 800px) { .widgets { grid-template-columns: 1fr; } .flow-hint { display: none; } }
</style>
