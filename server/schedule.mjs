// Pure notification planning: given the planner state and a time window, return the
// notifications that fall inside it. No I/O, so it is easy to test with fake clocks.
//
// All planner times are wall-clock times in the user's timezone (state.settings.timezone).
import { rhythm, segments } from './pomodoro.mjs'
import { goalDates } from './goaldates.mjs'

export const DEFAULT_SETTINGS = {
  timezone: 'UTC',
  notify: { blocks: true, deadlines: true, daily: true, wellbeing: true, pomodoro: true },
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
/** At most this many plugin reminders per day per account, whatever plugins ask for. */
export const REMINDERS_PER_DAY = 30
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
/** Does a reminder starting on `start` fire on `date`? No repeat: only that day. */
export function remindsOn(r, start, date) {
  if (date < start) return false
  const rep = r.repeat
  if (!rep) return date === start
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
  if (rep === 'daily') return true
  if (rep === 'weekdays') return dow >= 1 && dow <= 5
  const w = /^weekly:([a-z,]+)$/.exec(rep)
  if (w) return w[1].split(',').includes(DAY_NAMES[dow])
  const e = /^every:(\d{1,3})$/.exec(rep)
  if (e && Number(e[1]) > 0) return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) % Number(e[1]) === 0
  return false
}

/* ── planner queries (mirror of the client store, kept minimal) ── */
const todosOn = (state, date) => (state.todos ?? []).filter((t) => t.scheduled?.date === date)
function blocksOn(state, date) {
  const fixed = (state.timeBlocks ?? []).filter((b) => b.date === date).map((b) => ({ ...b, kind: 'block' }))
  const r = rhythm(state.settings)
  const timed = todosOn(state, date).filter((t) => t.scheduled.start && !t.done).map((t) => {
    // a pomodoro sitting spans its breaks too (server/pomodoro.mjs, same maths as the app)
    const pomo = t.pomo ? segments(t.timeMin || 30, r) : null
    const span = pomo ? pomo[pomo.length - 1].end : t.timeMin || 30
    return {
      id: t.id, kind: 'todo', title: t.title, link: t.links?.[0] ?? null, start: t.scheduled.start,
      end: fromMin(Math.min(1440, toMin(t.scheduled.start) + span)), pomo,
    }
  })
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

    // pomodoro sittings: a push at every switch between work and break
    if (s.notify.pomodoro) {
      for (const b of blocks) {
        if (!b.pomo || b.pomo.length < 2) continue
        const t0 = toMin(b.start)
        const n = b.pomo.length
        const name = clip(b.title, 50)
        b.pomo.forEach((g, i) => {
          if (!g.brk) return
          const breakAt = t0 + g.end
          const backAt = breakAt + g.brk
          if (backAt > 1440) return
          const long = (i + 1) % rhythm(state.settings).every === 0
          add({
            key: `pomo:break:${b.id}:${D}:${b.start}:${i}`, at: zoned(D, fromMin(breakAt), tz),
            title: `${long ? 'Long break' : 'Break'} · ${g.brk} min`, body: `${name} · pomodoro ${i + 1}/${n} done · back at ${fromMin(backAt)}`,
            url: '/#/focus', tag: `pomo-${b.id}`,
          })
          const next = b.pomo[i + 1]
          add({
            key: `pomo:work:${b.id}:${D}:${b.start}:${i + 1}`, at: zoned(D, fromMin(backAt), tz),
            title: `Back to work · pomodoro ${i + 2}/${n}`, body: `${name} · until ${fromMin(Math.min(1440, t0 + next.end))}`,
            url: '/#/focus', tag: `pomo-${b.id}`,
          })
        })
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
        ...(() => { const gs = goalDates(state).filter((g) => g.date === D || g.date === addDays(D, 1)); return gs.length ? [`Goal dates: ${gs.slice(0, 2).map((g) => `${clip(g.title, 24)} ${g.pct}% (${g.date === D ? 'today' : 'tomorrow'})`).join(' · ')}`] : [] })(),
      ].filter(Boolean)
      add({ key: `brief:${D}`, at: zoned(D, s.briefingTime, tz), title: `Briefing · ${wd(D)} ${D.slice(5)}`, body: bits.join('\n'), url: '/#/briefing', tag: `brief-${D}` })

      const stamped = (state.signOffs?.[D] ?? []).filter(Boolean).length
      const tomorrow = todosOn(state, addDays(D, 1)).filter((t) => !t.done)
      const untimed = tomorrow.filter((t) => !t.scheduled.start).length
      if (stamped < 4 || untimed) {
        add({
          key: `eve:${D}`, at: zoned(D, s.eveningTime, tz), title: 'Debrief',
          body: [stamped < 4 ? `Sign-off ${stamped}/4 stamped — press S to stamp` : 'Sign-off complete ✓',
            `Tomorrow: ${tomorrow.length} task${tomorrow.length === 1 ? '' : 's'}${untimed ? `, ${untimed} without a time` : ''}`].join('\n'),
          url: '/#/debrief', tag: `eve-${D}`,
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
        body: 'Screens off soon. Stamp today’s sign-off and glance at tomorrow.', url: '/#/debrief', tag: `wind-${D}`,
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
  /* goal dates (a PSG's or SIG's time bound): your own targets, so a gentler nudge than a deadline's: the morning
     before and the morning of, at the briefing time. Never an "overdue" alarm. */
  if (s.notify.deadlines) {
    for (const g of goalDates(state)) {
      const base = { url: `/#/strategy/${g.planId}?goal=${encodeURIComponent(g.no)}`, tag: `goal-${g.no}` }
      const body = `${g.no} · ${g.pct}% done · target ${wd(g.date)} ${g.date.slice(5)}`
      add({ ...base, key: `goal:${g.key}:${g.date}:1d`, at: zoned(addDays(g.date, -1), s.briefingTime, tz), title: `Goal date tomorrow · ${clip(g.title, 60)}`, body })
      add({ ...base, key: `goal:${g.key}:${g.date}:0d`, at: zoned(g.date, s.briefingTime, tz), title: `Goal date today · ${clip(g.title, 60)}`, body })
    }
  }

  // plugin reminders (goal 4, gap G2): records in state.reminders, written through the data door. Data, not code:
  // a plugin never runs on the server. { at: 'YYYY-MM-DDTHH:MM' local, repeat?: daily|weekdays|weekly:mon,..|every:n, title, open?, by? }
  if (s.notify.reminders !== false) {
    const muted = state.settings?.mutedPlugins ?? {}
    let perDay = {}
    for (const r of state.reminders ?? []) {
      if (!r || typeof r.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r.at) || (r.by && muted[r.by]) || r.done) continue
      const start = r.at.slice(0, 10), hhmm = r.at.slice(11, 16)
      for (const D of days) {
        if (!remindsOn(r, start, D)) continue
        perDay[D] = (perDay[D] ?? 0) + 1
        if (perDay[D] > REMINDERS_PER_DAY) continue
        add({
          key: `reminder:${r.id}:${D}:${hhmm}`, at: zoned(D, hhmm, tz),
          title: clip(String(r.title ?? r.text ?? 'Reminder'), 80), body: r.body ? clip(String(r.body), 120) : (r.by ? `From ${r.by}` : ''),
          url: typeof r.open === 'string' && r.open.startsWith('/#/') ? r.open : '/#/', tag: `reminder-${r.id}`,
        })
      }
    }
  }

  return out.sort((a, b) => a.at - b.at)
}
