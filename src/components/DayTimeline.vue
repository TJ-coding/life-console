<script setup>
// Vertical hourly schedule used in each Weekly Planner day column.
import { computed, ref } from 'vue'
import { ui, todayISO, toMin, fromMin, layoutLanes } from '../store'
import { useTimelineEdit } from '../timelineEdit'
const props = defineProps({ date: String, blocks: Array, from: { type: Number, default: 6 }, to: { type: Number, default: 23 }, pxh: { type: Number, default: 22 }, dimFn: Function })
const emit = defineEmits(['drop-todo', 'open'])
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
})
const hover = ed.hover
function openBlock(b) {
  if (!ed.isResizing() && b.todoId) emit('open', b.todoId)
}
</script>
<template>
  <div class="vt" :style="{ height: (to - from) * pxh + 'px' }" @dragover="ed.onOver" @dragleave="ed.onLeave" @drop.stop="ed.onDrop">
    <div v-for="h in to - from" :key="h" class="hr" :style="{ top: (h - 1) * pxh + 'px', height: pxh + 'px' }">
      <span class="mono">{{ String(from + h - 1).padStart(2, '0') }}</span>
    </div>
    <div
      v-for="b in visible" :key="b.id" class="block vb" :class="['cat-' + b.category, { todo: b.kind === 'todo', 'is-done': b.done, dim: dimFn && dimFn(b), moving: ui.dragBlock?.id === (b.todoId ?? b.id), sizing: ed.resize.value?.id === b.id }]"
      :style="style(b)" :title="`${b.start}–${b.end}  ${b.title}\nDrag to move (any day) · drag bottom edge to change end`" draggable="true"
      @dragstart="ed.dragStartBlock($event, b)" @dragend="ed.dragEnd" @click="openBlock(b)"
    >
      <span class="mono t">{{ b.start }}<template v-if="ed.resize.value?.id === b.id">–{{ b.end }}</template></span> {{ b.title }}
      <span class="handle" title="Drag to change end time" @pointerdown="ed.startResize($event, b)" @click.stop></span>
    </div>
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
.vb.moving { opacity: 0.35; }
.vb.sizing { outline: 1px solid var(--info); z-index: 4; overflow: visible; }
.handle { position: absolute; left: 0; right: 0; bottom: -1px; height: 6px; cursor: ns-resize; touch-action: none; }
.handle::after { content: ''; position: absolute; left: 35%; right: 35%; bottom: 1px; height: 2px; border-radius: 1px; background: var(--c); opacity: 0; }
.vb:hover .handle::after, .vb.sizing .handle::after { opacity: 0.9; }
</style>
