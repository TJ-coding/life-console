// Shared editing behaviour for timeline components (horizontal Timeline24 and vertical DayTimeline):
//  • drag a block's body to move it (snaps to 15 min; can land on another day's timeline)
//  • drag a block's end handle to change its end time / duration
//  • drop a todo from any list to give it a start time
//  • locked (ui.scheduleLock): no drag/resize — tap still opens detail (ISS-8, ISS-14)
import { ref } from 'vue'
import { ui, toMin, fromMin, snap, SNAP, moveBlock, resizeBlock, toast, isBlockSel, shiftSelected, diffDays } from './store'
import { TODO_MIME } from './dnd'

const BLOCK_MIME = 'text/x-block'

/**
 * @param {object} o
 * @param {'x'|'y'} o.axis
 * @param {() => number} o.pxh       pixels per hour
 * @param {() => number} o.from      first hour shown
 * @param {() => number} o.to        last hour shown
 * @param {() => string} o.date      date this timeline represents
 * @param {(id: string, start: string) => void} o.onDropTodo
 * @param {() => boolean} [o.locked]   true = dragging/resizing locked out (ISS-14)
 */
export function useTimelineEdit(o) {
  const locked = () => o.locked?.() ?? false
  const hover = ref(null) // { start, dur } preview while dragging over
  const resize = ref(null) // { id, end } live preview while resizing
  let resizing = false

  const pos = (e, el) => {
    const r = el.getBoundingClientRect()
    return o.axis === 'x' ? e.clientX - r.left : e.clientY - r.top
  }
  const minuteAt = (e, el) => o.from() * 60 + (pos(e, el) / o.pxh()) * 60

  /* ── move ── */
  function dragStartBlock(e, b) {
    if (locked()) { e.preventDefault(); return }
    if (resizing) { e.preventDefault(); return }
    const blockEl = e.currentTarget
    const grab = ((o.axis === 'x' ? e.clientX - blockEl.getBoundingClientRect().left : e.clientY - blockEl.getBoundingClientRect().top) / o.pxh()) * 60
    ui.dragBlock = { kind: b.kind, id: b.kind === 'todo' ? b.todoId : b.id, offset: grab, dur: toMin(b.end) - toMin(b.start) }
    // dragging one of several selected blocks moves the whole selection by the same offset
    if (ui.selBlocks.length > 1 && isBlockSel(b)) ui.dragBlock.group = { date: o.date(), start: toMin(b.start) }
    e.dataTransfer.setData(BLOCK_MIME, ui.dragBlock.id)
    if (b.kind === 'todo') e.dataTransfer.setData(TODO_MIME, b.todoId) // lets it drop onto todo lists too
    e.dataTransfer.effectAllowed = 'move'
  }
  function dragEnd() {
    ui.dragBlock = null
    hover.value = null
  }
  function onOver(e) {
    const types = e.dataTransfer.types
    if (!types.includes(BLOCK_MIME) && !types.includes(TODO_MIME)) return
    e.preventDefault()
    hover.value = slotAt(e)
  }
  /** Where a drop at this pointer position would land ({ start, dur } in minutes). */
  function slotAt(e) {
    const m = minuteAt(e, e.currentTarget)
    const d = ui.dragBlock
    const dur = d ? d.dur : 30
    const start = snap(d ? m - d.offset : m)
    return { start: Math.max(0, Math.min(1440 - dur, start)), dur }
  }
  function onLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) hover.value = null
  }
  function onDrop(e) {
    e.preventDefault()
    // compute from the drop itself: dragleave between child blocks may already have cleared `hover`
    const h = slotAt(e)
    hover.value = null
    const d = ui.dragBlock
    if (d && h) {
      if (locked()) { toast('Schedule locked · unlock (padlock) to drag — tap a block to edit or remove it'); return } // still cancel the drag (ISS-14)
      if (d.group) {
        shiftSelected(h.start - d.group.start, diffDays(d.group.date, o.date()))
        ui.dragBlock = null
        return
      }
      moveBlock(d.kind, d.id, o.date(), h.start)
      toast(`${d.kind === 'todo' ? d.id : 'Block'} → ${o.date().slice(5)} ${fromMin(h.start)}`)
      ui.dragBlock = null
      return
    }
    const id = e.dataTransfer.getData(TODO_MIME)
    if (id && h) o.onDropTodo(id, fromMin(h.start))
  }

  /* ── resize (pointer events on the end handle) ── */
  function startResize(e, b) {
    e.preventDefault()
    e.stopPropagation()
    if (locked()) return
    resizing = true
    const origin = o.axis === 'x' ? e.clientX : e.clientY
    const startMin = toMin(b.start)
    const origEnd = toMin(b.end)
    const id = b.kind === 'todo' ? b.todoId : b.id
    const move = (ev) => {
      const delta = (((o.axis === 'x' ? ev.clientX : ev.clientY) - origin) / o.pxh()) * 60
      resize.value = { id: b.id, end: Math.max(startMin + SNAP, Math.min(1440, snap(origEnd + delta))) }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (resize.value && resize.value.end !== origEnd) {
        resizeBlock(b.kind, id, resize.value.end)
        const mins = resize.value.end - startMin
        toast(`${b.kind === 'todo' ? id : 'Block'} ends ${fromMin(resize.value.end)} (${mins}m)`)
      }
      resize.value = null
      setTimeout(() => { resizing = false }, 0) // swallow the click that follows pointerup
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  /** Block with the live resize preview applied. */
  const view = (b) => (resize.value?.id === b.id ? { ...b, end: fromMin(resize.value.end) } : b)
  const isResizing = () => resizing

  return { hover, resize, view, dragStartBlock, dragEnd, onOver, onLeave, onDrop, startResize, isResizing }
}
