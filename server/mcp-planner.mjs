// Planner access for Claude over MCP (server/mcp.mjs): a separate permission from the workshop. The person confirms
// it on the trusted page (/trust?do=claude-planner, server/consent.mjs), which adds the 'planner' scope to Claude's
// token; /trust?do=claude-planner-off or connecting Claude again takes it away. Pure functions on the planner
// document: reading (today, find) and small edits (add a task or deadline, change or complete a task). Nothing is
// ever deleted. Edits run inside planner.save's lock (`mutate`), so devices pick them up like any other change.
import { localDate, addDays } from './schedule.mjs'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const bad = (msg) => Object.assign(new Error(msg), { status: 400 })

const tzOf = (state) => state?.settings?.timezone || 'UTC'
function nowIn(tz, ms = Date.now()) {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms))
  return { date: localDate(ms, tz), time: t }
}
const isContainer = (state, t) => (state.todos ?? []).some((x) => x.parent === t.id)
const mins = (n) => (n ? `${n}m` : '')

function todoLine(state, t) {
  const bits = [
    t.scheduled ? `${t.scheduled.date}${t.scheduled.start ? ` ${t.scheduled.start}` : ''}` : 'backlog',
    mins(t.timeMin), `P${t.priority ?? 3}`,
    t.due ? `due ${t.due}` : '',
    isContainer(state, t) ? 'has subtasks' : '',
    t.parent ? `part of ${t.parent}` : '',
    t.done ? 'done' : '',
  ].filter(Boolean)
  return `- ${t.id} ${t.title} (${bits.join(', ')})`
}
const deadlineLine = (d) => `- ${d.id} ${d.title} (due ${String(d.due).replace('T', ' ')}${d.done ? ', done' : ''})`

/** What today looks like: the answer to "what now?" in plain text. */
export function today(state, ms = Date.now()) {
  if (!state) return 'The planner is empty.'
  const tz = tzOf(state)
  const { date, time } = nowIn(tz, ms)
  const todos = state.todos ?? []
  const leaves = todos.filter((t) => !isContainer(state, t))
  const blocks = (state.timeBlocks ?? []).filter((b) => b.date === date).sort((a, b) => a.start.localeCompare(b.start))
  const todays = leaves.filter((t) => t.scheduled?.date === date).sort((a, b) => (a.scheduled.start ?? '99').localeCompare(b.scheduled.start ?? '99'))
  const overdue = leaves.filter((t) => !t.done && ((t.due && t.due < date) || (t.scheduled?.date && t.scheduled.date < date)))
  const soon = addDays(date, 14)
  const now = `${date}T${time}`
  const open = (state.deadlines ?? []).filter((d) => !d.done).sort((a, b) => String(a.due).localeCompare(String(b.due)))
  const missed = open.filter((d) => String(d.due) < now)
  const deadlines = open.filter((d) => String(d.due) >= now && String(d.due).slice(0, 10) <= soon)
  const backlog = leaves.filter((t) => !t.done && !t.scheduled).length
  const out = [`Today is ${date}, ${time} (${tz}).`]
  out.push('', 'Time blocks today:', ...(blocks.length ? blocks.map((b) => `- ${b.start}-${b.end} ${b.title}${b.category ? ` [${b.category}]` : ''}`) : ['(none)']))
  out.push('', 'Tasks today:', ...(todays.length ? todays.map((t) => todoLine(state, t)) : ['(none)']))
  if (overdue.length) out.push('', 'Overdue tasks:', ...overdue.slice(0, 20).map((t) => todoLine(state, t)))
  if (missed.length) out.push('', 'Deadlines passed, not marked done:', ...missed.slice(0, 20).map(deadlineLine))
  out.push('', 'Deadlines in the next 14 days:', ...(deadlines.length ? deadlines.map(deadlineLine) : ['(none)']))
  out.push('', `Backlog: ${backlog} unscheduled task${backlog === 1 ? '' : 's'} (find_in_planner lists them).`)
  return out.join('\n')
}

/** Tasks, deadlines and plans matching every word of `query` (empty: open tasks first). */
export function find(state, { query = '', done = false, limit = 30 } = {}) {
  if (!state) return 'The planner is empty.'
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (...fields) => { const hay = fields.join(' ').toLowerCase(); return words.every((w) => hay.includes(w)) }
  const n = Math.min(Math.max(Number(limit) || 30, 1), 100)
  const todos = (state.todos ?? []).filter((t) => (done || !t.done) && hit(t.id, t.title, t.vital, t.notes, ...(t.links ?? [])))
  const deadlines = (state.deadlines ?? []).filter((d) => (done || !d.done) && hit(d.id, d.title, d.vital, d.source))
  const plans = (state.plans ?? []).filter((p) => p.status !== 'archived' && hit(p.id, p.title, p.intent, p.vision, ...(p.psgs ?? []).map((g) => `${g.no} ${g.name ?? ''}`)))
  const out = []
  if (todos.length) out.push(`Tasks (${todos.length}${todos.length > n ? `, first ${n}` : ''}):`, ...todos.slice(0, n).map((t) => todoLine(state, t)))
  if (deadlines.length) out.push('Deadlines:', ...deadlines.slice(0, n).map(deadlineLine))
  if (plans.length) out.push('Plans:', ...plans.slice(0, 10).map((p) => `- ${p.id} ${p.title} (${p.status}${(p.psgs ?? []).length ? `; goals ${p.psgs.map((g) => g.no).join(', ')}` : ''})`))
  return out.length ? out.join('\n') : 'Nothing found.'
}

