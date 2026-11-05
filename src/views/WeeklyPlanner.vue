<script setup>
// S-10 · Weekly Planner — Mon–Fri columns + Weekend + right sidebar.
import { computed, ref, watchEffect } from 'vue'
import {
  state, ui, todayISO, addDays, mondayOf, isoWeek, fmtMD, wdJa, fmtSlash, todosForDay, workload, updateTodo,
  byPriority, partLabel, routineDone, toggleRoutine, monthGroup, toggleMonthly, parseISO, pad, toast, CAPACITY_H, blocksForDay,
} from '../store'
import DayColumn from '../components/DayColumn.vue'
import WeekBar from '../components/WeekBar.vue'
import { startDrag, endDrag, overRow, leaveRow, dropOnRow, dropClass } from '../dnd'
import TodoRow from '../components/TodoRow.vue'
import Stamps from '../components/Stamps.vue'
import Prio from '../components/Prio.vue'
import Chip from '../components/Chip.vue'

const days = computed(() => [0, 1, 2, 3, 4].map((i) => addDays(ui.weekStart, i)))
const sat = computed(() => addDays(ui.weekStart, 5))
const sun = computed(() => addDays(ui.weekStart, 6))
const weekEnd = computed(() => sun.value)
const isThisWeek = computed(() => ui.weekStart === mondayOf(todayISO()))
const filter = ref('')
const linkOptions = computed(() => {
  const ids = new Set()
  state.todos.forEach((t) => t.links.forEach((l) => ids.add(l)))
  state.timeBlocks.forEach((b) => b.link && ids.add(b.link))
  return [...ids].sort()
})

// all todos in the visible week (for keyboard navigation + KPI)
const weekTodos = computed(() => [...days.value, sat.value, sun.value].flatMap((d) => todosForDay(d)))
watchEffect(() => { ui.visibleIds = weekTodos.value.map((t) => t.id) })

const untimed = computed(() => weekTodos.value.filter((t) => !t.done && !t.scheduled.start))
const weekendTodos = computed(() => [...todosForDay(sat.value), ...todosForDay(sun.value)])
const weekendBlocks = computed(() => [sat.value, sun.value].map((d) => ({ date: d, blocks: blocksForDay(d).sort((a, b) => a.start.localeCompare(b.start)) })))
const backlog = computed(() => state.todos.filter((t) => !t.scheduled && !t.done).sort(byPriority))

const routinesDone = computed(() => routineDone(ui.weekStart))
const monthKey = computed(() => ui.weekStart.slice(0, 7))
const group = computed(() => monthGroup(ui.weekStart))
const monthlyDone = computed(() => state.monthlyLog[monthKey.value] ?? [])

const kpi = computed(() => {
  const all = weekTodos.value
  const done = all.filter((t) => t.done).length
  const planned = [...days.value, sat.value, sun.value].reduce((s, d) => s + workload(d), 0)
  const stamped = [...days.value, sat.value, sun.value].filter((d) => state.signOffs[d]?.[3]).length
  return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0, planned, stamped }
})

const print = () => window.print()
function shift(n) { ui.weekStart = addDays(ui.weekStart, n * 7) }
function dropWeekend(e) {
  const id = e.dataTransfer.getData('text/x-todo')
  if (id) updateTodo(id, { scheduled: { date: sat.value, start: null } })
}
function dropBacklog(e) {
  const id = e.dataTransfer.getData('text/x-todo')
  if (id) { updateTodo(id, { scheduled: null }); toast(`${id} → backlog`) }
}
function copyLastWeek() {
  const prev = addDays(ui.weekStart, -7)
  let n = 0
  for (const b of state.timeBlocks.filter((x) => x.date >= prev && x.date < ui.weekStart)) {
    const date = addDays(b.date, 7)
    if (state.timeBlocks.some((x) => x.date === date && x.start === b.start && x.title === b.title)) continue
    state.timeBlocks.push({ ...b, id: `B-${date}-${b.start}-${Math.random().toString(36).slice(2, 6)}`, date })
    n++
  }
  toast(n ? `Copied ${n} blocks from last week` : 'Nothing new to copy')
}
</script>

