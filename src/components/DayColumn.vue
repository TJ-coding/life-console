<script setup>
// One day of the unified planner, top → bottom like the paper template:
//   header · ② Workload bucket (assign day) · ③ Schedule timeline (assign time) · deadlines · notes · sign-off
// A task dropped in the bucket can be dragged straight down onto a time in the same column.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { state, ui, todayISO, wd, wdJa, fmtSlash, todosForDay, blocksForDay, workload, diffDays, CAPACITY_H, autoTimebox, toast, isOverdue, moveBlock, toMin, byPriority, categoryOf, partLabel, isHoverLinked, isLeaf, assignToDay, updateTodo } from '../store'
import { startDrag, endDrag } from '../dnd'
import DayTimeline from './DayTimeline.vue'
import DeadlineQuickAdd from './DeadlineQuickAdd.vue'
import WorkloadBucket from './WorkloadBucket.vue'
import Gauge from './Gauge.vue'
import Stamps from './Stamps.vue'
import Prio from './Prio.vue'

const router = useRouter()
const openDay = () => router.push(props.date === todayISO() ? '/' : `/day/${props.date}`)
// balance: ② Assign day only — { avg, counts (days the average covers), rows, moves } from the planner
const props = defineProps({ date: String, filter: String, mode: { type: String, default: 'both' }, balance: Object })
/* ② Assign day: the space under the day does that day's job — on an over-full day, what to move out
   (the planner's rebalance moves); on a day with room, the backlog tasks the planner gives it */
const free = computed(() => CAPACITY_H - hours.value)
const moveOut = computed(() => (props.balance && !past.value && hours.value > CAPACITY_H ? Object.values(props.balance.moves).filter((s) => s.from === props.date) : []))
const fits = computed(() => (props.balance && !past.value ? props.balance.place[props.date] ?? [] : []))
function moveTo(s) {
  updateTodo(s.todo.id, { scheduled: { date: s.to, start: null } })
  toast(`${s.todo.id} → ${wd(s.to)} ${fmtSlash(s.to)}`)
}
const delta = computed(() => (props.balance?.counts.includes(props.date) ? hours.value - props.balance.avg : null))
const isToday = computed(() => props.date === todayISO())
const past = computed(() => diffDays(props.date, todayISO()) > 0)
const todos = computed(() => todosForDay(props.date))
const untimed = computed(() => todos.value.filter((t) => !t.done && !t.scheduled.start))
const blocks = computed(() => blocksForDay(props.date))
const hours = computed(() => workload(props.date))
const deadlines = computed(() => state.deadlines.filter((d) => d.due.slice(0, 10) === props.date).sort((a, b) => a.due.localeCompare(b.due)))
const matches = (links) => !props.filter || links.includes(props.filter)
const dimBlock = (b) => props.filter && b.link !== props.filter && !(b.todoId && matches(state.todos.find((t) => t.id === b.todoId)?.links ?? []))
const dimTodo = (t) => !matches(t.links)
const adding = ref(false)
const notes = computed({ get: () => state.notes[props.date] ?? '', set: (v) => { state.notes[props.date] = v } })
// via moveBlock so a task's first time follows the pomodoro rhythm (Settings → Pomodoro)
const schedule = (id, start) => moveBlock('todo', id, props.date, toMin(start))
// Assign time: the day's work that has no time yet, listed above the schedule to drag onto it
const toTime = computed(() => [...untimed.value].sort(byPriority))
const toTimeMin = computed(() => untimed.value.reduce((s, t) => s + (t.timeMin || 0), 0))
const hm = (m) => { const h = Math.floor(m / 60); return h ? `${h}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m` }

// sizes per layout mode; on phones (= 640px) the schedule gets a few extra px/hour so blocks stay readable (ISS-22)
const phone = ref(typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches)
if (typeof matchMedia === 'function') matchMedia('(max-width: 640px)').addEventListener?.('change', (e) => (phone.value = e.matches))
const bucketPx = computed(() => ({ days: 30, both: 18, times: 11 })[props.mode])
const timelinePx = computed(() => {
  const base = ({ both: 18, times: 26 })[props.mode] ?? 0
  return base ? base + (phone.value ? 8 : 0) : 0
})

function auto() {
  const r = autoTimebox(props.date)
  toast(r.unplaced.length ? `Time-boxed ${r.placed.length}; ${r.unplaced.length} didn't fit 08:00–21:00` : `Time-boxed ${r.placed.length} tasks on ${wd(props.date)}`)
}
</script>

