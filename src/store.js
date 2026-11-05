// Central reactive store for the prototype. Persisted to localStorage.
import { reactive, watch } from 'vue'

/* ───────────── date / time helpers ───────────── */
export const pad = (n) => String(n).padStart(2, '0')
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseISO = (s) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const addDays = (s, n) => {
  const d = parseISO(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}
export const todayISO = () => iso(new Date())
export const mondayOf = (s) => addDays(s, -((parseISO(s).getDay() + 6) % 7))
export const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5) // b - a
export const toMin = (t) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
export const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
export const WD_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
export const WD_JA = ['日', '月', '火', '水', '木', '金', '土']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const wd = (s) => WD_EN[parseISO(s).getDay()]
export const wdJa = (s) => WD_JA[parseISO(s).getDay()]
export const fmtMD = (s) => {
  const d = parseISO(s)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
export const fmtSlash = (s) => {
  const d = parseISO(s)
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}
export const hhmm = (isoTs) => {
  const d = new Date(isoTs)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function isoWeek(s) {
  const d = parseISO(s)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const w1 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7)
}
export function relDay(s, base = todayISO()) {
  const n = diffDays(base, s)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  if (n < 0) return `${-n}d overdue`
  return `In ${n} days`
}

/* ───────────── domain constants ───────────── */
export const STAMPS = ['印', '印', '確認', '完']
export const STAMP_NAMES = ['Draft', 'Self-check', 'Confirmed', 'Complete']
export const CAPACITY_H = 7

export function linkType(id) {
  if (/^(PSG|SIG)-/.test(id)) return 'goal'
  if (/^DL-/.test(id)) return 'deadline'
  if (/^SP-/.test(id)) return 'plan'
  if (/^R-/.test(id)) return 'risk'
  if (/^IPB-/.test(id)) return 'ipb'
  if (/^KZ-/.test(id)) return 'kaizen'
  return 'course'
}
export function categoryOf(todo) {
  const types = todo.links.map(linkType)
  if (types.includes('course')) return 'academic'
  if (types.includes('goal') || types.includes('plan')) return 'research'
  if (types.includes('kaizen')) return 'kaizen'
  return 'experiment'
}

/* ───────────── seed data (relative to the current week) ───────────── */
function seed() {
  const T = todayISO()
  const M = mondayOf(T)
  const D = (n) => addDays(M, n) // 0 = Monday
  const now = new Date().toISOString()
  const todo = (id, title, o = {}) => ({
    id, title, vital: '', timeMin: 30, done: false, lsd: 'S', priority: 3,
    due: null, scheduled: null, links: [], notes: '', createdAt: now, updatedAt: now, ...o,
  })
  const at = (date, t) => new Date(`${date}T${t}:00`).toISOString()

  // sign-offs: past weekdays fully/partially stamped, today half-way
  const signOffs = {}
  for (let i = 0; i < 7; i++) {
    const d = D(i)
    const n = diffDays(d, T)
    if (n > 0) signOffs[d] = [at(d, '07:10'), at(d, '09:05'), at(d, '18:30'), n > 1 || i % 2 ? at(d, '21:40') : null]
  }
  signOffs[T] = [at(T, '07:15'), at(T, '09:00'), null, null]

  const block = (date, start, end, title, category, link = null) => ({
    id: `B-${date}-${start}`, date, start, end, title, category, link,
  })
  const timeBlocks = []
  for (let i = 0; i < 5; i++) timeBlocks.push(block(D(i), '06:30', '07:30', 'Physical training', 'kaizen', 'KZ-01'))
  timeBlocks.push(
    block(D(0), '08:30', '11:30', 'Deep work: literature review', 'research', 'PSG-01'),
    block(D(0), '13:00', '15:00', 'Statistical methods', 'academic', 'ST1010'),
    block(D(0), '20:30', '21:30', 'Debrief & review', 'kaizen'),
    block(D(1), '08:00', '11:30', 'CARVER target analysis', 'research', 'PSG-01'),
    block(D(1), '13:30', '15:30', 'ST2001 Lecture 2', 'academic', 'ST2001spA'),
    block(D(1), '16:00', '17:00', 'Kaizen: filing standard', 'kaizen', 'KZ-02'),
    block(D(2), '09:00', '11:30', 'Telemetry pipeline', 'experiment', 'SIG-01.2'),
    block(D(2), '14:00', '16:00', 'SP-03 payload test', 'research', 'SP-03'),
    block(D(3), '10:00', '12:00', 'Baseline experiments', 'experiment', 'SIG-01.2'),
    block(D(3), '13:30', '15:00', 'ST2001 Lecture 3', 'academic', 'ST2001spA'),
    block(D(3), '16:00', '17:00', 'Takt ledger review', 'kaizen', 'KZ-03'),
    block(D(4), '08:30', '12:00', 'Full pipeline run', 'experiment', 'SIG-01.2'),
    block(D(4), '13:30', '16:30', 'ST2001 problem set', 'academic', 'ST2001spA'),
    block(D(4), '17:00', '18:30', 'Weekly retro', 'kaizen', 'KZ-04'),
    block(D(5), '10:00', '11:30', 'Long run', 'kaizen'),
    block(D(6), '15:00', '16:30', 'Next-week horizon planning', 'research', 'SP-03'),
  )

  return {
    version: 1,
    todos: [
      todo('T-101', 'Outline literature review section', { vital: 'Position vs. 3 closest works', timeMin: 45, lsd: 'D', priority: 2, scheduled: { date: D(0), start: null }, done: diffDays(D(0), T) > 0, links: ['SIG-01.3'] }),
      todo('T-102', 'Sync lab meeting notes', { timeMin: 30, scheduled: { date: D(0), start: null }, done: diffDays(D(0), T) > 0 }),
      todo('T-103', 'Course prerequisites verification', { timeMin: 15, lsd: 'L', priority: 2, scheduled: { date: D(1), start: null }, done: diffDays(D(1), T) > 0, links: ['ST2001spA'] }),
      todo('T-104', 'Read Ahead – ST2001 Lecture 3 (OS: Processes)', { vital: 'Process control block · context switch', timeMin: 30, lsd: 'L', priority: 1, due: T, scheduled: { date: T, start: '09:00' }, links: ['ST2001spA', 'SIG-02.1'], notes: '## Core focus\n- PCB register structure\n- Context switch overhead vs thread switch' }),
      todo('T-105', 'Draft related-works section', { vital: 'Synthesise 5 benchmark papers', timeMin: 90, lsd: 'S', priority: 1, scheduled: { date: T, start: null }, links: ['SIG-01.3'] }),
      todo('T-106', 'Ochiai card: LMs Represent Space and Time', { vital: 'Record 3 core insights', timeMin: 25, lsd: 'D', priority: 3, scheduled: { date: T, start: null }, links: ['SIG-01.1'] }),
      todo('T-107', 'Vacuum clean (main desk)', { vital: 'Monthly rotation · group B', timeMin: 15, lsd: 'D', priority: 4, scheduled: { date: T, start: null }, links: ['KZ-04'] }),
      todo('T-108', 'Baseline experiment script', { vital: 'Reproduce Table 2', timeMin: 120, lsd: 'L', priority: 2, scheduled: { date: D(4), start: null }, links: ['SIG-01.2'] }),
      todo('T-109', 'ST2001 Report 2 writing', { vital: 'Processes & memory', timeMin: 120, lsd: 'L', priority: 1, due: addDays(T, 1), scheduled: { date: D(2), start: null }, links: ['ST2001spA'] }),
      todo('T-110', 'Refactor CARVER weight vector', { timeMin: 45, lsd: 'S', priority: 1, links: ['SP-03'] }),
      todo('T-111', 'Draft sensor spec sheet', { timeMin: 60, lsd: 'L', priority: 2, links: ['ST2001spA'] }),
      todo('T-112', 'Reorganise lab Obsidian notes', { timeMin: 30, lsd: 'D', priority: 3 }),
      todo('T-113', 'GPU cluster script fix for batch jobs', { timeMin: 40, lsd: 'S', priority: 2, links: ['SIG-01.2'] }),
      todo('T-114', 'Table 2 metric delta confirmation', { timeMin: 30, lsd: 'S', priority: 2, links: ['SIG-01.2'] }),
      todo('T-115', 'Submit ST2001 lab assignment', { timeMin: 20, lsd: 'S', priority: 2, due: D(4), scheduled: { date: D(4), start: null }, links: ['SIG-02.1'] }),
      todo('T-116', 'Weekly financial takt pass', { timeMin: 20, lsd: 'D', priority: 4, scheduled: { date: D(5), start: null } }),
    ],
    timeBlocks,
    deadlines: [
      { id: 'DL-1', title: 'ST2001 Report 2 (Processes & Memory)', vital: 'Upload PDF to LMS', due: `${addDays(T, 1)}T23:59`, source: 'ST2001spA', clickUp: true, done: false, priority: 1 },
      { id: 'DL-2', title: 'SIG-01.2 milestone: code freeze', vital: 'Tag release in repo', due: `${addDays(T, 3)}T18:00`, source: 'SIG-01.2', clickUp: true, done: false, priority: 2 },
      { id: 'DL-3', title: 'Weekly review aggregation', vital: 'KPI + Kaizen table', due: `${D(6)}T18:00`, source: 'KZ-04', clickUp: false, done: false, priority: 3 },
      { id: 'DL-4', title: 'PS-04 problem set', vital: '', due: `${D(0)}T18:00`, source: 'ST1010', clickUp: true, done: diffDays(D(0), T) > 0, priority: 2 },
      { id: 'DL-5', title: 'Hardware order form', vital: 'Needs supervisor sign', due: `${addDays(T, -1)}T17:00`, source: 'SP-03', clickUp: true, done: false, priority: 2 },
      { id: 'DL-6', title: 'Conference abstract', vital: '250 words', due: `${addDays(T, 12)}T23:59`, source: 'PSG-01', clickUp: true, done: false, priority: 1 },
    ],
    plan: {
      planNo: 'SP-03',
      title: 'PhD Year 1 Execution',
      status: 'Active · On-track',
      intent: 'Establish research independence, achieve 1× first-author tier-1 publication, and maintain a rigorous physiological operating rhythm.',
      vision: 'Top-tier autonomous researcher & practitioner',
      psgs: [
        { no: 'PSG-01', name: 'Publish first paper', priority: 1, indicators: '1× camera-ready tier-1 paper', timeBound: '2027-03-31', status: 'doing' },
        { no: 'PSG-02', name: 'Graduate coursework', priority: 2, indicators: 'GPA ≥ 3.85 & pass all credits', timeBound: '2027-01-20', status: 'doing' },
        { no: 'PSG-03', name: 'Physiological standard', priority: 3, indicators: '≥ 85% sleep hygiene compliance', timeBound: 'Continuous', status: 'doing' },
      ],
      sigs: [
        { no: 'SIG-01.1', psg: 'PSG-01', name: 'Literature position', priority: 1, criteria: 'Ochiai card on 15 core papers', timeBound: addDays(T, 10), status: 'done', pct: 100 },
        { no: 'SIG-01.2', psg: 'PSG-01', name: 'Baseline benchmark', priority: 1, criteria: 'Reproduce Table 2 within ±1%', timeBound: addDays(T, 26), status: 'doing', pct: 40 },
        { no: 'SIG-01.3', psg: 'PSG-01', name: 'Manuscript draft', priority: 2, criteria: '8-page draft ready for review', timeBound: addDays(T, 71), status: 'open', pct: 0 },
        { no: 'SIG-02.1', psg: 'PSG-02', name: 'ST2001 OS course', priority: 2, criteria: '8 reports submitted + exam ≥ A', timeBound: addDays(T, 45), status: 'doing', pct: 65 },
        { no: 'SIG-02.2', psg: 'PSG-02', name: 'ST1010 Statistics', priority: 3, criteria: 'All problem sets ≥ 80%', timeBound: addDays(T, 60), status: 'doing', pct: 75 },
        { no: 'SIG-03.1', psg: 'PSG-03', name: 'Sleep regularity', priority: 2, criteria: 'Score ≥ 85% & 23:00 cutoff', timeBound: 'Continuous', status: 'doing', pct: 60 },
      ],
      checkEveryDays: 7,
      checkLog: [
        { date: addDays(T, -13), reminder: true, checked: true, updated: true },
        { date: addDays(T, -6), reminder: true, checked: true, updated: false },
      ],
      events: [
        { sym: '◆', event: 'Baseline code freeze', date: addDays(T, 15) },
        { sym: '▲', event: 'Supervisor review', date: addDays(T, 30) },
        { sym: '■', event: 'Conference deadline', date: addDays(T, 100) },
      ],
    },
    routines: [
      'Sort table side stationery', 'Empty table', 'Put loose paper into archive queue', 'Archive papers in archive queue',
      'Return folders into archive', 'Make bed', 'Vacuum clean', 'Empty bin', 'Sort files in PC', 'Templates printed',
      'Refill deodorant beads', 'Dishes', 'Laundry', 'Floor is clear of any object',
    ],
    routineLog: { [M]: [0, 1, 2, 4, 5, 6, 7, 8, 11] },
    monthlyGroups: { A: ['Clean sink', 'Clean kitchen'], B: ['Sort bookshelf', 'Clean bath'], C: ['Clean PC tower', 'Clean toilet'] },
    monthlyLog: {},
    signOffs,
    notes: { [T]: 'Morning cold start: pre-work drift down from 35m → 17m.' },
    sleep: { [T]: { bed: '21:50', bedTarget: '21:30', wake: '06:35', wakeTarget: '06:30', targetMin: 540 } },
    caffeine: { [T]: [{ t: '08:10', what: 'Coffee', mg: 95 }, { t: '10:30', what: 'Tea', mg: 50 }] },
    caffeineCutoff: '13:30',
    caffeineLimit: 400,
    lectures: [{ id: 'L-3', course: 'ST2001spA', title: 'OS: Processes', no: 3, date: T, time: '13:30', readAhead: false, attended: false, cheatSheet: false }],
    reviews: [{ id: 'IPB-02', title: 'IPB-02 Threat overlay', date: addDays(T, 4) }],
  }
}

/* ───────────── state + persistence ───────────── */
const KEY = 'life-console/v1'
function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return null
}
const loaded = load()
/** true if this browser already had planner data saved (vs. a fresh demo seed) */
export const hadLocalData = loaded !== null
export const state = reactive(loaded ?? seed())
/** Every todo carries a numeric `order` used to rank todos that share a priority. */
export function ensureOrder() {
  state.todos?.forEach((t, i) => { if (typeof t.order !== 'number') t.order = (i + 1) * 1000 })
}
/** Notification preferences live in the synced document so the server scheduler can read them. */
export const NOTIFY_DEFAULTS = {
  notify: { blocks: true, deadlines: true, daily: true, wellbeing: true },
  blockLeadMin: 5, briefingTime: '07:30', eveningTime: '21:00', bedTime: '23:00', windDownMin: 60, caffeineWarnMin: 30,
}
export function ensureSettings() {
  if (!state.settings) state.settings = {}
  const s = state.settings
  for (const [k, v] of Object.entries(NOTIFY_DEFAULTS)) if (s[k] === undefined) s[k] = typeof v === 'object' ? { ...v } : v
  for (const [k, v] of Object.entries(NOTIFY_DEFAULTS.notify)) if (s.notify[k] === undefined) s.notify[k] = v
  // the server schedules in this timezone; keep it in step with the device you're using
  let tz = 'UTC'
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { /* ignore */ }
  if (s.timezone !== tz) s.timezone = tz
}
/* ───────────── schema migrations ─────────────
 * Each step upgrades a stored document by one version. They run on every load / sync / import,
 * so data saved by older versions of the app (on the server or in a browser) keeps working.
 * To change the data shape: bump SCHEMA_VERSION and add the next numbered step. Never edit old steps.
 */