<template>
  <div class="wp">
    <WeekBar />
    <div class="summary">
      <span class="row" :class="untimed.length ? 'warn' : 'ok'" style="font-weight: 600; gap: 4px">
        <span class="icon sm">{{ untimed.length ? 'more_time' : 'check_circle' }}</span>
        {{ untimed.length ? `${untimed.length} tasks have a day but no time` : 'Every assigned task has a time' }}
      </span>
      <span class="mono small"><span class="muted">time-boxed</span> {{ weekTodos.filter((t) => t.scheduled.start).length }}/{{ weekTodos.length }}</span>
      <span class="spacer"></span>
      <span class="small muted">Drag tasks marked <span class="icon sm warn" style="vertical-align: middle">more_time</span> onto their day's timeline.</span>
      <div class="row">
        <span class="tiny upper muted">Link</span>
        <select v-model="filter" class="select mono small">
          <option value="">All</option>
          <option v-for="l in linkOptions" :key="l" :value="l">{{ l }}</option>
        </select>
      </div>
      <button class="btn" title="Copy last week's fixed blocks" @click="copyLastWeek"><span class="icon sm">content_copy</span>Copy last week</button>
      <button class="btn icon-only" title="Print A4" @click="print"><span class="icon sm">print</span></button>
    </div>

    <div class="body">
      <div class="days">
        <DayColumn v-for="d in days" :key="d" :date="d" :filter="filter" />

        <!-- weekend column -->
        <div class="panel weekend">
          <header class="dh">
            <div class="row"><span class="ja">{{ wdJa(sat) }}{{ wdJa(sun) }}</span><span class="mono tiny muted">WEEKEND</span></div>
            <div class="mono small">{{ fmtSlash(sat) }} – {{ fmtSlash(sun) }}</div>
            <div class="mono small">{{ (workload(sat) + workload(sun)).toFixed(1) }}h</div>
          </header>
          <div v-for="wb in weekendBlocks" :key="wb.date" class="sec">
            <div class="sh tiny upper muted">{{ wdJa(wb.date) }} {{ fmtSlash(wb.date) }}</div>
            <div v-for="b in wb.blocks" :key="b.id" class="block wb" :class="['cat-' + b.category, { todo: b.kind === 'todo' }]">
              <span class="mono muted">{{ b.start }}</span> {{ b.title }}
            </div>
            <div v-if="!wb.blocks.length" class="small muted">—</div>
          </div>
          <div class="sec drop" @dragover.prevent @drop.prevent="dropWeekend">
            <div class="sh tiny upper muted">Weekend todos</div>
            <TodoRow v-for="t in weekendTodos" :key="t.id" :todo="t" adopt-date flag-untimed compact :show-links="false" />
            <div v-if="!weekendTodos.length" class="drop-empty small muted">drop todos here</div>
          </div>
          <div class="sec stamps-sec">
            <div class="col" style="align-items: center; gap: 6px">
              <div class="row tiny muted"><span class="mono">SAT</span></div><Stamps :date="sat" :size="20" />
              <div class="row tiny muted"><span class="mono">SUN</span></div><Stamps :date="sun" :size="20" />
            </div>
          </div>
        </div>
      </div>

      <aside class="side">
        <section class="panel">
          <div class="panel-h">
            <span class="icon sm ok">task_alt</span><h3>Weekly routines</h3><span class="spacer"></span>
            <span class="mono small ok">{{ routinesDone.length }}/{{ state.routines.length }}</span>
          </div>
          <div class="routines">
            <label v-for="(r, i) in state.routines" :key="i" class="rt" :class="{ done: routinesDone.includes(i) }">
              <input type="checkbox" :checked="routinesDone.includes(i)" @change="toggleRoutine(ui.weekStart, i)" />
              <span class="ellipsis">{{ r }}</span>
            </label>
          </div>
        </section>

        <section class="panel">
          <div class="panel-h"><span class="icon sm warn">autorenew</span><h3>Monthly rotation</h3><span class="spacer"></span><span class="chip plan">GROUP {{ group }}</span></div>
          <div class="routines">
            <label v-for="task in state.monthlyGroups[group]" :key="task" class="rt" :class="{ done: monthlyDone.includes(task) }">
              <input type="checkbox" :checked="monthlyDone.includes(task)" @change="toggleMonthly(monthKey, task)" />
              <span>{{ task }}</span>
            </label>
          </div>
        </section>

        <section class="panel">
          <div class="panel-h"><span class="icon sm ok">monitoring</span><h3>Week KPI</h3></div>
          <div class="panel-b kpis mono small">
            <div><span class="muted">Todos done</span><b>{{ kpi.done }}/{{ kpi.total }} · {{ kpi.pct }}%</b></div>
            <div class="bar"><i :style="{ width: kpi.pct + '%' }"></i></div>
            <div><span class="muted">Planned hours</span><b>{{ kpi.planned.toFixed(1) }}h / {{ CAPACITY_H * 5 }}h</b></div>
            <div><span class="muted">Routines</span><b>{{ Math.round((routinesDone.length / state.routines.length) * 100) }}%</b></div>
            <div><span class="muted">Days stamped 完</span><b>{{ kpi.stamped }}/7</b></div>
          </div>
        </section>

        <section class="panel backlog" @dragover.prevent @drop.prevent="dropBacklog">
          <div class="panel-h"><span class="icon sm info">inventory_2</span><h3>Backlog</h3><span class="spacer"></span><span class="mono small muted">{{ backlog.length }} items</span></div>
          <div class="bl-list">
            <div v-for="t in backlog" :key="t.id" class="bl" :class="dropClass(t)" draggable="true" @dragstart="startDrag($event, t)" @dragend="endDrag"
              @dragover="overRow($event, t)" @dragleave="leaveRow($event, t)" @drop="dropOnRow($event, t, { unschedule: true })" @click="ui.selectedId = t.id" @dblclick="ui.drawerId = t.id">
              <div class="row"><Prio :p="t.priority" /><span v-if="partLabel(t)" class="mono small muted">part {{ partLabel(t) }}</span><span class="spacer"></span><span class="mono small muted">{{ t.timeMin }}m</span>
                <button v-if="t.timeMin >= 30" class="btn sm icon-only" title="Split across days" @click.stop="ui.splitId = t.id"><span class="icon sm">call_split</span></button></div>
              <div class="ellipsis">{{ t.title }}</div>
              <div v-if="t.links.length" class="row"><Chip v-for="l in t.links" :key="l" :id="l" /></div>
            </div>
            <div v-if="!backlog.length" class="empty">Backlog empty.</div>
          </div>
          <div class="small muted pad">Drag onto a day's list or timeline. Drop here to unschedule; drop between cards to reprioritise.</div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.wp { display: flex; flex-direction: column; height: 100%; }
