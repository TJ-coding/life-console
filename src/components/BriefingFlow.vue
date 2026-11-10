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
const view = computed(() => {
  if (idx.value >= n.value) return { ...preview({ patch: {}, add: [] }, props.recapDays), verdict: null }
  const s = step.value, days = s.days()
  const o = opts.value[cur.value]
  const p = preview(o?.sim ?? { patch: {}, add: [] }, days)
  return { ...p, verdict: o ? (o.verdict ?? simVerdict(p.after, days)) : null }
})
const tones = computed(() => opts.value.map((o) => (o.verdict ?? simVerdict(simTodos(o.sim), step.value.days()))[1]))
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

/* ── arrows: from where a task was (outline / chip) to where the option puts it, drawn once blocks settle ── */
const arena = ref(null)
const arrows = ref([])
const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
let arrowTimer
function measure() {
  const el = arena.value
  if (!el) { arrows.value = []; return }
  const box = el.getBoundingClientRect()
  const rect = (n) => { const b = n.getBoundingClientRect(); return { x: b.left - box.left, y: b.top - box.top, w: b.width, h: b.height } }
  const out = []
  for (const d of el.querySelectorAll('.vb.pv-new[data-tid], .uc.new[data-tid]')) {
    const id = d.dataset.tid
    const s0 = el.querySelector(`.vb.pv-ghost[data-tid="${id}"], .uc.gone[data-tid="${id}"]`)
    if (!s0) continue
    const a = rect(s0), b = rect(d)
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2
    const clampX = (x, r) => Math.max(r.x + 24, Math.min(r.x + r.w - 24, x))
    let path
    if (d.classList.contains('vb') && s0.classList.contains('vb') && Math.abs(bx - ax) < 60) {
      // a block moving within its day: out of the old slot's right side, curving into the new one
      const sx = Math.min(a.x + a.w, b.x + b.w) - 18, bulge = Math.min(90, 30 + Math.abs(by - ay) / 4)
      const ty = by > ay ? b.y - 3 : b.y + b.h + 3
      path = `M${sx},${ay} C${sx + bulge},${ay} ${sx + bulge},${ty} ${sx - 6},${ty}`
    } else if (Math.abs(by - ay) > Math.abs(bx - ax)) {
      // mostly up or down (a chip under the schedule going onto it): into the nearest edge, right above / below
      const sx = ax, sy = by < ay ? a.y - 2 : a.y + a.h + 2
      const ex = clampX(ax, b), ty = by < ay ? b.y + b.h + 3 : b.y - 3, my = (sy + ty) / 2
      path = `M${sx},${sy} C${sx},${my} ${ex},${my} ${ex},${ty}`
    } else {
      // sideways (into another day's column): an S-curve into the target's near side
      const ex = bx > ax ? b.x - 4 : b.x + b.w + 4, sx = bx > ax ? a.x + a.w + 2 : a.x - 2, mx = (sx + ex) / 2
      path = `M${sx},${ay} C${mx},${ay} ${mx},${by} ${ex},${by}`
    }
    out.push({ id, d: path })
  }
  arrows.value = out
}
function redraw() { arrows.value = []; clearTimeout(arrowTimer); arrowTimer = setTimeout(() => nextTick(measure), still ? 0 : 340) }
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

    <div class="stage">
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
        <div v-if="view.stats.length" class="spec">
            <div v-for="r in view.stats" :key="r.k" class="sr">
              <span class="sk mono">{{ r.k }}</span>
              <span class="sa mono">{{ String(r.a) === String(r.b) ? '' : r.a }}</span>
              <span class="sar mono" :class="good(r)">{{ arrow(r) }}</span>
              <span class="sb mono" :class="good(r)">{{ r.b }}</span>
            </div>
          </div>
          <div v-if="view.verdict && step" class="verdict">
            <span class="tiny upper muted">If you pick · {{ opts[cur]?.label }}</span>
            <span class="vt" :class="view.verdict[1]">{{ view.verdict[0] }}</span>
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
        <div ref="arena" class="arena">
        <div class="cols" :style="{ gridTemplateColumns: `repeat(${view.cols.length}, minmax(0, 1fr))` }">
          <div v-for="c in view.cols" :key="c.date" class="dcol">
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
        <svg class="arrows" aria-hidden="true">
          <defs><marker id="pv-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" /></marker></defs>
          <g v-for="a in arrows" :key="a.id + a.d"><path class="ar" :d="a.d" pathLength="1" /><path class="ah" :d="a.d" marker-end="url(#pv-head)" /></g>
        </svg>
        </div>
      </section>
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