<template>
  <div class="day panel" :class="{ today: isToday, past }">
    <header class="dh" role="link" tabindex="0" :title="`Open ${wd(date)} ${fmtSlash(date)} in day view`" @click="openDay" @keydown.enter="openDay">
      <div class="row">
        <span class="ja">{{ wdJa(date) }}</span>
        <span class="mono md">{{ fmtSlash(date) }}</span>
        <span class="mono tiny muted">{{ wd(date) }}</span>
        <span class="spacer"></span>
        <span v-if="isToday" class="mono tiny ok">● NOW</span>
        <span class="icon sm open">open_in_new</span>
      </div>
      <div class="row">
        <span v-if="hours > CAPACITY_H" class="icon sm danger" title="Over capacity">warning</span>
        <span class="mono small" :class="hours > CAPACITY_H ? 'danger' : ''">{{ hours.toFixed(1) }}<span class="muted">/{{ CAPACITY_H }}h</span></span>
        <div class="grow"><Gauge :hours="hours" horizontal /></div>
      </div>
      <div v-if="balance && delta === null" class="delta mono muted" title="Not counted in the week's average">{{ date < todayISO() ? 'past' : 'weekend' }}</div>
      <div v-else-if="delta !== null" class="delta mono" :class="hours > CAPACITY_H ? 'danger' : delta > 1 ? 'warn' : delta < -1 ? 'room' : 'muted'" :title="`${Math.abs(delta).toFixed(1)}h ${delta >= 0 ? 'above' : 'below'} the week's average of ${balance.avg.toFixed(1)}h`">
        <span class="icon sm">{{ delta >= 0 ? 'arrow_upward' : 'arrow_downward' }}</span>{{ delta >= 0 ? '+' : '−' }}{{ Math.abs(delta).toFixed(1) }}h <span class="muted">vs avg</span><template v-if="delta < -1 && hours <= CAPACITY_H"> · room</template>
      </div>
    </header>

    <div class="sec">
      <div class="sh tiny upper muted"><span class="n">②</span> Workload<span class="spacer"></span>{{ todos.filter((t) => t.done).length }}/{{ todos.length }} done</div>
      <WorkloadBucket :date="date" :hour-px="bucketPx" :dim-fn="filter ? dimTodo : null" :min-rows="balance?.rows" :avg="balance && balance.counts.includes(date) ? balance.avg : null" />
    </div>

    <div v-if="mode !== 'days'" class="sec">
      <div class="sh tiny upper muted">
        <span class="n">③</span> Schedule<span class="spacer"></span>
        <button v-if="untimed.length && !past" class="btn sm auto" :title="`Auto time-box: give ${untimed.length} untimed task(s) a time in free gaps (08:00–21:00), by priority`" @click="auto">
          <span class="icon sm">bolt</span>{{ untimed.length }}
        </button>
        <span v-else-if="!untimed.length && todos.length" class="ok" title="Every task has a time">✓</span>
      </div>
      <div v-if="mode === 'times' && toTime.length" class="totime" :title="`${hm(toTimeMin)} of ${wd(date)}'s work has no time yet: drag each onto the schedule, or ⚡ to auto time-box`">
        <div class="tth"><span class="tiny upper">Not timed</span><b class="mono">{{ hm(toTimeMin) }}</b></div>
        <div
          v-for="t in toTime" :key="t.id" class="tt block" :class="['cat-' + categoryOf(t), { linked: isHoverLinked(t.id) }]" draggable="true"
          @dragstart="startDrag($event, t)" @dragend="endDrag" @click="ui.drawerId = t.id"
          @mouseenter="ui.hoverId = t.id" @mouseleave="ui.hoverId = null"
        >
          <span class="ttl"><b v-if="partLabel(t)" class="mono pl">{{ partLabel(t) }}</b>{{ t.title }}</span><span class="mono muted">{{ hm(t.timeMin) }}</span>
        </div>
      </div>
      <DayTimeline :date="date" :blocks="blocks" :pxh="timelinePx" :dim-fn="filter ? dimBlock : null" @drop-todo="schedule" @open="(id) => (ui.drawerId = id)" @edit="(b) => (ui.blockId = b.id)" />
    </div>

    <div class="sec">
      <div class="sh tiny upper muted">
        Deadlines<span class="spacer"></span>
        <button class="btn sm icon-only addbtn" :class="{ active: adding }" :title="`Add a deadline on ${wd(date)}`" @click="adding = !adding"><span class="icon sm">add</span></button>
      </div>
      <div v-for="d in deadlines" :key="d.id" class="dl small" :class="{ done: d.done, over: isOverdue(d) }" :title="`${d.title}${d.vital ? ' · ' + d.vital : ''} — click to edit`" @click="ui.deadlineId = d.id">
        <input v-model="d.done" type="checkbox" @click.stop />
        <span class="ellipsis grow">{{ d.title }}</span>
        <span class="mono muted">{{ d.due.slice(11) }}</span>
      </div>
      <DeadlineQuickAdd v-if="adding" :date="date" compact autofocus @cancel="adding = false" />
      <div v-if="!deadlines.length && !adding" class="small muted pad">—</div>
    </div>

    <div v-if="moveOut.length" class="sec">
      <div class="sh tiny upper danger">Move out<span class="spacer"></span><span class="mono">{{ (hours - CAPACITY_H).toFixed(1) }}h over</span></div>
      <button v-for="s in moveOut" :key="s.todo.id" class="pick" :title="`Move ${s.todo.title} to ${wd(s.to)} ${fmtSlash(s.to)}`" @click="moveTo(s)" @mouseenter="ui.hoverId = s.todo.id" @mouseleave="ui.hoverId = null">
        <span class="ellipsis grow">{{ s.todo.title }}</span><span class="mono to">→ {{ wd(s.to) }}</span>
      </button>
    </div>
    <div v-else-if="fits.length" class="sec">
      <div class="sh tiny upper muted" :title="`Backlog tasks that would even out the week here, by priority and due date · ${free.toFixed(1)}h free`">Fits here<span class="spacer"></span><span class="mono">{{ free.toFixed(1) }}h free</span></div>
      <button v-for="t in fits" :key="t.id" class="pick" :class="{ linked: isHoverLinked(t.id) }" :title="`Put ${t.title} on ${wd(date)} ${fmtSlash(date)}`" @click="assignToDay(t.id, date)" @mouseenter="ui.hoverId = t.id" @mouseleave="ui.hoverId = null">
        <Prio :p="t.priority" /><span class="ellipsis grow">{{ t.title }}</span><span class="mono muted">{{ t.timeMin }}m</span>
      </button>
    </div>

    <template v-if="mode !== 'days'">
      <div class="sec">
        <div class="sh tiny upper muted">Notes</div>
        <textarea v-model="notes" class="textarea notes" rows="2" placeholder="…"></textarea>
      </div>
      <div class="sec stamps-sec"><Stamps :date="date" :size="22" /></div>
    </template>
  </div>
