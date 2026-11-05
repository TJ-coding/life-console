<script setup>
// Goal flow: the plan as a dataflow of cards generated from SIG dependencies, laid out on a time axis.
// x = time: a card's right edge (its ◆) sits on the goal's end date. Arrows go from a SIG to the SIGs that
// depend on it; a SIG that no other SIG of its PSG depends on flows into its PSG, and every PSG into the Vision.
// Cards share a row unless they'd overlap; each is placed near the rows of what feeds it.
// Continuous / undated goals sit in a "∞" column after the axis; the Vision comes last.
// Dated PSG/SIG cards can be dragged sideways (mouse/pen) to move their time bound, snapping to days.
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { allSigs, psgPct, todayISO, addDays, diffDays, state, toast } from '../store'
import { sigState, inDays, boundIssues, CONTINUOUS } from '../glance'

const props = defineProps({ plan: { type: Object, required: true }, selected: { type: String, default: null } })
const emit = defineEmits(['select'])

const NW = 184, NH = 58, GY = 12, GX = 14, AX = 40, GAP = 56, MIN_PX = 2
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '')

const scroller = ref(null)
const cw = ref(1200)
let ro
onMounted(() => {
  ro = new ResizeObserver(([e]) => { cw.value = Math.max(320, e.contentRect.width) })
  if (scroller.value) ro.observe(scroller.value)
})
onBeforeUnmount(() => ro?.disconnect())

