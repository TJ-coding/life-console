<script setup>
// Split one task into parts. Two paths, picked with a segmented switch:
//  • Within a day — parts stay on one day and get start times in its free gaps; a mini timeline
//    shows the day before (current block, dashed) and after (where each part lands).
//  • Across days  — parts go to different days, with a live day-load preview per day.
// Questions it answers, in order: where will the parts land? · does the day/week still fit? · how many parts?
// Re-splitting a part re-splits the whole task (its open parts) by default. Apply has Undo in the toast.
import { computed, nextTick, ref, watch } from 'vue'
import {
  ui, findTodo, todayISO, addDays, wd, fmtSlash, dayLoad, CAPACITY_H, evenParts, autoSpread, planDaySpread,
  splitWithUndo, splitSiblings, partLabel, blocksForDay, toMin, fromMin, WORK_FROM, WORK_TO,
} from '../store'

const t = computed(() => (ui.splitId ? findTodo(ui.splitId) : null))
const T = computed(() => todayISO())

/* ── scope: a part of an already-split task re-splits the whole task unless told otherwise ── */
const openParts = computed(() => splitSiblings(t.value).filter((x) => !x.done))
const canWhole = computed(() => openParts.value.length > 1)
const scope = ref('whole') // 'whole' | 'part'
const whole = computed(() => canWhole.value && scope.value === 'whole')
const total = computed(() => (whole.value ? openParts.value.reduce((s, x) => s + x.timeMin, 0) : t.value?.timeMin ?? 0))
const skipIds = computed(() => (whole.value ? openParts.value.map((x) => x.id) : [t.value?.id]))

/* ── mode ── */
const mode = ref('day') // 'day' (within a day) | 'days' (across days)
const days = computed(() => {
  const w = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ui.weekStart, i))
  const own = t.value?.scheduled?.date
  return own && !w.includes(own) ? [...w, own].sort() : w
})
const usable = (d) => d >= T.value
const day = ref(null) // the day for "within a day"

const n = ref(2)
const parts = ref([]) // [{ min, date, start }]
const dialog = ref(null)

function open() {
  scope.value = 'whole'
  const sd = t.value.scheduled?.date
  mode.value = sd ? 'day' : 'days' // already on a day → spread through it; backlog → across days
  day.value = sd && sd >= T.value ? sd : T.value
  n.value = total.value >= 90 ? 3 : 2
  rebuild()
  // not on a day yet and today is too full (or nearly over): default to the first day where every part fits
  if (mode.value === 'day' && !sd && unplaced.value) {
    const next = days.value.find((d) => d > T.value && planDaySpread(d, parts.value.map((p) => p.min), skipIds.value).every(Boolean))
    if (next) day.value = next // the `day` watcher re-places the parts
  }
  nextTick(() => dialog.value?.focus())
}
watch(() => ui.splitId, (id) => { if (id && t.value) open() })
watch(scope, () => { if (t.value) rebuild() })
watch(mode, () => { if (t.value) place() })
watch(day, () => { if (t.value && mode.value === 'day') place() })

/** New part sizes from the count, then place them for the current mode. */
function rebuild() {
  parts.value = evenParts(total.value, n.value).map((min) => ({ min, date: null, start: null }))
  place()
}
const setN = (k) => { n.value = k; rebuild() }
/** Within a day: every part on `day`, start times in the earliest free gaps. Across days: auto-pick days. */
function place() {
  if (mode.value === 'day') {
    const starts = planDaySpread(day.value, parts.value.map((p) => Number(p.min) || 30), skipIds.value)
    parts.value.forEach((p, i) => { p.date = day.value; p.start = starts[i] ?? null })
  } else {
    const week = days.value.filter(usable)
    const weekdays = week.filter((d) => days.value.indexOf(d) < 5)
    const pool = weekdays.length >= Math.min(parts.value.length, 2) ? weekdays : week
    const picks = pool.length ? autoSpread({ ...t.value, timeMin: total.value }, parts.value.map((p) => p.min), pool) : []
    parts.value.forEach((p, i) => { p.date = picks[i] ?? null; p.start = null })
  }
}
const unplaced = computed(() => (mode.value === 'day' ? parts.value.filter((p) => !p.start).length : 0))
/** When parts don't fit the chosen day: the first later day where all of them do (a one-tap way out). */
const fitDay = computed(() => (unplaced.value
  ? days.value.find((d) => d > day.value && d >= T.value && planDaySpread(d, parts.value.map((p) => Number(p.min) || 30), skipIds.value).every(Boolean)) ?? null
  : null))