export const SCHEMA_VERSION = 2
const PLAN_STATUSES = ['active', 'paused', 'archived']
function planV2(p) {
  const legacyLabel = typeof p.status === 'string' && !PLAN_STATUSES.includes(p.status) ? p.status : null
  return {
    ...p,
    id: p.id ?? p.planNo ?? 'SP-01',
    status: PLAN_STATUSES.includes(p.status) ? p.status : 'active',
    health: p.health ?? (legacyLabel ? legacyLabel.replace(/^Active\s*·\s*/i, '') : 'On-track'),
  }
}
const MIGRATIONS = {
  // v1 → v2: a single strategic plan (`plan`) becomes a list (`plans`), each with an id and status
  2(doc) {
    if (!Array.isArray(doc.plans)) doc.plans = []
    if (doc.plan) {
      const p = planV2(doc.plan)
      if (!doc.plans.some((x) => x.id === p.id)) doc.plans.unshift(p)
      delete doc.plan
    }
    doc.plans = doc.plans.map(planV2)
  },
}
/** Upgrade a document in place to SCHEMA_VERSION (idempotent; tolerates stale clients re-adding old fields). */
export function migrateDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc
  let v = Number(doc.schemaVersion) || 1
  while (v < SCHEMA_VERSION) { MIGRATIONS[v + 1](doc); v += 1 }
  if (doc.plan) MIGRATIONS[2](doc) // an out-of-date device synced the old field back
  doc.schemaVersion = SCHEMA_VERSION
  return doc
}