const graph = computed(() => {
  const plan = props.plan
  const T = todayISO()
  const byNo = new Map(allSigs().map((s) => [s.no, s]))
  const psgs = [...plan.psgs].sort((a, b) => a.priority - b.priority)
  const pIdx = Object.fromEntries(psgs.map((p, i) => [p.no, i]))

  // nodes and edges
  const nodes = new Map()
  const add = (id, kind, ref, ext = false) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, ref, ext, ins: [], outs: [] })
    return nodes.get(id)
  }
  const edges = []
  const link = (a, b) => { edges.push({ from: a, to: b }); nodes.get(a).outs.push(b); nodes.get(b).ins.push(a) }
  for (const s of plan.sigs) add(s.no, 'sig', s)
  for (const s of plan.sigs) for (const d of s.deps ?? []) if (!nodes.has(d) && byNo.has(d)) add(d, 'sig', byNo.get(d), true)
  for (const s of plan.sigs) for (const d of s.deps ?? []) if (nodes.has(d)) link(d, s.no)
  for (const p of psgs) add(p.no, 'psg', p)
  for (const s of plan.sigs) {
    if (!nodes.has(s.psg)) continue
    if (!plan.sigs.some((o) => o.psg === s.psg && (o.deps ?? []).includes(s.no))) link(s.no, s.psg)
  }
  if (psgs.length) { add('VISION', 'vision', plan); for (const p of psgs) link(p.no, 'VISION') }

  // time axis: dated goals, today, events and linked deadlines
  for (const n of nodes.values()) n.end = n.kind !== 'vision' && isDate(n.ref.timeBound) ? n.ref.timeBound : null
  const dated = [...nodes.values()].filter((n) => n.end)
  const ids = new Set(nodes.keys())
  const evs = (plan.events ?? []).filter((e) => isDate(e.date))
  const dls = state.deadlines.filter((d) => !d.done && ids.has(d.source) && isDate((d.due ?? '').slice(0, 10)))
  const pts = [T, ...dated.map((n) => n.end), ...evs.map((e) => e.date), ...dls.map((d) => d.due.slice(0, 10))].sort()
  const from = addDays(pts[0], -3)
  const to = addDays(pts.at(-1), 3)
  const days = Math.max(14, diffDays(from, to))
  const undated = [...nodes.values()].filter((n) => !n.end && n.kind !== 'vision')
  const tail = (undated.length ? GAP + NW : 0) + (nodes.has('VISION') ? GAP + NW : 0) + 8
  const ppd = Math.max(MIN_PX, (cw.value - NW - tail) / days)
  const x = (iso) => NW + diffDays(from, iso) * ppd
  const axisEnd = x(to)
  const infX = axisEnd + GAP + NW // right edge of the ∞ column
  for (const n of nodes.values()) n.R = n.end ? x(n.end) : n.kind === 'vision' ? 0 : infX
  if (nodes.has('VISION')) nodes.get('VISION').R = (undated.length ? infX : axisEnd) + GAP + NW
  for (const n of nodes.values()) n.L = n.R - NW

  // rows: place cards in time order, each in the free row closest to the rows of what feeds it
  const rowEnd = []
  const group = (n) => pIdx[n.kind === 'psg' ? n.id : n.ref.psg] ?? 0
  const order = [...nodes.values()].sort((a, b) => a.R - b.R || group(a) - group(b))
  for (const n of order) {
    const placed = n.ins.map((i) => nodes.get(i)).filter((m) => m.row !== undefined)
    const pref = placed.length ? Math.round(placed.reduce((s, m) => s + m.row, 0) / placed.length) : group(n) * 2
    let best = null
    for (let r = 0; r <= Math.max(rowEnd.length, pref); r++) {
      if ((rowEnd[r] ?? -Infinity) + GX > n.L) continue
      if (best === null || Math.abs(r - pref) < Math.abs(best - pref)) best = r
    }
    n.row = best
    rowEnd[best] = n.R
  }
  // drop empty rows
  const used = [...new Set([...nodes.values()].map((n) => n.row))].sort((a, b) => a - b)
  const remap = Object.fromEntries(used.map((r, i) => [r, i]))
  for (const n of nodes.values()) { n.row = remap[n.row]; n.y = AX + n.row * (NH + GY) }

  const ticks = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d.endsWith('-01')) ticks.push({ x: x(d), label: new Date(d + 'T00:00').toLocaleString('en', { month: 'short' }) + (d.slice(5, 7) === '01' ? ` ${d.slice(0, 4)}` : ''), major: true })
    else if (ppd >= 8 && new Date(d + 'T00:00').getDay() === 1) ticks.push({ x: x(d), label: d.slice(8), major: false })
  }
  const marks = [
    ...evs.map((e) => ({ x: x(e.date), sym: e.sym, title: `${e.event} · ${e.date}`, cls: 'ev' })),
    ...dls.map((d) => ({ x: x(d.due.slice(0, 10)), sym: '⏰', title: `${d.id} ${d.title} · ${d.due.replace('T', ' ')} (${d.source})`, cls: 'dl' })),
  ]
  const H = AX + used.length * (NH + GY)
  const W = (nodes.has('VISION') ? nodes.get('VISION').R : undated.length ? infX : axisEnd) + 8
  return { nodes, edges, ticks, marks, W, H, ppd, todayX: x(T), infX: undated.length ? infX - NW : null }
})

/** Everything upstream and downstream of the selected goal, to light up its path. */
const path = computed(() => {
  const sel = props.selected
  const { nodes } = graph.value
  if (!sel || !nodes.has(sel)) return null
  const set = new Set([sel])
  const walk = (id, side) => { for (const n of nodes.get(id)[side]) if (!set.has(n)) { set.add(n); walk(n, side) } }
  walk(sel, 'ins')
  walk(sel, 'outs')
  return set
})

