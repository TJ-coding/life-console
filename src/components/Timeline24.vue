<script setup>
// Horizontal 24h strip (spec §2.4 "Timeline strip").
// Fixed px-per-hour so block text stays readable; scrolls horizontally and
// auto-centres on "now". Todos can be dropped onto it to get a start time.
import { computed, ref, onMounted, nextTick, watch } from 'vue'
import { ui, todayISO, toMin, fromMin, layoutLanes, removeTimelineBlock, isBlockSel, toggleBlockSel } from '../store'
import { useTimelineEdit } from '../timelineEdit'

const props = defineProps({ date: String, blocks: Array, from: { type: Number, default: 0 }, to: { type: Number, default: 24 } })
const emit = defineEmits(['drop-todo', 'open', 'edit'])

const ZOOMS = { S: 64, M: 110, L: 170 } // px per hour
const zoomKey = 'life-console/timeline-zoom'
let saved = 'M'
try { saved = localStorage.getItem(zoomKey) || 'M' } catch { /* ignore */ }
const zoom = ref(ZOOMS[saved] ? saved : 'M')
const pxh = computed(() => ZOOMS[zoom.value])

const LANE = 58
const HEAD = 24
const laid = computed(() => layoutLanes(props.blocks.map((b) => ed.view(b))))
const height = computed(() => HEAD + laid.value.lanes * LANE + 16)
const width = computed(() => (props.to - props.from) * pxh.value)
const x = (m) => ((m - props.from * 60) / 60) * pxh.value
const style = (b) => ({
  left: x(toMin(b.start)) + 1 + 'px',
  width: Math.max(6, x(toMin(b.end)) - x(toMin(b.start)) - 2) + 'px',
  top: HEAD + b.lane * LANE + 'px',
  height: LANE - 6 + 'px',
})
const nowMin = computed(() => ui.now.getHours() * 60 + ui.now.getMinutes())
const showNow = computed(() => props.date === todayISO())

const scroller = ref(null)
function scrollToNow(smooth = true) {
  const el = scroller.value
  if (!el) return
  const target = showNow.value ? x(nowMin.value) : x(8 * 60) + el.clientWidth * 0.25
  el.scrollTo({ left: Math.max(0, target - el.clientWidth * 0.25), behavior: smooth ? 'smooth' : 'auto' })
}
async function setZoom(k) {
  zoom.value = k
  try { localStorage.setItem(zoomKey, k) } catch { /* ignore */ }
  await nextTick()
  scrollToNow(false)
}
onMounted(() => nextTick(() => scrollToNow(false)))
watch(() => props.date, () => nextTick(() => scrollToNow(false)))

const ed = useTimelineEdit({
  axis: 'x', pxh: () => pxh.value, from: () => props.from, to: () => props.to, date: () => props.date,
  onDropTodo: (id, start) => emit('drop-todo', id, start),
  locked: () => ui.scheduleLock, // ISS-14
})
const hover = ed.hover
const removeBlock = removeTimelineBlock
function openBlock(e, b) {
  if (ed.isResizing()) return
  // Shift/⌘/Ctrl-click — or any click while a selection is open — adds/removes it from the selection
  if (e.shiftKey || e.metaKey || e.ctrlKey || ui.selBlocks.length) { toggleBlockSel(b); return }
  if (b.todoId) emit('open', b.todoId)
  else emit('edit', b) // a fixed block: detail + delete dialog (ISS-8)
}
</script>

