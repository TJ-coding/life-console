<script setup>
// S-01 · Command Center — the morning briefing for today, and (S-11) a day view for any date via /day/:date.
import { computed, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  state, ui, todayISO, wd, isoWeek, todosForDay, blocksForDay, workload, getStamps, STAMPS, CAPACITY_H,
  psgPct, nextSig, diffDays, relDay, toMin, fromMin, pad, mondayOf, routineDone, monthGroup,
  nextCheckDate, nextPlanCheck, activePlans, updateTodo, addTodo, parseQuick, toast, addDays, fmtSlash,
} from '../store'
import Timeline24 from '../components/Timeline24.vue'
import TodoRow from '../components/TodoRow.vue'
import Gauge from '../components/Gauge.vue'
import Stamps from '../components/Stamps.vue'
import Chip from '../components/Chip.vue'
import Prio from '../components/Prio.vue'
import NowCard from '../components/NowCard.vue'
import DeadlineQuickAdd from '../components/DeadlineQuickAdd.vue'

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
const untimed = computed(() => todos.value.filter((t) => !t.done && !t.scheduled.start))
const firstBlock = computed(() => [...blocks.value].sort((a, b) => toMin(a.start) - toMin(b.start))[0])
const dayLabel = computed(() => (isToday.value ? "Today's" : `${wd(T.value)}`))
const todos = computed(() => todosForDay(T.value))
watchEffect(() => { ui.visibleIds = todos.value.map((t) => t.id) })
const blocks = computed(() => blocksForDay(T.value))
const hours = computed(() => workload(T.value))
const stage = computed(() => getStamps(T.value).filter(Boolean).length)
const totalMin = computed(() => todos.value.filter((t) => !t.done).reduce((s, t) => s + t.timeMin, 0))
const nowMin = computed(() => ui.now.getHours() * 60 + ui.now.getMinutes())

const deadlines = computed(() =>
  state.deadlines.filter((d) => !d.done && diffDays(T.value, d.due) <= 7).sort((a, b) => a.due.localeCompare(b.due)))
const psgs = computed(() =>
  activePlans().flatMap((pl) => pl.psgs.map((p) => ({ ...p, plan: pl.id, planNo: pl.planNo })))
    .sort((a, b) => a.priority - b.priority).slice(0, 3).map((p) => ({ ...p, pct: psgPct(p.no), next: nextSig(p.no) })))

const week = computed(() => mondayOf(T.value))
const routineCount = computed(() => routineDone(week.value).length)
const group = computed(() => monthGroup(T.value))

const sleep = computed(() => state.sleep[T.value])
const sleptMin = computed(() => {
  const s = sleep.value
  if (!s) return 0
  return (toMin(s.wake) - toMin(s.bed) + 1440) % 1440
})
const delta = (actual, target) => {
  const d = toMin(actual) - toMin(target)
  return `${d >= 0 ? '+' : '−'}${Math.abs(d)}m`
}

const caffeine = computed(() => state.caffeine[T.value] ?? [])
const mg = computed(() => caffeine.value.reduce((s, c) => s + c.mg, 0))
const cutoffLeft = computed(() => toMin(state.caffeineCutoff) - nowMin.value)
function addCaffeine(what, amount) {
  if (!state.caffeine[T.value]) state.caffeine[T.value] = []
  state.caffeine[T.value].push({ t: fromMin(nowMin.value), what, mg: amount })
  if (cutoffLeft.value < 0) toast('Past caffeine cutoff')
}

const reviews = computed(() =>
  [...activePlans().map((p) => ({ id: p.id, title: `Plan ${p.planNo} check`, date: nextCheckDate(p), to: `/strategy/${p.id}` })), ...state.reviews]
    .sort((a, b) => a.date.localeCompare(b.date)))
const lectures = computed(() => state.lectures.filter((l) => l.date === T.value))

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
const pctClass = (n) => (n >= 70 ? '' : n >= 40 ? 'info' : 'warn')
</script>

