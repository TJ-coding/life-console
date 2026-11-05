<script setup>
// Week selector + planning-flow progress for the unified planner:
//   ① Backlog → ② Assign day (workload) → ③ Assign time (schedule)
// Steps don't navigate away — they switch the column layout to emphasise that step.
import { computed } from 'vue'
import { state, ui, todayISO, addDays, mondayOf, isoWeek, fmtMD, setScheduleLock, LOCK_HELP, isLeaf } from '../store'

const weekEnd = computed(() => addDays(ui.weekStart, 6))
const isThisWeek = computed(() => ui.weekStart === mondayOf(todayISO()))
const inWeek = (d) => d >= ui.weekStart && d <= weekEnd.value
const backlog = computed(() => state.todos.filter((t) => !t.done && !t.scheduled && isLeaf(t)).length)
const assigned = computed(() => state.todos.filter((t) => !t.done && t.scheduled && inWeek(t.scheduled.date)))
const timed = computed(() => assigned.value.filter((t) => t.scheduled.start).length)
const pct = computed(() => (assigned.value.length ? Math.round((timed.value / assigned.value.length) * 100) : 100))
const shift = (n) => { ui.weekStart = addDays(ui.weekStart, n * 7) }
const setMode = (m) => {
  ui.planMode = m
  try { localStorage.setItem('life-console/plan-mode', m) } catch { /* ignore */ }
}
</script>

<template>
  <div class="weekbar">
    <div class="weeksel">
      <button class="btn icon-only" title="Previous week ( [ )" @click="shift(-1)"><span class="icon sm">chevron_left</span></button>
      <span class="mono wk">W{{ isoWeek(ui.weekStart) }} · {{ fmtMD(ui.weekStart) }} – {{ fmtMD(weekEnd) }}</span>
      <button class="btn icon-only" title="Next week ( ] )" @click="shift(1)"><span class="icon sm">chevron_right</span></button>
      <button v-if="!isThisWeek" class="btn sm" @click="ui.weekStart = mondayOf(todayISO())">This week</button>
    </div>

    <div class="flow" role="group" aria-label="Planning flow and layout">
      <div class="step" :class="{ done: !backlog }" title="Tasks not yet on a day (left panel)">
        <span class="n mono">{{ backlog ? 1 : '✓' }}</span>
        <span class="lbl"><b>Backlog</b><small class="mono">{{ backlog }} to place</small></span>
      </div>
      <span class="icon sm arrow">arrow_forward</span>
      <button class="step" :class="{ on: ui.planMode === 'days' }" title="Emphasise workload buckets (assign a day)" @click="setMode('days')">
        <span class="n mono">2</span>
        <span class="lbl"><b>Assign day</b><small class="mono">{{ assigned.length }} on this week</small></span>
      </button>
      <span class="icon sm arrow">arrow_forward</span>
      <button class="step" :class="{ on: ui.planMode === 'times', done: assigned.length && pct === 100 }" title="Emphasise the schedule (assign a time)" @click="setMode('times')">
        <span class="n mono">{{ assigned.length && pct === 100 ? '✓' : 3 }}</span>
        <span class="lbl">
          <b>Assign time</b>
          <small class="mono">{{ timed }}/{{ assigned.length }} time-boxed</small>
          <i class="prog"><i :style="{ width: pct + '%' }"></i></i>
        </span>
      </button>
      <button class="step both" :class="{ on: ui.planMode === 'both' }" title="Show workload and schedule together" @click="setMode('both')">
        <span class="icon sm">view_agenda</span><span class="lbl"><b>Both</b></span>
      </button>
    </div>

    <button class="btn icon-only" :class="{ lockon: ui.scheduleLock }" :title="ui.scheduleLock ? LOCK_HELP.on : LOCK_HELP.off" :aria-label="ui.scheduleLock ? LOCK_HELP.on : LOCK_HELP.off" @click="setScheduleLock(!ui.scheduleLock)"><span class="icon sm">{{ ui.scheduleLock ? 'lock' : 'lock_open' }}</span></button>
    <span class="spacer"></span>
    <slot />
  </div>
</template>

<style scoped>
.weekbar { display: flex; align-items: center; gap: 14px; padding: 8px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.weeksel { display: flex; align-items: center; gap: 6px; }
.wk { font-weight: 600; min-width: 170px; text-align: center; }
.flow { display: flex; align-items: center; gap: 4px; }
.step { display: flex; align-items: center; gap: 8px; padding: 4px 10px 4px 6px; border: 1px solid var(--border); border-radius: 2px; color: var(--muted); background: transparent; text-align: left; }
button.step { cursor: pointer; }
button.step:hover { border-color: var(--muted); color: var(--text); }
.step.on { border-color: var(--accent); color: var(--text); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.step.done .n { border-color: var(--accent); color: var(--accent); }
.step.both { margin-left: 6px; padding-left: 8px; }
.n { width: 20px; height: 20px; border-radius: 50%; border: 1px solid currentColor; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex: none; }
.step.on .n { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.lbl { display: flex; flex-direction: column; line-height: 14px; }
.lbl b { font-size: 12px; }
.lbl small { font-size: 10px; color: var(--muted); }
.prog { display: block; height: 3px; margin-top: 2px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
.prog i { display: block; height: 100%; background: var(--accent); }
.arrow { color: var(--muted); }
.lockbtn, .lockon { flex: none; }
.lockon { color: var(--accent); border-color: var(--accent); }
@media (max-width: 1100px) { .lbl small, .prog { display: none; } }
/* phone: the flow wraps instead of running off the right edge (ISS-12) */
@media (max-width: 640px) {
  .weekbar { gap: 8px; padding: 6px 10px; }
  .wk { min-width: 0; flex: 1; }
  .flow { width: 100%; flex-wrap: wrap; row-gap: 4px; }
  .arrow { display: none; }
  .step, .step.both { padding: 4px 8px; }
}
</style>
