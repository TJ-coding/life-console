<script setup>
// Step ② for one day: the 7-hour workload bucket (the paper template's "1 Hour … 7 Hours" gauge).
// Tasks stack from the bottom, each sized by its estimate; past capacity spills into a red zone.
// Lives inside DayColumn directly above that day's timeline — drag a block down onto a time.
import PartBadge from './PartBadge.vue'
import { computed, ref } from 'vue'
import { state, ui, todosForDay, categoryOf, toMin, splitSiblings, toggleTodo, CAPACITY_H, partLabel, assignToDay, toast, isHoverLinked, loadsDay, rowSelectClick, isTodoSel, openCtxMenu } from '../store'
import { TODO_MIME, startDrag, endDrag, overRow, leaveRow, dropOnRow, dropClass } from '../dnd'

const props = defineProps({
  date: { type: String, required: true },
  withBlocks: Boolean, // also show fixed calendar blocks as a grey base layer
  cap: { type: Number, default: CAPACITY_H },
  hourPx: { type: Number, default: 30 },
  dimFn: Function,
  minRows: Number, // ② Assign day: every bucket in the week gets the same height so their lines line up
  avg: { type: Number, default: null }, // ② Assign day: the week's average load, drawn as a line
})

const todos = computed(() => {
  const ts = todosForDay(props.date)
  // ISS-21 feedback: every part of one task on this day is ONE card (timed sittings and the untimed
  // rest alike) — the schedule keeps the sittings as separate blocks; the planner edits them.
  const byGroup = new Map()
  ts.forEach((t) => { if (t.split) { const l = byGroup.get(t.split.group) ?? []; l.push(t); byGroup.set(t.split.group, l) } })
  const out = []
  const merged = new Set()
  for (const t of ts) {
    if (merged.has(t.id)) continue
    const parts = t.split ? [...(byGroup.get(t.split.group) ?? [])] : null
    if (parts && parts.length > 1) {
      parts.sort((a, b) => (a.scheduled?.start || '99').localeCompare(b.scheduled?.start || '99'))
      parts.forEach((p) => merged.add(p.id))
      out.push({ ...parts[0], grouped: { n: parts.length, timeMin: parts.reduce((s, p) => s + p.timeMin, 0), parts } })
    } else out.push(t)
  }
  return out
})
const fixedH = computed(() => (props.withBlocks
  ? state.timeBlocks.filter((b) => b.date === props.date).reduce((s, b) => s + (toMin(b.end) - toMin(b.start)) / 60, 0)
  : 0))
// minutes a card adds to the gauge: work finished ahead of a future day no longer loads it (its card shrinks to a strip)
const loadMin = (t) => (t.grouped ? t.grouped.parts : [t]).reduce((s, p) => s + (loadsDay(p, props.date) ? p.timeMin || 0 : 0), 0)
const total = computed(() => fixedH.value + todos.value.reduce((s, t) => s + loadMin(t) / 60, 0))
const rows = computed(() => Math.max(props.cap, Math.ceil(total.value), props.minRows || 0))
const blockH = (min) => Math.max(16, (min / 60) * props.hourPx - 2)
const cardH = (t) => blockH(loadMin(t))
// small blocks have a minimum height; let the bucket grow so they never spill over the header
const stackPx = computed(() => todos.value.reduce((s, t) => s + cardH(t) + 2, fixedH.value ? blockH(fixedH.value * 60) + 2 : 0))
const height = computed(() => Math.max(rows.value * props.hourPx, stackPx.value + 2) + 2)
const showLabels = computed(() => props.hourPx >= 14)

