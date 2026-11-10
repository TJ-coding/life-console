<script setup>
// S-01 · Command Center — a driver's console for today, and (S-11) a day view for any date via /day/:date.
// Order = priority: what to do NOW (with what's next as a hint) on top; then the day's schedule beside the
// next DEADLINES and the rest of TODAY.
// Everything else is one quiet telemetry strip at the bottom, and only exceptions get colour.
import { computed, ref, watch, watchEffect, nextTick, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  state, ui, todayISO, wd, isoWeek, todosForDay, blocksForDay, workload, CAPACITY_H,
  diffDays, relDay, toMin, fromMin, pad, mondayOf, routineDone, nextCheckDate, activePlans,
  updateTodo, addTodo, deleteTodo, parseQuick, toast, addDays, fmtSlash, setScheduleLock, LOCK_HELP, touchUI,
  isLeaf, byPriority, findTodo, unscheduleTodo, deleteBlock,
} from '../store'
import { TODO_MIME, startDrag, endDrag } from '../dnd'
import Prio from '../components/Prio.vue'
import Timeline24 from '../components/Timeline24.vue'
import TodoRow from '../components/TodoRow.vue'
import Stamps from '../components/Stamps.vue'
import NowCard from '../components/NowCard.vue'
import DeadlineHero from '../components/DeadlineHero.vue'
import { openDeadlines, minsTo, countdown, urgency, effDue } from '../glance'
import DayTimeline from '../components/DayTimeline.vue'
import CommandCenterMore from '../components/CommandCenterMore.vue'

/* per-device view preferences (not synced): timeline direction and the "More" section */
const pref = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

const route = useRoute()
const router = useRouter()
const today = computed(() => { void ui.now; return todayISO() }) // follows midnight
/** The day being viewed: /day/:date, or today on "/". */
const T = computed(() => route.params.date || today.value)
const isToday = computed(() => T.value === today.value)
const dayPath = (d) => (d === today.value ? '/' : `/day/${d}`)
const goDay = (n) => router.push(dayPath(addDays(T.value, n)))
function openWeek() {
  ui.weekStart = mondayOf(T.value)
  router.push('/week')
}
const nowMin = computed(() => ui.now.getHours() * 60 + ui.now.getMinutes())

/* ── today's run sheet: timed todos in clock order, then untimed by priority ── */
const todos = computed(() => todosForDay(T.value))
const pending = computed(() => {
  const open = todos.value.filter((t) => !t.done)
  const timed = open.filter((t) => t.scheduled.start).sort((a, b) => toMin(a.scheduled.start) - toMin(b.scheduled.start))
  return [...timed, ...open.filter((t) => !t.scheduled.start)]
})
const done = computed(() => todos.value.filter((t) => t.done))
const showDone = ref(false)
watchEffect(() => { ui.visibleIds = [...pending.value, ...(showDone.value ? done.value : [])].map((t) => t.id) })
const remainingMin = computed(() => pending.value.reduce((s, t) => s + (t.timeMin || 0), 0))
const doneMin = computed(() => done.value.reduce((s, t) => s + (t.timeMin || 0), 0))
const pctOf = (m) => Math.min(100, (m / 60 / CAPACITY_H) * 100)
const loadLevel = computed(() => (hours.value > CAPACITY_H + 1 ? 'danger' : hours.value > CAPACITY_H ? 'warn' : 'ok'))
const fmtH = (m) => `${Math.floor(m / 60)}h ${pad(m % 60)}m`

/** One click to delete (ISS-7), with an undo in the toast instead of a confirm step. */
function removeTodo(t) {
  const copy = JSON.parse(JSON.stringify(t))
  deleteTodo(t.id)
  toast(`Deleted ${t.id}`, { label: 'Undo', run: () => state.todos.push(copy) })
}

const blocks = computed(() => blocksForDay(T.value))

