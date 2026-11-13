// "At a glance" helpers shared by S-01, S-21 and S-35: countdowns, urgency and goal status.
// Reads `ui.now` so computed values tick with the 1 s clock.
import { state, ui, todayISO, diffDays, pad, sigsOf, psgPct, activePlans, allPsgs, allSigs } from './store'

/* ───────────── time to a moment ───────────── */
/** Minutes from now until an ISO date-time ('YYYY-MM-DDTHH:MM'); negative when past. */
export const minsTo = (due) => { void ui.now; return Math.round((new Date(due) - ui.now) / 60000) }

/** Compact countdown: 42m · 5h 07m · 3d 7h (prefixed with − when past). */
export function countdown(due) {
  const m = minsTo(due)
  const a = Math.abs(m)
  const s = a < 60 ? `${a}m` : a < 1440 ? `${Math.floor(a / 60)}h ${pad(a % 60)}m` : `${Math.floor(a / 1440)}d ${Math.floor((a % 1440) / 60)}h`
  return m < 0 ? `−${s}` : s
}

/** Big readout: minutes within an hour, hours + minutes within a day, otherwise days + hours (absolute;
 *  pair with "overdue by"). No seconds: a ticking deadline is distracting (ISS-26). Rounds up while
 *  counting down, so "1m" shows until it's due rather than "0m" a minute early. */
export function bigCountdown(due) {
  void ui.now
  const ms = new Date(due) - ui.now
  const a = ms > 0 ? Math.ceil(ms / 60000) : Math.floor(-ms / 60000)
  if (a < 60) return `${a}m`
  if (a < 1440) return `${Math.floor(a / 60)}h ${pad(a % 60)}m`
  return `${Math.floor(a / 1440)}d ${Math.floor((a % 1440) / 60)}h`
}

/** Status colour class: ≤ 12 h or overdue = danger, ≤ 48 h = warn, else ok. */
export const urgency = (due) => { const m = minsTo(due); return m <= 720 ? 'danger' : m <= 2880 ? 'warn' : 'ok' }

/** OVERDUE / DUE TODAY / TOMORROW / IN n DAYS */
export function dueStatus(due) {
  if (minsTo(due) <= 0) return 'OVERDUE'
  const n = diffDays(todayISO(), due)
  return n === 0 ? 'DUE TODAY' : n === 1 ? 'TOMORROW' : `IN ${n} DAYS`
}

/** The moment a deadline actually looms at: the personal internal target (end of that day) while it
 *  still stands — not passed yet — else the hard due date. On a date-only internal this means the
 *  countdown runs to 23:59 of that day. Tick-aware via ui.now. */
export function effDue(d) {
  void ui.now
  return d.internal && d.internal >= todayISO() ? `${d.internal}T23:59` : d.due
}

/** Open deadlines, soonest first — by the moment each actually looms at (effDue, see above). */
export const openDeadlines = () => state.deadlines.filter((d) => !d.done).sort((a, b) => effDue(a).localeCompare(effDue(b)))

/* ───────────── goals ───────────── */
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '')
/** Days until a goal's time bound (negative = past), or null when it isn't a date ("Continuous"). */
export const daysTo = (timeBound) => (isDate(timeBound) ? diffDays(todayISO(), timeBound) : null)
/** "in 26d" · "today" · "12d late" · '' */
export function inDays(timeBound) {
  const n = daysTo(timeBound)
  if (n === null) return ''
  return n === 0 ? 'today' : n > 0 ? `in ${n}d` : `${-n}d late`
}

/** SIG state for colour: done · late (time bound passed) · soon (≤ 7 days) · ok. */
export function sigState(s) {
  if (s.status === 'done' || Number(s.pct) >= 100) return 'done'
  const n = daysTo(s.timeBound)
  if (n === null) return 'ok'
  return n < 0 ? 'late' : n <= 7 ? 'soon' : 'ok'
}

/** The SIG to work on next: in progress first, then the nearest time bound, then priority. */
export function nextSigOf(psgNo) {
  const key = (s) => [s.status === 'doing' ? 0 : 1, daysTo(s.timeBound) ?? 1e6, Number(s.priority) || 9]
  return sigsOf(psgNo).filter((s) => sigState(s) !== 'done')
    .sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] })[0] ?? null
}

/** Open deadlines linked to a goal (source = the PSG or one of its SIGs), soonest first. */
export function goalDeadlines(psgNo) {
  const ids = new Set([psgNo, ...sigsOf(psgNo).map((s) => s.no)])
  return openDeadlines().filter((d) => ids.has(d.source))
}

/** Everything a goal row needs. `behind` = a SIG or the PSG itself is past its time bound. */
export function psgGlance(p) {
  const sigs = sigsOf(p.no)
  const pct = psgPct(p.no)
  const late = sigs.filter((s) => sigState(s) === 'late')
  const psgLate = daysTo(p.timeBound) !== null && daysTo(p.timeBound) < 0 && pct < 100
  return { ...p, pct, sigs, late, behind: late.length > 0 || psgLate, next: nextSigOf(p.no), deadline: goalDeadlines(p.no)[0] ?? null }
}

/** The nearest open SIG time bound across active plans: { sig, plan, days } or null. */
export function nextMilestone() {
  return activePlans().flatMap((plan) => plan.sigs.filter((s) => sigState(s) !== 'done' && daysTo(s.timeBound) !== null).map((sig) => ({ sig, plan, days: daysTo(sig.timeBound) })))
    .sort((a, b) => a.days - b.days)[0] ?? null
}

/* ───────────── time bounds ───────────── */
/* A goal's `timeBound` is one of: 'YYYY-MM-DD' (end date) · 'Continuous' (no end) · '' (not set).
   Anything else is free text left over from before the date picker; it's flagged so it gets fixed. */
export const CONTINUOUS = 'Continuous'
export const isLegacyBound = (v) => !!v && !isDate(v) && v !== CONTINUOUS
/** Plain-language problems with a goal's time bound: not a date, ends after its PSG, ends before a SIG it depends on. */
export function boundIssues(g) {
  const out = []
  const tb = g.timeBound ?? ''
  if (isLegacyBound(tb)) out.push(`"${tb}" isn't a date: pick one or set Continuous`)
  if (!g.psg || !isDate(tb)) return out
  const p = allPsgs().find((x) => x.no === g.psg)
  if (p && isDate(p.timeBound) && tb > p.timeBound) out.push(`Ends after ${p.no} (${p.timeBound})`)
  for (const d of g.deps ?? []) {
    const p = allPsgs().find((x) => x.no === d)
    if (p) {
      if (isDate(p.timeBound) && tb < p.timeBound) out.push(`Ends before ${d} (${p.timeBound}), which it depends on`)
      continue
    }
    const s = allSigs().find((x) => x.no === d)
    if (s && isDate(s.timeBound) && tb < s.timeBound) out.push(`Ends before ${d} (${s.timeBound}), which it depends on`)
  }
  return out
}