function edgeView(e) {
  const { nodes } = graph.value
  const a = nodes.get(e.from), b = nodes.get(e.to)
  const x1 = a.R + 5, y1 = a.y + NH / 2
  let d
  if (b.L - 4 >= x1 + 10) {
    // room to come in from the left: an S-curve
    const x2 = b.L - 4, y2 = b.y + NH / 2, k = Math.max(28, (x2 - x1) / 2)
    d = `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`
  } else {
    // close in time (the card starts left of this ◆): turn into it from above or below, never loop back
    const x2 = Math.min(b.R - 16, Math.max(b.L + 16, x1 + 24))
    const y2 = b.y > a.y ? b.y - 3 : b.y + NH + 3
    d = `M${x1},${y1} Q${x2},${y1} ${x2},${y2}`
  }
  // impossible order: a SIG that ends before a SIG it needs, or after its PSG
  const bad = !!(a.end && b.end && b.kind !== 'vision' && b.end < a.end)
  const cls = bad ? 'bad' : a.kind === 'sig' && sigState(a.ref) === 'done' ? 'done' : ''
  const on = !!(path.value && path.value.has(e.from) && path.value.has(e.to))
  return { d, cls, on, dim: !!path.value && !on }
}

const overall = computed(() => {
  const p = props.plan.psgs
  return p.length ? Math.round(p.reduce((s, x) => s + psgPct(x.no), 0) / p.length) : 0
})
const psgState = (p) => (psgPct(p.no) >= 100 ? 'done' : sigState({ timeBound: p.timeBound, status: 'doing' }))
function when(tb) {
  if (!tb) return 'no end date'
  if (tb === CONTINUOUS) return '∞ continuous'
  if (!isDate(tb)) return `"${tb}"`
  return `${tb.slice(5).replace('-', '/')} · ${inDays(tb)}`
}
function nodeView(n) {
  if (n.kind === 'vision') return { label: props.plan.planNo, name: props.plan.vision || 'Vision', pct: overall.value, meta: 'Vision', st: '', issues: [] }
  if (n.kind === 'psg') return { label: n.id, name: n.ref.name, pct: psgPct(n.id), meta: when(n.ref.timeBound), st: psgState(n.ref), issues: boundIssues(n.ref) }
  return { label: n.id, name: n.ref.name, pct: Number(n.ref.pct) || 0, meta: when(n.ref.timeBound), st: sigState(n.ref), issues: boundIssues(n.ref) }
}
const nodeList = computed(() => [...graph.value.nodes.values()])
/* drag a dated card sideways to change its time bound. The layout stays put while dragging (only the
   dragged card shifts by whole days); the new date is written on release, then the flow re-lays itself. */
const drag = ref(null) // { id, end, x0, days, moved }
let swallowClick = false
const canDrag = (n) => !!n.end && !n.ext && n.kind !== 'vision'
function onDown(e, n) {
  if (e.button !== 0 || e.pointerType === 'touch' || !canDrag(n)) return
  drag.value = { id: n.id, end: n.end, x0: e.clientX, days: 0, moved: false }
  e.currentTarget.setPointerCapture?.(e.pointerId)
  window.addEventListener('keydown', onDragKey, true)
}
function onMove(e) {
  const d = drag.value
  if (!d) return
  const dx = e.clientX - d.x0
  if (!d.moved && Math.abs(dx) < 4) return
  d.moved = true
  d.days = Math.round(dx / graph.value.ppd)
}
function onUp() {
  const d = drag.value
  if (!d) return
  endDrag()
  if (!d.moved) return
  swallowClick = true
  setTimeout(() => { swallowClick = false }, 0)
  if (!d.days) return
  const n = graph.value.nodes.get(d.id)
  if (!n) return
  const to = addDays(d.end, d.days)
  n.ref.timeBound = to
  toast(`${d.id} time bound ${d.end} → ${to}`)
}
function onDragKey(e) {
  if (e.key !== 'Escape' || !drag.value) return
  e.stopPropagation()
  e.preventDefault()
  drag.value = null
  endDrag()
  swallowClick = true // the release that follows a cancelled drag is not a click
  window.addEventListener('pointerup', () => setTimeout(() => { swallowClick = false }, 0), { once: true, capture: true })
}
function endDrag() {
  drag.value = null
  window.removeEventListener('keydown', onDragKey, true)
}
onBeforeUnmount(endDrag)
const shift = (n) => (drag.value?.id === n.id ? drag.value.days * graph.value.ppd : 0)
const dragTo = computed(() => (drag.value?.moved ? addDays(drag.value.end, drag.value.days) : null))
const metaOf = (n) => (drag.value?.id === n.id && drag.value.moved ? when(dragTo.value) : nodeView(n).meta)
const pick = (n) => { if (swallowClick) return; if (n.kind !== 'vision' && !n.ext) emit('select', n.id) }
</script>