const more = ref(pref('life-console/cc-more', '0') === '1')
const setMore = (v) => { more.value = v; save('life-console/cc-more', v ? '1' : '0') }
const vert = ref(pref('life-console/cc-timeline', 'v') === 'v') // vertical is the default
const VZOOMS = { S: 24, M: 40, L: 64 } // px per hour
const vzoom = ref(VZOOMS[pref('life-console/cc-vzoom', 'M')] ? pref('life-console/cc-vzoom', 'M') : 'M')
const vpxh = computed(() => VZOOMS[vzoom.value])
const vscroll = ref(null)
/** Vertical timeline: scroll so "now" (or 08:00 on other days) sits a third of the way down. */
function scrollVert(smooth = false) {
  const el = vscroll.value
  if (!el) return
  const m = isToday.value ? nowMin.value : 8 * 60
  el.scrollTo({ top: Math.max(0, (m / 60) * vpxh.value - el.clientHeight / 3), behavior: smooth ? 'smooth' : 'auto' })
}
function setVZoom(k) {
  vzoom.value = k
  save('life-console/cc-vzoom', k)
  nextTick(() => scrollVert())
}
function setVert(v) {
  vert.value = v
  save('life-console/cc-timeline', v ? 'v' : 'h')
  nextTick(() => scrollVert())
}
onMounted(() => nextTick(() => scrollVert()))
watch(T, () => nextTick(() => scrollVert()))
const firstBlock = computed(() => [...blocks.value].sort((a, b) => toMin(a.start) - toMin(b.start))[0])

/* ── deadlines: the nearest as a headline (DeadlineHero), plus the next four ── */
const allOpenDls = computed(() => openDeadlines())
const nextDl = computed(() => allOpenDls.value[0] ?? null)
const laterDls = computed(() => allOpenDls.value.slice(1, 5))
const hiddenDls = computed(() => Math.max(0, allOpenDls.value.length - 1 - laterDls.value.length))

/* ── telemetry: secondary numbers, coloured only when they need attention ── */
const hours = computed(() => workload(T.value))
const routineCount = computed(() => routineDone(mondayOf(T.value)).length)
const sleep = computed(() => state.sleep[T.value])
const sleptMin = computed(() => { const s = sleep.value; return s ? (toMin(s.wake) - toMin(s.bed) + 1440) % 1440 : 0 })
const mg = computed(() => (state.caffeine[T.value] ?? []).reduce((s, c) => s + c.mg, 0))
const cutoffLeft = computed(() => toMin(state.caffeineCutoff) - nowMin.value)
function addCoffee() {
  if (!state.caffeine[T.value]) state.caffeine[T.value] = []
  state.caffeine[T.value].push({ t: fromMin(nowMin.value), what: 'Coffee', mg: 95 })
  toast(cutoffLeft.value < 0 ? 'Past caffeine cutoff' : `+95mg · ${mg.value}mg today`)
}
/** Reviews / plan checks / lectures only surface when they're due now-ish. */
const alerts = computed(() => [
  ...activePlans().map((p) => ({ id: p.id, text: `Plan ${p.planNo} check`, date: nextCheckDate(p), to: `/strategy/${p.id}` })),
  ...state.reviews.map((r) => ({ id: r.id, text: r.title, date: r.date, to: null })),
].filter((a) => diffDays(T.value, a.date) <= 1).sort((a, b) => a.date.localeCompare(b.date)))
const lectures = computed(() => state.lectures.filter((l) => l.date === T.value))

/* ── adding / scheduling ── */
function dropOnTimeline(id, start) {
  updateTodo(id, { scheduled: { date: T.value, start } })
  toast(`${id} → ${start}`)
}
function dropOnList(e) {
  const t = findTodo(e.dataTransfer.getData(TODO_MIME))
  if (!t || t.scheduled?.date === T.value) return
  if (!t.scheduled) pull(t) // from the backlog column: toast with Undo
  else updateTodo(t.id, { scheduled: { date: T.value, start: null } })
}
/* ── plan the day: pull tasks from the backlog into this day's list, one click each ── */
const planning = ref(false) // the backlog column beside the day's list
watch(T, () => { planning.value = false })
/** A backlog task dropped anywhere on the list (rows included) just joins the day: no reorder, no
 *  priority change. Capture phase, so the rows' own reorder handlers never see it. */
