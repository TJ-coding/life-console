<script setup>
// S-13 · Workload — step ② of the planning flow: assign each backlog task to a DAY.
// Same column layout as the Weekly Planner (step ③, assign a TIME), mirroring the paper
// template where each day's "Workload 1–7 Hours" gauge sits directly above its schedule.
import { computed, ref, watchEffect } from 'vue'
import {
  state, ui, addDays, wd, fmtSlash, CAPACITY_H, dayLoad, suggestRebalance, todosForDay, updateTodo, toast, byPriority, partLabel,
} from '../store'
import { TODO_MIME, startDrag, endDrag, overRow, leaveRow, dropOnRow, dropClass } from '../dnd'
import WeekBar from '../components/WeekBar.vue'
import WorkloadBucket from '../components/WorkloadBucket.vue'
import Prio from '../components/Prio.vue'
import Chip from '../components/Chip.vue'

const withBlocks = ref(false)
const cap = computed(() => (withBlocks.value ? CAPACITY_H + 3 : CAPACITY_H))
const days = computed(() => [0, 1, 2, 3, 4].map((i) => addDays(ui.weekStart, i)))
const sat = computed(() => addDays(ui.weekStart, 5))
const sun = computed(() => addDays(ui.weekStart, 6))
watchEffect(() => { ui.visibleIds = [...days.value, sat.value, sun.value].flatMap((d) => todosForDay(d)).map((t) => t.id) })

/* ── backlog (step ①) ── */
const prioFilter = ref(0)
const backlog = computed(() => state.todos.filter((t) => !t.done && !t.scheduled && (!prioFilter.value || t.priority === prioFilter.value)).sort(byPriority))
const backlogH = computed(() => backlog.value.reduce((s, t) => s + t.timeMin / 60, 0))
const hotBacklog = ref(false)
function dropBacklog(e) {
  hotBacklog.value = false
  const id = e.dataTransfer.getData(TODO_MIME)
  if (id) { updateTodo(id, { scheduled: null }); toast(`${id} → backlog`) }
}

/* ── balance figures (weekdays) ── */
const loads = computed(() => days.value.map((d) => dayLoad(d, withBlocks.value).total))
const stats = computed(() => {
  const wk = loads.value
  const avg = wk.reduce((a, b) => a + b, 0) / 5
  const spread = Math.max(...wk) - Math.min(...wk)
  const over = days.value.filter((d, i) => wk[i] > cap.value)
  const free = wk.reduce((s, v) => s + Math.max(0, cap.value - v), 0)
  const level = over.length || spread > 3 ? 'unbalanced' : spread > 1.5 ? 'uneven' : 'balanced'
  return { avg, spread, over, free, level, total: wk.reduce((a, b) => a + b, 0) }
})
const LEVEL = {
  balanced: { icon: 'check_circle', label: 'Balanced', cls: 'ok' },
  uneven: { icon: 'error', label: 'Uneven', cls: 'warn' },
  unbalanced: { icon: 'warning', label: 'Unbalanced', cls: 'danger' },
}

/* ── rebalance + by goal ── */
const suggestions = computed(() => suggestRebalance(days.value, withBlocks.value, cap.value))
function apply(s) {
  updateTodo(s.todo.id, { scheduled: { date: s.to, start: null } })
  toast(`${s.todo.id} → ${wd(s.to)} ${fmtSlash(s.to)}`)
}
const byGoal = computed(() => {
  const m = new Map()
  for (const d of [...days.value, sat.value, sun.value]) {
    for (const t of todosForDay(d)) {
      let psg = 'Unlinked'
      for (const l of t.links) {
        if (l.startsWith('PSG-')) { psg = l; break }
        const s = state.plan.sigs.find((x) => x.no === l)
        if (s) { psg = s.psg; break }
      }
      m.set(psg, (m.get(psg) ?? 0) + t.timeMin / 60)
    }
  }
  return [...m].map(([k, h]) => ({ k, h, name: state.plan.psgs.find((p) => p.no === k)?.name ?? 'Not linked to a goal' }))
    .sort((a, b) => (a.k === 'Unlinked') - (b.k === 'Unlinked') || b.h - a.h)
})
const goalMax = computed(() => Math.max(1, ...byGoal.value.map((r) => r.h)))
const h1 = (v) => v.toFixed(1)
</script>