/** Bring any loaded / synced / imported document up to the current shape. */
export function normalizeState() {
  migrateDoc(state)
  ensureOrder()
  ensureSettings()
  // SIGs may depend on other SIGs (ISS-5); the field is optional, so default it instead of a migration
  for (const p of state.plans ?? []) for (const s of p.sigs ?? []) if (!Array.isArray(s.deps)) s.deps = []
  // an internal (earlier, personal) deadline beside the hard due date (ISS-9); also optional
  for (const d of state.deadlines ?? []) if (d.internal === undefined) d.internal = ''
}
normalizeState()
watch(state, (v) => {
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* ignore */ }
}, { deep: true })

export function resetDemo() {
  const fresh = seed()
  for (const k of Object.keys(state)) delete state[k]
  Object.assign(state, fresh)
  normalizeState()
}

/* ───────────── transient UI state ───────────── */
let savedTheme = 'dark'
try { savedTheme = localStorage.getItem('life-console/theme') || 'dark' } catch { /* ignore */ }
export const ui = reactive({
  now: new Date(),
  palette: false,
  paletteMode: 'cmd', // 'cmd' | 'add'
  drawerId: null,
  selectedId: null,
  visibleIds: [],
  weekStart: mondayOf(todayISO()),
  dragId: null, // todo being dragged
  splitId: null, // todo open in the Split dialog
  deadlineId: null, // deadline open in the edit dialog
  backlogOnly: false, // Plan week: hide the day columns, show deadlines & goals beside the backlog only (ISS-16)
  hoverId: null, // todo under the pointer — highlighted in backlog, bucket and timeline at once
  planMode: (() => { try { return localStorage.getItem('life-console/plan-mode') || 'both' } catch { return 'both' } })(), // 'days' | 'both' | 'times'
  backlogFocus: 0, // bump to focus the Plan-week backlog quick-add
  sidePanel: null, // planner side panel: null | 'balance' | 'routines'
  focusIds: [], // top-3 todos shown in focus mode (keys 1–3)
  dragBlock: null, // timeline block being moved: { kind, id, offset, dur }
  dropOver: null, // todo row under the cursor
  dropPos: null, // 'before' | 'after'
  toast: '',
  toastAction: null,
  theme: savedTheme,
})
setInterval(() => { ui.now = new Date() }, 1000)

