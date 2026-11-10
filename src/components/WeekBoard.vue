<script setup>
// Backlog-only view (ISS-16, reworked Nov 2026): the next weeks as columns beside the Unplanned
// backlog, so tasks can be spread over weeks before they get a day. Questions, in order:
//   1. Which week has room for this task?   → free hours in each column header
//   2. What is due in that week?            → its deadlines & goal milestones at the top of the column
//   3. What's already planned for it?       → the task cards below
// Drag a task onto a column (or click a week on the card); the week view then offers it in that
// week's backlog. The week bar arrows page through the weeks.
import { computed, ref } from 'vue'
import { state, ui, todayISO, addDays, mondayOf, wd, fmtMD, isoWeek, byPriority, partLabel, isHoverLinked, parentPath, planWeek, backlogTodos, planWeeks, weekFree, assignToWeek } from '../store'
import { TODO_MIME, startDrag, endDrag, overRow, leaveRow, dropOnRow, dropClass } from '../dnd'
import Prio from './Prio.vue'
import Chip from './Chip.vue'

const weeks = computed(() => planWeeks())
const thisWeek = computed(() => mondayOf(todayISO()))
const inWeek = (s, w) => s >= w && s <= addDays(w, 6)
const DATE = /^\d{4}-\d{2}-\d{2}$/

const cols = computed(() => weeks.value.map((w) => {
  const dls = state.deadlines.filter((d) => !d.done && inWeek(d.due.slice(0, 10), w))
    .map((d) => ({ key: d.id, id: d.id, title: d.title, due: d.due.slice(0, 10), deadline: true }))
  const goals = state.plans.filter((p) => p.status === 'active').flatMap((p) => [
    ...p.sigs.filter((s) => s.status !== 'done' && DATE.test(s.timeBound ?? '')).map((s) => ({ key: `${p.id}/${s.no}`, id: s.no, title: s.name, due: s.timeBound })),
    ...p.psgs.filter((g) => DATE.test(g.timeBound ?? '')).map((g) => ({ key: `${p.id}/${g.no}`, id: g.no, title: g.name, due: g.timeBound })),
  ]).filter((g) => inWeek(g.due, w))
  const { free, planned } = weekFree(w)
  return {
    w, free, planned,
    due: [...dls, ...goals].sort((a, b) => a.due.localeCompare(b.due)),
    tasks: backlogTodos().filter((t) => planWeek(t) === w).sort(byPriority),
  }
}))
const later = computed(() => {
  const last = weeks.value[weeks.value.length - 1]
  return backlogTodos().filter((t) => planWeek(t) > last).length
})
const label = (w) => (w === thisWeek.value ? 'this week' : w === addDays(thisWeek.value, 7) ? 'next week' : `in ${Math.round((Date.parse(w) - Date.parse(thisWeek.value)) / 6048e5)} weeks`)
const weekOk = (t, w) => !t.due || w <= t.due

const hot = ref(null)
function onDrop(e, w) {
  hot.value = null
  const id = e.dataTransfer.getData(TODO_MIME)
  if (id) assignToWeek(id, w)
}
const leave = (e, w) => { if (hot.value === w && !e.currentTarget.contains(e.relatedTarget)) hot.value = null }
</script>