const fromBacklog = () => { const t = ui.dragId && findTodo(ui.dragId); return t && !t.scheduled ? t : null }
/** A timeline item dragged onto the list leaves the timeline but stays on this day's list: a task
 *  just loses its start time; a fixed block becomes a task for the day. Undo in the toast. */
const fromTimeline = () => ui.dragBlock && !ui.dragBlock.group ? ui.dragBlock : null
/** While a timeline item is being dragged, the list and the Backlog button show where it can go. */
const tlDrag = computed(() => fromTimeline()?.kind ?? null) // 'todo' | 'block' | null
const listHot = ref(false)
watch(tlDrag, (k) => { if (!k) listHot.value = btnHot.value = false })
function listDragOverCapture(e) {
  if (!fromBacklog() && !fromTimeline()) return
  listHot.value = !!fromTimeline()
  e.preventDefault()
  e.stopPropagation()
}
function listDropCapture(e) {
  const t = fromBacklog()
  const d = !t && fromTimeline()
  if (!t && !d) return
  e.preventDefault()
  e.stopPropagation()
  endDrag()
  ui.dragBlock = null
  if (t) return pull(t)
  if (d.kind === 'todo') {
    const x = findTodo(d.id)
    if (x?.scheduled?.date === T.value) return unscheduleTodo(d.id, 'time')
    updateTodo(d.id, { scheduled: { date: T.value, start: null } }) // a block from another day's timeline
    return toast(`${d.id} → ${isToday.value ? 'today' : wd(T.value)}`)
  }
  const copy = deleteBlock(d.id)
  if (!copy) return
  const nt = addTodo({ title: copy.title || 'Untitled', timeMin: Math.max(5, toMin(copy.end) - toMin(copy.start)), links: copy.link ? [copy.link] : [], scheduled: { date: T.value, start: null } })
  toast(`${copy.title || 'Block'} → ${nt.id} on ${isToday.value ? "today's" : wd(T.value) + "'s"} list`, { label: 'Undo', run: () => { deleteTodo(nt.id); state.timeBlocks.push(copy) } })
}
/** Dropping a day task on the backlog column sends it back (Undo in the toast). */
const blHot = ref(false)
const btnHot = ref(false)
/** The Backlog button takes drops too, so a task can go back without opening the column first. */
function overBacklogBtn(e) {
  if (!e.dataTransfer.types.includes(TODO_MIME)) return
  e.preventDefault()
  btnHot.value = true
}
function dropOnBacklog(e) {
  blHot.value = btnHot.value = false
  const t = findTodo(e.dataTransfer.getData(TODO_MIME))
  if (!t?.scheduled) return
  const prev = { ...t.scheduled }
  updateTodo(t.id, { scheduled: null })
  toast(`${t.id} back to the backlog`, { label: 'Undo', run: () => updateTodo(t.id, { scheduled: prev }) })
}
const backlog = computed(() => state.todos.filter((t) => !t.done && !t.scheduled && isLeaf(t)).sort(byPriority))
const backlogMin = computed(() => backlog.value.reduce((s, t) => s + (t.timeMin || 0), 0))
function pull(t) {
  updateTodo(t.id, { scheduled: { date: T.value, start: null } })
  toast(`${t.id} → ${isToday.value ? 'today' : wd(T.value)} · ${hours.value.toFixed(1)}/${CAPACITY_H}h`, { label: 'Undo', run: () => updateTodo(t.id, { scheduled: null }) })
}

const quick = ref('')
function quickAdd() {
  const p = parseQuick(quick.value)
  if (!p.title) return
  const t = addTodo({ title: p.title, links: p.links, due: p.due, timeMin: p.timeMin ?? 30, priority: p.priority ?? 3, lsd: p.lsd ?? 'S', scheduled: { date: T.value, start: null } })
  ui.selectedId = t.id
  quick.value = ''
}
</script>