export function applyTheme() {
  document.documentElement.dataset.theme = ui.theme
  try { localStorage.setItem('life-console/theme', ui.theme) } catch { /* ignore */ }
}
export function toggleTheme() {
  ui.theme = ui.theme === 'dark' ? 'light' : 'dark'
  applyTheme()
}
let toastTimer
export function toast(msg, action = null) {
  ui.toast = msg
  ui.toastAction = action // optional { label, run }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { ui.toast = ''; ui.toastAction = null }, action ? 6000 : 2200)
}

/* ───────────── todos ───────────── */
export const findTodo = (id) => state.todos.find((t) => t.id === id)
export function addTodo(partial) {
  const max = Math.max(100, ...state.todos.map((t) => Number(t.id.split('-')[1]) || 0))
  const now = new Date().toISOString()
  const t = {
    id: `T-${max + 1}`, title: 'Untitled', vital: '', timeMin: 30, done: false, lsd: 'S', priority: 3,
    due: null, scheduled: null, links: [], notes: '', createdAt: now, updatedAt: now,
    order: Math.max(0, ...state.todos.map((x) => x.order ?? 0)) + 1000, ...partial,
  }
  state.todos.push(t)
  return state.todos[state.todos.length - 1] // the reactive proxy, not the raw object
}
export function updateTodo(id, patch) {
  const t = findTodo(id)
  if (t) Object.assign(t, patch, { updatedAt: new Date().toISOString() })
}
export function toggleTodo(id) {
  const t = findTodo(id)
  if (t) updateTodo(id, { done: !t.done })
}
export function deleteTodo(id) {
  const i = state.todos.findIndex((t) => t.id === id)
  if (i >= 0) state.todos.splice(i, 1)
  if (ui.drawerId === id) ui.drawerId = null
  if (ui.selectedId === id) ui.selectedId = null
}
export const byPriority = (a, b) => Number(a.done) - Number(b.done) || a.priority - b.priority || a.order - b.order

