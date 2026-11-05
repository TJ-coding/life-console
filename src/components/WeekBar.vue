<script setup>
// Shared week selector + planning flow: ① Backlog → ② Workload (assign day) → ③ Schedule (assign time).
// Used by the Workload and Weekly Planner screens so both read as the same sheet, like the paper template.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { state, ui, todayISO, addDays, mondayOf, isoWeek, fmtMD } from '../store'

const route = useRoute()
const weekEnd = computed(() => addDays(ui.weekStart, 6))
const isThisWeek = computed(() => ui.weekStart === mondayOf(todayISO()))
const inWeek = (d) => d >= ui.weekStart && d <= weekEnd.value
const backlog = computed(() => state.todos.filter((t) => !t.done && !t.scheduled).length)
const assigned = computed(() => state.todos.filter((t) => !t.done && t.scheduled && inWeek(t.scheduled.date)))
const untimed = computed(() => assigned.value.filter((t) => !t.scheduled.start).length)
const shift = (n) => { ui.weekStart = addDays(ui.weekStart, n * 7) }
</script>

<template>
  <div class="weekbar">
    <div class="weeksel">
      <button class="btn icon-only" title="Previous week ( [ )" @click="shift(-1)"><span class="icon sm">chevron_left</span></button>
      <span class="mono wk">Week {{ isoWeek(ui.weekStart) }} · {{ fmtMD(ui.weekStart) }} – {{ fmtMD(weekEnd) }}</span>
      <button class="btn icon-only" title="Next week ( ] )" @click="shift(1)"><span class="icon sm">chevron_right</span></button>
      <button v-if="!isThisWeek" class="btn sm" @click="ui.weekStart = mondayOf(todayISO())">This week</button>
    </div>

    <nav class="steps" aria-label="Planning flow">
      <router-link :to="{ path: '/todos', query: { view: 'unscheduled' } }" class="step">
        <span class="n mono">1</span>
        <span class="lbl"><b>Backlog</b><small class="mono">{{ backlog }} unassigned</small></span>
      </router-link>
      <span class="icon sm arrow">arrow_forward</span>
      <router-link to="/workload" class="step" :class="{ on: route.name === 'workload' }">
        <span class="n mono">2</span>
        <span class="lbl"><b>Workload</b><small class="mono">assign day · {{ assigned.length }} this week</small></span>
      </router-link>
      <span class="icon sm arrow">arrow_forward</span>
      <router-link to="/week" class="step" :class="{ on: route.name === 'week' }">
        <span class="n mono">3</span>
        <span class="lbl"><b>Schedule</b><small class="mono" :class="{ warnish: untimed }">assign time · {{ untimed }} without a time</small></span>
      </router-link>
    </nav>

    <span class="spacer"></span>
    <slot />
  </div>
</template>

<style scoped>
.weekbar { display: flex; align-items: center; gap: 14px; padding: 8px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.weeksel { display: flex; align-items: center; gap: 6px; }
.wk { font-weight: 600; min-width: 210px; text-align: center; }
.steps { display: flex; align-items: center; gap: 4px; }
.step { display: flex; align-items: center; gap: 8px; padding: 4px 10px 4px 6px; border: 1px solid var(--border); border-radius: 2px; color: var(--muted); }
.step:hover { border-color: var(--muted); color: var(--text); }
.step.on { border-color: var(--accent); color: var(--text); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.n { width: 20px; height: 20px; border-radius: 50%; border: 1px solid currentColor; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
.step.on .n { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.lbl { display: flex; flex-direction: column; line-height: 14px; }
.lbl b { font-size: 12px; }
.lbl small { font-size: 10px; color: var(--muted); }
.warnish { color: var(--warn) !important; }
.arrow { color: var(--muted); }
@media (max-width: 1100px) { .lbl small { display: none; } }
</style>
