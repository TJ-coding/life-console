// Briefing / Debrief: what needs the driver's attention before and after the day, and the one-click fixes.
import { state, addDays, todosForDay, isLeaf, workload, CAPACITY_H, addTodo, updateTodo, deleteTodo, toast, wd, activePlans, byPriority } from './store'
import { openDeadlines, effDue, minsTo, sigState, daysTo } from './glance'

/** Open tasks linked to a deadline and scheduled between `from` (any day if null) and the day it looms. */
export const coverFor = (d, from = null) => state.todos.filter((t) =>
  !t.done && isLeaf(t) && t.links?.includes(d.id) && t.scheduled?.date && (!from || t.scheduled.date >= from) && t.scheduled.date <= effDue(d).slice(0, 10))

/** Deadlines looming within `hours` (or overdue) that no task scheduled from `from` on works towards. */
export const threats = (hours, from = null) => openDeadlines().filter((d) => minsTo(effDue(d)) <= hours * 60 && !coverFor(d, from).length)

/** Open tasks on a day without a start time, by priority. */
export const untimedOn = (date) => todosForDay(date).filter((t) => !t.done && isLeaf(t) && !t.scheduled.start)

/** Hours of tasks on a day beyond capacity (0 when it fits). */
export const overBy = (date) => Math.max(0, workload(date) - CAPACITY_H)

/** Milestones (SIGs) past their time bound in active plans, most overdue first. */
export const lateSigs = () => activePlans()
  .flatMap((plan) => plan.sigs.filter((s) => sigState(s) === 'late').map((sig) => ({ sig, plan, days: -daysTo(sig.timeBound) })))
  .sort((a, b) => b.days - a.days)

/** The day's objective: its top-priority task, done or not. */
export const objectiveOf = (date) => todosForDay(date).filter(isLeaf).sort((a, b) => a.priority - b.priority || a.order - b.order)[0] ?? null

/** Put a 30-minute P1 task for a deadline on a day's list (untimed), with Undo. */
export function addTaskFor(d, date) {
  const t = addTodo({ title: `Work on: ${d.title}`, timeMin: 30, priority: 1, links: [d.id], due: d.due.slice(0, 10), scheduled: { date, start: null } })
  toast(`${t.id} added to ${wd(date)} for ${d.id}`, { label: 'Undo', run: () => deleteTodo(t.id) })
  return t
}

/** Move a task to the next day (untimed), with Undo. */
export function toNextDay(t, from) {
  const prev = t.scheduled ? { ...t.scheduled } : null
  const to = addDays(from, 1)
  updateTodo(t.id, { scheduled: { date: to, start: null } })
  toast(`${t.id} moved to ${wd(to)}`, { label: 'Undo', run: () => updateTodo(t.id, { scheduled: prev }) })
}

/** Move several tasks to the next day (untimed), with one Undo. */
export function allToNextDay(list, from) {
  const to = addDays(from, 1)
  const prev = list.map((t) => ({ id: t.id, s: t.scheduled ? { ...t.scheduled } : null }))
  for (const t of list) updateTodo(t.id, { scheduled: { date: to, start: null } })
  toast(`Moved ${prev.length} task${prev.length > 1 ? 's' : ''} to ${wd(to)}`, { label: 'Undo', run: () => prev.forEach((p) => updateTodo(p.id, { scheduled: p.s })) })
}

/** Move the lowest-priority untimed tasks to the next day until the day fits its capacity, with one Undo. */
export function shedLoad(date) {
  const moved = []
  const pool = untimedOn(date).sort(byPriority).reverse()
  for (const t of pool) {
    if (overBy(date) <= 0) break
    moved.push({ id: t.id, prev: { ...t.scheduled } })
    updateTodo(t.id, { scheduled: { date: addDays(date, 1), start: null } })
  }
  if (moved.length) toast(`Moved ${moved.length} task${moved.length > 1 ? 's' : ''} to ${wd(addDays(date, 1))}`, { label: 'Undo', run: () => moved.forEach((m) => updateTodo(m.id, { scheduled: m.prev })) })
  return moved.length
}

/** Minutes as "45m" / "2h" / "1h 30m". */
export const dur = (m) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`)
