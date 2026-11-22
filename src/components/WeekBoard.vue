<script setup>
// Backlog-only view (ISS-16, reworked Nov 2026): one list inside the backlog panel — Unplanned on
// top, then the next weeks — so tasks can be put into a week before they get a day, and the week
// view's backlog (② Assign day) only shows that week's share. Questions, in order:
//   1. What still has no week?              → Unplanned, first
//   2. Which week has room for this task?   → free hours in each week's header (and on the buttons)
//   3. What is due in that week?            → its deadlines & goal milestones under the header
// Click a week on a row, or drag it onto a week. The week bar arrows page through the weeks.
import PartBadge from './PartBadge.vue'
import { computed, ref } from 'vue'

const props = defineProps({ prio: { type: Number, default: 0 }, q: { type: String, default: '' } }) // the panel's P1–P5 filter and search
import { state, ui, todayISO, addDays, mondayOf, wd, fmtMD, isoWeek, byPriority, partLabel, isHoverLinked, planWeek, backlogTodos, planWeeks, weekFree, assignToWeek, todoMatches, trailLinks } from '../store'
import { TODO_MIME, startDrag, endDrag, overRow, leaveRow, dropOnRow, dropClass } from '../dnd'
import Prio from './Prio.vue'
import { useRouter } from 'vue-router'
import { goalDates } from '../../server/goaldates.mjs'
import Chip from './Chip.vue'
import LinkTrail from './LinkTrail.vue'

const weeks = computed(() => planWeeks())
const thisWeek = computed(() => mondayOf(todayISO()))
const inWeek = (s, w) => s >= w && s <= addDays(w, 6)

const cols = computed(() => weeks.value.map((w) => {
  const dls = state.deadlines.filter((d) => !d.done && inWeek(d.due.slice(0, 10), w))
    .map((d) => ({ key: d.id, id: d.id, title: d.title, due: d.due.slice(0, 10), deadline: true }))
  // goal dates (shared with Deadlines/Today: server/goaldates.mjs), shown quieter than the deadlines
  const goals = goalDates(state).filter((g) => inWeek(g.date, w))
    .map((g) => ({ key: g.key, id: g.no, title: g.title, due: g.date, planId: g.planId }))
  const { free, planned } = weekFree(w)
  return {
    w, free, planned,
    due: [...dls, ...goals].sort((a, b) => a.due.localeCompare(b.due)),
    tasks: backlogTodos().filter((t) => planWeek(t) === w && shown(t)).sort(byPriority),
  }
}))
const router = useRouter()
const openGoal = (g) => router.push(`/strategy/${g.planId}?goal=${encodeURIComponent(g.id)}`)
const shown = (t) => (!props.prio || t.priority === props.prio) && todoMatches(t, props.q)
const unplanned = computed(() => backlogTodos().filter((t) => !planWeek(t) && shown(t)).sort(byPriority))
const uHours = computed(() => unplanned.value.reduce((s, t) => s + (t.timeMin || 0) / 60, 0))
const freeOf = computed(() => Object.fromEntries(cols.value.map((c) => [c.w, c.free])))
// sections top to bottom: Unplanned (w = null), then the weeks
const secs = computed(() => [{ w: null, tasks: unplanned.value, due: [] }, ...cols.value])
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
      v-for="c in secs" :key="c.w ?? 'none'" class="wk" :class="{ hot: hot === (c.w ?? 'none'), now: c.w === thisWeek, un: !c.w }"
      @dragover.prevent.stop="hot = c.w ?? 'none'" @dragleave="leave($event, c.w ?? 'none')" @drop.prevent.stop="onDrop($event, c.w)"
    >
      <header v-if="!c.w" class="wh row">
        <b>Unplanned</b>
        <span class="mono small muted">{{ c.tasks.length }} tasks · {{ uHours.toFixed(1) }}h</span>
      </header>
      <header v-else class="wh row">
        <b class="mono">W{{ isoWeek(c.w) }}</b>
        <span class="muted">{{ label(c.w) }}</span>
        <span class="mono small muted">{{ fmtMD(c.w) }} – {{ fmtMD(addDays(c.w, 6)) }}</span>
        <span v-if="c.tasks.length" class="mono small muted">· {{ c.tasks.length }} planned · {{ c.planned.toFixed(1) }}h</span>
        <span class="spacer"></span>
        <span class="mono free" :class="{ over: c.free < 0 }" :title="`Free time on the days still ahead, minus ${c.planned.toFixed(1)}h planned here`">{{ c.free < 0 ? `${(-c.free).toFixed(1)}h over` : `${c.free.toFixed(1)}h free` }}</span>
      </header>

      <div v-if="c.due.length" class="due">
        <span
          v-for="d in c.due" :key="d.key" class="dl click" :class="{ goal: !d.deadline }" :title="d.deadline ? `Open ${d.id}` : `Goal date: ${d.id}'s target. Click to open the goal`"
          @click="d.deadline ? (ui.deadlineId = d.id) : openGoal(d)"
        >
          <span class="icon sm">{{ d.deadline ? 'flag' : 'outlined_flag' }}</span>
          <span class="mono small dw">{{ wd(d.due).slice(0, 3) }}</span>
          <span v-if="!d.deadline" class="mono small gid">{{ d.id }}</span>{{ d.title }}
        </span>
      </div>

      <div
        v-for="t in c.tasks" :key="t.id" class="trow" :class="[dropClass(t), { linked: isHoverLinked(t.id), sel: ui.selectedId === t.id, late: c.w && !weekOk(t, c.w) }]" draggable="true"
        @dragstart="startDrag($event, t)" @dragend="endDrag" @dragover="overRow($event, t)" @dragleave="leaveRow($event, t)"
        @drop="dropOnRow($event, t, { unschedule: true, week: c.w })" @mouseenter="ui.hoverId = t.id" @mouseleave="ui.hoverId = null"
        @click="ui.selectedId = t.id" @dblclick="ui.drawerId = t.id"
      >
        <Prio :p="t.priority" />
        <span class="grow ellipsis ttl">
          <LinkTrail :todo="t" inline />
          <PartBadge v-if="partLabel(t)" :todo="t" class="part mono" />{{ t.title }}
        </span>
        <span class="meta row">
          <Chip v-for="l in t.links.filter((x) => !trailLinks(t).includes(x))" :key="l" :id="l" />
          <span v-if="t.due" class="mono small" :class="!c.w || weekOk(t, c.w) ? 'muted' : 'danger'">due {{ wd(t.due) }} {{ fmtMD(t.due) }}</span>
        </span>
        <span class="mono small muted tm">{{ t.timeMin }}m</span>
        <span class="quick">
          <button v-if="c.w" class="qd" title="Back to unplanned" @click.stop="assignToWeek(t.id, null)"><span class="icon">undo</span></button>
          <button
            v-for="w in weeks.filter((x) => x !== c.w)" :key="w" class="qd mono" :disabled="!weekOk(t, w)"
            :class="{ tight: freeOf[w] < t.timeMin / 60 }"
            :title="`${c.w ? 'Move' : 'Plan'} for W${isoWeek(w)} · ${freeOf[w].toFixed(1)}h free${!weekOk(t, w) ? ' · after due date' : ''}`" @click.stop="assignToWeek(t.id, w)"
          >W{{ isoWeek(w) }}</button>
        </span>
      </div>
      <div v-if="!c.tasks.length" class="empty-row small muted">{{ c.w ? 'Drop tasks here' : 'Every task has a week ✓' }}</div>
    </section>
    <button v-if="later" class="later small" title="Next week ( ] )" @click="ui.weekStart = addDays(ui.weekStart < thisWeek ? thisWeek : ui.weekStart, 7)">
      <span class="mono">{{ later }}</span> more in later weeks<span class="icon sm">chevron_right</span>
    </button>
  </div>
