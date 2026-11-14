// Undo / redo for the planner (ISS-30): ⌘Z / Ctrl+Z and ⇧⌘Z / Ctrl+Y.
// Works on whole-document snapshots: every change made on this device becomes a step once it settles
// (a burst of edits — a drag, a dialog filling several fields — within SETTLE ms is one step). Undo puts the
// previous snapshot back into `state`, which saves and syncs like any other edit.
// Changes that arrive from another device (sync.js) are not steps: they reset the history instead, so an
// undo can never wipe out something done elsewhere.
import { watch } from 'vue'
import { state, normalizeState } from './store'

const SETTLE = 600
const MAX = 50
const snap = () => JSON.stringify(state)

let last = snap() // the settled document the next step would go back to
const past = []
const future = []
let timer = null
let quiet = false // true while we (or sync) rewrite state: not a user step

/** Sync is about to replace / merge state from the server: ignore those writes. */
export function pauseUndo() { quiet = true; clearTimeout(timer); timer = null }
/** …and once it has: start a fresh history from what's there now. */
export function resetUndo() { past.length = 0; future.length = 0; last = snap(); quiet = false }

function settle() {
  timer = null
  const now = snap()
  if (now === last) return
  past.push(last)
  if (past.length > MAX) past.shift()
  future.length = 0
  last = now
}
watch(state, () => {
  if (quiet) return
  clearTimeout(timer)
  timer = setTimeout(settle, SETTLE)
}, { deep: true })

function put(json) {
  quiet = true
  for (const k of Object.keys(state)) delete state[k]
  Object.assign(state, JSON.parse(json))
  normalizeState()
  last = snap()
  // the store's own watchers (save, containers) run on this change before we listen again
  setTimeout(() => { last = snap(); quiet = false }, 0)
}
/** Undo the last step; false when there's nothing to undo. */
export function undo() {
  if (timer) { clearTimeout(timer); settle() } // a change still settling counts as the last step
  if (!past.length) return false
  future.push(last)
  put(past.pop())
  return true
}
/** Redo the step undone last; false when there's nothing to redo. */
export function redo() {
  if (timer) { clearTimeout(timer); settle() }
  if (!future.length) return false
  past.push(last)
  put(future.pop())
  return true
}
