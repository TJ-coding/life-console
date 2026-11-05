// Pure notification planning: given the planner state and a time window, return the
// notifications that fall inside it. No I/O, so it is easy to test with fake clocks.
//
// All planner times are wall-clock times in the user's timezone (state.settings.timezone).

export const DEFAULT_SETTINGS = {
  timezone: 'UTC',
  notify: { blocks: true, deadlines: true, daily: true, wellbeing: true },
  blockLeadMin: 5,
  briefingTime: '07:30',
  eveningTime: '21:00',
  bedTime: '23:00',
  windDownMin: 60,
  caffeineWarnMin: 30,
}

export function settingsOf(state) {
  const s = state?.settings ?? {}
  return { ...DEFAULT_SETTINGS, ...s, notify: { ...DEFAULT_SETTINGS.notify, ...(s.notify ?? {}) } }
}

/* ── timezone helpers ── */
const fmtCache = new Map()
function parts(ms, tz) {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    fmtCache.set(tz, f)
  }
  return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
}
const offsetMs = (ms, tz) => {
  const p = parts(ms, tz)
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000
}
/** Epoch ms of wall-clock `date` + `hhmm` in `tz` (handles DST; '24:00' is next midnight). */
export function zoned(date, hhmm, tz) {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const first = guess - offsetMs(guess, tz)
  return guess - offsetMs(first, tz)
}
export const localDate = (ms, tz) => { const p = parts(ms, tz); return `${p.year}-${p.month}-${p.day}` }
export const addDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const wd = (date) => WD[new Date(`${date}T00:00:00Z`).getUTCDay()]
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/* ── planner queries (mirror of the client store, kept minimal) ── */
const todosOn = (state, date) => (state.todos ?? []).filter((t) => t.scheduled?.date === date)
function blocksOn(state, date) {
  const fixed = (state.timeBlocks ?? []).filter((b) => b.date === date).map((b) => ({ ...b, kind: 'block' }))
  const timed = todosOn(state, date).filter((t) => t.scheduled.start && !t.done).map((t) => ({
    id: t.id, kind: 'todo', title: t.title, link: t.links?.[0] ?? null, start: t.scheduled.start,
    end: fromMin(Math.min(1440, toMin(t.scheduled.start) + (t.timeMin || 30))),
  }))
  return [...fixed, ...timed].sort((a, b) => toMin(a.start) - toMin(b.start))
}
const byPriority = (a, b) => Number(a.done) - Number(b.done) || a.priority - b.priority || (a.order ?? 0) - (b.order ?? 0)

/**
 * Notifications whose time falls in (fromMs, toMs].
 * Each: { key, at, title, body, url, tag, data?, actions? } — `key` is stable so callers can de-duplicate.
 */
