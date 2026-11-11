<script setup>
// The Briefing / Debrief frame: one decision per step. The left side asks the question and lists the
// options (a cursor moves through them: hover, ↑↓); the right side shows the real day schedule as it would
// be with the option under the cursor, plus the numbers it changes (before → after, ↑/↓) and one verdict line.
// Picking an option applies it straight away (Back / Change undo it). The last step is a recap + finish.
//
// step = { key, grp?, title(), why()?, tone?, days(): [dates], options(): [{ label, sim, rec?, verdict? }], stale()? }
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { state, wd, parseISO, MONTHS, todayISO, blocksFrom, toMin, fromMin } from '../store'
import { simTodos, simStats, simVerdict, untimedIn, objectiveIn, applySim, windDownAt, dur } from '../review'
import DayTimeline from './DayTimeline.vue'

const props = defineProps({
  title: String, date: String, finish: String,
  steps: { type: Array, required: true },
  recapDays: { type: Array, default: () => [] },
})
const emit = defineEmits(['done'])

const idx = ref(0)
const answers = reactive({}) // key → { label, undo }
const was = reactive({}) // key → label picked before the user came back to the step
const cursor = ref(null)
const flash = ref(null)
const n = computed(() => props.steps.length)
const step = computed(() => props.steps[idx.value] ?? null)
const stale = computed(() => step.value?.stale?.() ?? null)
const opts = computed(() => (step.value && !stale.value ? step.value.options() : []))
const recIdx = computed(() => Math.max(0, opts.value.findIndex((o) => o.rec)))
const cur = computed(() => {
  if (cursor.value != null && opts.value[cursor.value]) return cursor.value
  const k = step.value && was[step.value.key] ? opts.value.findIndex((o) => o.label === was[step.value.key]) : -1
  return k >= 0 ? k : recIdx.value
})
const label = computed(() => { const d = parseISO(props.date); return `${wd(props.date)} ${d.getDate()} ${MONTHS[d.getMonth()]}` })

/* ── moving between steps: a step you come back to is undone until you pick again (or leave it) ── */
function leave() {
  const s = step.value
  if (!s || answers[s.key] || !was[s.key]) return
  const o = opts.value.find((x) => x.label === was[s.key])
  if (o) answers[s.key] = { label: o.label, undo: applySim(o.sim) }
  delete was[s.key]
}
function enter(i) {
  idx.value = i
  cursor.value = null
  const s = props.steps[i]
  if (s && answers[s.key]) { answers[s.key].undo(); was[s.key] = answers[s.key].label; delete answers[s.key] }
}
const go = (i) => { if (flash.value) return; leave(); enter(Math.max(0, Math.min(n.value, i))) }
function choose(k) {
  const o = opts.value[k]
  if (!o || flash.value) return
  answers[step.value.key] = { label: o.label, undo: applySim(o.sim) }
  delete was[step.value.key]
  flash.value = o.label
  setTimeout(() => { flash.value = null; enter(idx.value + 1) }, 380)
}

/* ── the preview ── */
const wdn = computed(() => windDownAt())
function preview(sim, days) {
  const before = state.todos
  const after = simTodos(sim)
  const obj = Object.fromEntries(days.map((d) => [d, objectiveIn(after, d)?.id]))
  const cols = days.map((date) => {
    const b0 = blocksFrom(date, before), b1 = blocksFrom(date, after)
    const at0 = new Map(b0.filter((b) => b.todoId).map((b) => [b.todoId, b.start]))
    const ghosts = b0.filter((b) => b.todoId && !b1.some((x) => x.todoId === b.todoId && x.start === b.start)).map((b) => ({ ...b, id: 'ghost-' + b.id, ghost: true }))
    const u0 = untimedIn(before, date).map((t) => t.id), u1 = untimedIn(after, date)
    return {
      date, blocks: [...ghosts, ...b1],
      mark: (b) => b.ghost ? 'pv-ghost' : [
        b.todoId && at0.get(b.todoId) !== b.start ? 'pv-new' : '',
        b.kind === 'todo' && !b.done && toMin(b.end) > wdn.value ? 'pv-late' : '',
        b.todoId && b.todoId === obj[date] ? 'pv-star' : ''].join(' '),
      untimed: [...u1.map((t) => ({ id: t.id, title: t.title, m: t.timeMin || 30, cls: u0.includes(t.id) ? '' : 'new', star: t.id === obj[date] })),
        ...u0.filter((id) => !u1.some((t) => t.id === id)).map((id) => ({ id, title: state.todos.find((t) => t.id === id)?.title ?? id, cls: 'gone' }))],
    }
  })
  // tasks that leave the days on screen land in a strip under them (backlog, done, another day): an arrow target
  const was0 = new Map(before.map((t) => [t.id, t]))
  const off = after.filter((t) => {
    const t0 = was0.get(t.id)
    if (!t0 || !days.includes(t0.scheduled?.date)) return false
    return (t.done && !t0.done) || !t.scheduled || !days.includes(t.scheduled.date)
  }).map((t) => ({ id: t.id, title: t.title, where: t.done && !was0.get(t.id).done ? '✓ Done' : !t.scheduled ? 'Backlog' : wd(t.scheduled.date) }))
  return { cols, off, stats: simStats(before, after, days), after }
}
/** The days an option touches (where its tasks are now and where they'd go); the step's own day if it changes nothing.
 *  Returned with the step's day first (verdicts and results are about it); columns are drawn in date order. */