<template>
  <div class="cc">
    <!-- 1 · NOW, full width (next block as a hint inside it) -->
    <NowCard v-if="isToday" />
    <section v-else class="panel inst preview">
      <div class="inst-lbl"><span class="tiny upper info">Day view · {{ relDay(T, today) }}</span></div>
      <div class="pv-title">{{ wd(T) }} {{ fmtSlash(T) }}</div>
      <div class="small muted mono">
        {{ blocks.length }} blocks · {{ pending.length }} todos · {{ hours.toFixed(1) }}h planned
        <template v-if="firstBlock"> · first {{ firstBlock.start }} {{ firstBlock.title }}</template>
      </div>
      <div class="row">
        <button class="btn" @click="router.push('/')"><span class="icon sm">today</span>Back to today <span class="kbd">T</span></button>
        <button class="btn" @click="openWeek"><span class="icon sm">calendar_month</span>Plan week</button>
      </div>
    </section>

    <!-- 2 + 3 · the shape of the day and what's left: stacked (horizontal strip) or side by side (vertical) -->
    <div class="day" :class="{ vert }">
      <section class="panel tl-panel">
        <div class="panel-h">
          <button class="btn icon-only sm" title="Previous day ( [ )" @click="goDay(-1)"><span class="icon sm">chevron_left</span></button>
          <h2 class="mono dayname">{{ isToday ? 'Today' : wd(T) }} {{ fmtSlash(T) }}</h2>
          <button class="btn icon-only sm" title="Next day ( ] )" @click="goDay(1)"><span class="icon sm">chevron_right</span></button>
          <button class="chip weekchip" title="Open this week in Plan week" @click="openWeek">W{{ isoWeek(T) }}</button>
          <span class="spacer"></span>
          <div class="seg" title="Timeline direction">
            <button class="btn sm icon-only" :class="{ active: !vert }" title="Horizontal timeline" @click="setVert(false)"><span class="icon sm">view_column</span></button>
            <button class="btn sm icon-only" :class="{ active: vert }" title="Vertical timeline" @click="setVert(true)"><span class="icon sm">view_agenda</span></button>
          </div>
          <button v-if="touchUI" class="btn sm icon-only lockbtn" :class="{ active: ui.scheduleLock }" :title="ui.scheduleLock ? LOCK_HELP.on : LOCK_HELP.off" :aria-label="ui.scheduleLock ? LOCK_HELP.on : LOCK_HELP.off" @click="setScheduleLock(!ui.scheduleLock)"><span class="icon sm">{{ ui.scheduleLock ? 'lock' : 'lock_open' }}</span></button>
        </div>
        <template v-if="vert">
          <div class="vctrl">
            <span class="tiny upper muted">Zoom</span>
            <button v-for="(_, k) in VZOOMS" :key="k" class="btn sm" :class="{ active: vzoom === k }" @click="setVZoom(k)">{{ k }}</button>
            <span class="spacer"></span>
            <button v-if="isToday" class="btn sm" title="Scroll to now" @click="scrollVert(true)"><span class="icon sm">my_location</span>Now</button>
          </div>
          <div ref="vscroll" class="vscroll" :class="'z-' + vzoom">
            <DayTimeline :date="T" :blocks="blocks" :from="0" :to="24" :pxh="vpxh" @drop-todo="dropOnTimeline" @open="(id) => (ui.drawerId = id)" @edit="(b) => (ui.blockId = b.id)" />
          </div>
        </template>
        <div v-else class="panel-b tl-b">
          <Timeline24 :date="T" :blocks="blocks" @drop-todo="dropOnTimeline" @open="(id) => (ui.drawerId = id)" @edit="(b) => (ui.blockId = b.id)" />
        </div>
      </section>

      <div class="side">
      <!-- deadline sits above the list: second only to NOW -->
      <section class="panel inst dl-inst" :class="nextDl ? 'u-' + urgency(effDue(nextDl)) : ''">
        <template v-if="nextDl">
          <DeadlineHero :d="nextDl" />
          <!-- then the next four -->
          <div class="dl-list">
            <button v-for="d in laterDls" :key="d.id" class="dl-row" @click="ui.deadlineId = d.id">
              <span class="mono cd" :class="urgency(effDue(d))">{{ minsTo(effDue(d)) <= 0 ? 'overdue' : countdown(effDue(d)) }}</span>
              <span class="ellipsis grow">{{ d.title }}</span>
              <span class="mono small muted when">{{ relDay(d.due.slice(0, 10), today) }} · {{ d.due.slice(11) }}</span>
            </button>
          </div>
          <router-link v-if="hiddenDls" to="/deadlines" class="mono small muted more-dl">+{{ hiddenDls }} more on Deadlines →</router-link>
        </template>
        <template v-else>
          <div class="inst-lbl"><router-link to="/deadlines" class="tiny upper muted">Next deadline</router-link></div>
          <div class="inst-big mono muted">—</div>
        </template>
      </section>

      <section class="panel todo-panel">
        <div class="panel-h">
          <span class="icon sm ok">checklist</span>
          <h2><router-link to="/todos" class="title-link">{{ isToday ? 'Left today' : `Todos · ${wd(T)}` }}</router-link></h2>
          <span class="mono small muted">{{ pending.length }} open · {{ fmtH(remainingMin) }} left</span>
          <span class="spacer"></span>
          <button v-if="T >= today" class="btn sm plan-btn" :class="{ active: planning, 'drop-ready': tlDrag === 'todo', 'drop-hot': btnHot }" :aria-pressed="planning" :title="planning ? 'Hide the backlog · drop a task here to send it back' : `Show the backlog beside the list: drag or click tasks into ${isToday ? 'today' : wd(T)} · drop a task here to send it back`" @click="planning = !planning" @dragover="overBacklogBtn" @dragleave="btnHot = false" @drop.prevent="dropOnBacklog">
            <span class="icon sm">inventory_2</span>{{ tlDrag === 'todo' ? 'Drop: back to backlog' : 'Backlog' }}<span v-if="backlog.length" class="mono n">{{ backlog.length }}</span>
          </button>
          <button v-if="done.length" class="btn sm ghost-btn" @click="showDone = !showDone">{{ showDone ? 'Hide' : 'Show' }} {{ done.length }} done</button>
          <span class="load" :title="`Workload: ${hours.toFixed(1)}h planned of ${CAPACITY_H}h (${fmtH(doneMin)} done)`">
            <span class="mono tiny" :class="loadLevel === 'ok' ? 'muted' : loadLevel">{{ hours.toFixed(1) }}/{{ CAPACITY_H }}h</span>
            <span class="load-bar" :class="loadLevel">
              <i class="fill done-part" :style="{ height: pctOf(doneMin) + '%' }"></i>
              <i class="fill" :style="{ bottom: pctOf(doneMin) + '%', height: Math.max(0, Math.min(pctOf(doneMin + remainingMin), 100) - pctOf(doneMin)) + '%' }"></i>
            </span>
          </span>
        </div>
        <div class="tp-body" :class="{ split: planning }">
          <div class="tp-main">
            <div class="list" :class="{ 'tl-drop': tlDrag, 'tl-hot': listHot }" @dragleave="(e) => { if (!e.currentTarget.contains(e.relatedTarget)) listHot = false }" @dragover.capture="listDragOverCapture" @drop.capture="listDropCapture" @dragover.prevent @drop.prevent="dropOnList">
              <div v-if="tlDrag" class="tl-hint"><span class="icon sm">{{ tlDrag === 'todo' ? 'schedule' : 'add_task' }}</span>{{ tlDrag === 'todo' ? `Drop here to unschedule · stays on ${isToday ? "today's" : wd(T) + "'s"} list` : `Drop here to make it a task for ${isToday ? 'today' : wd(T)}` }}</div>
              <TodoRow v-for="t in pending" :key="t.id" :todo="t" compact adopt-date show-start show-prio removable :show-links="false" @remove="removeTodo" />
              <template v-if="showDone">
                <TodoRow v-for="t in done" :key="t.id" :todo="t" compact adopt-date show-start show-prio removable :show-links="false" @remove="removeTodo" />
              </template>
              <div v-if="!pending.length" class="empty">{{ todos.length ? 'All done for the day.' : planning ? 'Drag tasks here from the backlog.' : 'Nothing planned. Add one below or pull from the backlog.' }}</div>
            </div>
            <form class="qa" @submit.prevent="quickAdd">
              <span class="mono ok">+</span>
              <input v-model="quick" class="input ghost mono grow" :placeholder="`Add to ${isToday ? 'today' : wd(T) + ' ' + fmtSlash(T)}: Review notes 20m @CASE1 p2`" />
            </form>
          </div>
          <aside v-if="planning" class="bl-col" :class="{ 'drop-hot': blHot }" @dragover.prevent="blHot = true" @dragleave="blHot = false" @drop.prevent="dropOnBacklog">
            <div class="bl-h tiny upper muted"><span class="grow">Backlog</span><span class="mono">{{ backlog.length }} · {{ fmtH(backlogMin) }}</span><button class="bl-x" title="Hide the backlog" aria-label="Hide the backlog" @click="planning = false"><span class="icon sm">close</span></button></div>
            <div class="bl-list">
              <div
                v-for="t in backlog" :key="t.id" class="bl-row" :class="{ dragging: ui.dragId === t.id }" draggable="true" role="button" tabindex="0"
                :title="`Drag into the list or onto the schedule, or click to add ${t.id} to ${isToday ? 'today' : wd(T)}`"
                @dragstart="startDrag($event, t)" @dragend="endDrag" @click="pull(t)" @keydown.enter="pull(t)"
              >
                <span class="icon sm grip">drag_indicator</span>
                <Prio :p="t.priority" />
                <span class="ellipsis grow">{{ t.title }}</span>
                <span v-if="t.due" class="mono small due" :class="t.due <= T ? 'warn' : 'muted'">{{ relDay(t.due, T).toLowerCase() }}</span>
                <span class="mono small muted">{{ t.timeMin }}m</span>
              </div>
              <div v-if="!backlog.length" class="empty">Backlog clear ✓</div>
            </div>
          </aside>
        </div>
      </section>

      </div>
    </div>


    <!-- 4 · telemetry: one quiet line, pinned to the bottom of the page -->
    <footer class="panel telemetry mono small">
      <span class="tm seals" title="Daily seals 印 → 印 → 確認 → 完 (S stamps the next)"><span class="muted">SEALS</span> <Stamps :date="T" :size="22" /></span>
      <span class="tm" title="Sleep the night before"><span class="muted">SLEEP</span>
        <b v-if="sleep" :class="{ warn: sleptMin < sleep.targetMin }">{{ Math.floor(sleptMin / 60) }}h{{ pad(sleptMin % 60) }}</b><span v-else class="muted">—</span>
      </span>
      <span class="tm" title="Caffeine today"><span class="muted">CAF</span>
        <b :class="{ danger: mg > state.caffeineLimit, warn: isToday && cutoffLeft < 0 && mg > 0 }">{{ mg }}</b><span class="muted">/{{ state.caffeineLimit }}mg</span>
        <button v-if="isToday" class="btn sm icon-only" :title="cutoffLeft > 0 ? `Add a coffee (95mg) · cutoff ${state.caffeineCutoff}` : `Cutoff ${state.caffeineCutoff} passed`" @click="addCoffee"><span class="icon sm">coffee</span></button>
      </span>
      <router-link to="/week" class="tm" title="Weekly routines done"><span class="muted">ROUTINES</span> <b>{{ routineCount }}</b><span class="muted">/{{ state.routines.length }}</span></router-link>
      <span class="spacer"></span>
      <template v-for="a in alerts" :key="a.id">
        <router-link v-if="a.to" :to="a.to" class="tm alert">{{ a.text }} · {{ relDay(a.date, T) }}</router-link>
        <span v-else class="tm alert">{{ a.text }} · {{ relDay(a.date, T) }}</span>
      </template>
      <span v-for="l in lectures" :key="l.id" class="tm alert info" :title="`#${l.no} ${l.title}`">{{ l.time }} {{ l.course }}<template v-if="!l.readAhead"> · read ahead</template></span>
      <button class="btn sm more-btn" :aria-expanded="more" @click="setMore(!more)">{{ more ? 'Less' : 'More' }}<span class="icon sm">{{ more ? 'expand_less' : 'expand_more' }}</span></button>
    </footer>

    <!-- 5 · the full briefing, on demand -->
    <CommandCenterMore v-if="more" :date="T" :is-today="isToday" />
  </div>
