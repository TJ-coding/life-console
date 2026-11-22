<script setup>
// The cascading goal diagram, laid out as a pyramid: Vision → PSGs → SIGs → each SIG's open tasks, top-down
// (default) or sideways. Same look as the original tree: square nodes on the dot grid, thin straight connectors
// with hard right-angle turns (a "bus" from each parent to its children), status pills, tasks hanging under
// their SIG. Nodes show name, %, time bound and a deadline countdown; criteria and dependencies stay in the
// tables (a dependency is a link icon with a tooltip). Click a node to select it, double-click to open it in
// the table.
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { state, ui, sigsOf, psgPct, tickTodo } from '../store'
import { inDays, countdown, urgency, effDue, minsTo } from '../glance'
import Prio from './Prio.vue'

const props = defineProps({
  plan: { type: Object, required: true },
  selected: { type: String, default: null },
  tasks: { type: Function, required: true }, // (goalNo) => { open: todo[], done: n }
  dir: { type: String, default: 'down' }, // 'down' | 'side'
  showTasks: { type: Boolean, default: true },
})
const emit = defineEmits(['select', 'pick', 'open', 'add-sig', 'add-task'])

const box = ref(null)
const cw = ref(1200)
let ro
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
onBeforeUnmount(() => { ro?.disconnect(); window.removeEventListener('resize', measure) })