const sum = computed(() => parts.value.reduce((s, p) => s + (Number(p.min) || 0), 0))

/* ── within a day: mini timeline (before / after) ── */
const dayBlocks = computed(() => (mode.value === 'day' && day.value ? blocksForDay(day.value) : []))
const others = computed(() => dayBlocks.value.filter((b) => !skipIds.value.includes(b.todoId)))
const own = computed(() => dayBlocks.value.filter((b) => skipIds.value.includes(b.todoId)))
const after = computed(() => parts.value
  .map((p, i) => ({ i, start: p.start, end: p.start ? fromMin(Math.min(1440, toMin(p.start) + (Number(p.min) || 30))) : null }))
  .filter((p) => p.start))
const range = computed(() => {
  const all = [...others.value, ...own.value, ...after.value]
  const lo = Math.min(toMin(WORK_FROM), ...all.map((b) => toMin(b.start)))
  const hi = Math.max(toMin(WORK_TO), ...all.map((b) => toMin(b.end)))
  return [Math.floor(lo / 60) * 60, Math.min(1440, Math.ceil(hi / 60) * 60)]
})
const pct = (m) => ((m - range.value[0]) / (range.value[1] - range.value[0])) * 100
const pos = (b) => ({ left: pct(toMin(b.start)) + '%', width: Math.max(0.8, pct(toMin(b.end)) - pct(toMin(b.start))) + '%' })
const ticks = computed(() => {
  const out = []
  for (let m = range.value[0]; m <= range.value[1]; m += 120) out.push(m)
  return out
})
const nowPct = computed(() => {
  if (day.value !== T.value) return null
  const m = ui.now.getHours() * 60 + ui.now.getMinutes()
  return m >= range.value[0] && m <= range.value[1] ? pct(m) : null
})
const dayFree = computed(() => (mode.value === 'day' && day.value
  ? CAPACITY_H - dayLoad(day.value).total + (whole.value ? openParts.value : [t.value]).filter((x) => x.scheduled?.date === day.value).reduce((s, x) => s + x.timeMin, 0) / 60
  : 0))

/* ── across days: load preview ── */
const preview = computed(() => days.value.map((d) => {
  const mine = (whole.value ? openParts.value : [t.value]).filter((x) => x.scheduled?.date === d).reduce((s, x) => s + x.timeMin, 0) / 60
  const base = dayLoad(d).total - mine
  const add = parts.value.filter((p) => p.date === d).reduce((s, p) => s + (Number(p.min) || 0), 0) / 60
  return { d, base, add, after: base + add }
}))
const pmax = computed(() => Math.max(CAPACITY_H + 1, ...preview.value.map((p) => p.after)))
/** A part on the task's own day keeps its current start time when splitting across days. */
const keepsStart = (p, i) => i === 0 && t.value?.scheduled?.start && p.date === t.value.scheduled.date

const valid = computed(() => parts.value.length >= 2 && parts.value.every((p) => Number(p.min) > 0) && (mode.value === 'days' || !!day.value))
function apply() {
  if (!valid.value) return
  splitWithUndo(t.value.id, parts.value.map((p) => ({
    min: Number(p.min),
    date: mode.value === 'day' ? day.value : p.date || null,
    // within a day: the planned start (blank = untimed, it waits in that day's bucket);
    // across days: undefined = part 1 keeps its start if it stays on the same day, others untimed
    start: mode.value === 'day' ? p.start || null : undefined,
  })), { whole: whole.value })
  ui.splitId = null
}
const close = () => { ui.splitId = null }
function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close() }
  if (e.key === 'Enter' && !['BUTTON', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) { e.preventDefault(); apply() }
}
const fmtH = (h) => `${h < 0 ? '−' : ''}${Math.abs(h).toFixed(1)}h`
const dayLabel = (d) => (d === T.value ? 'Today' : wd(d))
</script>

