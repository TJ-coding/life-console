// Shared drag-and-drop for todos.
// Dropping a todo onto another todo row inserts it before/after that row and
// adopts that row's priority — i.e. reordering *is* reprioritising.
import { ui, findTodo, reorderTodo, toast } from './store'

export const TODO_MIME = 'text/x-todo'
const isTodoDrag = (e) => e.dataTransfer?.types.includes(TODO_MIME)

export function startDrag(e, t) {
  e.dataTransfer.setData(TODO_MIME, t.id)
  e.dataTransfer.effectAllowed = 'move'
  ui.dragId = t.id
}
export function endDrag() {
  ui.dragId = null
  ui.dropOver = null
  ui.dropPos = null
}
/** opts.reverse: list is rendered bottom-up (workload buckets), so screen halves map inversely. */
export function overRow(e, t, opts = {}) {
  if (!isTodoDrag(e)) return
  e.preventDefault()
  e.stopPropagation()
  const r = e.currentTarget.getBoundingClientRect()
  ui.dropOver = t.id
  const upper = e.clientY < r.top + r.height / 2
  ui.dropPos = upper !== !!opts.reverse ? 'before' : 'after'
}
export function leaveRow(e, t) {
  if (ui.dropOver === t.id && !e.currentTarget.contains(e.relatedTarget)) ui.dropOver = null
}
/**
 * opts.adoptDate  — move onto the target's scheduled day (day lists)
 * opts.unschedule — clear the schedule (backlog)
 * opts.week       — set the task's planned week (backlog-only week columns; null = unplanned)
 */
export function dropOnRow(e, target, opts = {}) {
  if (!isTodoDrag(e)) return
  e.preventDefault()
  e.stopPropagation()
  const id = e.dataTransfer.getData(TODO_MIME)
  const before = ui.dropPos === 'before'
  endDrag()
  const moved = findTodo(id)
  if (!moved || id === target.id) return
  const extra = {}
  if (opts.unschedule) extra.scheduled = null
  if ('week' in opts) extra.week = opts.week
  else if (opts.adoptDate && target.scheduled && moved.scheduled?.date !== target.scheduled.date) {
    extra.scheduled = { date: target.scheduled.date, start: null }
  }
  const oldP = moved.priority
  reorderTodo(id, target.id, before, extra)
  toast(oldP !== target.priority ? `${id} · P${oldP} → P${target.priority}` : `${id} reordered`)
}
export const dropClass = (t, reverse = false) => ({
  'drop-before': ui.dropOver === t.id && ui.dropPos === (reverse ? 'after' : 'before'),
  'drop-after': ui.dropOver === t.id && ui.dropPos === (reverse ? 'before' : 'after'),
  dragging: ui.dragId === t.id,
})