.summary { display: flex; align-items: center; gap: 18px; padding: 8px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.weeksel { display: flex; align-items: center; gap: 6px; }
.wk { font-weight: 600; min-width: 220px; text-align: center; }
.select.small { height: 26px; font-size: 11px; }
.body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 280px; }
.days { display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)) minmax(140px, 0.75fr); gap: 8px; padding: 12px; overflow: auto; align-items: start; }
.side { border-left: 1px solid var(--border); padding: 12px; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.routines { padding: 6px 0; }
.rt { display: flex; align-items: center; gap: 8px; padding: 4px 12px; cursor: pointer; }
.rt:hover { background: var(--surface-2); }
.rt.done span { text-decoration: line-through; color: var(--muted); }
.kpis { display: flex; flex-direction: column; gap: 6px; }
.kpis div:not(.bar) { display: flex; justify-content: space-between; }
.bl-list { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.bl { border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; cursor: grab; }
.bl:hover { border-color: var(--info); }
.pad { padding: 0 10px 10px; }
/* weekend column */
.weekend { overflow: hidden; }
.dh { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border); }
.ja { font-family: 'Noto Sans JP'; font-weight: 700; font-size: 16px; }
.md { font-size: 15px; font-weight: 700; }
.sec { border-bottom: 1px solid var(--border); padding: 6px; display: flex; flex-direction: column; gap: 3px; }
.sh { padding: 2px 2px 2px; }
.wb { padding: 3px 5px; }
.drop { min-height: 70px; }
.drop-empty { border: 1px dashed var(--border); border-radius: 2px; text-align: center; padding: 8px; }
.stamps-sec { align-items: center; border-bottom: 0; }
@media (max-width: 1200px) { .body { grid-template-columns: 1fr; } .side { border-left: 0; border-top: 1px solid var(--border); display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); } }
</style>
