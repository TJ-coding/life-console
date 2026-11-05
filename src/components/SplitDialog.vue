<script setup>
// "Plan this task": the estimate is a budget. Give days an amount (it subtracts from "To plan"),
// then, inside a day, cut that amount into timed sittings (they subtract from the day's amount;
// the rest stays untimed in the day's bucket). Re-opening shows and edits the current plan.
// Questions, in order: how much is still unplanned? · how much goes on each day, and does the day fit? · when, within the day?
import { computed, nextTick, ref, watch } from 'vue'
import {
  ui, findTodo, todayISO, addDays, mondayOf, wd, fmtSlash, dayLoad, CAPACITY_H, evenParts, planDaySpread,
  replanTodo, splitSiblings, blocksForDay, toMin, fromMin, WORK_FROM, WORK_TO, pomo, planPomodoroDay,
} from '../store'
import { wallMin, count as pomoCount } from '../../server/pomodoro.mjs'

const SITTING = 60 // longest sitting "Auto times" makes when the pomodoro rhythm is off
// Pomodoro (Settings): amounts move in whole pomodoros, and a sitting is laid out as work + breaks
const P = computed(() => pomo())
const STEP = computed(() => (P.value.on ? P.value.work : 30)) // − / + step for amounts
/** Clock minutes a sitting takes (its breaks included when it's a pomodoro sitting). */
const wall = (s) => (s.pomo ? wallMin(Number(s.min) || 0, P.value) : Number(s.min) || 0)
const up = (m) => Math.floor(m / STEP.value) * STEP.value + STEP.value
const down = (m) => Math.ceil(m / STEP.value) * STEP.value - STEP.value

const t = computed(() => (ui.splitId ? findTodo(ui.splitId) : null))
const T = computed(() => todayISO())
const openParts = computed(() => (t.value?.split ? splitSiblings(t.value).filter((x) => !x.done) : t.value ? [t.value] : []))
const doneMin = computed(() => (t.value?.split ? splitSiblings(t.value).filter((x) => x.done).reduce((s, x) => s + x.timeMin, 0) : 0))
const ownIds = computed(() => openParts.value.map((x) => x.id))

const est = ref(0) // open budget in minutes (estimate minus what's done)
const plan = ref({}) // date → { min, sittings: [{ start, min }] }
const week0 = ref(null)
const dialog = ref(null)

function open() {
  est.value = openParts.value.reduce((s, x) => s + x.timeMin, 0)
  const p = {}
  for (const x of openParts.value) {
    const d = x.scheduled?.date
    if (!d) continue
    p[d] ??= { min: 0, sittings: [] }
    p[d].min += x.timeMin
    if (x.scheduled.start) p[d].sittings.push({ start: x.scheduled.start, min: x.timeMin, pomo: !!x.pomo })
  }
  Object.values(p).forEach((d) => d.sittings.sort((a, b) => a.start.localeCompare(b.start)))
  plan.value = p
  week0.value = ui.weekStart < mondayOf(T.value) ? mondayOf(T.value) : ui.weekStart
  nextTick(() => dialog.value?.focus())
}
watch(() => ui.splitId, (id) => { if (id && t.value) open() })

/* ── days shown: this dialog-week from today on, plus any day that already has time ── */
const days = computed(() => {
  const w = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(week0.value, i)).filter((d) => d >= T.value)
  return [...new Set([...w, ...Object.keys(plan.value).filter((d) => plan.value[d].min > 0)])].sort()
})
const shiftWeek = (n) => { week0.value = addDays(week0.value, 7 * n) }
const weekLabel = computed(() => `${fmtSlash(week0.value)} – ${fmtSlash(addDays(week0.value, 6))}`)
const canBack = computed(() => week0.value > mondayOf(T.value))

const planned = computed(() => Object.values(plan.value).reduce((s, d) => s + d.min, 0))
const left = computed(() => est.value - planned.value)
const amt = (d) => plan.value[d]?.min ?? 0
const timed = (d) => (plan.value[d]?.sittings ?? []).reduce((s, x) => s + (Number(x.min) || 0), 0)
const untimed = (d) => amt(d) - timed(d)