<template>
  <div class="board">
    <section
      v-for="c in cols" :key="c.w" class="wk" :class="{ hot: hot === c.w, now: c.w === thisWeek }"
      @dragover.prevent="hot = c.w" @dragleave="leave($event, c.w)" @drop.prevent="onDrop($event, c.w)"
    >
      <header class="wh">
        <div class="row">
          <b class="mono">W{{ isoWeek(c.w) }}</b><span class="small muted">{{ label(c.w) }}</span>
          <span class="spacer"></span>
          <span class="mono small free" :class="{ over: c.free < 0 }" :title="`Free time on the days still ahead, minus ${c.planned.toFixed(1)}h planned here`">{{ c.free < 0 ? `${(-c.free).toFixed(1)}h over` : `${c.free.toFixed(1)}h free` }}</span>
        </div>
        <div class="mono tiny muted">{{ fmtMD(c.w) }} – {{ fmtMD(addDays(c.w, 6)) }}<template v-if="c.tasks.length"> · {{ c.tasks.length }} planned · {{ c.planned.toFixed(1) }}h</template></div>
      </header>

      <div v-if="c.due.length" class="due">
        <div
          v-for="d in c.due" :key="d.key" class="dl row" :class="{ click: d.deadline }" :title="d.deadline ? `Open ${d.id}` : 'Goal milestone'"
          @click="d.deadline && (ui.deadlineId = d.id)"
        >
          <span class="icon sm">{{ d.deadline ? 'flag' : 'outlined_flag' }}</span>
          <span class="mono small dw">{{ wd(d.due).slice(0, 3) }}</span>
          <span class="grow ellipsis"><span v-if="!d.deadline" class="mono gid">{{ d.id }}</span>{{ d.title }}</span>
        </div>
      </div>

      <div class="list">
        <div
          v-for="t in c.tasks" :key="t.id" class="card" :class="[dropClass(t), { linked: isHoverLinked(t.id), sel: ui.selectedId === t.id, late: !weekOk(t, c.w) }]" draggable="true"
          @dragstart="startDrag($event, t)" @dragend="endDrag" @dragover="overRow($event, t)" @dragleave="leaveRow($event, t)"
          @drop="dropOnRow($event, t, { unschedule: true, week: c.w })" @mouseenter="ui.hoverId = t.id" @mouseleave="ui.hoverId = null"
          @click="ui.selectedId = t.id" @dblclick="ui.drawerId = t.id"
        >
          <div v-if="t.parent && parentPath(t)" class="crumb small muted ellipsis" :title="parentPath(t)">↳ {{ parentPath(t) }}</div>
          <div class="row">
            <Prio :p="t.priority" />
            <span class="grow ellipsis"><span v-if="partLabel(t)" class="part mono">{{ partLabel(t) }}</span>{{ t.title }}</span>
            <span class="mono small muted">{{ t.timeMin }}m</span>
          </div>
          <div v-if="t.links.length || t.due" class="row small meta">
            <Chip v-for="l in t.links" :key="l" :id="l" />
            <span v-if="t.due" class="mono" :class="weekOk(t, c.w) ? 'muted' : 'danger'">due {{ wd(t.due) }} {{ fmtMD(t.due) }}</span>
          </div>
          <div class="quick">
            <button class="qd mono" title="Back to unplanned" @click.stop="assignToWeek(t.id, null)"><span class="icon">undo</span></button>
            <button
              v-for="w in weeks.filter((x) => x !== c.w)" :key="w" class="qd mono" :disabled="!weekOk(t, w)"
              :title="`Move to W${isoWeek(w)}${!weekOk(t, w) ? ' · after due date' : ''}`" @click.stop="assignToWeek(t.id, w)"
            >W{{ isoWeek(w) }}</button>
          </div>
        </div>
        <div v-if="!c.tasks.length" class="empty small muted">Drop tasks here</div>
      </div>
    </section>
    <button v-if="later" class="later small" title="Next week ( ] )" @click="ui.weekStart = addDays(ui.weekStart < thisWeek ? thisWeek : ui.weekStart, 7)">
      <span class="mono">{{ later }}</span> later<span class="icon sm">chevron_right</span>
    </button>
  </div>
</template>

<style scoped>
.board { display: flex; gap: 8px; padding: 12px; overflow: auto; min-height: 0; position: relative; }
.wk { flex: 1 1 0; min-width: 190px; display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--border); border-radius: 2px; background: var(--surface); }
.wk.now { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
.wk.hot { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, var(--surface)); }
.wh { padding: 8px 10px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px; }
.wh .row { gap: 8px; }
.wh b { font-size: 15px; }
.free { color: var(--muted); }
.free.over { color: var(--danger); font-weight: 700; }
.due { border-bottom: 1px solid var(--border); padding: 4px 0; }
.dl { gap: 6px; padding: 3px 10px; font-size: 13px; }
.dl .icon { color: var(--warn); font-size: 15px; }
.dl.click { cursor: pointer; }
.dl.click:hover { background: var(--surface-2); }
.dw { width: 28px; color: var(--muted); }
.gid { margin-right: 6px; color: var(--muted); }
.list { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.card { border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; cursor: grab; background: var(--bg); font-size: 14px; }
.card:hover, .card.linked { border-color: var(--info); }
.card.sel { box-shadow: inset 0 0 0 1px var(--info); }
.card.late { border-left: 2px solid var(--danger); }
.crumb { font-size: 11px; margin-bottom: 2px; }
.meta { flex-wrap: wrap; gap: 4px; }
.part { font-size: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 2px; padding: 0 3px; margin-right: 5px; }
.quick { display: none; gap: 2px; margin-top: 2px; }
.card:hover .quick, .card.sel .quick { display: flex; }
.qd { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; height: 22px; border: 1px solid var(--border); border-radius: 2px; background: var(--surface); cursor: pointer; font-size: 10px; color: var(--text); }
.qd .icon { font-size: 14px; }
.qd:hover:not(:disabled) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.qd:disabled { opacity: 0.3; cursor: not-allowed; }
.empty { padding: 10px 4px; text-align: center; }
.later { flex: none; align-self: flex-start; display: flex; align-items: center; gap: 4px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 2px; background: transparent; color: var(--muted); cursor: pointer; }
.later:hover { color: var(--text); border-color: var(--accent); }
.danger { color: var(--danger); }
@media (max-width: 640px) {
  .board { flex: 1; scroll-snap-type: x proximity; padding: 10px; }
  .wk { flex: 0 0 82vw; scroll-snap-align: start; }
}
</style>