<template>
  <div class="cc">
    <!-- header strip -->
    <section class="panel head">
      <div class="daynav">
        <button class="btn icon-only" title="Previous day ( [ )" @click="goDay(-1)"><span class="icon">chevron_left</span></button>
        <div class="date mono">{{ T }} <span :class="isToday ? 'ok' : 'info'">{{ wd(T) }}</span></div>
        <button class="btn icon-only" title="Next day ( ] )" @click="goDay(1)"><span class="icon">chevron_right</span></button>
      </div>
      <span v-if="!isToday" class="chip course">{{ relDay(T, today) }}</span>
      <button v-if="!isToday" class="btn sm" @click="router.push('/')"><span class="icon sm">today</span>Today <span class="kbd">T</span></button>
      <button class="chip weekchip" title="Open this week in Plan week" @click="openWeek">WEEK {{ isoWeek(T) }}</button>
      <div class="sep"></div>
      <div class="kv">
        <div class="tiny upper muted">Workload</div>
        <div class="mono">{{ hours.toFixed(1) }}h / {{ CAPACITY_H }}.0h <span :class="hours > CAPACITY_H ? 'warn' : 'ok'">{{ Math.round((hours / CAPACITY_H) * 100) }}%</span></div>
      </div>
      <div class="kv">
        <div class="tiny upper muted">Sign-off</div>
        <div class="mono"><span class="stampc">{{ stage ? STAMPS[stage - 1] : '—' }}</span> stage {{ stage }}/4</div>
      </div>
      <div class="kv">
        <div class="tiny upper muted">Next plan check</div>
        <div v-if="nextPlanCheck()" class="mono">{{ nextPlanCheck().date }} <span class="muted">({{ relDay(nextPlanCheck().date, T) }} · {{ nextPlanCheck().plan.planNo }})</span></div>
        <div v-else class="mono muted">no active plan</div>
      </div>
    </section>

    <!-- right now -->
    <NowCard v-if="isToday" class="c12" />
    <section v-else class="panel c12 preview">
      <span class="icon info">event</span>
      <div class="grow">
        <div class="tiny upper muted">Day view · {{ relDay(T, today) }}</div>
        <div class="pv-title">{{ wd(T) }} {{ fmtSlash(T) }} — {{ blocks.length }} blocks, {{ todos.length }} tasks, {{ hours.toFixed(1) }}h planned</div>
        <div class="small muted mono">
          <template v-if="firstBlock">first: {{ firstBlock.start }} {{ firstBlock.title }}</template><template v-else>no blocks yet</template>
          <template v-if="untimed.length"> · <span class="warn">{{ untimed.length }} without a time</span></template>
        </div>
      </div>
      <button class="btn" @click="openWeek"><span class="icon sm">calendar_month</span>Plan week</button>
      <button class="btn" @click="router.push('/')"><span class="icon sm">today</span>Back to today</button>
    </section>

    <!-- row 1 -->
    <section class="panel c8">
      <div class="panel-h">
        <span class="icon sm ok">timeline</span><h2><a href="#" class="title-link" @click.prevent="openWeek">{{ dayLabel }} timeline</a></h2>
        <span class="spacer"></span>
        <div class="legend">
          <span class="cat-research"><i></i>Research</span><span class="cat-academic"><i></i>Academic</span>
          <span class="cat-experiment"><i></i>Experiment</span><span class="cat-kaizen"><i></i>Kaizen</span>
        </div>
      </div>
      <div class="panel-b">
        <Timeline24 :date="T" :blocks="blocks" @drop-todo="dropOnTimeline" @open="(id) => (ui.drawerId = id)" />
        <div v-if="!blocks.length" class="empty">No blocks scheduled. Press <span class="kbd">N</span> to add a todo or drag one onto the timeline.</div>
        <div v-else class="small muted hint">Drag a todo from the list below onto the strip to give it a start time. Dashed blocks are todos.</div>
      </div>
    </section>

    <section class="panel c4">
      <div class="panel-h"><span class="icon sm ok">approval</span><h2>Sign-off ledger</h2><span class="spacer"></span><span class="kbd">S</span><span class="small muted">stamp next</span></div>
      <div class="panel-b ledger">
        <div class="wl">
          <div class="tiny upper muted">Workload</div>
          <Gauge :hours="hours" :height="88" :width="18" />
          <div class="mono small">{{ hours.toFixed(1) }}h / {{ CAPACITY_H }}h</div>
        </div>
        <div class="col grow">
          <div class="tiny upper muted">Daily seals · 印 → 印 → 確認 → 完</div>
          <Stamps :date="T" :size="40" show-times />
          <div class="small muted">Click the next seal to stamp; click the last one to undo.</div>
        </div>
      </div>
    </section>

    <!-- row 2 -->
    <section class="panel c5 todos">
      <div class="panel-h">
        <span class="icon sm ok">checklist</span><h2><router-link to="/todos" class="title-link">{{ dayLabel }} todos</router-link></h2>
        <span class="spacer"></span><span class="mono small muted">{{ todos.filter((t) => !t.done).length }} pending</span>
      </div>
      <div class="list" @dragover.prevent @drop.prevent="dropOnList">
        <TodoRow v-for="t in todos" :key="t.id" :todo="t" adopt-date />
        <div v-if="!todos.length" class="empty">Nothing on today's sheet. Drag from the inbox or add below.</div>
      </div>
      <form class="qa" @submit.prevent="quickAdd">
        <span class="mono ok">+</span>
        <input v-model="quick" class="input ghost mono grow" :placeholder="`Add to ${isToday ? 'today' : wd(T) + ' ' + fmtSlash(T)}: Review notes 20m @SIG-01.1 p2`" />
      </form>
      <div class="foot mono small"><span class="muted">Remaining est.</span> {{ Math.floor(totalMin / 60) }}h {{ pad(totalMin % 60) }}m</div>
    </section>

    <section class="panel c3">
      <div class="panel-h"><span class="icon sm warn">alarm</span><h2><router-link to="/deadlines" class="title-link">Deadlines · 7d</router-link></h2></div>
      <div class="dl-list">
        <div v-for="d in deadlines" :key="d.id" class="dl" :class="{ over: diffDays(T, d.due) < 0 }" title="Click to edit" @click="ui.deadlineId = d.id">
          <div class="row">
            <Prio :p="d.priority" />
            <span class="spacer"></span>
            <span v-if="d.clickUp" class="small ok" title="Synced with ClickUp">● ClickUp</span>
          </div>
          <div class="dl-title">{{ d.title }}</div>
          <div class="row small">
            <span class="mono" :class="diffDays(T, d.due) < 0 ? 'danger' : diffDays(T, d.due) <= 1 ? 'warn' : 'muted'">{{ relDay(d.due, T) }} · {{ d.due.slice(11) }}</span>
            <span class="spacer"></span><Chip :id="d.source" />
          </div>
          <label class="row small muted" @click.stop><input v-model="d.done" type="checkbox" /> done</label>
        </div>
        <div v-if="!deadlines.length" class="empty">No deadlines in the next 7 days.</div>
      </div>
      <DeadlineQuickAdd :date="T" class="dl-add" />
    </section>

    <section class="panel c4">
      <div class="panel-h"><span class="icon sm ok">target</span><h2><router-link to="/strategy" class="title-link">Active strategic goals</router-link></h2></div>
      <div class="col panel-b">
        <router-link v-for="p in psgs" :key="p.no" :to="`/strategy/${p.plan}`" class="psg">
          <div class="row"><Chip :id="p.no" /><span class="mono tiny muted">{{ p.planNo }}</span><span class="spacer"></span><span class="mono" :class="pctClass(p.pct) || 'ok'">{{ p.pct }}%</span></div>
          <div class="psg-name">{{ p.name }}</div>
          <div class="bar" :class="pctClass(p.pct)"><i :style="{ width: p.pct + '%' }"></i></div>
          <div class="small muted mono ellipsis">Next: {{ p.next ? `${p.next.no} ${p.next.name}` : 'all SIGs done ✓' }}</div>
        </router-link>
        <div v-if="!psgs.length" class="empty">No active strategic plan. <router-link to="/strategy">Create or activate one</router-link>.</div>
      </div>
    </section>

    <!-- row 3 -->
    <div class="tiles c12">
      <router-link to="/week" class="panel tile">
        <div class="tiny upper muted row">Routines due<span class="spacer"></span><span class="icon sm">cleaning_services</span></div>
        <div class="big mono">{{ routineCount }}<span class="muted">/{{ state.routines.length }}</span></div>
        <div class="bar"><i :style="{ width: (routineCount / state.routines.length) * 100 + '%' }"></i></div>
        <div class="small">Monthly group <b class="ok mono">{{ group }}</b> · {{ state.monthlyGroups[group].join(', ') }}</div>
      </router-link>
      <div class="panel tile">
        <div class="tiny upper muted row">{{ isToday ? 'Sleep last night' : 'Sleep (night before)' }}<span class="spacer"></span><span class="icon sm">bedtime</span></div>
        <template v-if="sleep">
          <div class="big mono">{{ Math.floor(sleptMin / 60) }}h {{ pad(sleptMin % 60) }}m <span class="small muted">vs {{ sleep.targetMin / 60 }}h</span></div>
          <div class="small mono">
            <span :class="toMin(sleep.bed) > toMin(sleep.bedTarget) ? 'warn' : 'ok'">↓ {{ sleep.bed }} ({{ delta(sleep.bed, sleep.bedTarget) }})</span>
            &nbsp;<span :class="toMin(sleep.wake) > toMin(sleep.wakeTarget) ? 'warn' : 'ok'">↑ {{ sleep.wake }} ({{ delta(sleep.wake, sleep.wakeTarget) }})</span>
          </div>
        </template>
        <div v-else class="small muted">No entry yet.</div>
      </div>
      <div class="panel tile">
        <div class="tiny upper muted row">Caffeine {{ isToday ? 'today' : wd(T) }}<span class="spacer"></span><span class="icon sm">coffee</span></div>
        <div class="big mono">{{ mg }}<span class="muted small">/{{ state.caffeineLimit }}mg</span></div>
        <div class="bar" :class="mg > state.caffeineLimit ? 'danger' : mg > state.caffeineLimit * 0.75 ? 'warn' : ''"><i :style="{ width: Math.min(100, (mg / state.caffeineLimit) * 100) + '%' }"></i></div>
        <div v-if="isToday" class="row small">
          <span class="mono" :class="cutoffLeft > 0 ? 'warn' : 'muted'">{{ cutoffLeft > 0 ? `cutoff in ${Math.floor(cutoffLeft / 60)}h${pad(cutoffLeft % 60)}` : `cutoff ${state.caffeineCutoff} passed` }}</span>
          <span class="spacer"></span>
          <button class="btn sm" @click="addCaffeine('Coffee', 95)">+☕95</button>
          <button class="btn sm" @click="addCaffeine('Tea', 50)">+🍵50</button>
        </div>
      </div>
      <div class="panel tile">
        <div class="tiny upper muted row">Upcoming reviews<span class="spacer"></span><span class="icon sm">fact_check</span></div>
        <div v-for="r in reviews" :key="r.id" class="row small">
          <span class="ellipsis grow">{{ r.title }}</span>
          <span class="mono" :class="diffDays(T, r.date) <= 1 ? 'danger' : 'muted'">{{ relDay(r.date, T) }}</span>
        </div>
      </div>
      <div class="panel tile">
        <div class="tiny upper muted row">{{ isToday ? "Today's" : wd(T) }} lectures<span class="spacer"></span><span class="icon sm">school</span></div>
        <div v-for="l in lectures" :key="l.id" class="col" style="gap: 4px">
          <div class="row"><span class="mono">{{ l.course }}</span><span class="small muted ellipsis grow">#{{ l.no }} {{ l.title }}</span><span class="mono info">{{ l.time }}</span></div>
          <div class="row small checks">
            <label><input v-model="l.readAhead" type="checkbox" /> Read ahead</label>
            <label><input v-model="l.attended" type="checkbox" /> Attended</label>
            <label><input v-model="l.cheatSheet" type="checkbox" /> Cheat sheet</label>
          </div>
        </div>
        <div v-if="!lectures.length" class="small muted">No lectures {{ isToday ? 'today' : 'this day' }}.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cc { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 12px; padding: 16px; align-items: start; }