function daysFor(s, sim) {
  const own = s.days()[0], set = new Set()
  for (const [id, f] of Object.entries(sim?.patch ?? {})) {
    const t0 = state.todos.find((t) => t.id === id)
    if (t0?.scheduled?.date) set.add(t0.scheduled.date)
    if (f.scheduled?.date) set.add(f.scheduled.date)
  }
  for (const a of sim?.add ?? []) if (a.scheduled?.date) set.add(a.scheduled.date)
  if (!set.size) set.add(own)
  return [...set].sort((a, b) => (b === own) - (a === own) || a.localeCompare(b))
}
const view = computed(() => {
  if (idx.value >= n.value) return { ...preview({ patch: {}, add: [] }, props.recapDays), verdict: null }
  const s = step.value
  const o = opts.value[cur.value]
  const days = daysFor(s, o?.sim)
  const p = preview(o?.sim ?? { patch: {}, add: [] }, days)
  p.cols.sort((x, y) => x.date.localeCompare(y.date))
  // results: only what the step is about (another day's untimed / objective changes are incidental), at most four
  const aboutObjective = Object.values(o?.sim?.patch ?? {}).some((f) => 'priority' in f)
  const stats = p.stats.filter((r) => !(r.anchor?.day && r.anchor.day !== days[0] && ['untimed', 'objective'].includes(r.anchor.kind)))
    .filter((r) => r.anchor?.kind !== 'objective' || aboutObjective)
    .sort((x, y) => (good(y) === 'bad') - (good(x) === 'bad')).slice(0, 4)
  return { ...p, stats, verdict: o ? (o.verdict ?? simVerdict(p.after, days)) : null }
})
const tones = computed(() => opts.value.map((o) => (o.verdict ?? simVerdict(simTodos(o.sim), daysFor(step.value, o.sim)))[1]))
const span = computed(() => {
  const all = view.value.cols.flatMap((c) => c.blocks)
  const lo = Math.min(7, ...all.map((b) => Math.floor(toMin(b.start) / 60)))
  return { from: Math.max(0, lo), to: 24 }
})
// the schedule fills the window's height (no empty space under it); phones scroll instead
const winH = ref(typeof window === 'undefined' ? 900 : window.innerHeight)
const onResize = () => { winH.value = window.innerHeight; redraw() }
const pxh = computed(() => {
  if (typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches) return 18
  const extra = view.value.cols.some((c) => c.untimed.length) ? 40 : 0
  return Math.max(16, Math.min(48, Math.floor((winH.value - 230 - extra) / (span.value.to - span.value.from))))
})

const arrow = (r) => (typeof r.an === 'number' && typeof r.bn === 'number' && r.an !== r.bn ? (r.bn > r.an ? '↑' : '↓') : String(r.a) !== String(r.b) ? '→' : '')
const good = (r) => {
  if (r.bad) return 'bad'
  if (r.good) return 'good'
  if (!r.better || typeof r.an !== 'number' || r.an === r.bn) return ''
  return (r.better === 'higher') === (r.bn > r.an) ? 'good' : 'bad'
}
const dayName = (d) => (d === todayISO() ? 'Today' : wd(d)) + ' ' + parseISO(d).getDate()

