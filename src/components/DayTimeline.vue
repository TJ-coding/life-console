<script setup>
// Vertical hourly schedule used in each Weekly Planner day column.
import { computed, ref } from 'vue'
import { ui, todayISO, toMin, fromMin, layoutLanes, removeTimelineBlock, isHoverLinked, isBlockSel, toggleBlockSel, blockKey, clearBlockSel } from '../store'
import { useTimelineEdit } from '../timelineEdit'
const props = defineProps({ date: String, blocks: Array, from: { type: Number, default: 6 }, to: { type: Number, default: 23 }, pxh: { type: Number, default: 22 }, dimFn: Function,
  // preview mode (Briefing / Debrief): no editing; markFn(b) adds classes (pv-new, pv-ghost, pv-late, pv-star); lineAt draws a line (minutes)
  readonly: Boolean, markFn: Function, lineAt: Number, lineLabel: String })
const emit = defineEmits(['drop-todo', 'open', 'edit'])
const laid = computed(() => layoutLanes(props.blocks.map((b) => ed.view(b))))
const y = (m) => ((m - props.from * 60) / 60) * props.pxh
const style = (b) => {
  const s = Math.max(toMin(b.start), props.from * 60)
  const e = Math.min(toMin(b.end), props.to * 60)
  const w = 100 / laid.value.lanes
  return { top: y(s) + 'px', height: Math.max(12, y(e) - y(s) - 1) + 'px', left: `calc(28px + (100% - 28px) * ${(b.lane * w) / 100})`, width: `calc((100% - 28px) * ${w / 100} - 2px)` }
}
const visible = computed(() => laid.value.blocks.filter((b) => toMin(b.end) > props.from * 60 && toMin(b.start) < props.to * 60))
const nowY = computed(() => {
  if (props.date !== todayISO()) return null
  const m = ui.now.getHours() * 60 + ui.now.getMinutes()
  return m >= props.from * 60 && m <= props.to * 60 ? y(m) : null
})
const ed = useTimelineEdit({
  axis: 'y', pxh: () => props.pxh, from: () => props.from, to: () => props.to, date: () => props.date,
  onDropTodo: (id, start) => emit('drop-todo', id, start),
  locked: () => ui.scheduleLock, // ISS-14
})
const hover = ed.hover
function openBlock(e, b) {
  if (ed.isResizing()) return
  // Shift/⌘/Ctrl-click — or any click while a selection is open — adds/removes it from the selection
  // ISS-29: modifier-click adds/removes; on touch screens a tap does too while a selection is open; a plain
  // mouse click opens the block and clears the selection
  const touch = e.pointerType === 'touch' || (!e.pointerType && window.matchMedia?.('(hover: none)').matches)
  if (e.shiftKey || e.metaKey || e.ctrlKey || (touch && ui.selBlocks.length)) { toggleBlockSel(b); return }
  clearBlockSel()
  if (b.todoId) emit('open', b.todoId)
  else emit('edit', b) // a fixed block: detail + delete dialog (ISS-8)
}
const removeBlock = removeTimelineBlock
/** A pomodoro sitting's pomodoros, as segments of a slim rail (gaps = breaks), in % of the block's height. */
function pomos(b) {
  if (!b.pomo || b.pomo.length < 2 || ed.resize.value?.id === b.id) return []
  const span = toMin(b.end) - toMin(b.start)
  if (span <= 0) return []
  return b.pomo.map((g) => ({ top: `calc(${(g.start / span) * 100}% + 1px)`, height: `calc(${(g.work / span) * 100}% - 2px)` }))
}
</script>
<template>
  <div class="vt" :class="{ ro: readonly }" :data-boxsel="readonly ? null : ''" :style="{ height: (to - from) * pxh + 'px' }" @dragover="!readonly && ed.onOver($event)" @dragleave="!readonly && ed.onLeave($event)" @drop.stop="!readonly && ed.onDrop($event)">
    <div v-for="h in to - from" :key="h" class="hr" :style="{ top: (h - 1) * pxh + 'px', height: pxh + 'px' }">
      <span class="mono">{{ String(from + h - 1).padStart(2, '0') }}</span>
    </div>
    <div
      v-for="b in visible" :key="b.id" class="block vb" :class="['cat-' + b.category, { todo: b.kind === 'todo', 'is-done': b.done, dim: dimFn && dimFn(b) }, markFn ? markFn(b) : '', { moving: ui.dragBlock?.id === (b.todoId ?? b.id), sizing: ed.resize.value?.id === b.id, bsel: isBlockSel(b), linked: isHoverLinked(b.todoId) }]"
      :style="style(b)" :data-tid="b.todoId || null" :data-bkey="blockKey(b)" :title="`${b.start}–${b.end}  ${b.title}\n${ui.scheduleLock ? 'Schedule locked · tap to edit or remove' : 'Drag to move · drag bottom edge to resize · ✕ ' + (b.todoId ? 'takes it off the timeline' : 'removes it')}`" :draggable="!readonly && !ui.scheduleLock"
      @dragstart="!readonly && ed.dragStartBlock($event, b)" @dragend="!readonly && ed.dragEnd($event)" @click="!readonly && openBlock($event, b)" @contextmenu.prevent="!readonly && toggleBlockSel(b)"
      @mouseenter="b.todoId && (ui.hoverId = b.todoId)" @mouseleave="ui.hoverId = null"
    >
      <i v-for="(g, k) in pomos(b)" :key="'pm' + k" class="pm" :style="g"></i>
      <span v-if="b.done" class="icon dn" title="Completed">check_circle</span><span class="mono t">{{ b.start }}<template v-if="ed.resize.value?.id === b.id">–{{ b.end }}</template></span> <span class="bt">{{ b.title }}</span><span v-if="b.pomo && b.pomo.length > 1" class="mono pc" :title="`${b.pomo.length} pomodoros`"><span class="icon">timer</span>{{ b.pomo.length }}</span>
      <button v-if="!readonly && !ui.scheduleLock" class="xb icon" :title="b.todoId ? 'Off the timeline (task stays on the day) · undo in the toast' : 'Remove block · undo in the toast'" :aria-label="'Remove ' + b.title + ' from the schedule'" @click.stop="removeBlock(b)">close</button>
      <span v-if="!readonly && !ui.scheduleLock" class="handle" title="Drag to change end time" @pointerdown="ed.startResize($event, b)" @click.stop></span>
    </div>
    <div v-if="lineAt != null && lineAt > from * 60 && lineAt < to * 60" class="wline" :style="{ top: y(lineAt) + 'px' }"><span class="mono">{{ lineLabel }}</span></div>
    <div v-if="nowY !== null" class="now" :style="{ top: nowY + 'px' }"></div>
    <div v-if="hover" class="ghost" :style="{ top: y(hover.start) + 'px', height: Math.max(4, y(hover.start + hover.dur) - y(hover.start)) + 'px' }">
      <span class="mono">{{ fromMin(hover.start) }}</span>
    </div>
  </div>