const TIP = { psg: 'PSG · Prioritised Strategic Goal: the few things this plan must achieve', sig: 'SIG · Specific Indicator Goal: a measurable result that shows its PSG is being achieved' }
const MAXT = 3 // task rows per SIG before "+n more"
const TR = 24, FOOT = 22 // task row / foot row height
const VH = 96, PH = 86, SH = 54
const LBL = 18 // room for a level label above a row
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '')
const short = (d) => new Date(d + 'T00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })
const when = (tb) => (isDate(tb) ? `${short(tb)} · ${inDays(tb)}` : tb ? '∞ continuous' : 'no date')
const side = computed(() => props.dir === 'side')

/** tasks hanging under one goal: the first few open ones, "+n more", then a foot row (done count, + task) */
function taskBlock(no, sig) {
  if (!props.showTasks) return null
  const g = props.tasks(no)
  const open = g.open.slice(0, MAXT)
  const more = Math.max(0, g.open.length - MAXT)
  const canAdd = !!sig && sig.status !== 'done'
  if (!open.length && !g.done && !canAdd) return null
  const h = open.length * TR + (more ? TR : 0) + FOOT
  return { open, more, done: g.done, sig, canAdd, empty: !g.open.length, h }
}

const groups = computed(() => [...props.plan.psgs].sort((a, b) => a.priority - b.priority).map((p) => {
  const slots = sigsOf(p.no).filter((s) => props.plan.sigs.includes(s)).map((s) => ({ sig: s, block: taskBlock(s.no, s) }))
  const own = props.showTasks && props.tasks(p.no).open.length ? taskBlock(p.no, null) : null
  if (own) slots.push({ sig: null, block: own })
  return { psg: p, slots }
}))

/* straight connector from a parent edge to a child edge through a shared bus line */
const busDown = (x1, y1, yb, x2, y2) => `M${x1},${y1} V${yb} H${x2} V${y2}`
const busSide = (x1, y1, xb, x2, y2) => `M${x1},${y1} H${xb} V${y2} H${x2}`

const layout = computed(() => {
  const W = cw.value
  const nodes = [], wires = [], blocks = [], labels = []
  const gs = groups.value

  if (!side.value) {
    // top-down: a row per level, one column ("slot") per SIG
    const SG = 16, GG = 36
    const nSlots = Math.max(1, gs.reduce((n, g) => n + Math.max(1, g.slots.length), 0))
    const slotW = Math.max(200, Math.floor((W - SG * (nSlots - gs.length) - GG * Math.max(0, gs.length - 1)) / nSlots))
    const yV = LBL, yP = yV + VH + 34 + LBL, yS = yP + PH + 34 + LBL
    let x = 0, deepest = 0
    const tops = []
    for (const g of gs) {
      const n = Math.max(1, g.slots.length)
      const gw = n * slotW + (n - 1) * SG
      const pw = Math.min(gw, 300)
      const pc = x + gw / 2
      nodes.push({ kind: 'psg', g, x: pc - pw / 2, y: yP, w: pw, h: PH })
      tops.push(pc)
      const bus = yP + PH + 17
      g.slots.forEach((sl, k) => {
        const sx = x + k * (slotW + SG), cx = sx + slotW / 2
        if (sl.sig) {
          nodes.push({ kind: 'sig', g, s: sl.sig, x: sx, y: yS, w: slotW, h: SH })
          wires.push({ d: busDown(pc, yP + PH, bus, cx, yS), ids: [g.psg.no, sl.sig.no] })
        }
        if (sl.block) {
          const by = sl.sig ? yS + SH + 4 : yS
          blocks.push({ ...sl.block, x: sx + 10, y: by, w: slotW - 10 })
          if (!sl.sig) wires.push({ d: busDown(pc, yP + PH, bus, cx, yS), ids: [g.psg.no] })
          deepest = Math.max(deepest, by + sl.block.h - yS)
        }
      })
      x += gw + GG
    }
    const total = Math.max(W, x - GG)
    const vw = Math.min(320, total)
    nodes.push({ kind: 'vision', x: total / 2 - vw / 2, y: yV, w: vw, h: VH })
    for (const pc of tops) wires.push({ d: busDown(total / 2, yV + VH, yV + VH + 17, pc, yP), ids: [] })
    labels.push({ t: 'Vision', x: 0, y: 0 }, { t: 'Goals · PSG', tip: TIP.psg, x: 0, y: yP - LBL }, { t: 'Targets · SIG', tip: TIP.sig, x: 0, y: yS - LBL })
    return { W: total, H: yS + Math.max(SH, deepest) + 6, nodes, wires, blocks, labels }
  }

  // sideways: a column per level, a row ("slot") per SIG
  const gap = 40
  const cols = props.showTasks ? 4 : 3
  const unit = Math.max(170, Math.floor((W - gap * (cols - 1)) / cols))
  const X = [0, 1, 2, 3].map((i) => i * (unit + gap))
  const SG = 10, GG = 22
  let y = LBL
  const mids = []
  for (const g of gs) {
    const y0 = y
    const rows = []
    for (const sl of g.slots) {
      const h = Math.max(sl.sig ? SH : 0, sl.block?.h ?? 0, 1)
      rows.push({ sl, y, h })
      y += h + SG
    }
    if (!rows.length) y += SG
    y -= SG
    const gh = Math.max(y - y0, PH)
    if (gh > y - y0) { const off = (gh - (y - y0)) / 2; for (const r of rows) r.y += off; y = y0 + gh }
    const pm = y0 + gh / 2
    nodes.push({ kind: 'psg', g, x: X[1], y: pm - PH / 2, w: unit, h: PH })
    mids.push(pm)
    const bus = X[1] + unit + gap / 2
    for (const { sl, y: ry } of rows) {
      if (sl.sig) {
        nodes.push({ kind: 'sig', g, s: sl.sig, x: X[2], y: ry, w: unit, h: SH })
        wires.push({ d: busSide(X[1] + unit, pm, bus, X[2], ry + SH / 2), ids: [g.psg.no, sl.sig.no] })
      }
      if (sl.block) {
        blocks.push({ ...sl.block, x: X[3], y: ry, w: unit })
        const fx = sl.sig ? X[2] + unit : X[1] + unit
        wires.push({ d: sl.sig ? `M${fx},${ry + 12} H${X[3]}` : busSide(fx, pm, bus, X[3], ry + 12), ids: [sl.sig?.no ?? g.psg.no] })
      }
    }
    y += GG
  }
  const H = Math.max(y - GG, LBL + VH) + 6
  const vy = LBL + (H - LBL) / 2 - VH / 2
  nodes.push({ kind: 'vision', x: 0, y: vy, w: unit, h: VH })
  for (const pm of mids) wires.push({ d: busSide(unit, vy + VH / 2, unit + gap / 2, X[1], pm), ids: [] })
  labels.push({ t: 'Vision', x: X[0], y: 0 }, { t: 'Goals · PSG', tip: TIP.psg, x: X[1], y: 0 }, { t: 'Targets · SIG', tip: TIP.sig, x: X[2], y: 0 })
  if (props.showTasks) labels.push({ t: 'Tasks', x: X[3], y: 0 })
  return { W: X[cols - 1] + unit, H, nodes, wires, blocks, labels }
})

/** the selected goal plus its PSG / SIGs: their connectors light up */
const lit = computed(() => {
  const sel = props.selected
  if (!sel) return null
  const set = new Set([sel])
  for (const s of props.plan.sigs) if (s.psg === sel) set.add(s.no)
  const s = props.plan.sigs.find((x) => x.no === sel)
  if (s) set.add(s.psg)
  return set
})
const wireOn = (w) => !!lit.value && w.ids.length > 0 && w.ids.every((id) => lit.value.has(id))

const overall = computed(() => {
  const p = props.plan.psgs
  return p.length ? Math.round(p.reduce((s, x) => s + psgPct(x.no), 0) / p.length) : 0
})
const pctClass = (n) => (n >= 100 ? 'ok' : n >= 40 ? 'info' : n > 0 ? 'warn' : 'muted')
const dlOf = (no) => state.deadlines.filter((d) => !d.done && d.source === no).sort((a, b) => effDue(a).localeCompare(effDue(b)))[0] ?? null
const dlText = (d) => (minsTo(effDue(d)) <= 0 ? 'overdue' : countdown(effDue(d)))
const fmtMin = (m) => (!m ? '' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`)
const mark = (s) => (s.status === 'done' ? '✓' : s.status === 'doing' ? '!' : '◯')
const at = (o) => ({ left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', ...(o.h ? { height: o.h + 'px' } : {}) })
</script>

<template>
  <div ref="box" class="cmap-wrap">
    <div class="cmap" :style="{ width: layout.W + 'px', height: layout.H + 'px' }">
      <span v-for="l in layout.labels" :key="l.t" class="lvl tiny upper muted" :class="{ tip: l.tip }" :title="l.tip" :style="{ left: l.x + 'px', top: l.y + 'px' }">{{ l.t }}</span>

      <svg class="wires" data-fade :width="layout.W" :height="layout.H" aria-hidden="true">
        <path v-for="(w, i) in layout.wires" :key="i" :d="w.d" :class="{ on: wireOn(w) }" />
      </svg>

      <template v-for="n in layout.nodes" :key="n.kind + (n.s?.no ?? n.g?.psg.no ?? '')">
        <div v-if="n.kind === 'vision'" class="node vision" data-goal="VISION" :style="at(n)">
          <div class="row tiny upper"><span class="chip goal">Vision</span><span class="spacer"></span><span class="muted mono">{{ plan.planNo }}</span></div>
          <input v-model="plan.vision" class="input ghost vis-in" :title="plan.vision" placeholder="Where you want to end up" aria-label="Vision" />
          <div class="row small mono"><span class="muted">AGGREGATE</span><span class="spacer"></span><span :class="pctClass(overall)">{{ overall }}%</span></div>
          <div class="bar"><i :style="{ width: overall + '%' }"></i></div>
        </div>

        <div v-else-if="n.kind === 'psg'" class="node psg" :class="{ sel: selected === n.g.psg.no }" :data-goal="n.g.psg.no" :style="at(n)"
          @click="emit('select', n.g.psg.no)" @dblclick="emit('open', n.g.psg.no)">
          <div class="row"><Prio :p="n.g.psg.priority" /><span class="mono ok">{{ n.g.psg.no }}</span><span class="spacer"></span><span class="mono small" :class="pctClass(psgPct(n.g.psg.no))">{{ psgPct(n.g.psg.no) }}%</span></div>
          <input v-model="n.g.psg.name" class="input ghost nm-in" :title="n.g.psg.name" placeholder="PSG name" aria-label="PSG name" @click.stop="emit('pick', n.g.psg.no)" />
          <div class="row tiny meta">
            <span class="mono muted">{{ when(n.g.psg.timeBound) }}</span>
            <button v-if="dlOf(n.g.psg.no)" class="dl mono" type="button" :class="urgency(effDue(dlOf(n.g.psg.no)))" :title="`${dlOf(n.g.psg.no).title} · due ${dlOf(n.g.psg.no).due.replace('T', ' ')}`" @click.stop="ui.deadlineId = dlOf(n.g.psg.no).id"><span class="icon sm">alarm</span>{{ dlText(dlOf(n.g.psg.no)) }}</button>
            <span class="spacer"></span>
            <button class="btn sm add-sig" type="button" :title="`Add a SIG under ${n.g.psg.no}`" @click.stop="emit('add-sig', n.g.psg.no)">+ SIG</button>
          </div>
          <div class="bar" :class="psgPct(n.g.psg.no) < 40 ? 'warn' : ''"><i :style="{ width: psgPct(n.g.psg.no) + '%' }"></i></div>
        </div>

        <div v-else class="node sig" :class="[n.s.status, { sel: selected === n.s.no }]" :data-goal="n.s.no" :style="at(n)"
          @click="emit('select', n.s.no)" @dblclick="emit('open', n.s.no)">
          <div class="grow">
            <div class="row sig-nm">
              <span class="mono small" :class="n.s.status === 'done' ? 'ok' : 'info'">{{ n.s.no }}</span>
              <input v-model="n.s.name" class="input ghost sig-in" :title="n.s.name" placeholder="SIG name" aria-label="SIG name" @click.stop="emit('pick', n.s.no)" />
              <span v-if="(n.s.deps ?? []).length" class="icon sm muted dep" :title="`Starts after ${n.s.deps.join(', ')}`">link</span>
            </div>
            <div class="row tiny meta">
              <span class="mono muted">{{ when(n.s.timeBound) }}</span>
              <button v-if="dlOf(n.s.no)" class="dl mono" type="button" :class="urgency(effDue(dlOf(n.s.no)))" :title="`${dlOf(n.s.no).title} · due ${dlOf(n.s.no).due.replace('T', ' ')}`" @click.stop="ui.deadlineId = dlOf(n.s.no).id"><span class="icon sm">alarm</span>{{ dlText(dlOf(n.s.no)) }}</button>
            </div>
          </div>
          <span class="status" :class="n.s.status">{{ Number(n.s.pct) || 0 }}% {{ mark(n.s) }}</span>
        </div>
      </template>

      <div v-for="(b, i) in layout.blocks" :key="'b' + i" class="tasks" data-fade :style="at(b)">
        <div v-for="t in b.open" :key="t.id" class="task" :title="t.title" @click="ui.drawerId = t.id">
          <input type="checkbox" :checked="t.done" :aria-label="`Mark ${t.title} done`" @click.stop @change="tickTodo(t.id)" />
          <span class="grow ellipsis">{{ t.title }}</span>
          <span class="mono tiny muted">{{ fmtMin(t.timeMin) }}</span>
        </div>
        <div v-if="b.more" class="task more tiny muted" @click="emit('select', b.sig?.no)">+{{ b.more }} more</div>
        <div class="row task-foot">
          <span v-if="b.done" class="tiny muted mono">✓ {{ b.done }} done</span>
          <span v-else-if="b.empty && b.canAdd" class="tiny muted">No tasks yet</span>
          <span class="spacer"></span>
          <button v-if="b.canAdd" class="add-task" type="button" :title="`Create a todo for ${b.sig.no}`" @click.stop="emit('add-task', b.sig)">+ task</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cmap-wrap {
  overflow-x: auto; overflow-y: hidden; padding: 14px 16px 16px;
  background-image: radial-gradient(var(--border) 1px, transparent 1px); background-size: 16px 16px;
}
.cmap { position: relative; }
.lvl { position: absolute; white-space: nowrap; line-height: 14px; }
.lvl.tip { cursor: help; text-decoration: underline dotted; text-underline-offset: 3px; }
.wires { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; shape-rendering: crispEdges; }
.wires path { fill: none; stroke: color-mix(in srgb, var(--muted) 55%, var(--border)); stroke-width: 1; }
.wires path.on { stroke: var(--info); stroke-width: 2; }
.node { position: absolute; background: var(--surface); border: 1px solid var(--border); border-radius: 2px; padding: 8px 10px; display: flex; flex-direction: column; justify-content: center; gap: 6px; cursor: pointer; min-width: 0; }
.node:hover { border-color: var(--muted); }
.node.sel { border-color: var(--info); box-shadow: 0 0 0 2px var(--info); background: color-mix(in srgb, var(--info) 14%, var(--surface)); }
.node .row { min-width: 0; }
.vision { border-color: var(--accent); cursor: default; }
.vis-in { font-weight: 600; font-size: 14px; height: 28px; width: 100%; }
.nm-in { height: 24px; font-size: 13px; font-weight: 600; padding: 0 2px; width: 100%; }
.meta { gap: 8px; min-height: 18px; }
.sig { flex-direction: row; align-items: center; gap: 8px; }
.sig .grow { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.sig.doing { border-color: color-mix(in srgb, var(--info) 45%, var(--border)); }
.sig.done { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.sig.sel { border-color: var(--info); }
.sig-nm { gap: 6px; align-items: baseline; }
.sig-in { height: 20px; font-size: 12px; flex: 1; min-width: 40px; padding: 0 2px; }
.dep { font-size: 13px; align-self: center; }
.add-sig { height: 18px; padding: 0 5px; font-size: 10px; }
.dl { display: inline-flex; align-items: center; gap: 2px; border: 0; background: transparent; padding: 0; cursor: pointer; white-space: nowrap; font-size: 11px; }
.dl .icon { font-size: 13px; }
/* tasks hanging under their SIG */
.tasks { position: absolute; padding-left: 8px; border-left: 2px solid var(--surface-2); display: flex; flex-direction: column; }
.task { display: flex; align-items: center; gap: 6px; height: 24px; font-size: 12.5px; cursor: pointer; border-radius: 2px; padding: 0 4px; min-width: 0; }
.task:hover { background: var(--surface-2); }
.task input { margin: 0; }
.task-foot { gap: 6px; height: 22px; padding: 0 4px; }
.add-task { border: 0; background: transparent; color: var(--muted); font-size: 11px; cursor: pointer; padding: 0 2px; }
.add-task:hover { color: var(--accent); }
</style>
