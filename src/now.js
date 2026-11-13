// "What should I be doing right now?" — derived live from today's timeline + todos.
import { computed, ref } from 'vue'
import { allSigs, state, ui, todayISO, blocksForDay, todosForDay, toMin, fromMin, pad, updateTodo, byPriority, isLeaf } from './store'

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h ? `${h}h ${pad(m)}m` : `${m}m`
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Does todo `t` belong to block `b` (same link, or a SIG under the block's PSG)? */
function relatedTo(t, b) {
  if (!b.link) return false
  return t.links.some((l) => l === b.link || allSigs().find((s) => s.no === l)?.psg === b.link)
}

/** ISS-25: in a pomodoro sitting the big clock shows ONE countdown: to the pomodoro switch (break / back to
 *  work) or to the end of the whole block. Click the clock to switch; remembered per device. */
const CLOCK_KEY = 'life-console/pomo-clock'
export const clockMode = ref((() => { try { return localStorage.getItem(CLOCK_KEY) === 'block' ? 'block' : 'pomo' } catch { return 'pomo' } })())
export function toggleClockMode() {
  clockMode.value = clockMode.value === 'pomo' ? 'block' : 'pomo'
  try { localStorage.setItem(CLOCK_KEY, clockMode.value) } catch { /* ignore */ }
}

export function useNow() {
  const T = computed(() => { void ui.now; return todayISO() }) // re-evaluates across midnight
  const nowSec = computed(() => ui.now.getHours() * 3600 + ui.now.getMinutes() * 60 + ui.now.getSeconds())
  const nowMin = computed(() => Math.floor(nowSec.value / 60))

  // Only blocks that still matter: completed todos drop out so you're pointed at the next thing.
  const blocks = computed(() => blocksForDay(T.value).filter((b) => !b.done).sort((a, b) => toMin(a.start) - toMin(b.start)))
  const active = computed(() => blocks.value.filter((b) => toMin(b.start) <= nowMin.value && nowMin.value < toMin(b.end)))
  /** The block you should be in now (latest-started wins when they overlap). */
  const current = computed(() => [...active.value].sort((a, b) => toMin(b.start) - toMin(a.start))[0] ?? null)
  const overlapping = computed(() => active.value.filter((b) => b !== current.value))
  const next = computed(() => blocks.value.find((b) => toMin(b.start) > nowMin.value) ?? null)

  const progress = computed(() => {
    const c = current.value
    if (!c) return null
    const total = (toMin(c.end) - toMin(c.start)) * 60
    const elapsed = nowSec.value - toMin(c.start) * 60
    return { total, elapsed, remaining: total - elapsed, pct: Math.min(100, (elapsed / total) * 100) }
  })
  /** ISS-25: where the current pomodoro sitting is: working (seconds until the break) or on a break
   *  (seconds until work resumes). `n` / `of` count pomodoros. Null when the block isn't a pomodoro sitting. */
  const pomoPhase = computed(() => {
    const c = current.value
    const segs = c?.pomo
    if (!segs?.length) return null
    const off = nowSec.value - toMin(c.start) * 60
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      const end = s.end * 60
      if (off < end) return { phase: 'work', n: i + 1, of: segs.length, left: end - off, brk: s.brk, last: i === segs.length - 1 }
      if (off < end + s.brk * 60) return { phase: 'break', n: i + 1, of: segs.length, left: end + s.brk * 60 - off, brk: s.brk }
    }
    return null
  })
  /** The big clock: { sec, label, title } for the current block, following clockMode in a pomodoro sitting. */
  const readout = computed(() => {
    const p = progress.value
    if (!p) return null
    const ph = pomoPhase.value
    if (!ph) return { sec: p.remaining, label: 'left', title: null }
    const other = clockMode.value === 'pomo' ? 'Click to show the time left in the whole block' : 'Click to show the time to the next break'
    if (clockMode.value === 'block') return { sec: p.remaining, label: 'left in block', title: other }
    if (ph.phase === 'break') return { sec: ph.left, label: 'break left', title: other }
    if (ph.last) return { sec: p.remaining, label: 'left · last pomodoro', title: other }
    return { sec: ph.left, label: 'to break', title: other }
  })
  const untilNext = computed(() => (next.value ? toMin(next.value.start) * 60 - nowSec.value : null))
  /** Free seconds from now until the next block (or end of day). */
  const gap = computed(() => (next.value ? toMin(next.value.start) : 1440) * 60 - nowSec.value)

  /** Today's open todos without a future fixed time, priority order. */
  const queue = computed(() =>
    todosForDay(T.value).filter((t) => !t.done && t.id !== current.value?.todoId && !(t.scheduled.start && toMin(t.scheduled.start) > nowMin.value)))

  /** The one todo to pick up now. */
  const suggestion = computed(() => {
    const c = current.value
    if (c?.kind === 'todo') return null // already doing a todo
    if (c) {
      // inside a fixed block: work linked to it — today's list first, then anything open
      return queue.value.find((t) => relatedTo(t, c))
        ?? state.todos.filter((t) => !t.done && isLeaf(t) && relatedTo(t, c)).sort(byPriority)[0] ?? null
    }
    const freeMin = gap.value / 60
    return queue.value.find((t) => t.timeMin <= freeMin) ?? queue.value[0] ?? null
  })
  /** Suggested todo whose own start time already passed (you missed it). */
  const missedAt = computed(() => {
    const s = suggestion.value?.scheduled
    return s?.date === T.value && s.start && toMin(s.start) < nowMin.value ? s.start : null
  })
  const suggestionFits = computed(() => !!suggestion.value && suggestion.value.timeMin * 60 <= gap.value)

  /** Put the suggested todo on the timeline starting now. */
  function startNow(t) {
    updateTodo(t.id, { scheduled: { date: T.value, start: fromMin(nowMin.value) } })
  }

  /** One-line summary for the top bar / tab title. */
  const headline = computed(() => {
    if (current.value) return { state: 'busy', text: current.value.title, meta: `${fmtDur(progress.value.remaining)} left` }
    if (suggestion.value) return { state: 'free', text: `Free ${next.value ? fmtDur(gap.value) : 'for the day'}`, short: next.value ? fmtDur(gap.value) : 'rest of day', meta: `next: ${suggestion.value.title}` }
    if (next.value) return { state: 'free', text: `Free until ${next.value.start}`, short: `until ${next.value.start}`, meta: next.value.title }
    return { state: 'idle', text: 'Nothing scheduled', meta: 'press N to add' }
  })

  return { T, nowSec, nowMin, current, overlapping, next, progress, pomoPhase, readout, untilNext, gap, queue, suggestion, suggestionFits, missedAt, startNow, headline }
}