.head { grid-column: span 12; flex-direction: row; align-items: center; flex-wrap: wrap; gap: 20px; padding: 14px 18px; }
.daynav { display: flex; align-items: center; gap: 6px; }
.weekchip { cursor: pointer; }
.weekchip:hover { border-color: var(--accent); }
.preview { flex-direction: row; align-items: center; gap: 14px; padding: 14px 18px; border-left: 3px solid var(--info); }
.pv-title { font-size: 18px; font-weight: 600; line-height: 24px; }
.date { font-size: 30px; line-height: 36px; font-weight: 700; letter-spacing: -0.02em; }
.sep { width: 1px; align-self: stretch; background: var(--border); }
.kv { display: flex; flex-direction: column; gap: 3px; }
.stampc { color: var(--stamp); font-family: 'Noto Sans JP'; font-weight: 700; }
.c3 { grid-column: span 3; } .c4 { grid-column: span 4; } .c5 { grid-column: span 5; } .c8 { grid-column: span 8; } .c12 { grid-column: span 12; }
.hint { margin-top: 8px; }
.ledger { display: flex; gap: 18px; align-items: flex-start; }
.wl { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.todos { align-self: stretch; }
.list { flex: 1; min-height: 120px; }
.qa { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--border); }
.foot { padding: 8px 12px; }
.dl-list { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
.dl { border: 1px solid var(--border); border-radius: 2px; padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; }
.dl { cursor: pointer; }
.dl:hover { border-color: var(--muted); }
.dl-add { padding: 0 10px 10px; }
.dl.over { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 6%, transparent); }
.dl-title { font-weight: 600; }
.psg { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border); border-radius: 2px; padding: 10px; color: var(--text); }
.psg:hover { border-color: var(--accent); }
.psg-name { font-weight: 600; font-size: 14px; }
.tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.tile { padding: 12px; gap: 8px; color: var(--text); }
a.tile:hover { border-color: var(--accent); }
.big { font-size: 22px; line-height: 28px; font-weight: 700; }
.checks { flex-wrap: wrap; gap: 10px; }
.checks label { display: flex; align-items: center; gap: 4px; }
@media (max-width: 1200px) {
  .c3, .c4, .c5 { grid-column: span 6; } .c8 { grid-column: span 12; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .cc { padding: 12px; } .c3, .c4, .c5, .c8 { grid-column: span 12; } .tiles { grid-template-columns: 1fr; }
}
</style>
