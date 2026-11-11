// Briefing / Debrief: what needs the driver before and after the day, as what-if choices.
// A choice is a "sim": changes to todos ({ patch: {id: fields}, add: [new todos] }). The preview draws the
// real schedule from the todos with the sim applied; picking it applies the same sim, with an undo.
import { state, todayISO, todosForDay, isLeaf, CAPACITY_H, addTodo, updateTodo, toggleTodo, deleteTodo, findTodo, activePlans, blocksFrom, loadsDay, toMin, fromMin, newBlockMin, WORK_FROM, WORK_TO, byPriority, wd, addDays } from './store'
import { openDeadlines, effDue, minsTo, sigState, daysTo } from './glance'

/** Open tasks linked to a deadline and scheduled between `from` (any day if null) and the day it looms. */
export const coverFor = (d, from = null) => state.todos.filter((t) =>
  !t.done && isLeaf(t) && t.links?.includes(d.id) && t.scheduled?.date && (!from || t.scheduled.date >= from) && t.scheduled.date <= effDue(d).slice(0, 10))

/** Deadlines looming within `hours` (or overdue) that no task scheduled from `from` on works towards. */
export const threats = (hours, from = null) => openDeadlines().filter((d) => minsTo(effDue(d)) <= hours * 60 && !coverFor(d, from).length)

/** Open tasks on a day without a start time, by priority. */
export const untimedOn = (date) => todosForDay(date).filter((t) => !t.done && isLeaf(t) && !t.scheduled.start)

/** Milestones (SIGs) past their time bound in active plans, most overdue first. */
export const lateSigs = () => activePlans()
  .flatMap((plan) => plan.sigs.filter((s) => sigState(s) === 'late').map((sig) => ({ sig, plan, days: -daysTo(sig.timeBound) })))
  .sort((a, b) => b.days - a.days)

/** The day's objective: its top-priority task, done or not. */
export const objectiveOf = (date) => todosForDay(date).filter(isLeaf).sort((a, b) => a.priority - b.priority || a.order - b.order)[0] ?? null