</template>

<style scoped>
.day { min-width: 140px; overflow: hidden; }
.day.today { border-color: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent); }
.day.past { opacity: 0.85; }
.dh { cursor: pointer; }
.dh:hover { background: var(--surface-2); }
.dh:hover .ja, .dh:hover .md { color: var(--accent); }
.open { font-size: 14px; color: var(--muted); opacity: 0; }
.dh:hover .open { opacity: 1; }
.dh { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border); }
.ja { font-family: 'Noto Sans JP'; font-weight: 700; font-size: 16px; }
.today .ja { color: var(--accent); }
.md { font-size: 15px; font-weight: 700; }
.sec { border-bottom: 1px solid var(--border); padding: 6px; }
.delta { display: flex; align-items: center; gap: 3px; font-size: 12px; height: 18px; white-space: nowrap; overflow: hidden; }
.delta .icon { font-size: 14px; }
.delta.room { color: var(--info); }
.pick { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; text-align: left; padding: 4px 3px; border-radius: 2px; cursor: pointer; }
.pick:hover, .pick.linked { background: var(--surface-2); }
.pick:hover .grow { color: var(--accent); }
.pick .to { color: var(--accent); white-space: nowrap; }
.pick .mono { font-size: 11px; }
.totime { margin: 0 0 6px; padding: 5px; border-radius: 2px; background: color-mix(in srgb, var(--warn) 8%, transparent); border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--border)); display: flex; flex-direction: column; gap: 3px; }
.tth { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; color: var(--warn); padding: 0 1px 1px; }
.tth b { font-size: 13px; }
.tt { display: flex; align-items: center; gap: 6px; padding: 3px 5px; font-size: 11px; cursor: grab; }
.tt .ttl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tt .pl { color: var(--muted); margin-right: 4px; font-weight: 500; }
.tt.linked { outline: 2px solid var(--info); }
.sh { display: flex; align-items: center; gap: 4px; padding: 0 2px 5px; min-height: 22px; white-space: nowrap; overflow: hidden; }
.n { font-size: 12px; }
.auto { height: 20px; padding: 0 5px; font-size: 10px; color: var(--warn); border-color: color-mix(in srgb, var(--warn) 50%, var(--border)); }
.dl { display: flex; align-items: center; gap: 5px; padding: 3px 2px; cursor: pointer; border-radius: 2px; }
.dl:hover { background: var(--surface-2); }
.dl.over .grow { color: var(--danger); }
.addbtn { height: 18px; padding: 0 2px; }
.dl.done span.grow { text-decoration: line-through; color: var(--muted); }
.pad { padding: 2px; }
.notes { width: 100%; font-size: 11px; line-height: 15px; }
.stamps-sec { display: flex; justify-content: center; border-bottom: 0; padding: 8px; }
</style>