/* ── wires (loadout-screen style), drawn once blocks settle, in the order things happen:
   1. the option → the block (or chip) it moves  2. where the task was → where it goes
   3. each thing that changes (block, chip strip, backlog tag) → its result callout on the right ── */
const stage = ref(null)
const wires = ref([])
const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
let wireTimer
const tone = (r) => ({ good: 'ok', bad: 'danger' })[good(r)] ?? ''
const chipOf = (t) => ({ ok: 'OK', warn: 'CHECK', danger: 'PROBLEM' })[t] ?? 'NOTE'
function measure() {
  const el = stage.value
  if (!el) { wires.value = []; return }
  const box = el.getBoundingClientRect()
  const rect = (node) => { const b = node.getBoundingClientRect(); return { x: b.left - box.left, y: b.top - box.top, w: b.width, h: b.height, r: b.right - box.left, cy: b.top - box.top + b.height / 2 } }
  const out = []
  // 2. moves: old place → new place
  for (const d of el.querySelectorAll('.pv .vb.pv-new[data-tid], .pv .uc.new[data-tid]')) {
    const id = d.dataset.tid
    const s0 = el.querySelector(`.pv .vb.pv-ghost[data-tid="${id}"], .pv .uc.gone[data-tid="${id}"]`)
    if (!s0) continue
    const a = rect(s0), b = rect(d)
    const ax = a.x + a.w / 2, ay = a.cy, bx = b.x + b.w / 2, by = b.cy
    const clampX = (x, r) => Math.max(r.x + 24, Math.min(r.x + r.w - 24, x))
    let path
    if (d.classList.contains('vb') && s0.classList.contains('vb') && Math.abs(bx - ax) < 60) {
      const sx = Math.min(a.r, b.r) - 18, bulge = Math.min(90, 30 + Math.abs(by - ay) / 4)
      const ty = by > ay ? b.y - 3 : b.y + b.h + 3
      path = `M${sx},${ay} C${sx + bulge},${ay} ${sx + bulge},${ty} ${sx - 6},${ty}`
    } else if (Math.abs(by - ay) > Math.abs(bx - ax)) {
      const sx = ax, sy = by < ay ? a.y - 2 : a.y + a.h + 2
      const ex = clampX(ax, b), ty = by < ay ? b.y + b.h + 3 : b.y - 3, my = (sy + ty) / 2
      path = `M${sx},${sy} C${sx},${my} ${ex},${my} ${ex},${ty}`
    } else {
      const ex = bx > ax ? b.x - 4 : b.r + 4, sx = bx > ax ? a.r + 2 : a.x - 2, mx = (sx + ex) / 2
      path = `M${sx},${ay} C${mx},${ay} ${mx},${by} ${ex},${by}`
    }
    out.push({ key: 'mv-' + id, cls: 'mv', d: path, delay: 0.18 })
  }
  // 1. the option → what it acts on (first match in priority order, not document order)
  const pv = el.querySelector('.pv'), optEl = el.querySelector('.opt.cur')
  const pick = (...sels) => { for (const q of sels) { const n0 = el.querySelector(q); if (n0) return n0 } return null }
  const target = pick('.pv .vb.pv-new', '.pv .uc.new', '.pv .vb.pv-star', '.pv .uc.star', '.pv .dh')
  if (!pv) { wires.value = out; return }
  const p = rect(pv)
  let topK = 0, botK = 0
  const topY = () => p.y + 5 + topK++ * 4, botY = () => p.y + p.h - 5 - botK++ * 4
  /** How a wire reaches an element inside the schedule: via the band above or below the columns, dropping into its edge. */
  const port = (node) => {
    const r = rect(node)
    if (node.classList.contains('dh')) return { x: r.x + 64, y: r.cy, band: topY() }
    if (node.closest('.off')) return { x: r.r + 3, y: r.cy, band: null }
    const lower = r.cy > p.y + p.h / 2
    const x = Math.max(r.x + 14, Math.min(r.r - 14, node.classList.contains('vb') ? r.x + r.w * 0.72 : r.x + r.w / 2))
    return lower ? { x, y: r.y + r.h + 3, band: botY() } : { x, y: r.y - 3, band: topY() }
  }
  if (optEl && target) {
    const o = rect(optEl), t = rect(target), left = p.x - 14
    const inFirstCol = target.classList.contains('vb') && t.x < p.x + 120
    let d
    if (inFirstCol) d = `M${o.r - 4},${o.cy} H${left} V${t.cy} H${t.x + 4}`
    else { const q = port(target); d = q.band == null ? `M${o.r - 4},${o.cy} H${left} V${p.y + p.h + 8} H${q.x + 30} V${q.y} H${q.x}` : `M${o.r - 4},${o.cy} H${left} V${q.band} H${q.x} V${q.y}` }
    out.push({ key: 'ow', cls: 'ow', d, delay: 0 })
  }
  // 3. what changed → its callout (out through a band, down a bus right of the schedule, into the box)
  const anchorFor = (a) => {
    if (!a || a.kind === 'verdict') return target
    if (a.kind === 'off') return el.querySelector('.pv .off .uc')
    const col = el.querySelector(`.pv .dcol[data-day="${a.day}"]`)
    if (!col) return null
    if (a.kind === 'untimed') return col.querySelector('.ut') ?? col.querySelector('.dh')
    if (a.kind === 'objective') return col.querySelector('.vb.pv-star') ?? col.querySelector('.uc.star') ?? col.querySelector('.dh')
    return col.querySelector('.dh')
  }
  el.querySelectorAll('.results .co').forEach((co, i) => {
    const k = co.dataset.co
    const an = anchorFor(k === 'v' ? { kind: 'verdict' } : view.value.stats[+k]?.anchor)
    if (!an) return
    const c = rect(co), bus = p.r + 10 + (i % 5) * 6, ex = c.x - 3, ey = c.y + 18
    const q = port(an)
    const d = q.band == null ? `M${q.x},${q.y} H${bus} V${ey} H${ex}` : `M${q.x},${q.y} V${q.band} H${bus} V${ey} H${ex}`
    out.push({ key: 'cw-' + k, cls: 'cw', d, delay: 0.32 + i * 0.07, dot: [q.x, q.y] })
  })
  wires.value = out
}
function redraw() { wires.value = []; clearTimeout(wireTimer); wireTimer = setTimeout(() => nextTick(measure), still ? 0 : 340) }
watch([cur, idx, pxh], redraw)
onMounted(redraw)