/** ISS-29: a card is selected when its task is (a merged card: all of its parts on this day are). */
const cardSel = (t) => (t.grouped ? t.grouped.parts.every(isTodoSel) : isTodoSel(t))
const hot = ref(false)
function onDrop(e) {
  hot.value = false
  const id = e.dataTransfer.getData(TODO_MIME)
  if (id) assignToDay(id, props.date, props.cap)
}
const hm = (m) => { const h = Math.floor(m / 60); return h ? `${h}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m` }
/** Second line of a merged card: "3 sittings · 1h30" (+ untimed rest). */
function groupMeta(g) {
  const timed = g.parts.filter((p) => p.scheduled.start).length
  const rest = g.parts.filter((p) => !p.scheduled.start).reduce((s, p) => s + p.timeMin, 0)
  return `${hm(g.timeMin)} · ${timed ? `${timed} time${timed > 1 ? 's' : ''}` : ''}${timed && rest ? ' + ' : ''}${rest ? `${hm(rest)} untimed` : ''}`
}
/** On a merged card, done applies to every part of the split on this day. */
function toggleParts(t) {
  const to = !t.grouped.parts.every((x) => x.done)
  t.grouped.parts.forEach((x) => { if (x.done !== to) toggleTodo(x.id) })
  toast(to ? `Marked ${t.grouped.n} parts done ✓` : `Reopened ${t.grouped.n} parts`)
}
</script>

<template>
  <div
    class="bucket" data-boxsel data-sellist :class="{ 'drop-hot': hot }" :style="{ height: height + 'px' }"
    @dragover.prevent="hot = true" @dragleave="hot = false" @drop.prevent="onDrop"
  >
    <div v-for="r in rows" :key="r" class="hrow" :class="{ over: rows - r + 1 > cap }" :style="{ bottom: (rows - r) * hourPx + 1 + 'px', height: hourPx + 'px' }">
      <span v-if="showLabels" class="mono">{{ rows - r + 1 }}h</span>
    </div>
    <div class="capline" :style="{ bottom: cap * hourPx + 1 + 'px' }"></div>
    <div v-if="avg !== null" class="avgline" :style="{ bottom: avg * hourPx + 1 + 'px' }" :title="`Week average ${avg.toFixed(1)}h`"><span class="mono">avg</span></div>
    <div class="stack">
      <div v-if="fixedH" class="fixed" :style="{ height: blockH(fixedH * 60) + 'px' }" title="Fixed calendar blocks (lectures, training…)">
        <span class="mono">fixed {{ fixedH.toFixed(1) }}h</span>
      </div>
      <div
        v-for="t in todos" :key="t.id" class="card block"
        :draggable="!t.grouped"
        :class="['cat-' + categoryOf(t), dropClass(t, true), {
          'is-done': t.grouped ? t.grouped.parts.every((p) => p.done) : t.done, sel: ui.selectedId === t.id, msel: cardSel(t), linked: isHoverLinked(t.id), short: cardH(t) < 28,
          untimed: t.grouped ? t.grouped.parts.some((p) => !p.done && !p.scheduled.start) : !t.done && !t.scheduled.start, dim: dimFn && dimFn(t), grouped: t.grouped,
        }]"
        :style="{ height: cardH(t) + 'px' }" :data-bkey="'todo:' + t.id" :data-bparts="t.grouped ? t.grouped.parts.map((p) => p.id).join(',') : null"
        :title="t.grouped
          ? `${t.title} · ${groupMeta(t.grouped)}${t.grouped.parts.some((p) => p.scheduled.start) ? ' (' + t.grouped.parts.filter((p) => p.scheduled.start).map((p) => p.scheduled.start).join(', ') + ')' : ''}\nClick the plan button to change days or times.`
          : `${t.title} · ${t.timeMin}m · P${t.priority} · ${t.scheduled.start ? 'at ' + t.scheduled.start : 'no time yet — drag onto the timeline'}`"
        @dragstart="startDrag($event, t)" @dragend="endDrag"
        @dragover="overRow($event, t, { reverse: true })" @dragleave="leaveRow($event, t)" @drop="dropOnRow($event, t, { adoptDate: true })"
        @mouseenter="ui.hoverId = t.id" @mouseleave="ui.hoverId = null"
        @click="rowSelectClick($event, t) || (ui.selectedId = t.id)" @contextmenu.prevent="openCtxMenu($event, t.grouped ? t.grouped.parts.map((p) => 'todo:' + p.id) : ['todo:' + t.id])" @dblclick="t.grouped ? (ui.splitId = t.id) : (ui.drawerId = t.id)"
      >
        <input type="checkbox" class="ck" :checked="t.grouped ? t.grouped.parts.every((p) => p.done) : t.done" :title="t.grouped ? 'Done: all of this task today' : 'Done'" @click.stop @change="t.grouped ? toggleParts(t) : toggleTodo(t.id)" />
        <span class="ttl"><PartBadge v-if="partLabel(t) && !t.grouped" :todo="t" class="part mono" />{{ t.title }}</span>
        <span class="meta mono">
          <template v-if="t.grouped">{{ groupMeta(t.grouped) }}</template>
          <template v-else-if="t.scheduled.start">{{ t.scheduled.start }}</template>
          <span v-else-if="!t.done" class="icon tiny-i warn" title="No time yet">more_time</span>
          <template v-if="!t.grouped">{{ t.timeMin }}m</template>
        </span>
        <button v-if="t.grouped ? !t.grouped.parts.every((p) => p.done) : !t.done && t.timeMin >= 30" class="splitbtn" :title="t.grouped ? 'Plan: change days or times' : 'Plan: spread over days / times'" @click.stop="ui.splitId = t.grouped ? (t.grouped.parts.find((p) => !p.done) ?? t).id : t.id"><span class="icon">call_split</span></button>
      </div>
    </div>
    <div v-if="!todos.length && !fixedH" class="empty-hint small muted">drop tasks here</div>
  </div>