/* ── a day's amount ── */
function setAmt(d, min) {
  min = Math.max(0, min)
  if (!plan.value[d]) plan.value[d] = { min: 0, sittings: [] }
  const day = plan.value[d]
  day.min = min
  // shrinking below the timed sittings trims them from the last one back
  let over = timed(d) - min
  while (over > 0 && day.sittings.length) {
    const s = day.sittings[day.sittings.length - 1]
    const cut = Math.min(over, s.min)
    s.min -= cut
    over -= cut
    if (s.min <= 0) day.sittings.pop()
  }
  if (!min) delete plan.value[d]
}
const plus = (d) => setAmt(d, Math.min(up(amt(d)), amt(d) + left.value))
const minus = (d) => setAmt(d, down(amt(d)))
const restHere = (d) => setAmt(d, amt(d) + left.value)

/* ── sittings within a day ── */
const busyOf = (d) => (plan.value[d]?.sittings ?? [])
  .filter((s) => s.start)
  .map((s) => [toMin(s.start), toMin(s.start) + wall(s) + (s.pomo ? P.value.long : 0)])
function addSitting(d) {
  const rest = untimed(d)
  if (rest <= 0) return
  if (P.value.on) {
    // the next free gap that holds at least one pomodoro, filled up to one set
    const [first] = planPomodoroDay(d, rest, ownIds.value, busyOf(d))
    plan.value[d].sittings.push(first ? { ...first, pomo: true } : { start: '', min: Math.min(rest, P.value.work * P.value.every), pomo: true })
  } else {
    const min = rest <= 90 ? rest : SITTING
    const [start] = planDaySpread(d, [min], ownIds.value, WORK_FROM, WORK_TO, busyOf(d))
    plan.value[d].sittings.push({ start: start ?? '', min })
  }
  plan.value[d].sittings.sort((a, b) => (a.start || '99').localeCompare(b.start || '99'))
}
/**
 * Cut the whole day amount into sittings in the earliest free gaps. Pomodoro on: each gap gets as
 * many whole pomodoros as fit (≤ one set), a long break after each sitting. Off: sittings of ≤ 1h.
 */
function autoTimes(d) {
  if (P.value.on) {
    plan.value[d].sittings = planPomodoroDay(d, amt(d), ownIds.value).map((s) => ({ ...s, pomo: true }))
    return
  }
  const mins = evenParts(amt(d), Math.max(1, Math.ceil(amt(d) / SITTING)))
  const starts = planDaySpread(d, mins, ownIds.value)
  plan.value[d].sittings = mins.map((min, i) => ({ start: starts[i] ?? '', min })).filter((s) => s.start)
}
const dropSitting = (d, i) => plan.value[d].sittings.splice(i, 1)
/** Editing a sitting's minutes can't take more than the day has. */
function clampSitting(d, i) {
  const s = plan.value[d].sittings[i]
  const others = timed(d) - (Number(s.min) || 0)
  s.min = Math.max(5, Math.min(Number(s.min) || 0, amt(d) - others))
}

/* ── whole-plan shortcuts ── */
const weekDays = computed(() => days.value.filter((d) => d >= week0.value && d <= addDays(week0.value, 6) && (!t.value?.due || d <= t.value.due)))
/** `total` minutes over `n` days in whole `unit`s, e.g. 175 over 3 at 25 → [75, 50, 50]. */
function evenUnits(total, n, unit) {
  const k = Math.floor(total / unit)
  const out = Array.from({ length: n }, (_, i) => (Math.floor(k / n) + (i < k % n ? 1 : 0)) * unit)
  out[n - 1] += total - k * unit
  return out
}
function spreadEvenly() {
  const wk = weekDays.value.filter((d) => [1, 2, 3, 4, 5].includes(new Date(d + 'T12:00').getDay()))
  const pool = wk.length ? wk : weekDays.value
  if (!pool.length) return
  plan.value = {}
  const n = Math.min(pool.length, Math.max(1, Math.floor(est.value / STEP.value)))
  // pomodoro on: hand out whole pomodoros (any odd remainder goes on the last day)
  const parts = P.value.on ? evenUnits(est.value, n, P.value.work) : evenParts(est.value, n)
  parts.forEach((min, i) => { if (min) plan.value[pool[i]] = { min, sittings: [] } })
}
function fillFree() {
  plan.value = {}
  let rest = est.value
  for (const d of weekDays.value) {
    if (rest <= 0) break
    const unit = P.value.on ? P.value.work : 15
    const free = Math.floor(((CAPACITY_H - base(d)) * 60) / unit) * unit
    const take = Math.min(rest, Math.max(0, free))
    if (take > 0) { plan.value[d] = { min: take, sittings: [] }; rest -= take }
  }
}

