<script setup>
// One day of the unified planner, top → bottom like the paper template:
//   header · ② Workload bucket (assign day) · ③ Schedule timeline (assign time) · deadlines · notes · sign-off
// A task dropped in the bucket can be dragged straight down onto a time in the same column.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { state, ui, todayISO, wd, wdJa, fmtSlash, todosForDay, blocksForDay, workload, updateTodo, diffDays, CAPACITY_H, autoTimebox, toast, isOverdue } from '../store'
import DayTimeline from './DayTimeline.vue'
import DeadlineQuickAdd from './DeadlineQuickAdd.vue'
import WorkloadBucket from './WorkloadBucket.vue'
import Gauge from './Gauge.vue'
import Stamps from './Stamps.vue'

const router = useRouter()
const openDay = () => router.push(props.date === todayISO() ? '/' : `/day/${props.date}`)
const props = defineProps({ date: String, filter: String, mode: { type: String, default: 'both' } })
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
const schedule = (id, start) => updateTodo(id, { scheduled: { date: props.date, start } })

// sizes per layout mode
const bucketPx = computed(() => ({ days: 30, both: 18, times: 11 })[props.mode])
const timelinePx = computed(() => ({ both: 18, times: 26 })[props.mode] ?? 0)

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
    </header>

    <div class="sec">
      <div class="sh tiny upper muted"><span class="n">②</span> Workload<span class="spacer"></span>{{ todos.filter((t) => t.done).length }}/{{ todos.length }} done</div>
      <WorkloadBucket :date="date" :hour-px="bucketPx" :dim-fn="filter ? dimTodo : null" />
    </div>

    <div v-if="mode !== 'days'" class="sec">
      <div class="sh tiny upper muted">
        <span class="n">③</span> Schedule<span class="spacer"></span>
        <button v-if="untimed.length && !past" class="btn sm auto" :title="`Auto time-box: give ${untimed.length} untimed task(s) a time in free gaps (08:00–21:00), by priority`" @click="auto">
          <span class="icon sm">bolt</span>{{ untimed.length }}
        </button>
        <span v-else-if="!untimed.length && todos.length" class="ok" title="Every task has a time">✓</span>
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
        <span v-if="d.clickUp" class="ok" title="ClickUp">●</span>
        <span class="mono muted">{{ d.due.slice(11) }}</span>
      </div>
      <DeadlineQuickAdd v-if="adding" :date="date" compact autofocus @cancel="adding = false" />
      <div v-if="!deadlines.length && !adding" class="small muted pad">—</div>
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
.sh { display: flex; align-items: center; gap: 4px; padding: 0 2px 5px; min-height: 22px; }
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