<template>
  <div ref="scroller" class="flow-wrap">
    <div class="flow" :style="{ width: graph.W + 'px', height: graph.H + 'px' }">
      <div v-for="t in graph.ticks" :key="t.x" class="tick" :class="{ major: t.major }" :style="{ left: t.x + 'px' }"><span class="mono">{{ t.label }}</span></div>
      <div class="today" :style="{ left: graph.todayX + 'px' }"><span class="mono">today</span></div>
      <div v-if="graph.infX !== null" class="inf tiny upper muted" :style="{ left: graph.infX + 'px', width: NW + 'px' }">∞ / no end</div>
      <span v-for="(m, i) in graph.marks" :key="'m' + i" class="mark" :class="m.cls" :title="m.title" :style="{ left: m.x + 'px' }">{{ m.sym }}</span>

      <svg class="edges" :width="graph.W" :height="graph.H">
        <defs>
          <marker v-for="m in ['n', 'done', 'bad', 'on']" :id="`fl-arr-${m}`" :key="m" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto" :class="`mk-${m}`">
            <path d="M0,0 L8,4 L0,8 z" />
          </marker>
        </defs>
        <path v-for="(e, i) in graph.edges" :key="i" :d="edgeView(e).d" class="edge" :class="[edgeView(e).cls, { on: edgeView(e).on, dim: edgeView(e).dim }]"
          :marker-end="`url(#fl-arr-${edgeView(e).on ? 'on' : edgeView(e).cls || 'n'})`" />
      </svg>

      <div v-if="drag?.moved" class="drag-guide" :style="{ left: graph.nodes.get(drag.id).R + shift(graph.nodes.get(drag.id)) + 'px' }"><span class="mono">{{ dragTo }}</span></div>

      <div v-for="n in nodeList" :key="n.id" class="fn" :class="[`k-${n.kind}`, `st-${nodeView(n).st}`, { ext: n.ext, sel: selected === n.id, dim: path && !path.has(n.id), movable: canDrag(n), dragging: drag?.id === n.id && drag.moved }]"
        :style="{ left: n.L + shift(n) + 'px', top: n.y + 'px', width: NW + 'px', height: NH + 'px' }"
        :title="[n.ext ? 'From another plan' : canDrag(n) ? 'Drag sideways to change the time bound' : '', ...nodeView(n).issues].filter(Boolean).join('\n')"
        @pointerdown="onDown($event, n)" @pointermove="onMove" @pointerup="onUp" @pointercancel="endDrag"
        @click="pick(n)">
        <div class="row fn-top">
          <span class="mono fn-id">{{ nodeView(n).label }}</span>
          <span v-if="nodeView(n).issues.length" class="icon sm warn fn-warn">error</span>
          <span class="spacer"></span>
          <span class="mono fn-when">{{ metaOf(n) }}</span>
        </div>
        <div class="fn-nm ellipsis">{{ nodeView(n).name }}</div>
        <div class="bar"><i :style="{ width: nodeView(n).pct + '%' }"></i></div>
        <span v-if="n.end" class="dia"></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.flow-wrap { overflow: auto; padding: 4px 16px 16px; }
