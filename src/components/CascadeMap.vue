<script setup>
// The cascading goal diagram as a pyramid: Vision → PSGs → SIGs → open tasks, joined by lines that get thinner at
// each level and take their PSG's colour. Sideways (left → right) or top-down. `compact` drops the tasks column so
// the map fits beside the goals table. Cards show only what you read at a glance (name, %, time bound, a deadline
// mark); criteria and dependencies live in the tables (a dependency is a link icon with a tooltip here).
// Click a card to select it (its branch lights up), double-click to open it in the table.
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { state, ui, sigsOf, psgPct, tickTodo } from '../store'
import { sigState, inDays, countdown, urgency, effDue, minsTo } from '../glance'
import Prio from './Prio.vue'

const props = defineProps({
  plan: { type: Object, required: true },
  selected: { type: String, default: null },
  tasks: { type: Function, required: true }, // (goalNo) => { open: todo[], done: n }
  dir: { type: String, default: 'side' }, // 'side' | 'down'
  compact: { type: Boolean, default: false },
  showTasks: { type: Boolean, default: true },
})
const emit = defineEmits(['select', 'pick', 'open', 'add-sig', 'add-task'])

const box = ref(null)
const cw = ref(1200)
let ro, timer
/* width available inside the padding; measured on mount, on resize, and once the table's slide has finished */
function measure() {
  const el = box.value
  if (!el) return
  const cs = getComputedStyle(el)
  cw.value = Math.max(320, Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 4))
}
onMounted(() => {
  measure()
  ro = new ResizeObserver(measure)
  if (box.value) ro.observe(box.value)
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => { ro?.disconnect(); clearTimeout(timer); window.removeEventListener('resize', measure) })
watch(() => props.compact, () => { nextTick(measure); clearTimeout(timer); timer = setTimeout(measure, 350) })

const COLORS = ['var(--accent)', 'var(--info)', 'var(--cat-academic)', 'var(--cat-experiment)', 'var(--cat-kaizen)', 'var(--warn)']
const TIP = { psg: 'PSG · Prioritised Strategic Goal: the few things this plan must achieve', sig: 'SIG · Specific Indicator Goal: a measurable result that shows its PSG is being achieved' }
const MAXT = 3 // task rows per SIG before "+n more"
const TH = 32, TG = 6 // task row height / gap
const VH = 116, PH = 92, SH = 70
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '')
const short = (d) => new Date(d + 'T00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })
const when = (tb) => (isDate(tb) ? `${short(tb)} · ${inDays(tb)}` : tb ? '∞' : 'no date')

const withTasks = computed(() => props.showTasks && !props.compact)
const down = computed(() => props.dir === 'down' && !props.compact)

/** the plan as groups: each PSG with its slots (one per SIG, plus one for tasks linked to the PSG itself) */
const groups = computed(() => {
  const psgs = [...props.plan.psgs].sort((a, b) => a.priority - b.priority)
  return psgs.map((p, i) => {
    const color = COLORS[i % COLORS.length]
    const slots = sigsOf(p.no).filter((s) => props.plan.sigs.includes(s)).map((s) => ({ sig: s, ...taskRows(s.no, s) }))
    const own = props.tasks(p.no).open
    if (withTasks.value && own.length) slots.push({ sig: null, ...taskRows(p.no, null) })
    return { psg: p, color, slots }
  })
})
function taskRows(no, sig) {
  if (!withTasks.value) return { rows: [] }
  const open = props.tasks(no).open
  const rows = open.slice(0, MAXT).map((t) => ({ kind: 'task', t }))
  if (open.length > MAXT) rows.push({ kind: 'more', n: open.length - MAXT })
  if (!open.length && sig && sig.status !== 'done') rows.push({ kind: 'add', sig })
  else if (sig && sig.status !== 'done') rows.push({ kind: 'add', sig, small: true })
  return { rows }
}

/** positions of every card, task row and connector, in px inside a W×H box */
const layout = computed(() => {
  const W = cw.value
  const cards = [], lines = [], rows = []
  const gs = groups.value
  if (down.value) {
    // top-down: levels are rows; each SIG gets a slot across the width
    const nSlots = Math.max(1, gs.reduce((n, g) => n + Math.max(1, g.slots.length), 0))
    const GG = 24, SG = 12
    const slotW = Math.max(176, (W - GG * (gs.length - 1) - SG * (nSlots - gs.length)) / nSlots)
    const yV = 22, yP = yV + VH + 44, yS = yP + PH + 40, yT = yS + SH + 30
    let x = 0, maxRows = 0
    const pCenters = []
    for (const g of gs) {
      const n = Math.max(1, g.slots.length)
      const gw = n * slotW + (n - 1) * SG
      const pw = Math.min(gw, 300)
      const pc = x + gw / 2
      cards.push({ kind: 'psg', g, x: pc - pw / 2, y: yP, w: pw, h: PH })
      pCenters.push({ x: pc, g })
      g.slots.forEach((sl, k) => {
        const sx = x + k * (slotW + SG)
        const cx = sx + slotW / 2
        if (sl.sig) {
          cards.push({ kind: 'sig', g, s: sl.sig, x: sx, y: yS, w: slotW, h: SH })
          lines.push({ d: `M${pc},${yP + PH} C${pc},${yP + PH + 22} ${cx},${yS - 22} ${cx},${yS}`, w: 4, c: g.color, ids: [g.psg.no, sl.sig.no] })
        }
        const from = sl.sig ? { x: cx, y: yS + SH } : { x: pc, y: yP + PH }
        sl.rows.forEach((r, j) => {
          const ry = yT + j * (TH + TG)
          rows.push({ ...r, g, s: sl.sig, x: sx, y: ry, w: slotW, h: TH })
        })
        if (sl.rows.length) lines.push({ d: `M${from.x},${from.y} C${from.x},${from.y + 14} ${cx},${yT - 14} ${cx},${yT}`, w: 2, c: 'var(--muted)', ids: [sl.sig?.no ?? g.psg.no] })
        maxRows = Math.max(maxRows, sl.rows.length)
      })
      x += gw + GG
    }
    const total = Math.max(W, x - GG)
    const vw = Math.min(340, total)
    const vx = total / 2 - vw / 2
    cards.push({ kind: 'vision', x: vx, y: yV, w: vw, h: VH })
    for (const p of pCenters) lines.push({ d: `M${total / 2},${yV + VH} C${total / 2},${yV + VH + 24} ${p.x},${yP - 24} ${p.x},${yP}`, w: 7, c: p.g.color, ids: [p.g.psg.no] })
    const H = (withTasks.value && maxRows ? yT + maxRows * (TH + TG) : yS + SH) + 8
    const labels = [{ t: 'Vision', x: 0, y: 0 }, { t: 'Goals · PSG', tip: TIP.psg, x: 0, y: yP - 22 }, { t: 'Targets · SIG', tip: TIP.sig, x: 0, y: yS - 22 }]
    if (withTasks.value) labels.push({ t: 'Tasks', x: 0, y: yT - 22 })
    return { W: total, H, cards, lines, rows, labels, shape: `polygon(${(vx / total) * 100}% 0%, ${((vx + vw) / total) * 100}% 0%, 100% 100%, 0% 100%)` }
  }

  // sideways: levels are columns
  const cols = withTasks.value ? 4 : 3
  const gap = props.compact ? 24 : W >= 1100 ? 64 : W >= 700 ? 44 : 32
  // column widths by weight: beside the table the vision column gives way to the goals and targets
  const wts = props.compact ? [0.62, 1, 1.18] : [1, 1, 1, 1]
  const unit = Math.max(W < 560 ? 150 : 120, (W - gap * (cols - 1)) / wts.slice(0, cols).reduce((a, b) => a + b, 0))
  const CW = wts.map((k) => Math.floor(unit * k))
  const X = [0]
  for (let i = 1; i < 4; i++) X.push(X[i - 1] + (CW[i - 1] ?? 0) + gap)
  const SG = 14, GG = 30, top = 26
  let y = top
  const pMids = []
  for (const g of gs) {
    const y0 = y
    const slotTops = []
    const slots = g.slots.length ? g.slots : [{ sig: null, rows: [], empty: true }]
    for (const sl of slots) {
      const tH = sl.rows.length ? sl.rows.length * TH + (sl.rows.length - 1) * TG : 0
      const h = Math.max(sl.sig ? SH : sl.empty ? SH : 0, tH, 1)
      slotTops.push({ sl, y, h, tH })
      y += h + SG
    }
    y -= SG
    const gh = Math.max(y - y0, PH)
    if (gh > y - y0) { // a lone PSG is taller than its slots: centre them
      const off = (gh - (y - y0)) / 2
      for (const st of slotTops) st.y += off
      y = y0 + gh
    }
    const pMid = y0 + gh / 2
    cards.push({ kind: 'psg', g, x: X[1], y: pMid - PH / 2, w: CW[1], h: PH })
    pMids.push({ y: pMid, g })
    for (const { sl, y: sy, h, tH } of slotTops) {
      const mid = sy + h / 2
      if (sl.sig) {
        cards.push({ kind: 'sig', g, s: sl.sig, x: X[2], y: mid - SH / 2, w: CW[2], h: SH })
        lines.push({ d: `M${X[1] + CW[1]},${pMid} C${X[1] + CW[1] + gap / 2},${pMid} ${X[2] - gap / 2},${mid} ${X[2]},${mid}`, w: 4, c: g.color, ids: [g.psg.no, sl.sig.no] })
      }
      if (sl.rows.length) {
        const ty = mid - tH / 2
        sl.rows.forEach((r, j) => rows.push({ ...r, g, s: sl.sig, x: X[3], y: ty + j * (TH + TG), w: CW[3], h: TH }))
        const fx = sl.sig ? X[2] + CW[2] : X[1] + CW[1]
        const fy = sl.sig ? mid : pMid
        sl.rows.forEach((r, j) => {
          const ry = ty + j * (TH + TG) + TH / 2
          lines.push({ d: `M${fx},${fy} C${fx + gap / 2},${fy} ${X[3] - gap / 2},${ry} ${X[3]},${ry}`, w: 1.5, c: 'var(--muted)', ids: [sl.sig?.no ?? g.psg.no] })
        })
      }
    }
    y += GG
  }
  const H = Math.max(y - GG, top + VH) + 6
  const vy = top + (H - top) / 2 - VH / 2
  cards.push({ kind: 'vision', x: 0, y: vy, w: CW[0], h: VH })
  for (const p of pMids) lines.push({ d: `M${CW[0]},${vy + VH / 2} C${CW[0] + gap / 2},${vy + VH / 2} ${X[1] - gap / 2},${p.y} ${X[1]},${p.y}`, w: 7, c: p.g.color, ids: [p.g.psg.no] })
  const W2 = X[cols - 1] + CW[cols - 1]
  const labels = [{ t: 'Vision', x: X[0], y: 0 }, { t: 'Goals · PSG', tip: TIP.psg, x: X[1], y: 0 }, { t: 'Targets · SIG', tip: TIP.sig, x: X[2], y: 0 }]
  if (withTasks.value) labels.push({ t: 'Tasks', x: X[3], y: 0 })
  const a = ((vy - top) / (H - top)) * 100, b = ((vy + VH - top) / (H - top)) * 100
  return { W: W2, H, cards, lines, rows, labels, shapeTop: top, shape: `polygon(0% ${a}%, 100% 0%, 100% 100%, 0% ${b}%)` }
})

/** the selected goal with everything above and below it: its lines light up */
const lit = computed(() => {
  const sel = props.selected
  if (!sel) return null
  const set = new Set([sel])
  const p = props.plan.psgs.find((x) => x.no === sel)
  if (p) for (const s of props.plan.sigs) if (s.psg === sel) set.add(s.no)
  const s = props.plan.sigs.find((x) => x.no === sel)
  if (s) set.add(s.psg)
  return set
})
const lineOn = (l) => !!lit.value && l.ids.every((id) => lit.value.has(id))

const overall = computed(() => {
  const p = props.plan.psgs
  return p.length ? Math.round(p.reduce((s, x) => s + psgPct(x.no), 0) / p.length) : 0
})
const pctCls = (n) => (n >= 100 ? 'ok' : n >= 40 ? 'info' : n > 0 ? 'warn' : 'muted')
const stCls = (g) => 'st-' + sigState(g)
const dlOf = (no) => state.deadlines.filter((d) => !d.done && d.source === no).sort((a, b) => effDue(a).localeCompare(effDue(b)))[0] ?? null
const dlText = (d) => (minsTo(effDue(d)) <= 0 ? 'overdue' : countdown(effDue(d)))
const fmtMin = (m) => (!m ? '' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`)
const depsTitle = (s) => `Starts after ${(s.deps ?? []).join(', ')}`
</script>

<template>
  <div ref="box" class="cmap-wrap">
    <div class="cmap" :class="{ down }" :style="{ width: layout.W + 'px', height: layout.H + 'px' }">
      <div class="shape" aria-hidden="true" :style="{ top: (layout.shapeTop ?? 0) + 'px', clipPath: layout.shape }"></div>
      <span v-for="l in layout.labels" :key="l.t" class="lvl tiny upper muted" :class="{ tip: l.tip }" :title="l.tip" :style="{ left: l.x + 'px', top: l.y + 'px' }">{{ l.t }}</span>

      <svg class="wires" :width="layout.W" :height="layout.H" aria-hidden="true">
        <path v-for="(l, i) in layout.lines" :key="i" :d="l.d" :stroke-width="l.w" :style="{ stroke: l.c }" :class="{ on: lineOn(l), off: lit && !lineOn(l) }" />
      </svg>

      <template v-for="c in layout.cards" :key="c.kind + (c.s?.no ?? c.g?.psg.no ?? '')">
        <div v-if="c.kind === 'vision'" class="card vision" :style="{ left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px' }">
          <div class="row tiny upper"><span class="ok mono">Vision</span><span class="spacer"></span><span class="muted mono">{{ plan.planNo }}</span></div>
          <textarea v-model="plan.vision" class="input ghost vis-in" rows="2" placeholder="Where you want to end up" aria-label="Vision"></textarea>
          <div class="row small mono"><span class="muted">overall</span><span class="spacer"></span><b :class="pctCls(overall)">{{ overall }}%</b></div>
          <div class="bar"><i :style="{ width: overall + '%' }"></i></div>
        </div>

        <div v-else-if="c.kind === 'psg'" class="card psg" :class="[stCls({ ...c.g.psg, pct: psgPct(c.g.psg.no) }), { sel: selected === c.g.psg.no }]"
          :data-goal="c.g.psg.no" :style="{ left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px', '--g': c.g.color }"
          @click="emit('select', c.g.psg.no)" @dblclick="emit('open', c.g.psg.no)">
          <div class="row"><Prio :p="c.g.psg.priority" /><span class="mono small gno">{{ c.g.psg.no }}</span><span class="spacer"></span><span class="mono small" :class="pctCls(psgPct(c.g.psg.no))">{{ psgPct(c.g.psg.no) }}%</span></div>
          <input v-model="c.g.psg.name" class="input ghost nm-in" :title="c.g.psg.name" placeholder="Goal name" aria-label="PSG name" @click.stop="emit('pick', c.g.psg.no)" />
          <div class="row meta">
            <span class="mono small when">{{ when(c.g.psg.timeBound) }}</span>
            <span class="spacer"></span>
            <button v-if="dlOf(c.g.psg.no)" class="dl mono small" type="button" :class="urgency(effDue(dlOf(c.g.psg.no)))" :title="`${dlOf(c.g.psg.no).title} · due ${dlOf(c.g.psg.no).due.replace('T', ' ')}`" @click.stop="ui.deadlineId = dlOf(c.g.psg.no).id"><span class="icon sm">alarm</span>{{ dlText(dlOf(c.g.psg.no)) }}</button>
            <button class="add-sig" type="button" :title="`Add a SIG under ${c.g.psg.no}`" @click.stop="emit('add-sig', c.g.psg.no)">+ SIG</button>
          </div>
          <div class="bar"><i :style="{ width: psgPct(c.g.psg.no) + '%', background: c.g.color }"></i></div>
        </div>

        <div v-else class="card sig" :class="[stCls(c.s), { sel: selected === c.s.no }]" :data-goal="c.s.no"
          :style="{ left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px', '--g': c.g.color }"
          @click="emit('select', c.s.no)" @dblclick="emit('open', c.s.no)">
          <div class="row sig-top">
            <input v-model="c.s.name" class="input ghost sig-in" :title="c.s.name" placeholder="Target" aria-label="SIG name" @click.stop="emit('pick', c.s.no)" />
            <span v-if="(c.s.deps ?? []).length" class="icon sm muted" :title="depsTitle(c.s)" :aria-label="depsTitle(c.s)">link</span>
            <span class="mono small" :class="pctCls(Number(c.s.pct) || 0)">{{ Number(c.s.pct) || 0 }}%</span>
          </div>
          <div class="row meta">
            <span class="mono tiny muted gno">{{ c.s.no }}</span>
            <span class="mono small when">{{ when(c.s.timeBound) }}</span>
            <span class="spacer"></span>
            <button v-if="dlOf(c.s.no)" class="dl mono small" type="button" :class="urgency(effDue(dlOf(c.s.no)))" :title="`${dlOf(c.s.no).title} · due ${dlOf(c.s.no).due.replace('T', ' ')}`" @click.stop="ui.deadlineId = dlOf(c.s.no).id"><span class="icon sm">alarm</span>{{ dlText(dlOf(c.s.no)) }}</button>
          </div>
          <div class="bar"><i :style="{ width: (Number(c.s.pct) || 0) + '%', background: c.g.color }"></i></div>
        </div>
      </template>

      <template v-for="(r, i) in layout.rows" :key="'r' + i">
        <div v-if="r.kind === 'task'" class="trow" :style="{ left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }" :title="r.t.title" @click="ui.drawerId = r.t.id">
          <input type="checkbox" :checked="r.t.done" :aria-label="`Mark ${r.t.title} done`" @click.stop @change="tickTodo(r.t.id)" />
          <span class="grow ellipsis">{{ r.t.title }}</span>
          <span class="mono tiny muted">{{ fmtMin(r.t.timeMin) }}</span>
        </div>
        <button v-else-if="r.kind === 'more'" class="trow more" type="button" :style="{ left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }" @click="emit('select', r.s?.no ?? r.g.psg.no)">+{{ r.n }} more</button>
        <button v-else class="trow add-task" :class="{ small: r.small, none: !r.small }" type="button" :style="{ left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }" :title="`Create a todo for ${r.sig.no}`" @click="emit('add-task', r.sig)">
          <span v-if="!r.small" class="grow">No task yet</span><span>+ task</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cmap-wrap { overflow-x: auto; overflow-y: hidden; padding: 14px 16px 16px; }
.cmap { position: relative; }
.shape { position: absolute; left: 0; right: 0; bottom: 0; background: color-mix(in srgb, var(--info) 5%, transparent); pointer-events: none; }
.lvl { position: absolute; white-space: nowrap; }
.lvl.tip { cursor: help; text-decoration: underline dotted; text-underline-offset: 3px; }
.wires { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.wires path { fill: none; stroke-linecap: round; opacity: 0.45; transition: opacity 0.15s; }
.wires path.on { opacity: 0.95; }
.wires path.off { opacity: 0.25; }
.card { position: absolute; display: flex; flex-direction: column; justify-content: center; gap: 4px; padding: 7px 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; min-width: 0; }
.card:hover { border-color: var(--muted); }
.card.sel { border-color: var(--info); box-shadow: 0 0 0 2px color-mix(in srgb, var(--info) 55%, transparent); background: color-mix(in srgb, var(--info) 10%, var(--surface)); }
.card .row { min-width: 0; }
.vision { border-color: var(--accent); cursor: default; }
.vis-in { font-weight: 600; font-size: 15px; line-height: 20px; height: 44px; width: 100%; resize: none; padding: 2px 4px; overflow: hidden; }
.psg { border-left: 3px solid var(--g); }
.sig { border-left: 3px solid color-mix(in srgb, var(--g) 60%, var(--border)); }
.nm-in { height: 26px; font-size: 15px; font-weight: 600; width: 100%; padding: 0 2px; }
.sig-top { gap: 6px; }
.sig-in { height: 24px; font-size: 14px; font-weight: 500; flex: 1; min-width: 40px; padding: 0 2px; }
.gno { color: var(--muted); }
.psg .gno { color: var(--g); }
.meta { gap: 6px; min-height: 20px; }
.when { color: var(--muted); white-space: nowrap; }
.st-late .when { color: var(--danger); }
.st-soon .when { color: var(--warn); }
.st-done .when { color: var(--accent); }
.bar { height: 4px; }
.add-sig { border: 1px solid var(--border); background: transparent; color: var(--muted); border-radius: 2px; height: 20px; padding: 0 6px; font: 600 10px/1 'JetBrains Mono', monospace; cursor: pointer; }
.add-sig:hover { color: var(--accent); border-color: var(--accent); }
.dl { display: inline-flex; align-items: center; gap: 3px; border: 0; background: transparent; padding: 0; cursor: pointer; white-space: nowrap; }
.dl .icon { font-size: 14px; }
.trow { position: absolute; display: flex; align-items: center; gap: 6px; padding: 0 8px; border: 1px solid var(--border); border-radius: 3px; background: var(--surface); font-size: 13px; color: var(--text); cursor: pointer; text-align: left; min-width: 0; }
.trow:hover { background: var(--surface-2); }
.trow input { margin: 0; }
.trow.more { color: var(--muted); font-size: 12px; background: transparent; }
.trow.add-task { color: var(--muted); background: transparent; font: inherit; font-size: 12px; justify-content: flex-end; }
.trow.add-task.none { border-color: color-mix(in srgb, var(--warn) 45%, var(--border)); color: var(--warn); justify-content: space-between; }
.trow.add-task.small { border-color: transparent; height: 24px !important; }
.trow.add-task:hover { color: var(--accent); }
</style>