/* ── context per day ── */
const base = (d) => dayLoad(d).total - openParts.value.filter((x) => x.scheduled?.date === d).reduce((s, x) => s + x.timeMin, 0) / 60
const after = (d) => base(d) + amt(d) / 60
function strip(d) {
  const others = blocksForDay(d).filter((b) => !ownIds.value.includes(b.todoId)).map((b) => [toMin(b.start), toMin(b.end), b.title])
  const mine = (plan.value[d]?.sittings ?? []).filter((s) => s.start).map((s) => [toMin(s.start), toMin(s.start) + wall(s)])
  const lo = Math.min(toMin(WORK_FROM), ...others.map((b) => b[0]), ...mine.map((b) => b[0]))
  const hi = Math.max(toMin(WORK_TO), ...others.map((b) => b[1]), ...mine.map((b) => b[1]))
  const a = Math.floor(lo / 60) * 60
  const z = Math.min(1440, Math.ceil(hi / 60) * 60)
  const pos = ([s, e]) => ({ left: ((s - a) / (z - a)) * 100 + '%', width: Math.max(0.8, ((e - s) / (z - a)) * 100) + '%' })
  return { others: others.map((b) => ({ style: pos(b), title: `${fromMin(b[0])} ${b[2]}` })), mine: mine.map(pos), a: fromMin(a).slice(0, 2), z: fromMin(z).slice(0, 2) }
}

/* ── apply ── */
function apply() {
  const pieces = []
  for (const [date, d] of Object.entries(plan.value)) {
    d.sittings.forEach((s) => { if (s.min > 0) pieces.push({ date, start: s.start || null, min: Number(s.min), pomo: !!s.pomo }) })
    const rest = d.min - d.sittings.reduce((s, x) => s + (Number(x.min) || 0), 0)
    if (rest > 0) pieces.push({ date, start: null, min: rest })
  }
  if (left.value > 0) pieces.push({ date: null, start: null, min: left.value })
  if (!pieces.length) return
  replanTodo(t.value.id, pieces)
  ui.splitId = null
}
const close = () => { ui.splitId = null }
function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close() }
  // Enter always means Apply (even with a −/+ button focused) — except on Cancel/close, which keep their own meaning
  if (e.key === 'Enter' && !['SELECT', 'TEXTAREA'].includes(e.target.tagName) && !e.target.closest('[data-own-enter]')) { e.preventDefault(); apply() }
}

const hm = (m) => { m = Math.round(m); const h = Math.floor(m / 60); return h ? `${h}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m` }
const dayName = (d) => (d === T.value ? 'Today' : d === addDays(T.value, 1) ? 'Tomorrow' : wd(d))
const end = (s) => (s.start ? fromMin(Math.min(1440, toMin(s.start) + wall(s))) : '')
/** "2 × 25m" / "3 × 25m, last 10m" for a pomodoro sitting. */
function pomoNote(s) {
  const m = Number(s.min) || 0
  const n = pomoCount(m, P.value)
  const last = m - (n - 1) * P.value.work
  return `${n} pomodoro${n === 1 ? '' : 's'}${last < P.value.work ? `, last ${last}m` : ''}`
}
</script>