<template>
  <div class="wrap">
    <div class="ctrl">
      <span class="tiny upper muted">Zoom</span>
      <button v-for="(_, k) in ZOOMS" :key="k" class="btn sm" :class="{ active: zoom === k }" @click="setZoom(k)">{{ k }}</button>
      <button v-if="showNow" class="btn sm" title="Scroll to now" @click="scrollToNow()"><span class="icon sm">my_location</span>Now</button>
    </div>
    <div ref="scroller" class="scroller">
      <div class="tl" :style="{ height: height + 'px', width: width + 'px' }" @dragover="ed.onOver" @dragleave="ed.onLeave" @drop="ed.onDrop">
        <div v-for="h in to - from" :key="h" class="hour" :style="{ left: x((from + h - 1) * 60) + 'px', width: pxh + 'px' }">
          <span class="mono">{{ String(from + h - 1).padStart(2, '0') }}:00</span>
        </div>
        <div
          v-for="b in laid.blocks" :key="b.id" class="block tl-block" :class="['cat-' + b.category, { todo: b.kind === 'todo', 'is-done': b.done, moving: ui.dragBlock?.id === (b.todoId ?? b.id), sizing: ed.resize.value?.id === b.id, bsel: isBlockSel(b) }]"
          :style="style(b)" :title="`${b.start}–${b.end}  ${b.title}\n${ui.scheduleLock ? 'Schedule locked · tap to edit or remove' : 'Drag to move · drag right edge to resize · ✕ ' + (b.todoId ? 'takes it off the timeline' : 'removes it')}`" :draggable="!ui.scheduleLock"
          @dragstart="ed.dragStartBlock($event, b)" @dragend="ed.dragEnd" @click="openBlock($event, b)" @contextmenu.prevent="toggleBlockSel(b)"
        >
          <span class="mono t">{{ b.start }}–{{ b.end }}</span>
          <span class="nm">{{ b.title }}</span>
          <button v-if="!ui.scheduleLock" class="xb icon" :title="b.todoId ? 'Off the timeline (task stays on the day) · undo in the toast' : 'Remove block · undo in the toast'" :aria-label="'Remove ' + b.title + ' from the schedule'" @click.stop="removeBlock(b)">close</button>
          <span v-if="!ui.scheduleLock" class="handle" title="Drag to change end time" @pointerdown="ed.startResize($event, b)" @click.stop></span>
        </div>
        <div v-if="showNow" class="now" :style="{ left: x(nowMin) + 'px' }"><span class="mono">NOW {{ fromMin(nowMin) }}</span></div>
        <div v-if="hover" class="ghost" :style="{ left: x(hover.start) + 'px', width: x(hover.start + hover.dur) - x(hover.start) + 'px' }">
          <span class="mono">{{ fromMin(hover.start) }}–{{ fromMin(hover.start + hover.dur) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; gap: 6px; }
.ctrl { display: flex; align-items: center; gap: 4px; justify-content: flex-end; }
.scroller { overflow-x: auto; overflow-y: hidden; background: var(--surface-2); border: 1px solid var(--border); border-radius: 2px; }
.tl { position: relative; }
.hour { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--border); }
.hour::after { content: ''; position: absolute; top: 18px; bottom: 0; left: 50%; border-left: 1px dotted color-mix(in srgb, var(--border) 70%, transparent); }
.hour span { position: absolute; top: 4px; left: 4px; font-size: 10px; color: var(--muted); }
.tl-block { position: absolute; padding: 4px 6px; display: flex; flex-direction: column; gap: 2px; z-index: 1; }
.tl-block:hover { z-index: 4; }
.tl-block .t { font-size: 10px; color: var(--muted); white-space: nowrap; overflow: hidden; }
.tl-block .nm { font-size: 12px; line-height: 14px; font-weight: 500; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
.now { position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px solid var(--stamp); z-index: 2; pointer-events: none; }
.now span { position: absolute; bottom: 2px; left: 4px; background: var(--stamp); color: #fff; font-size: 10px; padding: 1px 4px; border-radius: 2px; white-space: nowrap; }
.ghost { position: absolute; top: 0; bottom: 0; border: 1px dashed var(--info); background: color-mix(in srgb, var(--info) 10%, transparent); z-index: 3; pointer-events: none; }
.ghost span { position: absolute; top: 2px; left: 3px; color: var(--info); font-size: 10px; background: var(--surface); padding: 0 3px; white-space: nowrap; }
.tl-block { cursor: grab; }
.tl-block.moving { opacity: 0.35; }
.tl-block.sizing { outline: 1px solid var(--info); z-index: 4; }
.handle { position: absolute; top: 0; right: -1px; bottom: 0; width: 8px; cursor: ew-resize; touch-action: none; }
.xb { position: absolute; top: 2px; right: 3px; width: 16px; height: 16px; font-size: 13px; color: var(--muted); background: transparent; border: 0; padding: 0; cursor: pointer; opacity: 0; }
.tl-block:hover .xb { opacity: 0.7; }
.xb:hover { opacity: 1; color: var(--danger); }
@media (hover: none) { .xb { opacity: 0.85; width: 22px; height: 22px; font-size: 16px; top: 1px; right: 1px; color: var(--text); } }
.handle::after { content: ''; position: absolute; top: 30%; bottom: 30%; right: 2px; width: 2px; border-radius: 1px; background: var(--c); opacity: 0; }
.tl-block:hover .handle::after, .tl-block.sizing .handle::after { opacity: 0.9; }
/* multi-selected (Shift/⌘-click or long-press): moved together */
.block.bsel { outline: 2px solid var(--accent); outline-offset: 1px; z-index: 5; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent); }
</style>
