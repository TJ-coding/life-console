<script setup>
// S-01 "More": the full briefing from the earlier Command Center layout, shown on demand under the cockpit.
import { computed } from 'vue'
import {
  state, wd, workload, CAPACITY_H, psgPct, nextSig, diffDays, relDay, toMin, fromMin, pad, mondayOf,
  routineDone, monthGroup, nextCheckDate, activePlans, toast, ui,
} from '../store'
import Gauge from './Gauge.vue'
import Stamps from './Stamps.vue'
import Chip from './Chip.vue'
import DeadlineQuickAdd from './DeadlineQuickAdd.vue'

const props = defineProps({ date: { type: String, required: true }, isToday: Boolean })
const T = computed(() => props.date)
const hours = computed(() => workload(T.value))
const nowMin = computed(() => ui.now.getHours() * 60 + ui.now.getMinutes())

const deadlines = computed(() =>
  state.deadlines.filter((d) => !d.done && diffDays(T.value, d.due) <= 7).sort((a, b) => a.due.localeCompare(b.due)))
const psgs = computed(() =>
  activePlans().flatMap((pl) => pl.psgs.map((p) => ({ ...p, plan: pl.id, planNo: pl.planNo })))
    .sort((a, b) => a.priority - b.priority).slice(0, 3).map((p) => ({ ...p, pct: psgPct(p.no), next: nextSig(p.no) })))
const pctClass = (n) => (n >= 70 ? '' : n >= 40 ? 'info' : 'warn')

const routineCount = computed(() => routineDone(mondayOf(T.value)).length)
const group = computed(() => monthGroup(T.value))
const sleep = computed(() => state.sleep[T.value])
const sleptMin = computed(() => { const s = sleep.value; return s ? (toMin(s.wake) - toMin(s.bed) + 1440) % 1440 : 0 })
const delta = (actual, target) => { const d = toMin(actual) - toMin(target); return `${d >= 0 ? '+' : '−'}${Math.abs(d)}m` }
const mg = computed(() => (state.caffeine[T.value] ?? []).reduce((s, c) => s + c.mg, 0))
const cutoffLeft = computed(() => toMin(state.caffeineCutoff) - nowMin.value)
function addCaffeine(what, amount) {
  if (!state.caffeine[T.value]) state.caffeine[T.value] = []
  state.caffeine[T.value].push({ t: fromMin(nowMin.value), what, mg: amount })
  if (cutoffLeft.value < 0) toast('Past caffeine cutoff')
}
const reviews = computed(() =>
  [...activePlans().map((p) => ({ id: p.id, title: `Plan ${p.planNo} check`, date: nextCheckDate(p) })), ...state.reviews]
    .sort((a, b) => a.date.localeCompare(b.date)))
const lectures = computed(() => state.lectures.filter((l) => l.date === T.value))
</script>

<template>
  <div class="more">
    <section class="panel c6">
      <div class="panel-h"><span class="icon sm warn">alarm</span><h2><router-link to="/deadlines" class="title-link">Deadlines · 7d</router-link></h2>
        <span class="spacer"></span><span class="mono small muted">{{ deadlines.length }} open</span></div>
      <div class="dlw">
        <label v-for="d in deadlines" :key="d.id" class="dline" :class="{ over: diffDays(T, d.due) < 0 }" title="Click to edit" @click="ui.deadlineId = d.id">
          <input v-model="d.done" type="checkbox" @click.stop />
          <span class="grow ellipsis">{{ d.title }}</span>
          <span class="mono small nowrap" :class="diffDays(T, d.due) < 0 ? 'danger' : diffDays(T, d.due) <= 1 ? 'warn' : 'muted'">{{ relDay(d.due, T) }} · {{ d.due.slice(11) }}</span>
          <Chip v-if="d.source" :id="d.source" />
        </label>
        <div v-if="!deadlines.length" class="empty">No deadlines in the next 7 days.</div>
      </div>
      <DeadlineQuickAdd :date="T" />
    </section>

    <section class="panel c6">
      <div class="panel-h"><span class="icon sm ok">target</span><h2><router-link to="/strategy" class="title-link">Active strategic goals</router-link></h2></div>
      <div class="panel-b psgs-b">
        <router-link v-for="p in psgs" :key="p.no" :to="`/strategy/${p.plan}`" class="psg">
          <div class="row"><Chip :id="p.no" /><span class="mono tiny muted">{{ p.planNo }}</span><span class="spacer"></span><span class="mono" :class="pctClass(p.pct) || 'ok'">{{ p.pct }}%</span></div>
          <div class="psg-name">{{ p.name }}</div>
          <div class="bar" :class="pctClass(p.pct)"><i :style="{ width: p.pct + '%' }"></i></div>
          <div class="small muted mono ellipsis">Next: {{ p.next ? `${p.next.no} ${p.next.name}` : 'all SIGs done ✓' }}</div>
        </router-link>
        <div v-if="!psgs.length" class="empty">No active strategic plan. <router-link to="/strategy">Create or activate one</router-link>.</div>
      </div>
    </section>

    <section class="panel c12">
      <div class="panel-h"><span class="icon sm ok">approval</span><h2>Sign-off ledger</h2><span class="spacer"></span><span class="kbd">S</span><span class="small muted">stamp next</span></div>
      <div class="panel-b ledger">
        <div class="wl">
          <div class="tiny upper muted">Workload</div>
          <Gauge :hours="hours" :height="88" :width="18" />
          <div class="mono small">{{ hours.toFixed(1) }}h / {{ CAPACITY_H }}h</div>
        </div>
        <div class="grow ledger-seals">
          <div class="tiny upper muted">Daily seals · 印 → 印 → 確認 → 完</div>
          <Stamps :date="T" :size="40" show-times />
          <div class="small muted">Click the next seal to stamp; click the last one to undo.</div>
        </div>
      </div>
    </section>

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
        <div v-for="l in lectures" :key="l.id" class="lec">
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
.more { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 12px; align-items: start; }
.c6 { grid-column: span 6; } .c12 { grid-column: span 12; }
.dlw { max-height: 330px; overflow: auto; padding: 4px 0; }
.dline { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 4px 12px; border-bottom: 1px solid var(--border); cursor: pointer; }
.dline:hover { background: var(--surface-2); }
.dline .grow { font-weight: 600; font-size: 13px; }
.dline input, .dline .chip { flex: none; }
.dline.over { border-left: 2px solid var(--danger); }
.dline.over .grow { color: var(--danger); }
.psgs-b { display: flex; flex-direction: column; gap: 8px; }
.psg { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border); border-radius: 2px; padding: 10px; color: var(--text); }
.psg:hover { border-color: var(--accent); }
.psg-name { font-weight: 600; font-size: 14px; }
.ledger { display: flex; gap: 18px; align-items: flex-start; }
.ledger-seals { display: flex; flex-direction: column; gap: 6px; }
.wl { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.tile { padding: 12px; gap: 8px; color: var(--text); }
a.tile:hover { border-color: var(--accent); }
.big { font-size: 22px; line-height: 28px; font-weight: 700; }
.lec { display: flex; flex-direction: column; gap: 4px; }
.checks { flex-wrap: wrap; gap: 10px; }
.checks label { display: flex; align-items: center; gap: 4px; }
@media (max-width: 1200px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) { .c6 { grid-column: span 12; } .tiles { grid-template-columns: 1fr; } }
</style>
