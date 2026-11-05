<script setup>
// Week balance: verdict, rebalance suggestions and hours by goal (side panel of the planner).
import { computed } from 'vue'
import { state, ui, addDays, wd, fmtSlash, CAPACITY_H, dayLoad, suggestRebalance, todosForDay, updateTodo, toast } from '../store'

const days = computed(() => [0, 1, 2, 3, 4].map((i) => addDays(ui.weekStart, i)))
const all = computed(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ui.weekStart, i)))
const loads = computed(() => days.value.map((d) => dayLoad(d).total))
const stats = computed(() => {
  const wk = loads.value
  const spread = Math.max(...wk) - Math.min(...wk)
  const over = days.value.filter((d, i) => wk[i] > CAPACITY_H)
  const level = over.length || spread > 3 ? 'unbalanced' : spread > 1.5 ? 'uneven' : 'balanced'
  return { avg: wk.reduce((a, b) => a + b, 0) / 5, spread, over, level, free: wk.reduce((s, v) => s + Math.max(0, CAPACITY_H - v), 0) }
})
const LEVEL = {
  balanced: { icon: 'check_circle', label: 'Balanced', cls: 'ok' },
  uneven: { icon: 'error', label: 'Uneven', cls: 'warn' },
  unbalanced: { icon: 'warning', label: 'Unbalanced', cls: 'danger' },
}
const suggestions = computed(() => suggestRebalance(days.value))
function apply(s) {
  updateTodo(s.todo.id, { scheduled: { date: s.to, start: null } })
  toast(`${s.todo.id} → ${wd(s.to)} ${fmtSlash(s.to)}`)
}
function applyAll() {
  const n = suggestions.value.length
  suggestions.value.forEach((s) => updateTodo(s.todo.id, { scheduled: { date: s.to, start: null } }))
  toast(`Moved ${n} tasks`)
}
const byGoal = computed(() => {
  const m = new Map()
  for (const d of all.value) {
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
defineExpose({ suggestions, stats })
</script>

<template>
  <div class="bp">
    <div class="verdict row" :class="LEVEL[stats.level].cls"><span class="icon">{{ LEVEL[stats.level].icon }}</span>{{ LEVEL[stats.level].label }}</div>
    <div class="mono small facts">
      <span><span class="muted">avg</span> {{ h1(stats.avg) }}h</span>
      <span><span class="muted">spread</span> {{ h1(stats.spread) }}h</span>
      <span><span class="muted">free</span> {{ h1(stats.free) }}h</span>
      <span v-if="stats.over.length" class="danger">over: {{ stats.over.map(wd).join(' · ') }}</span>
    </div>

    <div class="sh tiny upper muted row">Rebalance<span class="spacer"></span><button v-if="suggestions.length > 1" class="btn sm" @click="applyAll">Apply all</button></div>
    <div v-for="s in suggestions" :key="s.todo.id" class="sug" @mouseenter="ui.hoverId = s.todo.id" @mouseleave="ui.hoverId = null">
      <div class="grow">
        <div class="ellipsis">{{ s.todo.title }}</div>
        <div class="mono small muted">{{ s.todo.timeMin }}m · {{ wd(s.from) }} → <b class="txt">{{ wd(s.to) }}</b></div>
      </div>
      <button class="btn sm" @click="apply(s)">Move</button>
    </div>
    <div v-if="!suggestions.length" class="small muted row"><span class="icon sm ok">check_circle</span>Remaining weekdays are even and under capacity.</div>

    <div class="sh tiny upper muted">Hours by goal</div>
    <div v-for="g in byGoal" :key="g.k" class="goal">
      <div class="row small"><span class="mono">{{ g.k }}</span><span class="muted ellipsis grow">{{ g.name }}</span><span class="mono">{{ h1(g.h) }}h</span></div>
      <div class="gbar"><i :style="{ width: (g.h / goalMax) * 100 + '%' }"></i></div>
    </div>
    <div v-if="!byGoal.length" class="small muted">No tasks assigned this week.</div>
  </div>
</template>

<style scoped>
.bp { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
.verdict { font-weight: 600; font-size: 15px; gap: 6px; }
.facts { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.sh { margin-top: 8px; border-top: 1px solid var(--border); padding-top: 10px; }
.sug { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; }
.txt { color: var(--text); }
.goal { display: flex; flex-direction: column; gap: 4px; }
.gbar { height: 8px; }
.gbar i { display: block; height: 100%; background: var(--cat-research); border-radius: 0 4px 4px 0; }
</style>