/** Place todo `id` directly before/after `targetId` and give it the target's priority. */
export function reorderTodo(id, targetId, before, extra = {}) {
  const t = findTodo(id)
  const target = findTodo(targetId)
  if (!t || !target || t === target) return
  const peers = state.todos
    .filter((x) => x !== t && x.priority === target.priority && x.done === target.done)
    .sort((a, b) => a.order - b.order)
  const i = peers.indexOf(target)
  const nb = before ? peers[i - 1] : peers[i + 1]
  const a = target.order
  const b = nb ? nb.order : before ? a - 1000 : a + 1000
  updateTodo(id, { priority: target.priority, order: (a + b) / 2, ...extra })
  if (Math.abs(a - b) < 1e-6) {
    // floating point gap exhausted: re-space everything
    ;[...state.todos].sort((x, y) => x.order - y.order).forEach((x, k) => { x.order = (k + 1) * 1000 })
  }
}
/** Keyboard reorder: swap past the neighbour in the currently visible list. */
export function moveSelected(dir) {
  const ids = ui.visibleIds
  const i = ids.indexOf(ui.selectedId)
  const nb = ids[i + dir]
  if (i < 0 || !nb) return null
  reorderTodo(ui.selectedId, nb, dir < 0)
  return findTodo(ui.selectedId)
}
export const todosForDay = (date) => state.todos.filter((t) => t.scheduled?.date === date).sort(byPriority)
export const workload = (date) => todosForDay(date).reduce((s, t) => s + (t.timeMin || 0), 0) / 60

