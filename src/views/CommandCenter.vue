<script setup>
// S-01 · Command Center — a driver's console for today, and (S-11) a day view for any date via /day/:date.
// Order = priority: what to do NOW (with what's next as a hint) · time to the next DEADLINES · the rest of TODAY.
// Everything else is one quiet telemetry strip at the bottom, and only exceptions get colour.
import { computed, ref, watch, watchEffect, nextTick, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  state, ui, todayISO, wd, isoWeek, todosForDay, blocksForDay, workload, CAPACITY_H,
  diffDays, relDay, toMin, fromMin, pad, mondayOf, routineDone, nextCheckDate, activePlans,
  updateTodo, addTodo, deleteTodo, parseQuick, toast, addDays, fmtSlash,
} from '../store'
import Timeline24 from '../components/Timeline24.vue'
import TodoRow from '../components/TodoRow.vue'
import Stamps from '../components/Stamps.vue'
import NowCard from '../components/NowCard.vue'
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

/* ── deadlines: a countdown to the nearest, plus the two after it ── */
const openDeadlines = computed(() => state.deadlines.filter((d) => !d.done).sort((a, b) => a.due.localeCompare(b.due)))
const nextDl = computed(() => openDeadlines.value[0] ?? null)
const laterDls = computed(() => openDeadlines.value.slice(1, 4))
const minsTo = (d) => { void ui.now; return Math.round((new Date(d.due) - ui.now) / 60000) }
function countdown(d) {
  const m = minsTo(d)
  const a = Math.abs(m)
  const s = a < 60 ? `${a}m` : a < 1440 ? `${Math.floor(a / 60)}h ${pad(a % 60)}m` : `${Math.floor(a / 1440)}d ${Math.floor((a % 1440) / 60)}h`
  return m < 0 ? `−${s}` : s
}
const urgency = (d) => { const m = minsTo(d); return m <= 0 ? 'danger' : m <= 720 ? 'danger' : m <= 2880 ? 'warn' : 'ok' }

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
  const id = e.dataTransfer.getData('text/x-todo')
  if (id) updateTodo(id, { scheduled: { date: T.value, start: null } })
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
    <!-- 1 · instruments: NOW · NEXT · DEADLINE -->
    <div class="cockpit">
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

      <section class="panel inst dl-inst" :class="nextDl ? 'u-' + urgency(nextDl) : ''">
        <div class="inst-lbl"><router-link to="/deadlines" class="tiny upper muted">Next deadline</router-link></div>
        <template v-if="nextDl">
          <button class="dl-main" title="Open the deadline" @click="ui.deadlineId = nextDl.id">
            <span class="inst-big mono" :class="urgency(nextDl)">{{ minsTo(nextDl) <= 0 ? 'OVERDUE' : countdown(nextDl) }}</span>
            <span class="name clamp2">{{ nextDl.title }}</span>
            <span class="mono small muted">{{ relDay(nextDl.due.slice(0, 10), today) }} · {{ nextDl.due.slice(11) }}<template v-if="minsTo(nextDl) <= 0"> · {{ countdown(nextDl).slice(1) }} ago</template></span>
          </button>
          <button v-for="d in laterDls" :key="d.id" class="dl-row" @click="ui.deadlineId = d.id">
            <span class="mono small" :class="urgency(d)">{{ minsTo(d) <= 0 ? 'overdue' : countdown(d) }}</span>
            <span class="ellipsis grow">{{ d.title }}</span>
          </button>
        </template>
        <div v-else class="inst-big mono muted">—</div>
      </section>
    </div>

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
        </div>
        <template v-if="vert">
          <div class="vctrl">
            <span class="tiny upper muted">Zoom</span>
            <button v-for="(_, k) in VZOOMS" :key="k" class="btn sm" :class="{ active: vzoom === k }" @click="setVZoom(k)">{{ k }}</button>
            <span class="spacer"></span>
            <button v-if="isToday" class="btn sm" title="Scroll to now" @click="scrollVert(true)"><span class="icon sm">my_location</span>Now</button>
          </div>
          <div ref="vscroll" class="vscroll" :class="'z-' + vzoom">
            <DayTimeline :date="T" :blocks="blocks" :from="0" :to="24" :pxh="vpxh" @drop-todo="dropOnTimeline" @open="(id) => (ui.drawerId = id)" />
          </div>
        </template>
        <div v-else class="panel-b tl-b">
          <Timeline24 :date="T" :blocks="blocks" @drop-todo="dropOnTimeline" @open="(id) => (ui.drawerId = id)" />
        </div>
      </section>

      <div class="side">
      <section class="panel todo-panel">
        <div class="panel-h">
          <span class="icon sm ok">checklist</span>
          <h2><router-link to="/todos" class="title-link">{{ isToday ? 'Left today' : `Todos · ${wd(T)}` }}</router-link></h2>
          <span class="mono small muted">{{ pending.length }} open · {{ fmtH(remainingMin) }} left</span>
          <span class="spacer"></span>
          <button v-if="done.length" class="btn sm ghost-btn" @click="showDone = !showDone">{{ showDone ? 'Hide' : 'Show' }} {{ done.length }} done</button>
          <span class="load" :title="`Workload: ${hours.toFixed(1)}h planned of ${CAPACITY_H}h (${fmtH(doneMin)} done)`">
            <span class="mono tiny" :class="loadLevel === 'ok' ? 'muted' : loadLevel">{{ hours.toFixed(1) }}/{{ CAPACITY_H }}h</span>
            <span class="load-bar" :class="loadLevel">
              <i class="fill done-part" :style="{ height: pctOf(doneMin) + '%' }"></i>
              <i class="fill" :style="{ bottom: pctOf(doneMin) + '%', height: Math.max(0, Math.min(pctOf(doneMin + remainingMin), 100) - pctOf(doneMin)) + '%' }"></i>
            </span>
          </span>
        </div>
        <div class="list" @dragover.prevent @drop.prevent="dropOnList">
          <TodoRow v-for="t in pending" :key="t.id" :todo="t" compact adopt-date show-start show-prio removable :show-links="false" @remove="removeTodo" />
          <template v-if="showDone">
            <TodoRow v-for="t in done" :key="t.id" :todo="t" compact adopt-date show-start show-prio removable :show-links="false" @remove="removeTodo" />
          </template>
          <div v-if="!pending.length" class="empty">{{ todos.length ? 'All done for the day.' : 'Nothing planned. Add one below or drag from the inbox.' }}</div>
        </div>
        <form class="qa" @submit.prevent="quickAdd">
          <span class="mono ok">+</span>
          <input v-model="quick" class="input ghost mono grow" :placeholder="`Add to ${isToday ? 'today' : wd(T) + ' ' + fmtSlash(T)}: Review notes 20m @SIG-01.1 p2`" />
        </form>
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
.cc { display: flex; flex-direction: column; gap: 12px; padding: 16px; max-width: 1600px; min-height: 100%; box-sizing: border-box; }
.telemetry { margin-top: auto; }
.cockpit { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 12px; }
.preview { border-left: 3px solid var(--info); }
.pv-title { font: 600 24px/30px Inter, sans-serif; }
/* deadline instrument */
.dl-inst { border-left: 3px solid var(--border); }
.dl-inst.u-warn { border-left-color: var(--warn); }
.dl-inst.u-danger { border-left-color: var(--danger); background: color-mix(in srgb, var(--danger) 5%, var(--surface)); }
.dl-main, .dl-row { border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; padding: 0; }
.dl-main { display: flex; flex-direction: column; gap: 4px; }
.dl-main:hover .name { text-decoration: underline dotted; }
.dl-inst .inst-big { font-size: 38px; line-height: 42px; }
.dl-inst .name { font-weight: 600; font-size: 18px; line-height: 24px; }
.dl-row { display: flex; align-items: baseline; gap: 10px; border-top: 1px solid var(--border); padding-top: 7px; font-size: 14px; min-width: 0; }
.dl-row .mono { flex: none; min-width: 64px; font-size: 14px; font-weight: 600; }
.dl-row:hover .grow { color: var(--accent); }
/* timeline + list */
.day { display: flex; flex-direction: column; gap: 12px; }
.day.vert { display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); align-items: start; }
/* right column hugs its content: no empty box under the list */
.side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dayname { min-width: 92px; text-align: center; }
.weekchip { cursor: pointer; }
.weekchip:hover { border-color: var(--accent); }
.seg { display: flex; gap: 2px; }
.tl-b { padding: 8px 12px 12px; }
.vscroll { height: 520px; overflow-y: auto; padding: 6px 10px 6px 6px; }
.vscroll :deep(.vb) { font-size: 12px; line-height: 15px; padding: 3px 6px; }
.vscroll :deep(.vb .t) { font-size: 11px; }
.vscroll :deep(.hr span) { font-size: 11px; }
.todo-panel { min-width: 0; }
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
.list { min-height: 60px; max-height: 420px; overflow: auto; }
/* readable rows: the shared compact row is 11px, too small for the main list */
.list :deep(.trow.compact) { font-size: 15px; min-height: 46px; gap: 10px; padding: 6px 12px; }
.list :deep(.trow.compact .time) { font-size: 13px; }
.list :deep(.trow .start) { font-size: 13px; width: 46px; }
.list :deep(.trow .prio) { font-size: 12px; padding: 1px 5px; }
.list :deep(.trow .rm .icon) { font-size: 18px; }
.qa { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.qa input { font-size: 14px; }
.ghost-btn { color: var(--muted); }
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
  .cockpit { gap: 8px; grid-template-columns: minmax(0, 1fr); }
  .list :deep(.trow.compact) { font-size: 14px; }
  .inst-big { font-size: 24px; line-height: 28px; }
  /* on a phone the list of what's left beats the horizontal strip */
  .day, .day.vert { display: flex; flex-direction: column; align-items: stretch; }
  .side { display: contents; }
  .todo-panel { order: 1; } .tl-panel { order: 2; }
  .vscroll { height: 420px; }
}
</style>
