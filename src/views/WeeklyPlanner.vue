<script setup>
// S-10 · Plan week — the whole flow on one sheet, like the paper planner:
//   ① Backlog (left) → ② Workload bucket per day (assign day) → ③ timeline right below it (assign time)
// Balance and routines live in a side rail that opens on demand so the day columns stay wide.
import { computed, ref, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import {
  state, ui, todayISO, addDays, wd, todosForDay, workload, CAPACITY_H, toast, autoTimebox,
  routineDone, toggleRoutine, monthGroup, toggleMonthly, suggestRebalance,
  isLeaf,
} from '../store'
import WeekBar from '../components/WeekBar.vue'
import DayColumn from '../components/DayColumn.vue'
import BacklogPanel from '../components/BacklogPanel.vue'
import BalancePanel from '../components/BalancePanel.vue'
import WeekContext from '../components/WeekContext.vue'

const route = useRoute()
const T = computed(() => todayISO())
const days = computed(() => [0, 1, 2, 3, 4].map((i) => addDays(ui.weekStart, i)))
const sat = computed(() => addDays(ui.weekStart, 5))
const sun = computed(() => addDays(ui.weekStart, 6))
const week = computed(() => [...days.value, sat.value, sun.value])

// deep links: /week?mode=days|times|both (the old /workload route redirects here with mode=days)
watch(() => route.query.mode, (m) => {
  if (['days', 'times', 'both'].includes(m)) ui.planMode = m
}, { immediate: true })

const filter = ref('')
const linkOptions = computed(() => {
  const ids = new Set()
  state.todos.forEach((t) => t.links.forEach((l) => ids.add(l)))
  state.timeBlocks.forEach((b) => b.link && ids.add(b.link))
  return [...ids].sort()
})

const weekTodos = computed(() => week.value.flatMap((d) => todosForDay(d)))
watchEffect(() => { ui.visibleIds = weekTodos.value.map((t) => t.id) })

/* ── what to do next ── */
const backlogN = computed(() => state.todos.filter((t) => !t.done && !t.scheduled && isLeaf(t)).length)
const untimed = computed(() => weekTodos.value.filter((t) => !t.done && !t.scheduled.start && t.scheduled.date >= T.value))
const overDays = computed(() => days.value.filter((d) => workload(d) > CAPACITY_H))
const rebalanceN = computed(() => suggestRebalance(days.value).length)
const next = computed(() => {
  if (overDays.value.length) return { icon: 'warning', cls: 'danger', text: `${overDays.value.map(wd).join(', ')} over ${CAPACITY_H}h — move or split a task`, action: 'balance' }
  if (backlogN.value) return { icon: 'inventory_2', cls: 'info', text: `${backlogN.value} backlog tasks to place — hover one and click a day, or drag it into a bucket` }
  if (untimed.value.length) return { icon: 'more_time', cls: 'warn', text: `${untimed.value.length} tasks need a time — drag them down onto the timeline, or auto time-box`, action: 'auto' }
  return { icon: 'check_circle', cls: 'ok', text: 'Week planned: every task has a day and a time' }
})
function autoWeek() {
  let placed = 0
  let left = 0
  for (const d of week.value.filter((x) => x >= T.value)) {
    const r = autoTimebox(d)
    placed += r.placed.length
    left += r.unplaced.length
  }
  toast(left ? `Time-boxed ${placed}; ${left} didn't fit 08:00–21:00` : `Time-boxed ${placed} tasks`)
}

/* ── side rail ── */
const togglePanel = (p) => { ui.sidePanel = ui.sidePanel === p ? null : p }
const routinesDone = computed(() => routineDone(ui.weekStart))
const monthKey = computed(() => ui.weekStart.slice(0, 7))
const group = computed(() => monthGroup(ui.weekStart))
const monthlyDone = computed(() => state.monthlyLog[monthKey.value] ?? [])
const kpi = computed(() => {
  const all = weekTodos.value
  const done = all.filter((t) => t.done).length
  return {
    done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0,
    planned: week.value.reduce((s, d) => s + workload(d), 0),
    stamped: week.value.filter((d) => state.signOffs[d]?.[3]).length,
  }
})

const print = () => window.print()
</script>

<template>
  <div class="wp">
    <WeekBar />

    <div class="guide">
      <span class="next row" :class="next.cls"><span class="icon sm">{{ next.icon }}</span>{{ next.text }}</span>
      <button v-if="next.action === 'auto'" class="btn sm primary" @click="autoWeek"><span class="icon sm">bolt</span>Auto time-box week</button>
      <button v-if="next.action === 'balance'" class="btn sm" @click="ui.sidePanel = 'balance'"><span class="icon sm">balance</span>Open balance</button>
      <span class="spacer"></span>
      <div class="row">
        <span class="tiny upper muted">Link</span>
        <select v-model="filter" class="select mono small">
          <option value="">All</option>
          <option v-for="l in linkOptions" :key="l" :value="l">{{ l }}</option>
        </select>
      </div>
      <button class="btn sm icon-only" title="Print A4" @click="print"><span class="icon sm">print</span></button>
    </div>

    <!-- phones: backlog & days don't fit stacked — full-height screens with a switch on top (ISS-22) -->
    <nav class="phone-switch" aria-label="Backlog or week">
      <button :class="{ on: !ui.backlogOnly }" @click="ui.backlogOnly = false"><span class="icon sm">view_agenda</span>Days</button>
      <button :class="{ on: ui.backlogOnly }" @click="ui.backlogOnly = true"><span class="icon sm">inbox</span>Backlog</button>
    </nav>

    <div class="body" :class="{ only: ui.backlogOnly }">
      <BacklogPanel :focus="ui.backlogOnly" @focus="ui.backlogOnly = !ui.backlogOnly" />

      <template v-if="!ui.backlogOnly">
      <div class="days" :class="'mode-' + ui.planMode">
        <DayColumn v-for="d in days" :key="d" :date="d" :filter="filter" :mode="ui.planMode" />
        <div class="weekend">
          <DayColumn :date="sat" :filter="filter" :mode="ui.planMode" />
          <DayColumn :date="sun" :filter="filter" :mode="ui.planMode" />
        </div>
      </div>
      </template>

      <WeekContext v-if="ui.backlogOnly" />

      <nav class="rail" aria-label="Side panels">
        <button class="rb" :class="{ on: ui.sidePanel === 'balance' }" title="Balance & rebalance" @click="togglePanel('balance')">
          <span class="icon">balance</span><span v-if="rebalanceN || overDays.length" class="badge" :class="overDays.length ? 'bad' : ''">{{ rebalanceN || '!' }}</span>
        </button>
        <button class="rb" :class="{ on: ui.sidePanel === 'routines' }" title="Routines & week KPI" @click="togglePanel('routines')">
          <span class="icon">task_alt</span><span class="badge ok-b mono">{{ routinesDone.length }}</span>
        </button>
      </nav>

      <transition name="slide">
        <aside v-if="ui.sidePanel" class="overlay">
          <header class="oh">
            <h3 class="mono upper">{{ ui.sidePanel === 'balance' ? 'Balance' : 'Routines & KPI' }}</h3>
            <span class="spacer"></span>
            <button class="btn icon-only" title="Close" @click="ui.sidePanel = null"><span class="icon sm">close</span></button>
          </header>
          <div class="ob">
            <BalancePanel v-if="ui.sidePanel === 'balance'" />
            <template v-else>
              <div class="sec-h tiny upper muted row">Weekly routines<span class="spacer"></span><span class="mono ok">{{ routinesDone.length }}/{{ state.routines.length }}</span></div>
              <label v-for="(r, i) in state.routines" :key="i" class="rt" :class="{ done: routinesDone.includes(i) }">
                <input type="checkbox" :checked="routinesDone.includes(i)" @change="toggleRoutine(ui.weekStart, i)" />
                <span class="ellipsis">{{ r }}</span>
              </label>
              <div class="sec-h tiny upper muted row">Monthly rotation<span class="spacer"></span><span class="chip plan">GROUP {{ group }}</span></div>
              <label v-for="task in state.monthlyGroups[group]" :key="task" class="rt" :class="{ done: monthlyDone.includes(task) }">
                <input type="checkbox" :checked="monthlyDone.includes(task)" @change="toggleMonthly(monthKey, task)" />
                <span>{{ task }}</span>
              </label>
              <div class="sec-h tiny upper muted">Week KPI</div>
              <div class="kpis mono small">
                <div><span class="muted">Todos done</span><b>{{ kpi.done }}/{{ kpi.total }} · {{ kpi.pct }}%</b></div>
                <div class="bar"><i :style="{ width: kpi.pct + '%' }"></i></div>
                <div><span class="muted">Planned hours</span><b>{{ kpi.planned.toFixed(1) }}h / {{ CAPACITY_H * 5 }}h</b></div>
                <div><span class="muted">Days stamped 完</span><b>{{ kpi.stamped }}/7</b></div>
              </div>
            </template>
          </div>
        </aside>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.wp { display: flex; flex-direction: column; height: 100%; }
.phone-switch { display: none; }
.guide { display: flex; align-items: center; gap: 12px; padding: 7px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; min-height: 42px; }
.next { font-weight: 600; gap: 6px; }
.select.small { height: 24px; font-size: 11px; }
.body { flex: 1; min-height: 0; display: grid; grid-template-columns: 236px minmax(0, 1fr) 44px; position: relative; }
/* backlog-only focus (ISS-16): backlog beside the deadlines & goals this backlog serves */
.body.only { grid-template-columns: minmax(0, 1fr) 340px; }
.body.only .rail { display: none; }
.body.only > .ctx { grid-column: 2; grid-row: 1; }
@media (max-width: 900px) {
  .body.only { grid-template-columns: minmax(0, 1fr); }
  .body.only > .ctx { grid-column: 1; grid-row: 2; border-top: 1px solid var(--border); }
}
.days { display: grid; grid-template-columns: repeat(5, minmax(140px, 1fr)) minmax(130px, 0.8fr); gap: 8px; padding: 12px; overflow: auto; align-items: start; }
.weekend { display: flex; flex-direction: column; gap: 8px; }
/* ISS-17: all seven days on one row so the workload buckets compare side by side (after the base
   rules above so the 5+1 split loses); below 1150px the weekend stays stacked to keep columns wide */
@media (min-width: 1150px) {
  .days { grid-template-columns: repeat(5, minmax(118px, 1fr)) minmax(112px, 0.72fr) minmax(112px, 0.72fr); }
  .weekend { display: contents; }
}
.rail { border-left: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 0; }
.rb { position: relative; width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 2px; background: transparent; color: var(--muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.rb:hover, .rb.on { color: var(--text); border-color: var(--accent); }
.badge { position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px; padding: 0 3px; border-radius: 8px; background: var(--warn); color: #0b0b0b; font: 700 9px/16px 'JetBrains Mono', monospace; }
.badge.bad { background: var(--danger); color: #fff; }
.badge.ok-b { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); line-height: 14px; }
.overlay { position: absolute; top: 0; right: 44px; bottom: 0; width: 320px; background: var(--surface); border-left: 1px solid var(--border); box-shadow: -8px 0 24px rgba(0, 0, 0, 0.25); z-index: 20; display: flex; flex-direction: column; }
.oh { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.oh h3 { margin: 0; font-size: 12px; letter-spacing: 0.06em; }
.ob { flex: 1; overflow: auto; }
.sec-h { padding: 12px 12px 6px; }
.rt { display: flex; align-items: center; gap: 8px; padding: 4px 12px; cursor: pointer; }
.rt:hover { background: var(--surface-2); }
.rt.done span { text-decoration: line-through; color: var(--muted); }
.kpis { display: flex; flex-direction: column; gap: 6px; padding: 0 12px 12px; }
.kpis div:not(.bar) { display: flex; justify-content: space-between; }
.slide-enter-active, .slide-leave-active { transition: transform 0.15s ease, opacity 0.15s; }
.slide-enter-from, .slide-leave-to { transform: translateX(20px); opacity: 0; }
@media (max-width: 1100px) { .body { grid-template-columns: 200px minmax(0, 1fr) 44px; } }
/* phone (ISS-3): backlog becomes a capped section on top, day columns swipe horizontally,
   the panel rail becomes a bottom strip and the side panel a bottom sheet */
@media (max-width: 640px) {
  .phone-switch { display: flex; gap: 6px; padding: 6px 10px 0; }
  .phone-switch button { flex: 1; justify-content: center; border: 1px solid var(--border); background: transparent; border-radius: 3px; padding: 7px 6px; display: flex; align-items: center; gap: 6px; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; }
  .phone-switch button.on { color: var(--accent); border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .body { display: flex; flex-direction: column; }
  /* one screen at a time: the tab above picks Days (default) or Backlog, each full height */
  .body > .backlog { display: none; }
  .body.only > .backlog { display: flex; flex: 1; max-height: none; border-bottom: 0; }
  .body.only > .ctx { display: none; } /* the week context lives on the desktop backlog-only view */
  .days { flex: 1; min-height: 0; display: flex; overflow: auto; scroll-snap-type: x proximity; padding: 10px; }
  /* ISS-22: the day column must fit its content (schedule!) — capped viewport height would clip it */
  .days :deep(.day) { flex: 0 0 82vw; width: 82vw; scroll-snap-align: start; height: 100%; overflow-y: auto; }
  .weekend { display: contents; }
  .rail { order: 3; flex-direction: row; justify-content: flex-end; gap: 8px; padding: 6px 10px; border-left: 0; border-top: 1px solid var(--border); }
  .overlay { top: auto; bottom: 0; left: 0; right: 0; width: auto; max-height: 62vh; border-left: 0; border-top: 1px solid var(--border); border-radius: 6px 6px 0 0; }
  .slide-enter-from, .slide-leave-to { transform: translateY(40px); }
}
</style>