export function computeEvents(state, fromMs, toMs) {
  if (!state) return []
  const s = settingsOf(state)
  const tz = s.timezone || 'UTC'
  const out = []
  const add = (ev) => { if (ev.at > fromMs && ev.at <= toMs) out.push(ev) }
  const today = localDate(toMs, tz)
  const days = [addDays(today, -1), today, addDays(today, 1)]

  for (const D of days) {
    const blocks = blocksOn(state, D)

    if (s.notify.blocks) {
      for (const b of blocks) {
        const start = zoned(D, b.start, tz)
        add({
          key: `start:${b.kind}:${b.id}:${D}:${b.start}`, at: start - s.blockLeadMin * 60000,
          title: `In ${s.blockLeadMin} min · ${b.start} ${clip(b.title, 60)}`,
          body: `${b.start}–${b.end}${b.link ? ' · ' + b.link : ''}${b.kind === 'todo' ? ' · task' : ''}`,
          url: '/#/focus', tag: `start-${b.id}`,
        })
        if (b.kind === 'todo') {
          add({
            key: `end:todo:${b.id}:${D}:${b.start}`, at: zoned(D, b.end, tz),
            title: `Time's up · ${clip(b.title, 60)}`, body: 'Finished? Mark it done, or reschedule it in the planner.',
            url: '/#/', tag: `end-${b.id}`, data: { todoId: b.id }, actions: [{ action: 'done', title: 'Mark done' }, { action: 'open', title: 'Open' }],
          })
        }
      }
    }

    if (s.notify.daily) {
      const todos = todosOn(state, D).filter((t) => !t.done).sort(byPriority)
      const dls = (state.deadlines ?? []).filter((d) => !d.done && (d.due.slice(0, 10) === D || d.due.slice(0, 10) === addDays(D, 1)))
        .sort((a, b) => a.due.localeCompare(b.due))
      const first = blocks[0]
      const bits = [
        `${blocks.length} block${blocks.length === 1 ? '' : 's'}${first ? `, first ${first.start} ${clip(first.title, 28)}` : ''}`,
        todos.length ? `Top: ${todos.slice(0, 3).map((t) => clip(t.title, 26)).join(' · ')}` : 'No tasks on today’s sheet',
        dls.length ? `Due: ${dls.slice(0, 2).map((d) => `${clip(d.title, 24)} (${d.due.slice(0, 10) === D ? 'today' : 'tomorrow'} ${d.due.slice(11)})`).join(' · ')}` : '',
      ].filter(Boolean)
      add({ key: `brief:${D}`, at: zoned(D, s.briefingTime, tz), title: `Good morning · ${wd(D)} ${D.slice(5)}`, body: bits.join('\n'), url: '/#/', tag: `brief-${D}` })

      const stamped = (state.signOffs?.[D] ?? []).filter(Boolean).length
      const tomorrow = todosOn(state, addDays(D, 1)).filter((t) => !t.done)
      const untimed = tomorrow.filter((t) => !t.scheduled.start).length
      if (stamped < 4 || untimed) {
        add({
          key: `eve:${D}`, at: zoned(D, s.eveningTime, tz), title: 'Evening sign-off',
          body: [stamped < 4 ? `Sign-off ${stamped}/4 stamped — press S to stamp` : 'Sign-off complete ✓',
            `Tomorrow: ${tomorrow.length} task${tomorrow.length === 1 ? '' : 's'}${untimed ? `, ${untimed} without a time` : ''}`].join('\n'),
          url: '/#/week', tag: `eve-${D}`,
        })
      }
    }

    if (s.notify.wellbeing) {
      const cutoff = state.caffeineCutoff || '14:00'
      const mg = (state.caffeine?.[D] ?? []).reduce((a, c) => a + (c.mg || 0), 0)
      add({
        key: `caf:${D}`, at: zoned(D, cutoff, tz) - s.caffeineWarnMin * 60000, title: `Caffeine cutoff at ${cutoff}`,
        body: `Last call in ${s.caffeineWarnMin} min · ${mg}/${state.caffeineLimit ?? 400} mg so far today`, url: '/#/', tag: `caf-${D}`,
      })
      add({
        key: `wind:${D}`, at: zoned(D, s.bedTime, tz) - s.windDownMin * 60000, title: `Wind down · bed at ${s.bedTime}`,
        body: 'Screens off soon. Stamp today’s sign-off and glance at tomorrow.', url: '/#/', tag: `wind-${D}`,
      })
    }
  }

  if (s.notify.deadlines) {
    for (const d of state.deadlines ?? []) {
      if (d.done || !d.due) continue
      const due = zoned(d.due.slice(0, 10), d.due.slice(11, 16) || '23:59', tz)
      const when = `${wd(d.due.slice(0, 10))} ${d.due.slice(5, 10)} ${d.due.slice(11, 16)}`
      const base = { url: '/#/deadlines', tag: `dl-${d.id}` }
      add({ ...base, key: `dl:${d.id}:${d.due}:24h`, at: due - 24 * 3600000, title: `Due tomorrow · ${clip(d.title, 60)}`, body: `${when}${d.vital ? ' · ' + d.vital : ''}` })
      add({ ...base, key: `dl:${d.id}:${d.due}:1h`, at: due - 3600000, title: `Due in 1 hour · ${clip(d.title, 60)}`, body: `${when}${d.vital ? ' · ' + d.vital : ''}` })
      add({ ...base, key: `dl:${d.id}:${d.due}:due`, at: due, title: `Overdue now · ${clip(d.title, 60)}`, body: `Was due ${when}. Done? Tick it in Deadlines.` })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}