<template>
  <div v-if="t" class="scrim" @mousedown.self="close" @keydown="onKey">
    <div ref="dialog" class="dlg" role="dialog" aria-label="Plan this task" tabindex="-1">
      <header class="hd">
        <div class="grow ttlwrap">
          <div class="tiny upper muted">Plan this task</div>
          <div class="ttl">{{ t.title }}</div>
        </div>
        <button class="btn icon-only" data-own-enter title="Close (Esc)" @click="close"><span class="icon sm">close</span></button>
      </header>

      <!-- the one number: what's still unplanned -->
      <section class="budget">
        <div class="leftbox">
          <span class="tiny upper muted">To plan</span>
          <span class="big mono" :class="{ zero: left === 0 }">{{ left === 0 ? 'All planned' : hm(left) }}</span>
        </div>
        <div class="meter" :title="`${hm(planned)} of ${hm(est)} planned`"><i :style="{ width: est ? (planned / est) * 100 + '%' : 0 }"></i></div>
        <div class="estline small muted">
          Estimate
          <button class="btn sm icon-only" :title="`${STEP} min less`" :disabled="down(est) < planned || down(est) <= 0" @click="est = down(est)"><span class="icon sm">remove</span></button>
          <b class="mono">{{ hm(est) }}</b>
          <button class="btn sm icon-only" :title="`${STEP} min more`" @click="est = up(est)"><span class="icon sm">add</span></button>
          <span v-if="P.on" class="mono" :title="`Pomodoro ${P.work}/${P.short}, long ${P.long} after ${P.every} (Settings)`">· {{ pomoCount(est, P) }} × {{ P.work }}m</span>
          <span v-if="doneMin" class="mono">· {{ hm(doneMin) }} already done</span>
        </div>
      </section>

      <div class="bd">
        <div class="weeknav">
          <button class="btn sm icon-only" :disabled="!canBack" title="Previous week" @click="shiftWeek(-1)"><span class="icon sm">chevron_left</span></button>
          <span class="mono small">{{ weekLabel }}</span>
          <button class="btn sm icon-only" title="Next week" @click="shiftWeek(1)"><span class="icon sm">chevron_right</span></button>
          <span class="spacer"></span>
          <button class="btn sm" title="Share the estimate equally over this week's weekdays" @click="spreadEvenly">Spread evenly</button>
          <button class="btn sm" title="Fill each day's free capacity, earliest first" @click="fillFree">Fill free time</button>
        </div>

        <div v-for="d in days" :key="d" class="day" :class="{ on: amt(d) > 0 }">
          <div class="dayhead">
            <span class="dname"><b>{{ dayName(d) }}</b> <span class="mono muted">{{ fmtSlash(d) }}</span></span>
            <div class="stepper">
              <button class="btn icon-only" :disabled="!amt(d)" :aria-label="`Less on ${wd(d)}`" @click="minus(d)"><span class="icon sm">remove</span></button>
              <span class="mono amt" :class="{ muted: !amt(d) }">{{ amt(d) ? hm(amt(d)) : '0' }}</span>
              <button class="btn icon-only" :disabled="left <= 0" :aria-label="`More on ${wd(d)}`" @click="plus(d)"><span class="icon sm">add</span></button>
            </div>
            <button v-if="left > STEP" class="btn sm rest" :title="`Put the remaining ${hm(left)} on ${wd(d)}`" @click="restHere(d)">+ all {{ hm(left) }}</button>
            <span class="spacer"></span>
            <span class="mono small load" :class="after(d) > CAPACITY_H ? 'danger' : 'muted'" :title="`${wd(d)}'s workload after this plan`">
              {{ after(d).toFixed(1) }}/{{ CAPACITY_H }}h
            </span>
          </div>

          <div v-if="amt(d)" class="within">
            <div class="strip" :title="`${wd(d)}: grey = already booked, blue = this task`">
              <i v-for="(b, k) in strip(d).others" :key="'o' + k" class="b" :style="b.style" :title="b.title"></i>
              <i v-for="(b, k) in strip(d).mine" :key="'m' + k" class="b mine" :style="b"></i>
              <span class="ax mono">{{ strip(d).a }}</span><span class="ax z mono">{{ strip(d).z }}</span>
            </div>
            <div v-for="(s, i) in plan[d].sittings" :key="i" class="sit">
              <input v-model="s.start" type="time" step="900" class="input mono tm" :aria-label="`Sitting ${i + 1} start`" />
              <input v-model.number="s.min" type="number" min="5" :step="s.pomo ? P.work : 15" class="input mono mn" :aria-label="`Sitting ${i + 1} minutes`" @change="clampSitting(d, i)" />
              <span class="small muted">min</span>
              <span class="mono small muted grow">{{ s.start ? '→ ' + end(s) : 'no time' }}<template v-if="s.pomo"> · {{ pomoNote(s) }}</template></span>
              <button class="btn sm icon-only" title="Remove this time (its minutes become untimed)" @click="dropSitting(d, i)"><span class="icon sm">close</span></button>
            </div>
            <div class="sitfoot small">
              <span v-if="untimed(d) > 0" class="muted"><span class="mono">{{ hm(untimed(d)) }}</span> {{ plan[d].sittings.length ? 'without a time' : 'on this day, no time yet' }}</span>
              <span v-else class="muted">every minute has a time</span>
              <span class="spacer"></span>
              <button v-if="untimed(d) > 0" class="btn sm" @click="addSitting(d)"><span class="icon sm">more_time</span>Add a time</button>
              <button class="btn sm" :title="P.on ? `Cut this day's time into sets of up to ${P.every} pomodoros (${P.work}m work, ${P.short}m breaks), ${P.long}m apart, in the free gaps` : 'Cut this day\'s time into sittings of up to 1h in the free gaps'" @click="autoTimes(d)"><span class="icon sm">auto_fix_high</span>Auto times</button>
            </div>
          </div>
        </div>
      </div>

      <footer class="ft">
        <span class="small muted grow hint">
          <template v-if="left > 0">{{ hm(left) }} stays in the backlog. </template>Undo in the toast.
        </span>
        <button class="btn" data-own-enter @click="close">Cancel</button>
        <button class="btn primary" @click="apply"><span class="icon sm">check</span>Apply <span class="kbd">Enter</span></button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--scrim); z-index: 55; display: flex; justify-content: center; align-items: flex-start; padding-top: 6vh; }