</template>

<style scoped>
.bucket { position: relative; border: 1px solid var(--border); border-radius: 2px; background: var(--surface-2); }
.hrow { position: absolute; left: 0; right: 0; border-top: 1px solid var(--border); }
.hrow:first-child { border-top: 0; }
.hrow span { position: absolute; left: 3px; top: 1px; font-size: 9px; color: var(--muted); }
.hrow.over { background: color-mix(in srgb, var(--danger) 10%, transparent); }
.avgline { position: absolute; left: 0; right: 0; border-top: 1px solid var(--info); z-index: 3; pointer-events: none; }
.avgline span { position: absolute; left: 1px; top: -6px; font-size: 9px; line-height: 11px; padding: 0 2px; color: var(--info); background: var(--surface-2); }
.capline { position: absolute; left: 0; right: 0; border-top: 2px solid var(--muted); z-index: 1; pointer-events: none; }
.stack { position: absolute; left: 22px; right: 3px; bottom: 1px; display: flex; flex-direction: column-reverse; gap: 2px; z-index: 2; }
.fixed {
  flex: none; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--muted);
  background: repeating-linear-gradient(45deg, var(--border) 0 2px, transparent 2px 7px); border: 1px solid var(--border);
}
.card { flex: none; padding: 2px 4px; display: flex; flex-wrap: wrap; gap: 0 4px; align-items: flex-start; align-content: flex-start; cursor: grab; position: relative; overflow: hidden; }
.card.grouped { box-shadow: 2px 2px 0 -1px var(--surface-2), 3px 3px 0 -1px var(--border); } /* a quiet 'stack' cue */
.card.grouped .is-done .ttl { text-decoration: line-through; }
.ck { width: 11px; height: 11px; margin-top: 1px; flex: none; }
.card .ttl { flex: 1 1 5em; min-width: 0; font-size: 11px; line-height: 13px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; word-break: break-word; }
.card.short .ttl { -webkit-line-clamp: 1; white-space: nowrap; display: block; text-overflow: ellipsis; }
.card .meta { font-size: 9px; color: var(--muted); display: flex; align-items: center; gap: 2px; white-space: nowrap; margin-left: auto; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.card.grouped .meta { flex-basis: 100%; padding-left: 15px; }
.card.grouped .ttl { padding-right: 16px; }
.tiny-i { font-size: 11px; }
.part { font-weight: 600; font-size: 9px; margin-right: 4px; opacity: 0.8; }
.card.sel, .card.msel { outline: 1px solid var(--info); }
.card.linked { outline: 2px solid var(--info); z-index: 3; }
.card.is-done .ttl { text-decoration: line-through; }
.splitbtn { position: absolute; top: 1px; right: 1px; display: none; border: 1px solid var(--border); background: var(--surface); border-radius: 2px; padding: 0 1px; cursor: pointer; color: var(--text); line-height: 1; }
.splitbtn .icon { font-size: 13px; }
.card:hover .splitbtn { display: block; }
@media (hover: none) { .card.grouped .splitbtn { display: block; } }
.empty-hint { position: absolute; left: 22px; right: 4px; bottom: 6px; text-align: center; border: 1px dashed var(--border); border-radius: 2px; padding: 6px; }
</style>