/* ── keys ── */
function onKey(e) {
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
  if (idx.value >= n.value) { if (e.key === 'ArrowLeft') { e.preventDefault(); go(n.value - 1) } return }
  const L = opts.value.length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (L) cursor.value = (cur.value + (e.key === 'ArrowDown' ? 1 : -1) + L) % L }
  else if (e.key === 'Enter' && !e.target.closest?.('button')) { e.preventDefault(); stale.value ? go(idx.value + 1) : choose(cur.value) }
  else if (/^[1-9]$/.test(e.key) && +e.key <= L) choose(+e.key - 1)
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx.value - 1) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); go(idx.value + 1) }
}
onMounted(() => { window.addEventListener('keydown', onKey); window.addEventListener('resize', onResize) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize) })
watch(() => props.steps.length, (v) => { if (idx.value > v) idx.value = v })
</script>

<template>
  <div class="bf">
    <header class="bh">
      <div class="bt">
        <span class="ttl">{{ title }}</span><span class="mono muted">{{ label }}</span>
        <span class="spacer"></span>
        <span class="mono muted">{{ idx < n ? `${idx + 1} / ${n}` : 'recap' }}</span>
        <router-link to="/" class="mono esc" title="Leave (Esc)">ESC</router-link>
      </div>
      <div class="rail" aria-hidden="true">
        <i v-for="(s, k) in steps" :key="s.key" :class="[{ on: k === idx, past: k < idx }, s.tone && 't-' + s.tone]" @click="go(k)"></i>
        <i :class="{ on: idx === n }" @click="go(n)"></i>
      </div>
    </header>

    <div ref="stage" class="stage" :class="{ recap: !step }">
      <div class="left">
        <template v-if="step">
          <div class="q">
            <div v-if="step.grp" class="grp mono">{{ step.grp }}</div>
            <h1>{{ step.title() }}</h1>
            <div v-if="step.why" class="why">{{ step.why() }}</div>
          </div>
          <p v-if="stale" class="stale"><span class="icon sm">check</span>{{ stale }}</p>
          <div v-else class="opts" @mouseleave="cursor = null">
            <button v-for="(o, k) in opts" :key="k" class="opt" :class="{ cur: k === cur, on: flash === o.label }" @mouseenter="cursor = k" @focus="cursor = k" @click="choose(k)">
              <span class="k mono">{{ k + 1 }}</span><span class="ol">{{ o.label }}</span>
              <span v-if="o.rec" class="sug mono">SUGGESTED</span>
              <span class="dot" :class="tones[k]"></span>
            </button>
          </div>
        </template>
        <template v-else>
          <div class="q"><h1>{{ steps.length ? `${Object.keys(answers).length} sorted` : 'Nothing needs you' }}</h1></div>
          <div v-if="steps.length" class="recap">
            <div v-for="(s, k) in steps" :key="s.key" class="rr">
              <span class="c mono" :class="{ skip: !answers[s.key] }">{{ answers[s.key] ? '✓' : '–' }}</span>
              <span class="rt">{{ s.title() }}</span>
              <span class="rv">{{ answers[s.key]?.label ?? 'skipped' }}</span>
              <button class="lnk" @click="go(k)">Change</button>
            </div>
          </div>
          <slot name="recap" />
        </template>
      </div>

      <section class="pv panel">
        <div class="arena">
        <div class="cols" :style="{ gridTemplateColumns: `repeat(${view.cols.length}, minmax(0, 1fr))` }">
          <div v-for="c in view.cols" :key="c.date" class="dcol" :data-day="c.date">
            <div class="dh mono">{{ dayName(c.date) }}</div>
            <DayTimeline :date="c.date" :blocks="c.blocks" :from="span.from" :to="span.to" :pxh="pxh" readonly :mark-fn="c.mark" :line-at="wdn" :line-label="`wind-down ${fromMin(wdn)}`" />
            <div v-if="c.untimed.length" class="ut">
              <span class="tiny upper muted">No time yet</span>
              <span v-for="u in c.untimed" :key="u.id" :data-tid="u.id" class="uc" :class="[u.cls, { star: u.star }]">{{ u.title }}<span v-if="u.m" class="mono um">{{ dur(u.m) }}</span></span>
            </div>
          </div>
        </div>
        <div v-if="view.off?.length" class="off">
          <span v-for="o in view.off" :key="o.id" :data-tid="o.id" class="uc new"><b class="mono">{{ o.where }}</b> {{ o.title }}</span>
        </div>
        </div>
      </section>

      <aside v-if="step && !stale" :key="`${idx}-${cur}`" class="results">
        <span class="tiny upper muted rh">If you pick · {{ opts[cur]?.label }}</span>
        <div v-if="view.verdict" class="co big" :class="'t-' + (view.verdict[1] || 'n')" data-co="v" style="animation-delay: 0.62s">
          <span class="chip-t mono">{{ chipOf(view.verdict[1]) }}</span>
          <span class="cv">{{ view.verdict[0] }}</span>
        </div>
        <div v-for="(r, i) in view.stats" :key="r.k" class="co" :class="'t-' + (tone(r) || 'n')" :data-co="i" :style="{ animationDelay: `${0.7 + i * 0.07}s` }">
          <span class="ck mono">{{ r.k }}</span>
          <span class="cval mono"><span v-if="String(r.a) !== String(r.b)" class="ca">{{ r.a }}</span><span v-if="String(r.a) !== String(r.b)" class="car">{{ arrow(r) }}</span><b>{{ r.b }}</b></span>
        </div>
      </aside>

      <svg class="wires" aria-hidden="true">
        <defs>
          <marker id="pv-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="hd-mv" d="M0,0 L10,5 L0,10 z" /></marker>
          <marker id="pv-wire" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="hd-w" d="M0,0 L10,5 L0,10 z" /></marker>
        </defs>
        <g v-for="w in wires" :key="w.key + w.d" :class="w.cls" :style="{ '--d': w.delay + 's' }">
          <circle v-if="w.dot" class="wd" :cx="w.dot[0]" :cy="w.dot[1]" r="3" />
          <path class="ln" :d="w.d" pathLength="1" />
          <path class="hd" :d="w.d" :marker-end="w.cls === 'mv' ? 'url(#pv-head)' : 'url(#pv-wire)'" />
        </g>
      </svg>
    </div>

    <footer class="bfoot">
      <button class="btn" :disabled="idx === 0" @click="go(idx - 1)"><span class="icon sm">chevron_left</span>Back</button>
      <span class="hint mono muted">↑↓ compare · Enter pick · ← back</span>
      <span class="spacer"></span>
      <button v-if="idx < n" class="btn" @click="go(idx + 1)">{{ stale ? 'Next' : 'Skip' }}</button>
      <button v-else class="btn primary go" @click="emit('done')">{{ finish }}</button>
    </footer>
  </div>