.dlg { width: 600px; max-width: calc(100vw - 32px); max-height: 88vh; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; outline: none; }
.hd { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px 6px; }
.ttlwrap { min-width: 0; }
.ttl { font-weight: 600; font-size: 18px; line-height: 24px; }

.budget { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px 16px; padding: 4px 16px 12px; border-bottom: 1px solid var(--border); }
.leftbox { display: flex; flex-direction: column; }
.big { font-size: 30px; line-height: 34px; font-weight: 700; color: var(--text); }
.big.zero { font-size: 20px; color: var(--muted); }
.meter { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; align-self: end; margin-bottom: 8px; }
.meter i { display: block; height: 100%; background: var(--info); transition: width 0.15s; }
.estline { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; }
.estline b { color: var(--text); }

.bd { padding: 10px 16px 14px; display: flex; flex-direction: column; gap: 6px; overflow: auto; }
.weeknav { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }

.day { border: 1px solid var(--border); border-radius: 3px; padding: 6px 10px; }
.day.on { border-color: color-mix(in srgb, var(--info) 45%, var(--border)); }
.dayhead { display: flex; align-items: center; gap: 10px; min-height: 34px; }
.dname { width: 118px; font-size: 15px; flex: none; }
.dname .mono { font-size: 12px; }
.stepper { display: flex; align-items: center; gap: 2px; }
.stepper .btn { width: 32px; height: 32px; justify-content: center; }
.amt { width: 56px; text-align: center; font-size: 15px; font-weight: 600; }
.rest { color: var(--muted); }
.load { white-space: nowrap; }

.within { display: flex; flex-direction: column; gap: 6px; padding: 6px 0 2px; margin-top: 4px; border-top: 1px dashed var(--border); }
.strip { position: relative; height: 14px; background: var(--surface-2); border-radius: 2px; margin: 2px 0 12px; }
.strip .b { position: absolute; top: 2px; bottom: 2px; background: var(--muted); opacity: 0.4; border-radius: 1px; }
.strip .b.mine { background: var(--info); opacity: 1; }
.ax { position: absolute; top: 15px; left: 0; font-size: 10px; color: var(--muted); }
.ax.z { left: auto; right: 0; }
.sit { display: flex; align-items: center; gap: 8px; }
.tm { width: 110px; flex: none; }
.mn { width: 64px; flex: none; }
.sitfoot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.ft { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
.btn:disabled { opacity: 0.35; cursor: not-allowed; }
@media (max-width: 640px) {
  .scrim { padding-top: 0; align-items: flex-end; }
  .dlg { max-width: 100vw; width: 100%; max-height: 100%; border-radius: 6px 6px 0 0; border-width: 1px 0 0; }
  .ttl { font-size: 16px; line-height: 21px; }
  .big { font-size: 26px; }
  .dname { width: 84px; font-size: 14px; }
  .dname .mono { display: block; }
  .dayhead { gap: 6px; }
  .hint { display: none; }
  .ft { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
  .ft .btn { height: 40px; }
  .ft .btn.primary { flex: 1; justify-content: center; }
}
</style>
