// Pomodoro rhythm, shared by the app (planning, timeline) and the server (push at each switch).
// Pure: no I/O, no Vue. A "pomo" sitting is a timed task part whose work minutes (todo.timeMin)
// are cut into pomodoros with breaks between them, so its block on the schedule is longer than
// its work time: 50m of work at 25/5 is 09:00–09:55.

export const POMODORO_DEFAULTS = { on: true, work: 25, short: 5, long: 15, every: 4 }

/** Settings → a complete, sane rhythm. */
export function rhythm(settings) {
  const p = { ...POMODORO_DEFAULTS, ...(settings?.pomodoro ?? {}) }
  const int = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d)
  return {
    on: p.on !== false,
    work: int(p.work, 5, 120, 25),
    short: int(p.short, 0, 60, 5),
    long: int(p.long, 0, 90, 15),
    every: int(p.every, 1, 12, 4),
  }
}

/**
 * Work minutes → segments: [{ work, start, end, brk }] with offsets in minutes from the sitting's
 * start. `brk` is the break after this pomodoro (0 after the last). The last pomodoro may be short.
 */
export function segments(workMin, r) {
  const out = []
  let left = Math.max(0, Math.round(workMin || 0))
  let t = 0
  for (let i = 0; left > 0; i++) {
    const w = Math.min(r.work, left)
    left -= w
    const brk = left > 0 ? ((i + 1) % r.every === 0 ? r.long : r.short) : 0
    out.push({ work: w, start: t, end: t + w, brk })
    t += w + brk
  }
  return out
}

/** Minutes on the clock for `workMin` of work laid out as pomodoros. */
export function wallMin(workMin, r) {
  const s = segments(workMin, r)
  return s.length ? s[s.length - 1].end : 0
}

/** Inverse of wallMin: how much work fits in `wall` minutes on the clock (used when resizing). */
export function workIn(wall, r) {
  let work = 0
  let t = 0
  for (let i = 0; t < wall; i++) {
    const w = Math.min(r.work, wall - t)
    work += w
    t += w
    if (t >= wall) break
    t += (i + 1) % r.every === 0 ? r.long : r.short
  }
  return work
}

/** Count of pomodoros for `workMin` (a short last one counts). */
export const count = (workMin, r) => Math.ceil(Math.max(0, workMin || 0) / r.work)

/**
 * Cut a day's work amount into sittings of at most one set (`every` pomodoros), e.g. 3h20 at
 * 25×4 → [100, 100]. Sittings are separated by a long break when they're placed.
 */
export function sittings(workMin, r) {
  const set = r.work * r.every
  const out = []
  let left = Math.max(0, Math.round(workMin || 0))
  while (left > 0) { const m = Math.min(set, left); out.push(m); left -= m }
  return out
}