</template>
<style scoped>
.vt { position: relative; }
.hr { position: absolute; left: 0; right: 0; border-top: 1px solid var(--border); }
.hr span { position: absolute; left: 2px; top: 1px; font-size: 9px; color: var(--muted); }
.vb { position: absolute; padding: 2px 4px; font-size: 10px; line-height: 12px; }
.vb .t { color: var(--muted); font-size: 9px; }
.now { position: absolute; left: 0; right: 0; border-top: 2px solid var(--stamp); z-index: 2; pointer-events: none; }
.now::before { content: ''; position: absolute; left: 24px; top: -5px; width: 8px; height: 8px; border-radius: 50%; background: var(--stamp); }
.ghost { position: absolute; left: 28px; right: 0; border: 1px dashed var(--info); background: color-mix(in srgb, var(--info) 10%, transparent); z-index: 3; pointer-events: none; }
.ghost span { position: absolute; right: 2px; top: 1px; font-size: 10px; color: var(--info); background: var(--surface); padding: 0 2px; }
.vb { cursor: grab; }
/* preview mode (Briefing / Debrief) */
.ro .vb { cursor: default; min-height: 17px; }
/* options morph: a block glides to the time the option gives it (same key across options) */
@media (prefers-reduced-motion: no-preference) {
  .ro .vb { transition: top 0.32s cubic-bezier(.2,.8,.2,1), height 0.32s cubic-bezier(.2,.8,.2,1), left 0.32s cubic-bezier(.2,.8,.2,1), width 0.32s cubic-bezier(.2,.8,.2,1), background-color 0.2s; }
  .ro .vb.pv-new { animation: pv-in 0.32s cubic-bezier(.2,.8,.2,1); }
  .ro .vb.pv-ghost { animation: pv-fade 0.25s ease-out; }
}
@keyframes pv-in { from { opacity: 0; transform: scale(0.92); } }
@keyframes pv-fade { from { opacity: 0; } }
.wline { position: absolute; left: 28px; right: 0; border-top: 2px solid color-mix(in srgb, var(--danger) 55%, transparent); z-index: 1; pointer-events: none; }
.wline span { position: absolute; right: 2px; top: 1px; font-size: 9px; color: var(--danger); }
.vb.pv-new { background: var(--accent); color: var(--on-accent); outline: 2px solid color-mix(in srgb, var(--accent) 35%, transparent); z-index: 3; }
.vb.pv-new .t { color: var(--on-accent); }
.vb.pv-ghost { background: transparent; border: 1.5px solid var(--muted); color: var(--muted); opacity: 0.6; }
.vb.pv-late { background: color-mix(in srgb, var(--danger) 28%, var(--surface)); outline: 1px solid var(--danger); }
.vb.pv-new.pv-late { background: var(--danger); }
.vb.pv-star { outline: 2px solid var(--warn); outline-offset: 1px; z-index: 4; font-weight: 600; }
/* a pomodoro sitting: a slim rail on the right edge, one rounded segment per pomodoro, gaps = breaks */
.pm { position: absolute; right: 2px; width: 3px; border-radius: 2px; background: var(--c); opacity: 0.75; pointer-events: none; }
.vb:has(.pm) { padding-right: 8px; }
.pc { color: var(--muted); font-size: 9px; margin-left: 4px; white-space: nowrap; }
.pc .icon { font-size: 10px; vertical-align: -1px; margin-right: 1px; }
.vb.linked { outline: 2px solid var(--info); z-index: 4; }
.vb.moving { opacity: 0.35; }
.vb.sizing { outline: 1px solid var(--info); z-index: 4; overflow: visible; }
.handle { position: absolute; left: 0; right: 0; bottom: -1px; height: 6px; cursor: ns-resize; touch-action: none; }
.xb { position: absolute; top: 1px; right: 1px; width: 14px; height: 14px; font-size: 12px; color: var(--muted); background: transparent; border: 0; padding: 0; cursor: pointer; opacity: 0; display: none; }
.vb:hover .xb { opacity: 0.7; display: block; }
.xb:hover { opacity: 1; color: var(--danger); }
/* touch screens have no hover: the ✕ is always there (only shown while the schedule is unlocked) */
@media (hover: none) {
  .xb { display: block; opacity: 0.85; width: 18px; height: 18px; font-size: 14px; top: 0; right: 0; color: var(--text); }
}
.handle::after { content: ''; position: absolute; left: 35%; right: 35%; bottom: 1px; height: 2px; border-radius: 1px; background: var(--c); opacity: 0; }
.vb:hover .handle::after, .vb.sizing .handle::after { opacity: 0.9; }
/* multi-selected (Shift/⌘-click or long-press): moved together */
.block.bsel { outline: 2px solid var(--accent); outline-offset: 1px; z-index: 5; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent); }
</style>