/** Quick-add syntax: `Read chapter 3 #ST2001 30m due:fri p2 @SIG-02.1` */
export function parseQuick(text, base = todayISO()) {
  const out = { title: '', links: [], timeMin: null, due: null, priority: null, lsd: null }
  const words = []
  for (const tok of text.trim().split(/\s+/)) {
    let m
    if (!tok) continue
    if ((m = tok.match(/^[#@](.+)$/))) out.links.push(m[1])
    else if ((m = tok.match(/^(\d+(?:\.\d+)?)(m|min|h)$/i))) out.timeMin = Math.round(m[2].toLowerCase() === 'h' ? m[1] * 60 : +m[1])
    else if ((m = tok.match(/^due:(.+)$/i))) out.due = parseDue(m[1], base)
    else if ((m = tok.match(/^p([1-5])$/i))) out.priority = +m[1]
    else if ((m = tok.match(/^\[([lsd])\]$/i))) out.lsd = m[1].toUpperCase()
    else words.push(tok)
  }
  out.title = words.join(' ')
  return out
}
function parseDue(s, base) {
  s = s.toLowerCase()
  if (['today', 'tod'].includes(s)) return base
  if (['tomorrow', 'tmr', 'tom'].includes(s)) return addDays(base, 1)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{1,2}[-/]\d{1,2}$/.test(s)) {
    const [m, d] = s.split(/[-/]/).map(Number)
    const y = parseISO(base).getFullYear()
    const c = `${y}-${pad(m)}-${pad(d)}`
    return diffDays(base, c) < 0 ? `${y + 1}-${pad(m)}-${pad(d)}` : c
  }
  const idx = WD_EN.findIndex((w) => s.startsWith(w.toLowerCase().slice(0, 3)))
  if (idx >= 0) {
    const cur = parseISO(base).getDay()
    return addDays(base, (idx - cur + 7) % 7)
  }
  return null
}

/* ───────────── schedule blocks ───────────── */
export function blocksForDay(date) {
  const tb = state.timeBlocks.filter((b) => b.date === date).map((b) => ({ ...b, kind: 'block' }))
  const tt = state.todos
    .filter((t) => t.scheduled?.date === date && t.scheduled.start)
    .map((t) => ({
      id: t.id, todoId: t.id, kind: 'todo', title: partLabel(t) ? `${t.title} (${partLabel(t)})` : t.title, done: t.done, link: t.links[0] ?? null,
      start: t.scheduled.start,
      end: fromMin(Math.min(24 * 60, toMin(t.scheduled.start) + (t.timeMin || 30))),
      category: categoryOf(t),
    }))
  return [...tb, ...tt]
}
export const SNAP = 15
export const snap = (m) => Math.round(m / SNAP) * SNAP
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Move a timeline item (fixed block or scheduled todo) to a new day/start, keeping its duration. */
export function moveBlock(kind, id, date, startMin) {
  if (kind === 'todo') {
    const t = findTodo(id)
    if (!t) return
    const dur = t.timeMin || 30
    updateTodo(id, { scheduled: { date, start: fromMin(clamp(snap(startMin), 0, 1440 - Math.min(dur, 1440))) } })
    return
  }
  const b = state.timeBlocks.find((x) => x.id === id)
  if (!b) return
  const dur = toMin(b.end) - toMin(b.start)
  const s = clamp(snap(startMin), 0, 1440 - dur)
  Object.assign(b, { date, start: fromMin(s), end: fromMin(s + dur) })
}
/** Change the end time (duration) of a timeline item. For todos this edits the estimate. */
export function resizeBlock(kind, id, endMin) {
  if (kind === 'todo') {
    const t = findTodo(id)
    if (!t?.scheduled?.start) return
    updateTodo(id, { timeMin: Math.max(SNAP, endMin - toMin(t.scheduled.start)) })
    return
  }
  const b = state.timeBlocks.find((x) => x.id === id)
  if (b) b.end = fromMin(clamp(endMin, toMin(b.start) + SNAP, 1440))
}

export function layoutLanes(blocks) {
  const sorted = [...blocks].sort((a, b) => toMin(a.start) - toMin(b.start))
  const laneEnds = []
  const out = sorted.map((b) => {
    let lane = laneEnds.findIndex((e) => e <= toMin(b.start))
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0) }
    laneEnds[lane] = toMin(b.end)
    return { ...b, lane }
  })
  return { blocks: out, lanes: Math.max(1, laneEnds.length) }
}

/* ───────────── sign-off stamps ───────────── */
export const getStamps = (date) => state.signOffs[date] ?? [null, null, null, null]
export function stampNext(date) {
  if (!state.signOffs[date]) state.signOffs[date] = [null, null, null, null]
  const s = state.signOffs[date]
  const i = s.findIndex((x) => !x)
  if (i >= 0) s[i] = new Date().toISOString()
  return i
}
/** Stamps must be applied in order; clicking the last applied one removes it. */
export function toggleStamp(date, i) {
  if (!state.signOffs[date]) state.signOffs[date] = [null, null, null, null]
  const s = state.signOffs[date]
  const next = s.findIndex((x) => !x)
  const last = next < 0 ? 3 : next - 1
  if (i === next) s[i] = new Date().toISOString()
  else if (i === last) s[i] = null
  else toast('Stamps go in order: 印 → 印 → 確認 → 完')
}

/* ───────────── strategy ───────────── */
/* Goal numbers (PSG-nn, SIG-nn.m) are unique across ALL plans, so a task link names exactly one goal. */
export const findPlan = (id) => state.plans.find((p) => p.id === id)
export const activePlans = () => state.plans.filter((p) => p.status === 'active')
export const allPsgs = () => state.plans.flatMap((p) => p.psgs)
export const allSigs = () => state.plans.flatMap((p) => p.sigs)
export const planOfGoal = (no) => state.plans.find((p) => p.psgs.some((x) => x.no === no) || p.sigs.some((x) => x.no === no))
export function nextPsgNo() {
  const n = Math.max(0, ...allPsgs().map((p) => Number(String(p.no).replace(/^PSG-/, '')) || 0))
  return `PSG-${String(n + 1).padStart(2, '0')}`
}
export function createPlan(title = 'New strategic plan') {
  const n = Math.max(0, ...state.plans.map((p) => Number(String(p.planNo).replace(/^SP-/, '')) || 0)) + 1
  const planNo = `SP-${String(n).padStart(2, '0')}`
  state.plans.push({
    id: planNo, planNo, title, status: 'active', health: 'On-track', intent: '', vision: '',
    psgs: [], sigs: [], checkEveryDays: 7, checkLog: [], events: [],
  })
  return state.plans[state.plans.length - 1]
}
export function deletePlan(id) {
  const i = state.plans.findIndex((p) => p.id === id)
  if (i >= 0) state.plans.splice(i, 1)
}
export const sigsOf = (psgNo) => allSigs().filter((s) => s.psg === psgNo).sort((a, b) => a.priority - b.priority)
export function psgPct(psgNo) {
  const s = sigsOf(psgNo)
  return s.length ? Math.round(s.reduce((a, x) => a + Number(x.pct || 0), 0) / s.length) : 0
}
export const nextSig = (psgNo) => sigsOf(psgNo).find((s) => s.status !== 'done')
/** True if making SIG `fromNo` depend on `toNo` would create a dependency cycle. */
export function sigWouldCycle(fromNo, toNo) {
  if (fromNo === toNo) return true
  const seen = new Set()
  const stack = [toNo]
  while (stack.length) {
    const n = stack.pop()
    if (n === fromNo) return true // `fromNo` depends (directly or not) on `toNo`
    if (seen.has(n)) continue
    seen.add(n)
    allSigs().filter((s) => s.no === n).forEach((s) => stack.push(...(s.deps ?? [])))
  }
  return false
}
export function nextCheckDate(plan) {
  if (!plan) return nextPlanCheck()?.date ?? todayISO()
  const log = plan.checkLog ?? []
  const last = log.length ? log[log.length - 1].date : todayISO()
  return addDays(last, Number(plan.checkEveryDays) || 7)
}
/** The soonest check among active plans: { plan, date } or null. */
export function nextPlanCheck() {
  return activePlans().map((plan) => ({ plan, date: nextCheckDate(plan) })).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
}
export function planPct(plan) {
  return plan.psgs.length ? Math.round(plan.psgs.reduce((s, x) => s + psgPct(x.no), 0) / plan.psgs.length) : 0
}
export const planIds = (plan) => [plan.planNo, plan.id, ...plan.psgs.map((p) => p.no), ...plan.sigs.map((s) => s.no)]

/* ───────────── routines ───────────── */
export const monthGroup = (date) => ['A', 'B', 'C'][parseISO(date).getMonth() % 3]
export function routineDone(weekStart) {
  return state.routineLog[weekStart] ?? []
}
export function toggleRoutine(weekStart, idx) {
  if (!state.routineLog[weekStart]) state.routineLog[weekStart] = []
  const arr = state.routineLog[weekStart]
  const i = arr.indexOf(idx)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(idx)
}
export function toggleMonthly(monthKey, task) {
  if (!state.monthlyLog[monthKey]) state.monthlyLog[monthKey] = []
  const arr = state.monthlyLog[monthKey]
  const i = arr.indexOf(task)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(task)
}

/* ───────────── workload balance ───────────── */
export const CATEGORIES = [
  { key: 'research', label: 'Research' },
  { key: 'academic', label: 'Academic' },
  { key: 'experiment', label: 'Experiment' },
  { key: 'kaizen', label: 'Kaizen' },
]
/** Hours for one day split by category. withBlocks adds fixed calendar blocks to todo estimates. */
export function dayLoad(date, withBlocks = false) {
  const by = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]))
  for (const t of todosForDay(date)) by[categoryOf(t)] += (t.timeMin || 0) / 60
  if (withBlocks) {
    for (const b of state.timeBlocks.filter((x) => x.date === date)) by[b.category] = (by[b.category] ?? 0) + (toMin(b.end) - toMin(b.start)) / 60
  }
  return { date, by, total: Object.values(by).reduce((a, b) => a + b, 0) }
}
/**
 * Greedy rebalance: repeatedly move one movable todo (open, no fixed start time,
 * not due before the target day) from the heaviest remaining day to the lightest,
 * choosing the todo that best evens the pair. Only today and future days are touched.
 */