</template>

<style scoped>
.bf { padding: 22px 28px 20px; display: flex; flex-direction: column; gap: 20px; min-height: 100%; box-sizing: border-box; }
.bh { display: flex; flex-direction: column; gap: 10px; }
.bt { display: flex; align-items: baseline; gap: 12px; }
.ttl { font: 700 15px/20px 'JetBrains Mono', monospace; letter-spacing: 0.14em; text-transform: uppercase; }
.esc { font-size: 10px; color: var(--muted); text-decoration: none; border: 1px solid var(--border); padding: 2px 6px; border-radius: 2px; }
.rail { display: flex; gap: 4px; }
.rail i { flex: 1; height: 4px; border-radius: 2px; background: var(--surface-2); cursor: pointer; }
.rail i.past { background: color-mix(in srgb, var(--accent) 50%, transparent); }
.rail i.on { background: var(--accent); }
.rail i.t-danger:not(.on):not(.past) { background: color-mix(in srgb, var(--danger) 45%, transparent); }
.rail i.t-warn:not(.on):not(.past) { background: color-mix(in srgb, var(--warn) 45%, transparent); }

.stage { position: relative; display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.3fr) minmax(220px, 300px); gap: 44px; align-items: start; flex: 1 0 auto; }
.stage.recap { grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); }
.left { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.q { display: flex; flex-direction: column; gap: 8px; }
.grp { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.q h1 { margin: 0; font: 600 32px/38px Inter, sans-serif; text-wrap: balance; }
.why { font-size: 16px; line-height: 23px; color: var(--muted); }
.stale { display: flex; gap: 8px; align-items: center; color: var(--accent); font-size: 16px; margin: 0; }

.opts { display: flex; flex-direction: column; border-top: 1px solid var(--border); }
.opt { display: flex; align-items: center; gap: 14px; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--border); border-left: 3px solid transparent; padding: 13px 14px 13px 12px; font-size: 17px; line-height: 23px; min-height: 54px; color: var(--text); cursor: pointer; }
.opt .k { font-size: 12px; color: var(--muted); width: 14px; flex: none; }
.opt .ol { min-width: 0; }
.opt .sug { font-size: 10px; letter-spacing: 0.1em; color: var(--accent); margin-left: 6px; }
.opt .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); flex: none; margin-left: auto; }
.opt .dot.ok { background: var(--accent); } .opt .dot.warn { background: var(--warn); } .opt .dot.danger { background: var(--danger); }
.opt.cur { background: color-mix(in srgb, var(--accent) 9%, transparent); border-left-color: var(--accent); }
.opt.cur .k { color: var(--accent); }
.opt.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }

.recap { display: flex; flex-direction: column; border-top: 1px solid var(--border); }
.rr { display: flex; gap: 12px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 15px; }
.rr .c { color: var(--accent); width: 14px; flex: none; }
.rr .c.skip { color: var(--muted); }
.rr .rt { flex: 1; min-width: 0; }
.rr .rv { color: var(--muted); }
.lnk { background: none; border: 0; color: var(--muted); text-decoration: underline; font-size: 12px; cursor: pointer; padding: 0; }

.pv { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.arena { position: relative; }
.off { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; margin-top: 18px; }
.off .uc b { margin-right: 4px; }
.cols { display: grid; gap: 10px; }
.wires { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 6; }
.wires .ln { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.wires .hd { fill: none; stroke: none; }
.wires .mv .ln { stroke: var(--accent); stroke-width: 2.5; filter: drop-shadow(0 0 3px color-mix(in srgb, var(--bg) 80%, transparent)); }
.hd-mv { fill: var(--accent); }
.wires .ow .ln, .wires .cw .ln { stroke: var(--info); filter: drop-shadow(0 0 4px color-mix(in srgb, var(--info) 45%, transparent)); }
.hd-w { fill: var(--info); }
.wires .wd { fill: var(--info); }
@media (prefers-reduced-motion: no-preference) {
  /* each wire draws itself (dash trick; it ends as a solid line), then its arrowhead appears */
  .wires .ln { stroke-dasharray: 1; stroke-dashoffset: 1; animation: pv-draw 0.34s cubic-bezier(.4,0,.2,1) var(--d) forwards; }
  .wires .hd, .wires .wd { opacity: 0; animation: pv-head 0.12s calc(var(--d) + 0.3s) ease-out forwards; }
  .wires .wd { animation-delay: var(--d); }
  .uc { transition: background-color 0.2s, color 0.2s; }
  .uc.new { animation: pv-pop 0.3s cubic-bezier(.2,.8,.2,1); }
  .co { opacity: 0; animation: co-in 0.22s ease-out forwards; }
}
@keyframes pv-draw { to { stroke-dashoffset: 0; } }
@keyframes pv-head { to { opacity: 1; } }
@keyframes pv-pop { from { opacity: 0; transform: translateY(4px) scale(0.9); } }
@keyframes co-in { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: none; } }

/* result callouts (right column): a box per thing that changes, glowing in its status colour */
.results { display: flex; flex-direction: column; gap: 16px; min-width: 0; padding-top: 4px; }
.rh { padding-bottom: 2px; }
.co { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--info) 55%, var(--border)); border-radius: 3px; background: color-mix(in srgb, var(--info) 6%, var(--surface)); }
.co.t-ok { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 30%, transparent); }
.co.t-danger { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, var(--surface)); box-shadow: 0 0 14px color-mix(in srgb, var(--danger) 32%, transparent); }
.co.t-warn { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 8%, var(--surface)); box-shadow: 0 0 14px color-mix(in srgb, var(--warn) 28%, transparent); }
.ck { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.cval { display: flex; align-items: baseline; gap: 8px; font-size: 13px; min-width: 0; }
.cval .ca { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45%; }
.cval b { font-size: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.t-ok .cval b, .t-ok .car { color: var(--accent); } .t-danger .cval b, .t-danger .car { color: var(--danger); }
.co.big { gap: 6px; padding: 12px 14px; }
.chip-t { align-self: flex-start; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; padding: 1px 6px; border-radius: 2px; border: 1px solid currentColor; color: var(--info); }
.t-ok .chip-t { color: var(--accent); } .t-danger .chip-t { color: var(--danger); } .t-warn .chip-t { color: var(--warn); }
.cv { font-size: 17px; line-height: 23px; }
.t-ok .cv { color: var(--accent); } .t-danger .cv { color: var(--danger); } .t-warn .cv { color: var(--warn); }
.dcol { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dh { font-size: 12px; font-weight: 600; }
.ut { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.uc { font-size: 11px; padding: 2px 6px; border-radius: 3px; background: var(--surface-2); border: 1px solid var(--border); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uc .um { margin-left: 6px; opacity: 0.8; }
.uc.new { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.uc.gone { text-decoration: line-through; color: var(--muted); background: none; }
.uc.star { outline: 2px solid var(--warn); }


.bfoot { display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--border); padding-top: 12px; }
.bfoot .hint { font-size: 11px; }
.go { font-size: 15px; padding: 10px 24px; }
.bfoot .btn:disabled { opacity: 0.35; cursor: default; }
@media (max-width: 900px) {
  .bf { padding: 14px 12px 0; gap: 14px; }
  .stage, .stage.recap { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .wires .ow, .wires .cw { display: none; }
  .results { order: 3; }
  .q h1 { font-size: 24px; line-height: 30px; }
  .why { font-size: 15px; }
  .opt { font-size: 15px; min-height: 48px; }
  .bfoot { position: sticky; bottom: 0; z-index: 10; background: var(--bg); padding: 10px 0 calc(10px + env(safe-area-inset-bottom)); }
  .bfoot .hint { display: none; }
  .sa, .sb { max-width: 34vw; }
  .sb { font-size: 15px; }
}
</style>