.flow { position: relative; }
.tick { position: absolute; top: 0; bottom: 0; border-left: 1px solid color-mix(in srgb, var(--border) 45%, transparent); pointer-events: none; }
.tick.major { border-left-color: var(--border); }
.tick span { position: absolute; top: 6px; left: 4px; font-size: 11px; color: var(--muted); white-space: nowrap; }
.tick:not(.major) span { font-size: 10px; opacity: 0.7; }
.today { position: absolute; top: 0; bottom: 0; border-left: 1.5px solid var(--info); pointer-events: none; }
.today span { position: absolute; top: 6px; left: 4px; font-size: 10px; color: var(--info); background: var(--surface); padding: 0 2px; }
.inf { position: absolute; top: 8px; text-align: center; }
.mark { position: absolute; top: 28px; transform: translate(-50%, -50%); font-size: 11px; line-height: 1; z-index: 4; cursor: default; }
.mark.ev { color: var(--info); }
.edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.edge { fill: none; stroke: var(--muted); stroke-width: 1.25; opacity: 0.7; }
.edge.done { stroke: var(--accent); }
.edge.bad { stroke: var(--danger); stroke-width: 1.75; opacity: 1; }
.edge.on { stroke: var(--info); stroke-width: 2; opacity: 1; }
.edge.dim { opacity: 0.15; }
marker path { fill: var(--muted); }
.mk-done path { fill: var(--accent); }
.mk-bad path { fill: var(--danger); }
.mk-on path { fill: var(--info); }
.fn { position: absolute; box-sizing: border-box; background: var(--surface); border: 1px solid var(--border); border-left-width: 3px; border-radius: 2px; padding: 6px 10px 6px 8px; display: flex; flex-direction: column; gap: 3px; cursor: pointer; transition: opacity 0.15s; z-index: 1; }
.fn:hover { border-color: var(--muted); }
.fn.sel { box-shadow: 0 0 0 1px var(--info); border-color: var(--info); }
.fn.dim { opacity: 0.35; }
.fn.movable { cursor: grab; user-select: none; }
.fn.dragging { cursor: grabbing; z-index: 6; opacity: 1; box-shadow: 0 4px 14px rgb(0 0 0 / 0.35); border-color: var(--info); transition: none; }
.fn.dragging .fn-when { color: var(--info); }
.drag-guide { position: absolute; top: 0; bottom: 0; border-left: 1.5px solid var(--info); pointer-events: none; z-index: 5; }
.drag-guide span { position: absolute; top: 18px; left: 4px; font-size: 10px; color: var(--info); background: var(--surface); padding: 0 3px; white-space: nowrap; }
.fn.ext { opacity: 0.55; cursor: default; }
.fn.k-psg { border-left-color: var(--accent); }
.fn.k-vision { border-color: var(--accent); cursor: default; }
.fn.st-done { border-left-color: var(--accent); }
.fn.st-soon { border-left-color: var(--warn); }
.fn.st-late { border-left-color: var(--danger); }
.fn-top { gap: 4px; align-items: center; }
.fn-top .spacer { flex: 1 0 4px; }
.fn-id { font-size: 11px; color: var(--info); white-space: nowrap; flex-shrink: 0; }
.k-psg .fn-id, .k-vision .fn-id { color: var(--accent); }
.fn-when { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.st-soon .fn-when { color: var(--warn); }
.st-late .fn-when { color: var(--danger); }
.fn-warn { font-size: 14px; flex-shrink: 0; }
.fn-nm { font-size: 13px; font-weight: 500; }
.k-psg .fn-nm, .k-vision .fn-nm { font-weight: 600; }
.bar { margin-top: auto; }
/* the ◆ on the right edge marks the end date on the axis */
.dia { position: absolute; right: -6px; top: 50%; width: 9px; height: 9px; transform: translateY(-50%) rotate(45deg); background: var(--info); }
.k-psg .dia { width: 11px; height: 11px; right: -7px; background: var(--accent); }
.st-done .dia { background: var(--accent); }
.st-soon .dia { background: var(--warn); }
.st-late .dia { background: var(--danger); }
</style>