/** Minutes as "45m" / "2h" / "1h 30m". */
export const dur = (m) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`)

/** When the evening wind-down starts, in minutes (Settings → bedtime minus wind-down). */
export const windDownAt = () => toMin(state.settings?.bedTime || '23:00') - (state.settings?.windDownMin ?? 60)

/* ───────────── what-ifs ───────────── */
export const noSim = () => ({ patch: {}, add: [] })
/** The todo list as it would be with `sim` applied. Nothing is saved. */
export function simTodos(sim) {
  const p = sim?.patch ?? {}
  const out = state.todos.map((t) => (p[t.id] ? { ...t, ...p[t.id] } : t))
  return sim?.add?.length ? [...out, ...sim.add] : out
}
const dayTasks = (todos, date) => todos.filter((t) => t.scheduled?.date === date && isLeaf(t))
/** Hours of tasks on a day (what counts against CAPACITY_H). */
export const loadOf = (todos, date) => dayTasks(todos, date).filter((t) => loadsDay(t, date)).reduce((s, t) => s + (t.timeMin || 0), 0) / 60
export const untimedIn = (todos, date) => dayTasks(todos, date).filter((t) => !t.done && !t.scheduled.start).sort(byPriority)
export const openIn = (todos, date) => dayTasks(todos, date).filter((t) => !t.done).sort(byPriority)
export const objectiveIn = (todos, date) => dayTasks(todos, date).sort((a, b) => a.priority - b.priority || a.order - b.order)[0] ?? null

/** Earliest free start for `mins` of work on `date` (not in the past for today), from `after` on; 'HH:MM' or null. */
export function freeSlot(todos, date, mins, after = WORK_FROM, to = WORK_TO) {
  const busy = blocksFrom(date, todos).filter((b) => !(b.done && date > todayISO())).map((b) => [toMin(b.start), toMin(b.end)])
  let s = toMin(after)
  if (date === todayISO()) { const n = new Date(); s = Math.max(s, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15) }
  const len = newBlockMin(mins || 30)
  while (s + len <= toMin(to)) {
    const clash = busy.find(([a, b]) => s < b && s + len > a)
    if (!clash) return fromMin(s)
    s = Math.ceil(clash[1] / 15) * 15
  }
  return null
}
/** A sim that gives every untimed open task on `date` a start time, in priority order (like Auto time-box). */
export function timeboxSim(base, date) {
  const sim = { patch: { ...base.patch }, add: [...base.add] }
  const placed = []
  for (const t of untimedIn(simTodos(sim), date)) {
    const s = freeSlot(simTodos(sim), date, t.timeMin)
    if (!s) continue
    sim.patch[t.id] = { ...(sim.patch[t.id] ?? {}), scheduled: { date, start: s } }
    placed.push(t.id)
  }
  return { sim, placed }
}
/** Make `t` the day's objective: priority 1, ahead of the others. */
export function objectiveSim(t) {
  const first = Math.min(...state.todos.map((x) => x.order ?? 0))
  return { patch: { [t.id]: { priority: 1, order: first - 1000 } }, add: [] }
}
/** A 30-minute P1 task for a deadline at `start` on `date`. */
export const deadlineTaskSim = (d, date, start) => ({ patch: {}, add: [{ id: `NEW-${d.id}`, title: `Work on: ${d.title}`, timeMin: 30, priority: 1, order: 0, done: false, links: [d.id], due: d.due.slice(0, 10), scheduled: { date, start } }] })

/** Apply a sim to the real state; returns a function that undoes it. */
export function applySim(sim) {
  const undo = []
  for (const [id, fields] of Object.entries(sim.patch ?? {})) {
    const t = findTodo(id)
    if (!t) continue
    const prev = JSON.parse(JSON.stringify(Object.fromEntries(Object.keys(fields).map((k) => [k, t[k] ?? null]))))
    const { done, ...rest } = fields
    if (Object.keys(rest).length) updateTodo(id, rest)
    if (done !== undefined && done !== t.done) toggleTodo(id)
    undo.push(() => {
      const { done: d0, ...r0 } = prev
      if (Object.keys(r0).length) updateTodo(id, r0)
      if (d0 !== undefined && findTodo(id) && findTodo(id).done !== !!d0) toggleTodo(id)
    })
  }
  for (const a of sim.add ?? []) {
    const { id: _tmp, order: _o, ...rest } = a
    const t = addTodo(rest)
    undo.push(() => deleteTodo(t.id))
  }
  return () => undo.reverse().forEach((f) => f())
}

/* ───────────── the numbers a choice changes ───────────── */
const fmtH = (h) => `${h.toFixed(1)}h`
/** Before → after rows for the days shown (only what changes, plus anything still out of range). */
export function simStats(before, after, days) {
  const rows = []
  const wdn = windDownAt()
  for (const date of days) {
    const l0 = loadOf(before, date), l1 = loadOf(after, date)
    const label = date === todayISO() ? 'Today' : wd(date)
    // load: red only when over capacity, green when a choice brings it back under
    if (Math.abs(l0 - l1) > 1e-3 || (l1 > CAPACITY_H && date === days[0])) rows.push({ anchor: { day: date, kind: 'load' }, k: `${label} · tasks`, a: Math.abs(l0 - l1) > 1e-3 ? fmtH(l0) : `${fmtH(l1)} / ${CAPACITY_H}h`, b: `${fmtH(l1)} / ${CAPACITY_H}h`, an: l0, bn: l1, bad: l1 > CAPACITY_H, good: l0 > CAPACITY_H && l1 <= CAPACITY_H })
    const u0 = untimedIn(before, date).length, u1 = untimedIn(after, date).length
    if (u0 !== u1) rows.push({ anchor: { day: date, kind: 'untimed' }, k: `${label} · no time yet`, a: u0, b: u1, an: u0, bn: u1, better: 'lower' })
    const end = (todos) => Math.max(0, ...blocksFrom(date, todos).filter((b) => b.kind === 'todo' && !b.done).map((b) => toMin(b.end)))
    const e0 = end(before), e1 = end(after)
    if (e0 !== e1 && (e0 > wdn || e1 > wdn)) rows.push({ anchor: { day: date, kind: 'end' }, k: `${label} · last task ends`, a: e0 ? fromMin(e0) : '—', b: fromMin(e1), an: e0, bn: e1, better: 'lower', bad: e1 > wdn })
    const o0 = objectiveIn(before, date), o1 = objectiveIn(after, date)
    if (o0?.id !== o1?.id && o1) rows.push({ anchor: { day: date, kind: 'objective' }, k: `${label} · objective`, a: o0?.title ?? '—', b: o1.title })
  }
  const bl = (todos) => todos.filter((t) => !t.done && isLeaf(t) && !t.scheduled).length
  if (bl(before) !== bl(after)) rows.push({ anchor: { kind: 'off' }, k: 'Backlog', a: bl(before), b: bl(after), an: bl(before), bn: bl(after) })
  const dn = (todos) => todos.filter((t) => t.done).length
  if (dn(after) > dn(before)) rows.push({ anchor: { kind: 'off' }, k: 'Done', a: dn(before), b: dn(after), an: dn(before), bn: dn(after), better: 'higher' })
  return rows
}
/** One plain line on what a choice leads to, with a tone (ok / warn / danger / ''). */
export function simVerdict(after, days, before = state.todos) {
  const wdn = windDownAt()
  for (const date of days) {
    // only the day the step is about, or a day this choice makes heavier, can turn the verdict red
    if (date !== days[0] && loadOf(after, date) <= loadOf(before, date) + 1e-6) continue
    const label = date === todayISO() ? 'Today' : wd(date)
    const over = loadOf(after, date) - CAPACITY_H
    if (over > 1e-3) return [`${label} is ${over.toFixed(1)}h over capacity.`, 'danger']
    const late = blocksFrom(date, after).filter((b) => b.kind === 'todo' && !b.done && toMin(b.end) > wdn)
    if (late.length) return [`${label} runs past your ${fromMin(wdn)} wind-down.`, 'warn']
  }
  return [days.length > 1 && loadOf(after, days[1]) > loadOf(before, days[1]) + 1e-6 ? 'Both days fit.' : `${days[0] === todayISO() ? 'Today' : wd(days[0])} fits.`, 'ok']
}
export const tomorrowOf = (date) => addDays(date, 1)

/** A step for a day over capacity: move one of its lowest-priority tasks (or several) to `to`. */
export function overloadStep(date, to, { who = wd(date) } = {}) {
  const move = (id) => ({ date: to, start: null })
  return {
    key: 'overload-' + date, tone: 'warn', days: () => [date, to],
    title: () => `${who} has ${loadOf(state.todos, date).toFixed(1)}h of tasks`,
    why: () => `Your capacity is ${CAPACITY_H}h. Move something to ${wd(to)}.`,
    stale: () => (loadOf(state.todos, date) <= CAPACITY_H ? `${who} fits now.` : null),
    options: () => {
      const pool = openIn(state.todos, date).sort(byPriority).reverse()
      const over = loadOf(state.todos, date) - CAPACITY_H
      const single = pool.slice(0, 3).map((t) => ({ label: `Move “${t.title}” → ${wd(to)}`, sim: { patch: { [t.id]: { scheduled: move(t.id) } }, add: [] }, fits: (t.timeMin || 0) / 60 >= over - 1e-6 }))
      const greedy = { patch: {}, add: [] }
      let cut = 0
      for (const t of pool) { if (cut >= over - 1e-6) break; greedy.patch[t.id] = { scheduled: move(t.id) }; cut += (t.timeMin || 0) / 60 }
      const k = Object.keys(greedy.patch).length
      const fitIdx = single.findIndex((o) => o.fits)
      if (fitIdx >= 0) single[fitIdx].rec = true
      return [...single, k > 1 && { label: `Move the ${k} lowest-priority tasks → ${wd(to)}`, sim: greedy, rec: fitIdx < 0 }, { label: 'Keep it', sim: noSim() }].filter(Boolean)
    },
  }
}
/** Does `date` stay within capacity with `sim` applied? */
export const fitsWith = (sim, date) => loadOf(simTodos(sim), date) <= CAPACITY_H + 1e-6