/** A task's fields from the tool's arguments (only the ones given). `scheduled`: date + optional start; date null = backlog. */
function todoFields(a, { creating = false } = {}) {
  const f = {}
  if (a.title !== undefined || creating) {
    const title = String(a.title ?? '').trim().slice(0, 300)
    if (!title) throw bad('title is required')
    f.title = title
  }
  if (a.minutes !== undefined) {
    const m = Math.round(Number(a.minutes))
    if (!(m >= 5 && m <= 720)) throw bad('minutes must be between 5 and 720')
    f.timeMin = m
  }
  if (a.priority !== undefined) {
    const p = Number(a.priority)
    if (![1, 2, 3, 4, 5].includes(p)) throw bad('priority must be 1 (highest) to 5')
    f.priority = p
  }
  if (a.due !== undefined) {
    if (a.due !== null && !DATE.test(a.due)) throw bad('due must be YYYY-MM-DD (or null)')
    f.due = a.due
  }
  if (a.date !== undefined || a.start !== undefined) {
    if (a.date === null) f.scheduled = null
    else {
      if (!DATE.test(a.date ?? '')) throw bad('date must be YYYY-MM-DD (or null for the backlog)')
      if (a.start != null && !TIME.test(a.start)) throw bad('start must be HH:MM (24-hour)')
      f.scheduled = { date: a.date, start: a.start ?? null }
    }
  }
  if (a.notes !== undefined) f.notes = String(a.notes ?? '').slice(0, 5000)
  if (a.done !== undefined) f.done = !!a.done
  return f
}

/** Add a task. Mutates `state`; returns the new task. */
export function addTodo(state, a) {
  const f = todoFields(a, { creating: true })
  state.todos ??= []
  if (a.parent !== undefined && a.parent !== null && !state.todos.some((t) => t.id === a.parent)) throw bad(`There's no task ${a.parent}.`)
  const max = Math.max(100, ...state.todos.map((t) => Number(String(t.id).split('-')[1]) || 0))
  const now = new Date().toISOString()
  const t = {
    id: `T-${max + 1}`, title: 'Untitled', vital: '', timeMin: 30, done: false, lsd: 'S', priority: 3,
    due: null, scheduled: null, links: [], notes: '', createdAt: now, updatedAt: now,
    order: Math.max(0, ...state.todos.map((x) => x.order ?? 0)) + 1000, ...f,
    ...(a.parent ? { parent: a.parent } : {}),
  }
  if (t.scheduled?.start && state.settings?.pomodoro?.on) t.pomo = true // as the app does (store.js addTodo)
  state.todos.push(t)
  return t
}

/** Change a task (only the fields given). Mutates `state`; returns the task. */
export function updateTodo(state, a) {
  const t = (state.todos ?? []).find((x) => x.id === a.id)
  if (!t) throw bad(`There's no task ${a.id}.`)
  const f = todoFields(a)
  if (!Object.keys(f).length) throw bad('Give at least one field to change.')
  if (isContainer(state, t) && (f.done !== undefined || f.scheduled)) throw bad(`${t.id} has subtasks: it is done when they are, and it isn't scheduled itself. Change its subtasks instead.`)
  if (f.scheduled?.start && !t.scheduled?.start && state.settings?.pomodoro?.on) f.pomo = true
  Object.assign(t, f, { updatedAt: new Date().toISOString() })
  return t
}

/** Add a deadline. Mutates `state`; returns it. */
export function addDeadline(state, a) {
  const title = String(a.title ?? '').trim().slice(0, 300)
  if (!title) throw bad('title is required')
  const due = String(a.due ?? '')
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?$/.exec(due)
  if (!m || (m[2] && !TIME.test(m[2]))) throw bad('due must be YYYY-MM-DD or YYYY-MM-DDTHH:MM')
  state.deadlines ??= []
  const max = Math.max(0, ...state.deadlines.map((x) => Number(String(x.id).split('-')[1]) || 0))
  const d = { id: `DL-${max + 1}`, title, vital: '', due: `${m[1]}T${m[2] ?? '23:59'}`, source: String(a.source ?? '').slice(0, 200), done: false, priority: 2 }
  state.deadlines.push(d)
  return d
}

export { todoLine, deadlineLine }
