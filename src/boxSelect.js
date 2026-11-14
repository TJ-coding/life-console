// Box selection on the schedule (ISS-29): press on an empty spot of a timeline and drag to draw a box;
// every block it touches joins ui.selBlocks (the same selection Shift-click builds, so the selection bar,
// arrow keys and group drag all work on it). Shift while drawing adds to the current selection.
// Timelines opt in with `data-boxsel` on their area and `data-bkey="<blockKey>"` on each block; the box can
// cross several of them (the day columns of Plan week). Mouse / pen only — phones keep long-press.
// Clicking anywhere outside the selected blocks clears the selection.
import { ui } from './store'

const SKIP = '.block, button, a, input, select, textarea, [contenteditable="true"], .handle'
const START_PX = 5

let cand = null // { x, y, base: [] } after pointerdown, before the drag starts
let box = null // the overlay element while drawing
let boxEndedAt = 0 // when the last box drag ended: the click that follows it isn't a real click

function rectOf(a, b) {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) }
}
const hits = (r) => [...document.querySelectorAll('[data-boxsel] [data-bkey]')].filter((el) => {
  const b = el.getBoundingClientRect()
  return b.width > 0 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top
}).map((el) => el.dataset.bkey)

function onDown(e) {
  if (e.button !== 0 || e.pointerType === 'touch') return
  const area = e.target.closest?.('[data-boxsel]')
  if (!area || e.target.closest(SKIP) || ui.scheduleLock) return
  cand = { x: e.clientX, y: e.clientY, base: e.shiftKey || e.metaKey || e.ctrlKey ? [...ui.selBlocks] : [] }
}
function onMove(e) {
  if (!cand) return
  if (!box) {
    if (Math.hypot(e.clientX - cand.x, e.clientY - cand.y) < START_PX) return
    box = document.createElement('div')
    box.className = 'boxsel'
    document.body.appendChild(box)
    document.body.classList.add('boxselecting')
    window.getSelection?.()?.removeAllRanges()
  }
  e.preventDefault()
  const r = rectOf(cand, { x: e.clientX, y: e.clientY })
  Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.right - r.left + 'px', height: r.bottom - r.top + 'px' })
  const sel = [...new Set([...cand.base, ...hits(r)])]
  ui.selBlocks.splice(0, ui.selBlocks.length, ...sel)
}
function end(cancel) {
  if (box) {
    box.remove()
    box = null
    document.body.classList.remove('boxselecting')
    boxEndedAt = Date.now()
    if (cancel) ui.selBlocks.splice(0, ui.selBlocks.length, ...cand.base)
  }
  cand = null
}
/** Capture phase, so it sees clicks other handlers stop. The click ending a box drag is swallowed; any other
 *  click outside the selected blocks clears the selection (blocks, the selection bar and toasts don't). */
const KEEP = '[data-bkey], .selbar, .toast, .scrim, .pb-pop'
function onClick(e) {
  if (Date.now() - boxEndedAt < 400) { e.stopPropagation(); e.preventDefault(); boxEndedAt = 0; return }
  if (!ui.selBlocks.length || e.shiftKey || e.metaKey || e.ctrlKey) return
  if (e.target.closest?.(KEEP)) return
  ui.selBlocks.splice(0)
}
function onKey(e) { if (e.key === 'Escape' && box) { e.stopPropagation(); end(true) } }

let installed = false
export function installBoxSelect() {
  if (installed) return
  installed = true
  document.addEventListener('pointerdown', onDown)
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', () => end(false))
  document.addEventListener('pointercancel', () => end(true))
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
}