<template>
  <div v-if="t" class="scrim" @mousedown.self="close" @keydown="onKey">
    <div ref="dialog" class="dlg" role="dialog" aria-label="Split task" tabindex="-1">
      <header class="hd">
        <span class="icon">call_split</span>
        <div class="grow">
          <div class="tiny upper muted">Split<span v-if="partLabel(t)" class="mono"> · part {{ partLabel(t) }}</span></div>
          <div class="ttl ellipsis">{{ t.title }}</div>
        </div>
        <span class="mono est">{{ total }}m</span>
        <button class="btn icon-only" title="Close (Esc)" @click="close"><span class="icon sm">close</span></button>
      </header>

      <div class="bd">
        <div v-if="canWhole" class="scope small">
          <span class="muted">Already split into {{ openParts.length }} open parts.</span>
          <label><input v-model="scope" type="radio" value="whole" /> Re-split the whole task ({{ openParts.reduce((s, x) => s + x.timeMin, 0) }}m)</label>
          <label><input v-model="scope" type="radio" value="part" /> Only this part ({{ t.timeMin }}m)</label>
        </div>

        <div class="modes" role="tablist" aria-label="Split mode">
          <button role="tab" :aria-selected="mode === 'day'" :class="{ on: mode === 'day' }" @click="mode = 'day'">
            <span class="icon sm">view_timeline</span><b>Within a day</b>
          </button>
          <button role="tab" :aria-selected="mode === 'days'" :class="{ on: mode === 'days' }" @click="mode = 'days'">
            <span class="icon sm">date_range</span><b>Across days</b>
          </button>
        </div>
        <p class="explain">
          <template v-if="mode === 'day'">Same day, several sittings: each part gets a start time in that day's free gaps. The workload bucket still shows it as one task.</template>
          <template v-else>One part per day: each part moves to its own day (untimed — drag it onto that day's timeline later).</template>
        </p>

        <div class="ctl">
          <span class="tiny upper muted">Parts</span>
          <div class="seg">
            <button v-for="k in [2, 3, 4, 5]" :key="k" :class="{ on: parts.length === k }" :disabled="total / k < 10" @click="setN(k)">{{ k }}</button>
          </div>
          <span class="mono small muted">≈{{ Math.round(total / parts.length) }}m each</span>
        </div>
        <div v-if="mode === 'day'" class="ctl">
          <span class="tiny upper muted">Day</span>
          <div class="seg days">
            <button v-for="d in days" :key="d" :class="{ on: day === d }" :disabled="!usable(d)" :title="`${wd(d)} ${fmtSlash(d)}`" @click="day = d">{{ dayLabel(d) }}</button>
          </div>
        </div>

        <!-- within a day: before / after strip -->
        <div v-if="mode === 'day'" class="mini">
          <div class="mrow">
            <span class="tiny upper muted mlbl">Now</span>
            <div class="track">
              <i v-for="b in others" :key="b.id" class="blk" :style="pos(b)" :title="`${b.start}–${b.end} ${b.title}`"></i>
              <i v-for="b in own" :key="'o' + b.id" class="blk own" :style="pos(b)" :title="`${b.start}–${b.end} this task`"></i>
              <b v-if="nowPct !== null" class="now" :style="{ left: nowPct + '%' }"></b>
            </div>
          </div>
          <div class="mrow">
            <span class="tiny upper muted mlbl">After</span>
            <div class="track">
              <i v-for="b in others" :key="b.id" class="blk" :style="pos(b)"></i>
              <i v-for="p in after" :key="'p' + p.i" class="blk part" :style="pos(p)" :title="`Part ${p.i + 1}: ${p.start}–${p.end}`"><span class="mono">{{ p.i + 1 }}</span></i>
              <b v-if="nowPct !== null" class="now" :style="{ left: nowPct + '%' }"></b>
            </div>
          </div>
          <div class="mrow axis">
            <span></span>
            <div class="track bare">
              <span v-for="m in ticks" :key="m" class="tick mono" :style="{ left: pct(m) + '%' }">{{ fromMin(m).slice(0, 2) }}</span>
            </div>
          </div>
          <div class="legend small muted">
            <span><i class="lg"></i>other blocks</span>
            <span><i class="lg own"></i>{{ own.length ? 'this task now' : `this task (no time on ${dayLabel(day)} yet)` }}</span>
            <span><i class="lg part"></i>parts</span>
          </div>
        </div>

        <div class="parts">
          <div v-for="(p, i) in parts" :key="i" class="prow">
            <span class="mono small muted no">{{ i + 1 }}</span>
            <input v-model.number="p.min" type="number" min="5" step="5" class="input mono mins" :aria-label="`Part ${i + 1} minutes`" @change="mode === 'day' && place()" />
            <span class="small muted">min</span>
            <template v-if="mode === 'day'">
              <span class="small muted">at</span>
              <input v-model="p.start" type="time" step="900" class="input mono start" :aria-label="`Part ${i + 1} start`" />
              <span v-if="!p.start" class="small warn grow">untimed — waits in the bucket</span>
              <span v-else class="small muted grow mono">–{{ fromMin(Math.min(1440, toMin(p.start) + (Number(p.min) || 30))) }}</span>
              <button v-if="p.start" class="btn sm icon-only" title="No start time for this part (drag it onto the timeline later)" @click="p.start = null"><span class="icon sm">timer_off</span></button>
            </template>
            <template v-else>
              <span class="small muted">on</span>
              <select v-model="p.date" class="select grow" :aria-label="`Part ${i + 1} day`">
                <option :value="null">Backlog (decide later)</option>
                <option v-for="d in days" :key="d" :value="d" :disabled="!usable(d)">
                  {{ wd(d) }} {{ fmtSlash(d) }}{{ !usable(d) ? ' · past' : t.due && d > t.due ? ' · after due!' : '' }}
                </option>
              </select>
              <span v-if="keepsStart(p, i)" class="small muted mono" title="Stays on the task's day, so it keeps its start time">{{ t.scheduled.start }}</span>
            </template>
          </div>
          <div class="sumrow small">
            <template v-if="mode === 'day'">
              <button class="btn sm" title="Re-pick start times from the day's free gaps" @click="place"><span class="icon sm">auto_fix_high</span>Auto times</button>
              <span v-if="unplaced" class="warn">{{ unplaced }} part{{ unplaced > 1 ? 's' : '' }} didn't fit {{ WORK_FROM }}–{{ WORK_TO }}</span>
              <button v-if="fitDay" class="btn sm" :title="`Every part fits on ${wd(fitDay)} ${fmtSlash(fitDay)}`" @click="day = fitDay"><span class="icon sm">east</span>All fit {{ dayLabel(fitDay) }}</button>
              <span v-else class="muted mono">{{ dayLabel(day) }} free {{ fmtH(dayFree) }} of {{ CAPACITY_H }}h</span>
            </template>
            <button v-else class="btn sm" @click="place"><span class="icon sm">auto_fix_high</span>Auto-assign days</button>
            <span class="spacer"></span>
            <span class="mono" :class="sum === total ? 'muted' : 'warn'">{{ sum }}m / {{ total }}m<template v-if="sum !== total"> · estimate changes</template></span>
          </div>
        </div>

        <!-- across days: load per day -->
        <div v-if="mode === 'days'" class="pv">
          <div class="tiny upper muted">Day load after the split</div>
          <div v-for="p in preview" :key="p.d" class="pvrow" :class="{ off: !usable(p.d) }">
            <span class="mono small dl">{{ wd(p.d) }} {{ fmtSlash(p.d) }}</span>
            <div class="bar">
              <i class="base" :style="{ width: (p.base / pmax) * 100 + '%' }"></i>
              <i v-if="p.add" class="add" :style="{ left: (p.base / pmax) * 100 + '%', width: (p.add / pmax) * 100 + '%' }"></i>
              <b class="cap" :style="{ left: (CAPACITY_H / pmax) * 100 + '%' }"></b>
            </div>
            <span class="mono small val" :class="p.after > CAPACITY_H ? 'danger' : 'muted'">{{ p.after.toFixed(1) }}h</span>
          </div>
        </div>
      </div>

      <footer class="ft">
        <span class="small muted grow hint">Parts keep title, links, priority, due. <span class="kbd">Enter</span> split · <span class="kbd">Esc</span> cancel · undo in the toast</span>
        <button class="btn" @click="close">Cancel</button>
        <button class="btn primary" :disabled="!valid" @click="apply">
          <span class="icon sm">call_split</span>Split into {{ parts.length }}<template v-if="mode === 'day'"> · {{ dayLabel(day) }}</template>
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--scrim); z-index: 55; display: flex; justify-content: center; align-items: flex-start; padding-top: 8vh; }
.dlg { width: 620px; max-width: calc(100vw - 32px); max-height: 86vh; display: flex; flex-direction: column; background: var(--surface); border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border)); border-radius: 4px; outline: none; }
.hd { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.ttl { font-weight: 600; font-size: 15px; }
.est { font-size: 13px; }
.bd { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.scope { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 2px; }
.scope .muted { width: 100%; }
.scope label { display: flex; align-items: center; gap: 5px; cursor: pointer; }

.modes { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
.modes button { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 8px; background: transparent; border: 0; color: var(--muted); font: inherit; font-size: 14px; cursor: pointer; }
.modes button + button { border-left: 1px solid var(--border); }
.modes button.on { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); box-shadow: inset 0 -2px 0 var(--accent); }
.modes button:focus-visible { outline: 1px solid var(--info); outline-offset: -2px; }
.explain { margin: -4px 0 0; font-size: 13px; color: var(--muted); }

.ctl { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 2px; overflow: hidden; }
.seg button { min-width: 32px; height: 28px; padding: 0 8px; background: transparent; border: 0; color: var(--muted); font: 12px 'JetBrains Mono', monospace; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--border); }
.seg button.on { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.seg button:disabled { opacity: 0.35; cursor: not-allowed; }
.seg.days button { font-family: inherit; }

.mini { display: flex; flex-direction: column; gap: 4px; }
.mrow { display: grid; grid-template-columns: 44px 1fr; align-items: center; gap: 6px; }
.track { position: relative; height: 22px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 2px; }
.track.bare { height: 14px; background: none; border: 0; }
.blk { position: absolute; top: 3px; bottom: 3px; background: var(--muted); opacity: 0.45; border-radius: 1px; }
.blk.own { background: transparent; opacity: 1; border: 1px dashed var(--info); }
.blk.part { background: var(--info); opacity: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.blk.part span { font-size: 10px; color: var(--surface); font-weight: 700; }
.now { position: absolute; top: -2px; bottom: -2px; width: 0; border-left: 2px solid var(--stamp); }
.legend { display: flex; flex-wrap: wrap; gap: 2px 14px; padding-left: 50px; }
.lg { display: inline-block; width: 12px; height: 8px; margin-right: 5px; vertical-align: middle; background: var(--muted); opacity: 0.45; }
.lg.own { background: transparent; opacity: 1; border: 1px dashed var(--info); }
.lg.part { background: var(--info); opacity: 1; }
.tick { position: absolute; top: 0; transform: translateX(-50%); font-size: 10px; color: var(--muted); }

.parts { display: flex; flex-direction: column; gap: 6px; }
.prow { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.prow .no { width: 14px; text-align: right; }
.mins { width: 68px; }
.start { width: 104px; flex: none; }
.sumrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.pv { display: flex; flex-direction: column; gap: 5px; border-top: 1px solid var(--border); padding-top: 10px; }
.pvrow { display: grid; grid-template-columns: 82px 1fr 48px; align-items: center; gap: 8px; }
.pvrow.off { opacity: 0.45; }
.bar { position: relative; height: 10px; background: var(--surface-2); border-radius: 2px; }
.bar i { position: absolute; top: 0; bottom: 0; }
.base { left: 0; background: var(--muted); opacity: 0.55; border-radius: 2px 0 0 2px; }
.add { background: var(--info); border-radius: 0 3px 3px 0; margin-left: 2px; }
.cap { position: absolute; top: -3px; bottom: -3px; width: 0; border-left: 2px solid var(--text); opacity: 0.6; }
.val { text-align: right; }

.ft { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
.btn:disabled { opacity: 0.35; cursor: not-allowed; }
@media (max-width: 640px) {
  /* bottom sheet: sized to its content, thumb-reachable buttons */
  .scrim { padding-top: 0; align-items: flex-end; }
  .dlg { max-width: 100vw; max-height: 100%; width: 100%; border-radius: 6px 6px 0 0; border-width: 1px 0 0; }
  .ttl { font-size: 14px; }
  .legend { padding-left: 0; }
  .hint { display: none; }
  .ft { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
  .ft .btn { height: 38px; }
  .ft .btn.primary { flex: 1; justify-content: center; }
  .start { width: 96px; }
}
</style>