export function suggestRebalance(days, withBlocks = false, cap = CAPACITY_H) {
  const cand = days.filter((d) => d >= todayISO())
  const loads = Object.fromEntries(cand.map((d) => [d, dayLoad(d, withBlocks).total]))
  const moved = new Set()
  const out = []
  for (let i = 0; i < 8 && cand.length > 1; i++) {
    const sorted = [...cand].sort((a, b) => loads[b] - loads[a])
    const H = sorted[0]
    const L = sorted[sorted.length - 1]
    const diff = loads[H] - loads[L]
    if (diff <= 1 && loads[H] <= cap) break
    let best = null
    let bestScore = diff
    for (const t of todosForDay(H)) {
      if (t.done || t.scheduled.start || moved.has(t.id) || (t.due && t.due < L)) continue
      if (t.split && splitSiblings(t).some((x) => x.id !== t.id && x.scheduled?.date === L)) continue // keep parts on separate days
      const h = t.timeMin / 60
      const score = Math.abs(loads[H] - h - (loads[L] + h))
      if (score < bestScore - 0.01) { best = t; bestScore = score }
    }
    if (!best) break
    const h = best.timeMin / 60
    loads[H] -= h
    loads[L] += h
    moved.add(best.id)
    out.push({ todo: best, from: H, to: L, hours: h })
  }
  return out
}

/* ───────────── splitting a task across days ───────────── */
/** Parts of the same original task, in chronological order (unscheduled last). */
export function splitSiblings(t) {
  if (!t?.split) return []
  return state.todos
    .filter((x) => x.split?.group === t.split.group)
    .sort((a, b) => (a.scheduled?.date ?? '9999').localeCompare(b.scheduled?.date ?? '9999') || (a.scheduled?.start ?? '').localeCompare(b.scheduled?.start ?? '') || a.order - b.order)
}
/** "2/3" for a split part, '' otherwise. */
export function partLabel(t) {
  const sib = splitSiblings(t)
  return sib.length > 1 ? `${sib.findIndex((x) => x.id === t.id) + 1}/${sib.length}` : ''
}
/** Equal-ish chunks (multiples of 5 min) that add up to `total`. */
export function evenParts(total, n) {
  const base = Math.floor(total / n / 5) * 5
  const out = Array(n).fill(base)
  let rest = total - base * n
  for (let i = 0; rest > 0; i = (i + 1) % n) { const add = Math.min(5, rest); out[i] += add; rest -= add }
  return out
}
/**
 * Choose a day for each part: the day with the most free capacity, preferring days not yet used
 * by this split, then earlier days. `days` are candidate dates; the task's own current load is excluded.
 * Returned dates are sorted so part 1 is the earliest.
 */
export function autoSpread(todo, minutes, days, cap = CAPACITY_H) {
  const free = Object.fromEntries(days.map((d) => [d, cap - dayLoad(d).total + (todo.scheduled?.date === d ? todo.timeMin / 60 : 0)]))
  const used = new Set()
  const picks = minutes.map((m) => {
    const ranked = [...days].sort((a, b) => Number(used.has(a)) - Number(used.has(b)) || free[b] - free[a] || a.localeCompare(b))
    const d = ranked[0]
    used.add(d)
    free[d] -= m / 60
    return d
  })
  return picks.sort()
}
/**
 * Split todo `id` into parts [{ min, date|null }]. The original becomes part 1 (keeps its id);
 * the rest are new todos that copy its title, links, priority and due date.
 */