.stage { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 32px; align-items: start; flex: 1 0 auto; }
.left { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.left .spec { margin-top: 4px; }
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
.arrows { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 6; }
.arrows marker path { fill: var(--accent); }
.ah { fill: none; stroke: none; }
.ar { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; filter: drop-shadow(0 0 3px color-mix(in srgb, var(--bg) 80%, transparent)); }
@media (prefers-reduced-motion: no-preference) {
  /* the arrow draws itself from the old place to the new one (dash trick; it ends as a solid line) */
  .ar { stroke-dasharray: 1; stroke-dashoffset: 1; animation: pv-draw 0.42s cubic-bezier(.4,0,.2,1) forwards; }
  .ah { opacity: 0; animation: pv-head 0.15s 0.34s ease-out forwards; }
  .uc { transition: background-color 0.2s, color 0.2s; }
  .uc.new { animation: pv-pop 0.3s cubic-bezier(.2,.8,.2,1); }
}
@keyframes pv-draw { to { stroke-dashoffset: 0; } }
@keyframes pv-head { to { opacity: 1; } }
@keyframes pv-pop { from { opacity: 0; transform: translateY(4px) scale(0.9); } }
.dcol { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dh { font-size: 12px; font-weight: 600; }
.ut { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.uc { font-size: 11px; padding: 2px 6px; border-radius: 3px; background: var(--surface-2); border: 1px solid var(--border); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uc .um { margin-left: 6px; opacity: 0.8; }
.uc.new { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.uc.gone { text-decoration: line-through; color: var(--muted); background: none; }
.uc.star { outline: 2px solid var(--warn); }

.spec { display: flex; flex-direction: column; border-top: 1px solid var(--border); }
.sr { display: grid; grid-template-columns: minmax(0, 1fr) auto 16px auto; gap: 10px; align-items: baseline; padding: 9px 0; border-bottom: 1px solid var(--border); }
.sk { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.sa { font-size: 13px; color: var(--muted); text-align: right; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sar { font-size: 13px; text-align: center; }
.sb { font-size: 17px; font-weight: 700; text-align: right; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.good { color: var(--accent); } .bad { color: var(--danger); }
.verdict { display: flex; flex-direction: column; gap: 3px; }
.verdict .vt { font-size: 18px; line-height: 24px; }
.verdict .vt.ok { color: var(--accent); } .verdict .vt.warn { color: var(--warn); } .verdict .vt.danger { color: var(--danger); }

.bfoot { display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--border); padding-top: 12px; }
.bfoot .hint { font-size: 11px; }
.go { font-size: 15px; padding: 10px 24px; }
.bfoot .btn:disabled { opacity: 0.35; cursor: default; }
@media (max-width: 900px) {
  .bf { padding: 14px 12px 0; gap: 14px; }
  .stage { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .q h1 { font-size: 24px; line-height: 30px; }
  .why { font-size: 15px; }
  .opt { font-size: 15px; min-height: 48px; }
  .bfoot { position: sticky; bottom: 0; z-index: 10; background: var(--bg); padding: 10px 0 calc(10px + env(safe-area-inset-bottom)); }
  .bfoot .hint { display: none; }
  .sa, .sb { max-width: 34vw; }
  .sb { font-size: 15px; }
}
</style>