</template>

<style scoped>
/* weeks stacked top to bottom; the last one stretches so the board ends on the same line as Unplanned */
.board { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 0 8px 8px; overflow: auto; min-height: 0; }
.wk { flex: none; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 2px; background: var(--surface); }
.wk:last-of-type { flex: 1 0 auto; }
.wk.un { border-color: color-mix(in srgb, var(--info) 45%, var(--border)); }
.wk.now { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
.wk.hot { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, var(--surface)); }
.wh { gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.wh b { font-size: 15px; }
.free { font-size: 13px; color: var(--muted); }
.free.over { color: var(--danger); font-weight: 700; }
.due { display: flex; flex-wrap: wrap; gap: 4px 18px; padding: 6px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
.dl { display: inline-flex; align-items: center; gap: 6px; }
.dl .icon { color: var(--warn); font-size: 15px; }
.dl.click { cursor: pointer; }
.dl.click:hover { color: var(--accent); }
.dw, .gid { color: var(--muted); }
/* goal dates: quieter than deadlines */
.dl.goal { color: var(--muted); font-size: 12px; }
.dl.goal .icon { color: var(--info); font-size: 13px; }
.trow { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 4px 12px; font-size: 15px; cursor: grab; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
.trow:last-of-type { border-bottom: 0; }
.trow:hover, .trow.linked { background: var(--surface-2); }
.trow.sel { box-shadow: inset 2px 0 0 var(--info); }
.trow.late { box-shadow: inset 2px 0 0 var(--danger); }
.ttl { min-width: 0; }
.meta { gap: 4px; flex: none; }
.tm { width: 44px; text-align: right; flex: none; }
.part { font-size: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 2px; padding: 0 3px; margin-right: 5px; }
.quick { display: none; gap: 2px; flex: none; }
.trow:hover .quick, .trow.sel .quick { display: flex; }
.qd { display: flex; align-items: center; justify-content: center; min-width: 40px; height: 26px; padding: 0 6px; border: 1px solid var(--border); border-radius: 2px; background: var(--surface); cursor: pointer; font-size: 11px; color: var(--text); }
.qd .icon { font-size: 15px; }
.qd:hover:not(:disabled) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.qd.tight { color: var(--warn); }
.qd:disabled { opacity: 0.3; cursor: not-allowed; }
.empty-row { padding: 12px; }
.later { flex: none; align-self: flex-start; display: flex; align-items: center; gap: 4px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 2px; background: transparent; color: var(--muted); cursor: pointer; }
.later:hover { color: var(--text); border-color: var(--accent); }
.danger { color: var(--danger); }
/* phones: one row per line, chips and due date dropped (the drawer has them) */
@media (max-width: 640px) {
  .board { padding: 10px; }
  .trow { font-size: 14px; }
  .meta { display: none; }
  .quick { display: none !important; }
  .trow.sel { flex-wrap: wrap; }
  .trow.sel .quick { display: flex !important; width: 100%; }
}
</style>