export function splitTodo(id, parts) {
  const t = findTodo(id)
  if (!t || parts.length < 2) return []
  const group = t.split?.group ?? t.id
  const [first, ...rest] = parts
  updateTodo(id, {
    timeMin: first.min,
    scheduled: first.date ? { date: first.date, start: t.scheduled?.date === first.date ? t.scheduled.start : null } : null,
    split: { group },
  })
  return [t, ...rest.map((p, k) => addTodo({
    title: t.title, vital: t.vital, lsd: t.lsd, priority: t.priority, due: t.due, links: [...t.links],
    timeMin: p.min, scheduled: p.date ? { date: p.date, start: null } : null,
    split: { group }, order: t.order + (k + 1) * 0.001,
  }))]
}
/** Merge the open parts of a split back into one task (done parts stay as history). */
export function mergeParts(id) {
  const t = findTodo(id)
  const open = splitSiblings(t).filter((x) => !x.done)
  if (open.length < 2) return null
  const [keep, ...drop] = open
  updateTodo(keep.id, { timeMin: open.reduce((s, x) => s + x.timeMin, 0) })
  drop.forEach((x) => deleteTodo(x.id))
  if (splitSiblings(keep).length < 2) delete keep.split
  return keep
}

/* ───────────── planning flow: backlog → day → time ───────────── */
export const WORK_FROM = '08:00'
export const WORK_TO = '21:00'

/** Free hours left on a day (todo estimates vs capacity). */
export const freeHours = (date, cap = CAPACITY_H) => cap - dayLoad(date).total

/**
 * Step ②: put a task on a day (keeps its time only if it stays on the same day).
 * If that overfills the day, offers to split it instead.
 */
export function assignToDay(id, date, cap = CAPACITY_H) {
  const t = findTodo(id)
  if (!t) return
  updateTodo(id, { scheduled: { date, start: t.scheduled?.date === date ? t.scheduled.start : null } })
  const load = dayLoad(date).total
  if (load > cap && t.timeMin >= 30) {
    toast(`${wd(date)} is now ${load.toFixed(1)}h / ${cap}h`, { label: 'Split it…', run: () => { ui.splitId = id } })
  } else {
    toast(`${id} → ${wd(date)} ${fmtSlash(date)}`)
  }
}

/**
 * Step ③ shortcut: give every untimed open task on `date` a start time, in priority order,
 * using the earliest free gap between WORK_FROM and WORK_TO (and not in the past for today).
 * Returns { placed: [ids], unplaced: [ids] }.
 */
export function autoTimebox(date, from = WORK_FROM, to = WORK_TO) {
  const busy = blocksForDay(date).map((b) => [toMin(b.start), toMin(b.end)])
  let earliest = toMin(from)
  if (date === todayISO()) {
    const n = new Date()
    earliest = Math.max(earliest, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15)
  }
  const end = toMin(to)
  const placed = []
  const unplaced = []
  for (const t of todosForDay(date).filter((x) => !x.done && !x.scheduled.start)) {
    const dur = t.timeMin || 30
    let s = earliest
    let found = null
    while (s + dur <= end) {
      const clash = busy.find(([a, b]) => s < b && s + dur > a)
      if (!clash) { found = s; break }
      s = Math.ceil(clash[1] / 15) * 15
    }
    if (found === null) { unplaced.push(t.id); continue }
    updateTodo(t.id, { scheduled: { date, start: fromMin(found) } })
    busy.push([found, found + dur])
    placed.push(t.id)
  }
  return { placed, unplaced }
}

/* ───────────── deadlines ───────────── */
/** `YYYY-MM-DDTHH:MM` for "now", comparable with deadline.due strings. */
export const nowKey = () => `${todayISO()}T${fromMin(new Date().getHours() * 60 + new Date().getMinutes())}`
export const isOverdue = (d) => !d.done && d.due < nowKey()

/**
 * Deadline quick syntax: `Title due:fri 17:00 #ST2001 p1 ! vital points`
 * - due:… (today / tomorrow / weekday / MM-DD / YYYY-MM-DD) — defaults to `baseDate`
 * - HH:MM sets the time (default 23:59) · p1–p5 priority · #tag / @ID source · text after `!` = vital points
 */
export function parseDeadline(text, baseDate = todayISO()) {
  const [main, ...vitalParts] = text.split(/\s!\s?|^!\s?/)
  let time = null
  const rest = main.split(/\s+/).filter((tok) => {
    const m = tok.match(/^(\d{1,2}):(\d{2})$/)
    if (m && +m[1] < 24 && +m[2] < 60) { time = `${pad(+m[1])}:${m[2]}`; return false }
    return true
  }).join(' ')
  const q = parseQuick(rest, baseDate)
  return {
    title: q.title, vital: vitalParts.join(' ').trim(), date: q.due ?? baseDate, time: time ?? '23:59',
    source: q.links[0] ?? '', priority: q.priority ?? 2,
  }
}
export function addDeadline(d) {
  const max = Math.max(0, ...state.deadlines.map((x) => Number(x.id.split('-')[1]) || 0))
  const dl = { id: `DL-${max + 1}`, title: 'Untitled', vital: '', due: `${todayISO()}T23:59`, source: '', clickUp: false, done: false, priority: 2, ...d }
  state.deadlines.push(dl)
  return state.deadlines[state.deadlines.length - 1]
}
export function deleteDeadline(id) {
  const i = state.deadlines.findIndex((d) => d.id === id)
  if (i >= 0) state.deadlines.splice(i, 1)
  if (ui.deadlineId === id) ui.deadlineId = null
}