</template>

<style scoped>
.cc { display: flex; flex-direction: column; gap: 12px; padding: 16px; min-height: 100%; box-sizing: border-box; }
.telemetry { margin-top: auto; }
.preview { border-left: 3px solid var(--info); }
.pv-title { font: 600 24px/30px Inter, sans-serif; }
/* deadline instrument */
.dl-inst { border-left: 3px solid var(--border); }
.dl-inst.u-warn { border-left-color: var(--warn); }
.dl-inst.u-danger { border-left-color: var(--danger); background: color-mix(in srgb, var(--danger) 5%, var(--surface)); }
.dl-row { border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; padding: 0; }
.dl-list { display: flex; flex-direction: column; }
.dl-row { display: flex; align-items: center; gap: 12px; height: 38px; flex: none; border-top: 1px solid var(--border); font-size: 15px; min-width: 0; }
.dl-row .cd { flex: none; min-width: 72px; font-size: 15px; font-weight: 600; }
.dl-row .when { flex: none; }
.dl-row:hover .grow { color: var(--accent); }
.more-dl { align-self: flex-end; }
.more-dl:hover { color: var(--accent); }
/* timeline + list */
.day { display: flex; flex-direction: column; gap: 12px; }
/* the day row takes all spare height, so nothing leaves a gap above the footer */
.day.vert { flex: 1 0 auto; }
.day.vert { display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); align-items: stretch; }
/* the schedule takes the right column's height (deadline + list), never less than ~8 hours at M zoom */
.vert .vscroll { flex: 1 1 0; height: auto; min-height: 340px; }
/* horizontal strip: deadline and list side by side under it */
.day:not(.vert) .side { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); align-items: start; }
/* right column hugs its content: no empty box under the list */
.side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dayname { min-width: 92px; text-align: center; }
.weekchip { cursor: pointer; }
.weekchip:hover { border-color: var(--accent); }
.seg { display: flex; gap: 2px; }
.lockbtn.active { border-color: var(--accent); color: var(--accent); }
.tl-b { padding: 8px 12px 12px; }
.vscroll { height: 520px; overflow-y: auto; padding: 6px 10px 6px 6px; }
.vscroll :deep(.vb) { font-size: 12px; line-height: 15px; padding: 3px 6px; }
.vscroll :deep(.vb .t) { font-size: 11px; }
.vscroll :deep(.hr span) { font-size: 11px; }
.todo-panel { min-width: 0; }
/* vertical layout: Left today stretches to the bottom of the column; the add line stays at its foot */
.vert .todo-panel { flex: 1 1 auto; }
.vert .todo-panel .tp-body { flex: 1 1 auto; }
.vert .todo-panel .list { flex: 1 1 0; max-height: none; min-height: 140px; }
.day:not(.vert) .bl-list { max-height: 420px; }
.vctrl { display: flex; align-items: center; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--border); }
.vscroll.z-S :deep(.vb) { font-size: 11px; line-height: 13px; padding: 1px 6px; }
.vscroll.z-S :deep(.vb .t) { font-size: 10px; }
/* workload: a small vertical meter tucked into the right end of the "Left today" header */
.load { display: inline-flex; align-items: center; gap: 6px; margin-left: 4px; }
.load-bar { position: relative; width: 6px; height: 18px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 1px; overflow: hidden; }
.load-bar .fill { position: absolute; left: 0; right: 0; bottom: 0; background: var(--muted); }
.load-bar .fill.done-part { opacity: 0.45; }
.load-bar.warn .fill { background: var(--warn); }
.load-bar.danger .fill { background: var(--danger); }
.list { position: relative; min-height: 60px; max-height: 420px; overflow: auto; }
/* readable rows: the shared compact row is 11px, too small for the main list */
.list :deep(.trow.compact) { font-size: 15px; min-height: 46px; gap: 10px; padding: 6px 12px; }
.list :deep(.trow.compact .time) { font-size: 13px; }
.list :deep(.trow .start) { font-size: 13px; width: 46px; }
.list :deep(.trow .prio) { font-size: 12px; padding: 1px 5px; }
.list :deep(.trow .rm .icon) { font-size: 18px; }
.qa { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.qa input { font-size: 14px; }
.ghost-btn { color: var(--muted); }
/* plan the day: the backlog as a column beside the day's list */
.plan-btn { gap: 4px; }
.plan-btn.active { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.plan-btn .n { color: var(--muted); }
.plan-btn.active .n { color: inherit; }
.bl-x { display: flex; border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; margin-left: 8px; }
.bl-x:hover { color: var(--text); }
.tp-body { display: flex; min-height: 0; }
.tp-main { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; }
.tp-body.split .tp-main { flex: 3 1 0; }
.bl-col { display: flex; flex-direction: column; flex: 2 1 0; min-width: 220px; border-left: 1px solid var(--border); background: var(--surface-2); }
.bl-col.drop-hot { box-shadow: inset 0 0 0 1px var(--accent); }
.plan-btn.drop-ready { outline: 1px dashed var(--info); outline-offset: 1px; }
.plan-btn.drop-hot { box-shadow: 0 0 0 1px var(--accent); }
/* a timeline item being dragged: the list is a drop zone that says what a drop does */
.list.tl-drop { outline: 1px dashed var(--info); outline-offset: -1px; }
.list.tl-hot { background: color-mix(in srgb, var(--info) 6%, transparent); }
.tl-hint { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-size: 14px; color: var(--info); background: var(--surface); border-bottom: 1px dashed var(--info); pointer-events: none; }
.list.tl-hot .tl-hint { background: color-mix(in srgb, var(--info) 12%, var(--surface)); }
.bl-h { display: flex; align-items: center; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--border); }
.bl-list { flex: 1 1 0; min-height: 140px; overflow: auto; }
.bl-row { display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 6px 10px 6px 6px; border-bottom: 1px solid var(--border); font-size: 15px; cursor: grab; }
.bl-row:hover { background: var(--surface); }
.bl-row:hover .grow { color: var(--accent); }
.bl-row.dragging { opacity: 0.4; }
.bl-row .grip { color: var(--muted); font-size: 18px; }
.bl-row .due { flex: none; }
.bl-row .prio { font-size: 12px; padding: 1px 5px; }
/* telemetry strip */
.telemetry { flex-direction: row; align-items: center; flex-wrap: wrap; gap: 6px 18px; padding: 8px 14px; color: var(--text); font-size: 12px; }
.more-btn { gap: 2px; }
.tm { display: inline-flex; align-items: center; gap: 4px; color: inherit; white-space: nowrap; }
a.tm:hover { color: var(--accent); }
.tm b { font-weight: 700; }
.alert { color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 50%, transparent); border-radius: 2px; padding: 1px 6px; }
.alert.info { color: var(--info); border-color: color-mix(in srgb, var(--info) 50%, transparent); }
@media (max-width: 1100px) {
  .day.vert { grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); }
}
@media (max-width: 700px) {
  .cc { padding: 12px; }
  .list :deep(.trow.compact) { font-size: 14px; }
  .inst-big { font-size: 24px; line-height: 28px; }
  /* on a phone the list of what's left beats the horizontal strip */
  .day, .day.vert { display: flex; flex-direction: column; align-items: stretch; }
  .side, .day:not(.vert) .side { display: contents; }
  .dl-inst { order: 1; } .todo-panel { order: 2; } .tl-panel { order: 3; }
  .dl-row .when { display: none; }
  .todo-panel .panel-h { flex-wrap: wrap; row-gap: 6px; }
  .todo-panel .panel-h > * { white-space: nowrap; }
  /* no room side by side: the backlog stacks under the day's list */
  .tp-body.split { flex-direction: column; }
  .bl-col { min-width: 0; border-left: 0; border-top: 1px solid var(--border); }
  .bl-list { flex: none; max-height: 50vh; }
  .vscroll, .vert .vscroll { flex: none; height: 420px; }
}
</style>