<template>
  <div class="wl">
    <WeekBar>
      <div class="seg">
        <button class="btn sm" :class="{ active: !withBlocks }" title="Sum of todo estimates" @click="withBlocks = false">Todos</button>
        <button class="btn sm" :class="{ active: withBlocks }" title="Also count fixed calendar blocks" @click="withBlocks = true">+ Fixed blocks</button>
      </div>
    </WeekBar>

    <div class="summary">
      <span class="verdict row" :class="LEVEL[stats.level].cls"><span class="icon sm">{{ LEVEL[stats.level].icon }}</span>{{ LEVEL[stats.level].label }}</span>
      <span class="mono small"><span class="muted">Mon–Fri</span> {{ h1(stats.total) }}h / {{ cap * 5 }}h</span>
      <span class="mono small"><span class="muted">avg</span> {{ h1(stats.avg) }}h</span>
      <span class="mono small"><span class="muted">spread</span> {{ h1(stats.spread) }}h</span>
      <span class="mono small"><span class="muted">free capacity</span> {{ h1(stats.free) }}h</span>
      <span v-if="stats.over.length" class="mono small danger row"><span class="icon sm">warning</span>over: {{ stats.over.map(wd).join(' · ') }}</span>
      <span class="spacer"></span>
      <span class="small muted">Drag tasks from the backlog into a day. Drop onto a task to slot it before/after (takes its priority).</span>
    </div>

    <div class="body">
      <div class="days">
        <WorkloadBucket v-for="d in days" :key="d" :date="d" :with-blocks="withBlocks" :cap="cap" />
        <div class="weekend">
          <WorkloadBucket :date="sat" :with-blocks="withBlocks" :cap="cap" />
          <WorkloadBucket :date="sun" :with-blocks="withBlocks" :cap="cap" />
        </div>
      </div>

      <aside class="side">
        <section class="panel backlog" :class="{ 'drop-hot': hotBacklog }" @dragover.prevent="hotBacklog = true" @dragleave="hotBacklog = false" @drop.prevent="dropBacklog">
          <div class="panel-h">
            <span class="icon sm info">inventory_2</span><h3>① Backlog</h3><span class="spacer"></span>
            <span class="mono small muted">{{ backlog.length }} · {{ h1(backlogH) }}h</span>
          </div>
          <div class="pf">
            <button class="btn sm" :class="{ active: !prioFilter }" @click="prioFilter = 0">All</button>
            <button v-for="p in 5" :key="p" class="btn sm" :class="{ active: prioFilter === p }" @click="prioFilter = p">P{{ p }}</button>
          </div>
          <div class="bl-list">
            <div
              v-for="t in backlog" :key="t.id" class="bl" :class="dropClass(t)" draggable="true"
              @dragstart="startDrag($event, t)" @dragend="endDrag" @dragover="overRow($event, t)" @dragleave="leaveRow($event, t)"
              @drop="dropOnRow($event, t, { unschedule: true })" @click="ui.selectedId = t.id" @dblclick="ui.drawerId = t.id"
            >
              <div class="row">
                <Prio :p="t.priority" /><span class="ellipsis grow"><span v-if="partLabel(t)" class="part mono">{{ partLabel(t) }}</span>{{ t.title }}</span>
                <span class="mono small muted">{{ t.timeMin }}m</span>
                <button v-if="t.timeMin >= 30" class="btn sm icon-only splitb" title="Split across days" @click.stop="ui.splitId = t.id"><span class="icon sm">call_split</span></button>
              </div>
              <div v-if="t.links.length || t.due" class="row small">
                <Chip v-for="l in t.links" :key="l" :id="l" />
                <span v-if="t.due" class="mono muted">due {{ fmtSlash(t.due) }}</span>
              </div>
            </div>
            <div v-if="!backlog.length" class="empty">Backlog empty. Press <span class="kbd">N</span> to capture a task.</div>
          </div>
          <div class="small muted pad">Drop a scheduled task here to send it back.</div>
        </section>

        <section class="panel">
          <div class="panel-h"><span class="icon sm">balance</span><h3>Rebalance</h3></div>
          <div class="sugs">
            <div v-for="s in suggestions" :key="s.todo.id" class="sug">
              <div class="grow">
                <div class="ellipsis">{{ s.todo.title }}</div>
                <div class="mono small muted">{{ s.todo.timeMin }}m · {{ wd(s.from) }} → <b class="txt">{{ wd(s.to) }}</b></div>
              </div>
              <button class="btn sm" @click="apply(s)">Move</button>
            </div>
            <div v-if="!suggestions.length" class="small muted row"><span class="icon sm ok">check_circle</span>Remaining weekdays are even and under capacity.</div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-h"><span class="icon sm">target</span><h3>Hours by goal</h3></div>
          <div class="goals">
            <div v-for="g in byGoal" :key="g.k" class="goal">
              <div class="row small"><span class="mono">{{ g.k }}</span><span class="muted ellipsis grow">{{ g.name }}</span><span class="mono">{{ h1(g.h) }}h</span></div>
              <div class="gbar"><i :style="{ width: (g.h / goalMax) * 100 + '%' }"></i></div>
            </div>
            <div v-if="!byGoal.length" class="small muted">No tasks assigned this week.</div>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.wl { display: flex; flex-direction: column; height: 100%; }
.seg { display: flex; gap: 4px; }
.summary { display: flex; align-items: center; gap: 18px; padding: 8px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.verdict { font-weight: 600; gap: 4px; }
/* same grid as the Weekly Planner so the two sheets line up */
.body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 280px; }
.days { display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)) minmax(140px, 0.75fr); gap: 8px; padding: 12px; overflow: auto; align-items: start; }
.weekend { display: flex; flex-direction: column; gap: 8px; }
.side { border-left: 1px solid var(--border); padding: 12px; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.pf { display: flex; gap: 3px; padding: 8px 10px 0; flex-wrap: wrap; }
.bl-list { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.bl { border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; cursor: grab; background: var(--surface); }
.bl:hover { border-color: var(--info); }
.splitb { opacity: 0; }
.bl:hover .splitb { opacity: 1; }
.part { font-size: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 2px; padding: 0 3px; margin-right: 5px; }
.pad { padding: 0 10px 10px; }
.sugs { display: flex; flex-direction: column; gap: 6px; padding: 10px; }
.sug { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; }
.txt { color: var(--text); }
.goals { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.goal { display: flex; flex-direction: column; gap: 4px; }
.gbar { height: 8px; }
.gbar i { display: block; height: 100%; background: var(--cat-research); border-radius: 0 4px 4px 0; }
@media (max-width: 1200px) { .body { grid-template-columns: 1fr; } .side { border-left: 0; border-top: 1px solid var(--border); display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); } }
</style>
