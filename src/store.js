// Central reactive store for the prototype. Persisted to localStorage.
import { reactive, watch, computed } from 'vue'
import { rhythm, wallMin, workIn, segments, POMODORO_DEFAULTS } from '../server/pomodoro.mjs'

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

let stateReady = false // see goalMap()

/* ───────────── domain constants ───────────── */
export const STAMPS = ['印', '印', '確認', '完']
export const STAMP_NAMES = ['Draft', 'Self-check', 'Confirmed', 'Complete']
export const CAPACITY_H = 7

/* number → 'psg' | 'sig', built lazily: linkType also runs inside migrations while `state` is still loading */
let goalIndex = null
function goalMap() {
  if (!stateReady) return new Map()
  goalIndex ??= computed(() => {
    const m = new Map()
    for (const p of state.plans) {
      for (const g of p.psgs) m.set(String(g.no), 'psg')
      for (const g of p.sigs) m.set(String(g.no), 'sig')
    }
    return m
  })
  return goalIndex.value
}
export const isGoalNo = (no) => goalMap().has(String(no))
export const isPsgNo = (no) => goalMap().get(String(no)) === 'psg'

export function linkType(id) {
  if (isGoalNo(id) || /^(PSG|SIG)-/.test(id)) return 'goal' // goal numbers are free-form: look them up first
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
      todo('T-113', 'GPU cluster script fix for batch jobs', { timeMin: 40, lsd: 'S', priority: 2, links: ['SIG-01.2', 'DL-2'] }),
      todo('T-114', 'Table 2 metric delta confirmation', { timeMin: 30, lsd: 'S', priority: 2, links: ['SIG-01.2'] }),
      todo('T-115', 'Submit ST2001 lab assignment', { timeMin: 20, lsd: 'S', priority: 2, due: D(4), scheduled: { date: D(4), start: null }, links: ['SIG-02.1'] }),
      todo('T-116', 'Weekly financial takt pass', { timeMin: 20, lsd: 'D', priority: 4, scheduled: { date: D(5), start: null } }),
    ],
    timeBlocks,
    deadlines: [
      { id: 'DL-1', title: 'ST2001 Report 2 (Processes & Memory)', vital: 'Upload PDF to LMS', due: `${addDays(T, 1)}T23:59`, internal: T, source: 'ST2001spA', done: false, priority: 1 },
      { id: 'DL-2', title: 'SIG-01.2 milestone: code freeze', vital: 'Tag release in repo', due: `${addDays(T, 3)}T18:00`, source: 'SIG-01.2', done: false, priority: 2 },
      { id: 'DL-3', title: 'Weekly review aggregation', vital: 'KPI + Kaizen table', due: `${D(6)}T18:00`, source: 'KZ-04', done: false, priority: 3 },
      { id: 'DL-4', title: 'PS-04 problem set', vital: '', due: `${D(0)}T18:00`, source: 'ST1010', done: diffDays(D(0), T) > 0, priority: 2 },
      { id: 'DL-5', title: 'Hardware order form', vital: 'Needs supervisor sign', due: `${addDays(T, -1)}T17:00`, source: 'SP-03', done: false, priority: 2 },
      { id: 'DL-6', title: 'Conference abstract', vital: '250 words', due: `${addDays(T, 12)}T23:59`, source: 'PSG-01', done: false, priority: 1 },
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
stateReady = true
/** Every todo carries a numeric `order` used to rank todos that share a priority. */
export function ensureOrder() {
  state.todos?.forEach((t, i) => { if (typeof t.order !== 'number') t.order = (i + 1) * 1000 })
}
/** Notification preferences live in the synced document so the server scheduler can read them. */
export const NOTIFY_DEFAULTS = {
  notify: { blocks: true, deadlines: true, daily: true, wellbeing: true, vibrate: true, pomodoro: true },
  pomodoro: { ...POMODORO_DEFAULTS }, // work/short/long minutes, long break after `every` pomodoros
  blockLeadMin: 5, briefingTime: '07:30', eveningTime: '21:00', bedTime: '23:00', windDownMin: 60, caffeineWarnMin: 30,
}
export function ensureSettings() {
  if (!state.settings) state.settings = {}
  const s = state.settings
  for (const [k, v] of Object.entries(NOTIFY_DEFAULTS)) if (s[k] === undefined) s[k] = typeof v === 'object' ? { ...v } : v
  for (const [k, v] of Object.entries(NOTIFY_DEFAULTS.notify)) if (s.notify[k] === undefined) s.notify[k] = v
  for (const [k, v] of Object.entries(POMODORO_DEFAULTS)) if (s.pomodoro[k] === undefined) s.pomodoro[k] = v
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

/**
 * Backfill: a task linked to a deadline (a `DL-…` link) inherits that date as its due when its own
 * due date is unset. The personal internal target wins; else the hard due date's day part. Running
 * in normalizeState (load / sync / import) and on store changes keeps it true at real time.
 */
function backfillLinkedDues() {
  const byId = new Map((state.deadlines ?? []).map((d) => [d.id, d]))
  for (const t of state.todos ?? []) {
    if (t.due) continue
    const d = (t.links ?? []).filter((l) => linkType(l) === 'deadline').map((l) => byId.get(l)).find(Boolean)
    const due = d && (d.internal || (d.due ?? '').slice(0, 10))
    if (due) t.due = due
  }
}

/** Bring any loaded / synced / imported document up to the current shape. */
export function normalizeState() {
  migrateDoc(state)
  ensureOrder()
  ensureSettings()
  // SIGs may depend on other SIGs (ISS-5); the field is optional, so default it instead of a migration
  for (const p of state.plans ?? []) for (const s of p.sigs ?? []) if (!Array.isArray(s.deps)) s.deps = []
  // an internal (earlier, personal) deadline beside the hard due date (ISS-9); also optional
  for (const d of state.deadlines ?? []) {
    if (d.internal === undefined) d.internal = ''
    delete d.clickUp // the mock ClickUp sync was removed; the field was never used for anything else
  }
  backfillLinkedDues()
  syncContainers()
}
/**
 * Subtask invariants after load / sync (another device, or the notification "Mark done", may have
 * ticked a subtask): a container is done exactly when all its subtasks are, and is never scheduled.
 */
function syncContainers() {
  const kids = new Map()
  for (const t of state.todos ?? []) if (t.parent) (kids.get(t.parent) ?? kids.set(t.parent, []).get(t.parent)).push(t)
  if (!kids.size) return
  // deepest first, so a container's state is settled before its own parent looks at it
  const depth = (t, seen = new Set()) => { let d = 0, p = t; while (p?.parent && !seen.has(p.id)) { seen.add(p.id); p = state.todos.find((x) => x.id === p.parent); d++ } return d }
  const containers = (state.todos ?? []).filter((t) => kids.has(t.id)).sort((a, b) => depth(b) - depth(a))
  for (const c of containers) {
    const done = kids.get(c.id).every((k) => k.done)
    if (c.done !== done) c.done = done
    if (c.scheduled) c.scheduled = null
  }
}
normalizeState()
watch(state, (v) => {
  backfillLinkedDues()
  syncContainers()
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
  blockId: null, // fixed timeBlock open in the block dialog (ISS-8: detail + delete for timeline blocks)
  scheduleLock: (() => { // ISS-14: locks moving/resizing/deleting schedule blocks, default on for touch
    try {
      const s = localStorage.getItem('life-console/schedule-lock')
      if (s !== null) return s === '1'
    } catch { /* ignore */ }
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  })(),
  backlogOnly: false, // Plan week: hide the day columns, show deadlines & goals beside the backlog only (ISS-16)
  hoverId: null, // todo under the pointer — highlighted in backlog, bucket and timeline at once
  planMode: (() => { try { return localStorage.getItem('life-console/plan-mode') || 'both' } catch { return 'both' } })(), // 'days' | 'both' | 'times'
  backlogFocus: 0, // bump to focus the Plan-week backlog quick-add
  sidePanel: null, // planner side panel: null | 'balance' | 'routines'
  focusIds: [], // top-3 todos shown in focus mode (keys 1–3)
  dragBlock: null, // timeline block being moved: { kind, id, offset, dur, group? }
  selBlocks: [], // multi-selected schedule items ('todo:T-1' / 'block:B-3'): moved, shifted or removed together
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
  // undo toasts stay longer: on a phone you need time to notice them and reach the button
  toastTimer = setTimeout(() => { ui.toast = ''; ui.toastAction = null }, action ? 9000 : 2200)
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
  if (!t) return
  const done = !t.done
  // a task with subtasks is done when they all are: ticking it ticks (or reopens) its whole tree
  if (isContainer(t)) for (const d of descendantsOf(id)) if (d.done !== done) updateTodo(d.id, { done })
  updateTodo(id, { done })
  syncAncestors(t)
}

/* ───────────── subtasks ─────────────
   A todo may have `parent` (another todo's id). A todo with subtasks is a *container*: its `timeMin` is
   a budget the subtasks use up, it is never scheduled itself (its subtasks are), and it counts as done
   exactly when all its subtasks are done. Any depth. A missing parent (deleted elsewhere) = top level. */
export const childrenOf = (id) => state.todos.filter((t) => t.parent === id).sort((a, b) => Number(a.done) - Number(b.done) || a.order - b.order)
export const isContainer = (t) => !!t && state.todos.some((x) => x.parent === t.id)
/** Everything below `id`, depth-first (cycle-safe). */
export function descendantsOf(id, seen = new Set([id])) {
  const out = []
  for (const c of state.todos.filter((t) => t.parent === id)) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c, ...descendantsOf(c.id, seen))
  }
  return out
}
/** Parent chain, nearest first (cycle-safe). */
export function ancestorsOf(t) {
  const out = []
  const seen = new Set([t?.id])
  let p = t?.parent ? findTodo(t.parent) : null
  while (p && !seen.has(p.id)) { out.push(p); seen.add(p.id); p = p.parent ? findTodo(p.parent) : null }
  return out
}
/** Container done = all of its subtasks done; walk up from `t`. */
export function syncAncestors(t) {
  for (const a of ancestorsOf(t)) {
    const kids = state.todos.filter((x) => x.parent === a.id)
    if (!kids.length) continue // its last subtask was removed: it's a plain task again, leave it as is
    const done = kids.every((k) => k.done)
    if (a.done !== done) updateTodo(a.id, { done })
  }
}
/** Budget left to hand out to subtasks (negative = over budget). */
export const budgetLeft = (t) => (Number(t.timeMin) || 0) - childrenOf(t.id).reduce((s, c) => s + (Number(c.timeMin) || 0), 0)
/** { done, total } over direct subtasks. */
export function subCount(t) {
  const kids = state.todos.filter((x) => x.parent === t.id)
  return { done: kids.filter((k) => k.done).length, total: kids.length }
}
/** Schedulable / countable work: anything that isn't a container. */
export const isLeaf = (t) => !isContainer(t)
/** "Draft related-works › Collect papers" — the chain above a subtask, for breadcrumbs. */
export const parentPath = (t) => ancestorsOf(t).reverse().map((a) => a.title).join(' › ')
/**
 * Add a subtask under `parentId`. It inherits links, priority, scope and due; its estimate defaults to
 * what's left of the budget (max 30m). The parent becomes a container, so it leaves the schedule.
 */
export function addSubtask(parentId, partial = {}) {
  const p = findTodo(parentId)
  if (!p) return null
  const left = budgetLeft(p)
  const wasScheduled = p.scheduled
  if (p.scheduled) updateTodo(p.id, { scheduled: null })
  const t = addTodo({
    links: [...p.links], priority: p.priority, lsd: p.lsd, due: p.due, timeMin: left > 0 ? Math.min(30, left) : 30,
    order: Math.max(0, p.order, ...childrenOf(p.id).map((c) => c.order)) + 1, ...partial, parent: p.id,
  })
  if (p.done) updateTodo(p.id, { done: false })
  syncAncestors(t)
  return { todo: t, unscheduled: wasScheduled }
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
/** Does `t` still count toward its day's load? A task finished ahead of a future day frees that day. */
export const loadsDay = (t, date) => !(t.done && date > todayISO())
export const workload = (date) => todosForDay(date).filter((t) => loadsDay(t, date)).reduce((s, t) => s + (t.timeMin || 0), 0) / 60

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

/* ───────────── pomodoro ─────────────
 * A timed todo with `pomo: true` is laid out as pomodoros: its timeMin is work, its block on the
 * schedule also spans the breaks (server/pomodoro.mjs). New sittings get the flag while the rhythm
 * is on (Settings → Pomodoro); turning it off leaves existing sittings as they are.
 */
export const pomo = () => rhythm(state.settings)
/** Minutes a timed todo occupies on the clock (work + breaks for a pomodoro sitting). */
export const blockMin = (t) => (t.pomo ? wallMin(t.timeMin || 30, pomo()) : t.timeMin || 30)
/** Clock minutes for `workMin` of new work, under the current rhythm. */
export const newBlockMin = (workMin) => (pomo().on ? wallMin(workMin, pomo()) : workMin)

/* ───────────── schedule blocks ───────────── */
/** Blocks that occupy time when planning: a todo done ahead of a future day no longer does. */
const busyBlocks = (date) => blocksForDay(date).filter((b) => !(b.done && date > todayISO()))
export function blocksForDay(date) {
  const tb = state.timeBlocks.filter((b) => b.date === date).map((b) => ({ ...b, kind: 'block' }))
  const tt = state.todos
    .filter((t) => t.scheduled?.date === date && t.scheduled.start)
    .map((t) => ({
      id: t.id, todoId: t.id, kind: 'todo', title: partLabel(t) ? `${t.title} (${partLabel(t)})` : t.title, done: t.done, link: t.links[0] ?? null,
      start: t.scheduled.start,
      end: fromMin(Math.min(24 * 60, toMin(t.scheduled.start) + blockMin(t))),
      category: categoryOf(t),
      pomo: t.pomo ? segments(t.timeMin || 30, pomo()) : null,
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
    // a task getting its first time follows the pomodoro rhythm when it's on
    const pomoNow = t.scheduled?.start ? !!t.pomo : pomo().on
    const dur = pomoNow ? wallMin(t.timeMin || 30, pomo()) : t.timeMin || 30
    updateTodo(id, { scheduled: { date, start: fromMin(clamp(snap(startMin), 0, 1440 - Math.min(dur, 1440))) }, pomo: pomoNow || undefined })
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
    const wall = Math.max(SNAP, endMin - toMin(t.scheduled.start))
    updateTodo(id, { timeMin: t.pomo ? Math.max(5, workIn(wall, pomo())) : wall })
    return
  }
  const b = state.timeBlocks.find((x) => x.id === id)
  if (b) b.end = fromMin(clamp(endMin, toMin(b.start) + SNAP, 1440))
}
/** Remove a fixed time block (ISS-8). Returns a copy so the caller can offer an undo. */
export function deleteBlock(id) {
  const i = state.timeBlocks.findIndex((b) => b.id === id)
  if (i < 0) return null
  const [copy] = state.timeBlocks.splice(i, 1)
  return copy
}
/**
 * Take a todo off the schedule, with undo. how = 'time': clear the start time only (it leaves the
 * timeline but stays in that day's workload); 'day': back to the backlog (scheduled = null).
 */
export function unscheduleTodo(id, how = 'time') {
  const t = findTodo(id)
  if (!t?.scheduled) return
  const prev = { ...t.scheduled }
  if (how === 'time' && !prev.start) return
  updateTodo(id, { scheduled: how === 'time' ? { date: prev.date, start: null } : null })
  toast(how === 'time' ? `${id} off the timeline · still on ${wd(prev.date)}'s list` : `${id} back to the backlog`, {
    label: 'Undo', run: () => updateTodo(id, { scheduled: prev }),
  })
}
/** Delete a todo with an undo toast (never a hard delete without a way back). */
export function deleteTodoUndo(id) {
  const t = findTodo(id)
  if (!t) return
  // a task goes with its subtasks; the undo brings the whole tree back
  const all = [t, ...descendantsOf(id)]
  const copies = all.map((x) => JSON.parse(JSON.stringify(x)))
  const parent = t.parent ? findTodo(t.parent) : null
  for (const x of all) deleteTodo(x.id)
  if (parent) syncAncestors(childrenOf(parent.id)[0] ?? { parent: parent.id })
  const n = all.length - 1
  toast(`Deleted ${id}${n ? ` and ${n} subtask${n > 1 ? 's' : ''}` : ''}`, { label: 'Undo', run: () => { for (const c of copies) if (!findTodo(c.id)) state.todos.push(c) } })
}
/**
 * The ✕ on a timeline item, with undo. A scheduled todo only leaves the timeline (its time is cleared;
 * the task itself stays) — deleting the task lives in its drawer. A fixed block is deleted.
 */
export function removeTimelineBlock(b) {
  if (b.todoId) unscheduleTodo(b.todoId, 'time')
  else {
    const copy = deleteBlock(b.id)
    if (copy) toast(`Removed ${copy.title || 'block'} ${copy.start}–${copy.end}`, { label: 'Undo', run: () => state.timeBlocks.push(copy) })
  }
}

/* ───────────── multi-select on the schedule ─────────────
 * Shift/⌘/Ctrl-click (long-press on phones) collects blocks in ui.selBlocks; dragging one of them,
 * the arrow keys or the selection bar then move them all by the same amount, with one undo.
 */
export const blockKey = (b) => (b.todoId ? `todo:${b.todoId}` : `block:${b.id}`)
export const isBlockSel = (b) => ui.selBlocks.includes(blockKey(b))
export function toggleBlockSel(b) {
  const k = blockKey(b)
  const i = ui.selBlocks.indexOf(k)
  if (i >= 0) ui.selBlocks.splice(i, 1)
  else ui.selBlocks.push(k)
}
export const clearBlockSel = () => { ui.selBlocks.splice(0) }
/** Live items behind the selection keys: [{ key, kind, id, date, start, dur }] (gone ones dropped). */
function selItems() {
  const out = []
  for (const key of ui.selBlocks) {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
    if (kind === 'todo') {
      const t = findTodo(id)
      if (t?.scheduled?.start) out.push({ key, kind, id, date: t.scheduled.date, start: toMin(t.scheduled.start), dur: blockMin(t) })
    } else {
      const b = state.timeBlocks.find((x) => x.id === id)
      if (b) out.push({ key, kind, id, date: b.date, start: toMin(b.start), dur: toMin(b.end) - toMin(b.start) })
    }
  }
  return out
}
function snapshotSel(items) {
  return items.map((x) => (x.kind === 'todo'
    ? { kind: 'todo', id: x.id, scheduled: { ...findTodo(x.id).scheduled } }
    : { kind: 'block', copy: { ...state.timeBlocks.find((b) => b.id === x.id) } }))
}
function restoreSel(snap) {
  for (const s of snap) {
    if (s.kind === 'todo') updateTodo(s.id, { scheduled: s.scheduled })
    else {
      const b = state.timeBlocks.find((x) => x.id === s.copy.id)
      if (b) Object.assign(b, s.copy)
      else state.timeBlocks.push(s.copy)
    }
  }
}
/** Move every selected item by `dMin` minutes and `dDays` days (one undo). Refuses if any would leave its day. */
export function shiftSelected(dMin, dDays = 0) {
  const items = selItems()
  if (!items.length) { clearBlockSel(); return false }
  if (items.some((x) => x.start + dMin < 0 || x.start + dMin + x.dur > 1440)) {
    toast(`Can't move ${items.length > 1 ? 'them' : 'it'}: something would run past midnight`)
    return false
  }
  const snap = snapshotSel(items)
  for (const x of items) {
    const date = addDays(x.date, dDays)
    const s = x.start + dMin
    if (x.kind === 'todo') updateTodo(x.id, { scheduled: { date, start: fromMin(s) } })
    else Object.assign(state.timeBlocks.find((b) => b.id === x.id), { date, start: fromMin(s), end: fromMin(s + x.dur) })
  }
  const parts = []
  if (dDays) parts.push(`${dDays > 0 ? '+' : '−'}${Math.abs(dDays)} day${Math.abs(dDays) === 1 ? '' : 's'}`)
  if (dMin) parts.push(`${dMin > 0 ? 'later' : 'earlier'} ${Math.abs(dMin) >= 60 && Math.abs(dMin) % 60 === 0 ? Math.abs(dMin) / 60 + 'h' : Math.abs(dMin) + 'm'}`)
  toast(`Moved ${items.length} · ${parts.join(' · ') || 'no change'}`, { label: 'Undo', run: () => restoreSel(snap) })
  return true
}
/** Take every selected item off the schedule: tasks stay on their day untimed, fixed blocks are removed (one undo). */
export function removeSelected() {
  const items = selItems()
  if (!items.length) return
  const snap = snapshotSel(items)
  for (const x of items) {
    if (x.kind === 'todo') updateTodo(x.id, { scheduled: { date: x.date, start: null } })
    else deleteBlock(x.id)
  }
  clearBlockSel()
  toast(`Took ${items.length} off the schedule`, { label: 'Undo', run: () => restoreSel(snap) })
}

/** What the schedule lock does — shared by the padlock buttons' tooltips and toasts. */
export const LOCK_HELP = {
  on: 'Schedule locked: blocks can\'t be dragged, resized or ✕-removed. Tap a block to edit or remove it. Click to unlock.',
  off: 'Schedule unlocked: drag to move, drag the edge to resize, ✕ removes. Click to lock against accidental drags.',
}
export function setScheduleLock(v, announce = true) {
  ui.scheduleLock = v
  try { localStorage.setItem('life-console/schedule-lock', v ? '1' : '0') } catch { /* ignore */ }
  if (announce) toast(v ? 'Schedule locked · drag & ✕ off — tap a block to edit or remove it' : 'Schedule unlocked · drag to move, ✕ removes')
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
  let n = Math.max(0, ...allPsgs().map((p) => Number(String(p.no).replace(/^PSG-/, '')) || 0)) + 1
  while (goalTaken(`PSG-${String(n).padStart(2, '0')}`)) n++
  return `PSG-${String(n).padStart(2, '0')}`
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
/**Human readable name behind a link id: goal names, deadline titles, plan titles (ISS-19).*/
export function linkLabel(id) {
  const type = linkType(id)
  if (type === 'goal') {
    for (const p of state.plans) {
      const g = p.psgs.find((x) => x.no === id)
      if (g) return g.name || ''
      const s = p.sigs.find((x) => x.no === id)
      if (s) return s.name || ''
    }
  }
  if (type === 'deadline') return state.deadlines.find((d) => d.id === id)?.title ?? ''
  if (type === 'plan') return state.plans.find((p) => p.planNo === id || p.id === id)?.title ?? ''
  return ''
}
/** ISS-20: drop a goal number from every todo link and deadline source. Returns how many edits were made. */
export function unlinkGoal(no) {
  let n = 0
  for (const t of state.todos) {
    const i = t.links.indexOf(no)
    if (i >= 0) { t.links.splice(i, 1); n++ }
  }
  for (const d of state.deadlines) {
    if (d.source === no) { d.source = ''; n++ }
  }
  return n
}
/** Renumber a goal everywhere it is referenced (todo links, deadline sources, block links, SIG deps). Returns the edit count. */
export function renameGoal(from, to) {
  let n = 0
  for (const t of state.todos) {
    const i = t.links.indexOf(from)
    if (i < 0) continue
    if (t.links.includes(to)) t.links.splice(i, 1)
    else t.links.splice(i, 1, to)
    n++
  }
  for (const d of state.deadlines) if (d.source === from) { d.source = to; n++ }
  for (const b of state.timeBlocks) if (b.link === from) { b.link = to; n++ }
  for (const s of allSigs()) {
    const i = (s.deps ?? []).indexOf(from)
    if (i >= 0) { s.deps.splice(i, 1, to); n++ }
  }
  return n
}
/** Move a SIG under another PSG of the same plan; it gets the next free number there (SIG-02.n) and all references follow. */
export function moveSig(sig, psgNo) {
  if (!sig || sig.psg === psgNo) return null
  const from = sig.no
  // an automatic number (SIG-<old psg>.n) is renumbered under the new PSG; a number the owner chose is kept
  const auto = from.startsWith(`SIG-${String(sig.psg).replace(/^PSG-/i, '')}.`)
  const to = auto ? nextSigNo(psgNo) ?? from : from
  const edits = to === from ? 0 : renameGoal(from, to)
  sig.psg = psgNo
  sig.no = to
  return { from, to, edits }
}
/* Editable goal numbers (PSG/SIG "No."): free-form but concise, so they stay readable as chips and usable as
   links (quick-add `@NO`, which splits on spaces). Unique across all plans, ignoring case; whether a number is a PSG
   or a SIG comes from the data, never from its prefix. */
export const GOAL_NO_MAX = 10
const RESERVED = /^(DL|SP|T|R|IPB|KZ)-/i // other link types' prefixes (linkType)
const goalTaken = (no, except = null) => [...goalMap().keys()].some((k) => k !== except && k.toLowerCase() === String(no).toLowerCase())
/** Check a typed goal number. Returns { no } or { error }. */
export function checkGoalNo(value, except = null) {
  const no = String(value ?? '').trim()
  if (!no) return { error: 'The number can’t be empty' }
  if (/\s/.test(no)) return { error: 'No spaces (it’s used as a link)' }
  if (!/^[A-Za-z0-9._-]+$/.test(no)) return { error: 'Use letters, digits, - . _ only' }
  if (no.length > GOAL_NO_MAX) return { error: `Keep it to ${GOAL_NO_MAX} characters` }
  if (RESERVED.test(no)) return { error: `${no.split('-')[0].toUpperCase()}- is used by other links` }
  if (goalTaken(no, except)) return { error: `${no} is already used` }
  return { no }
}
/** Rename a PSG or SIG; every reference follows (links, deadlines, blocks, deps, and a PSG's SIGs' parent). */
export function renameGoalNo(goal, value) {
  const from = String(goal.no)
  const r = checkGoalNo(value, from)
  if (r.error) return r
  if (r.no === from) return null
  const edits = renameGoal(from, r.no)
  for (const p of state.plans) if (p.psgs.includes(goal)) for (const s of p.sigs) if (s.psg === from) s.psg = r.no
  goal.no = r.no
  return { from, to: r.no, edits }
}
/** Default number for a new SIG under `psgNo`: SIG-<psg code>.n, else <psg>.n, else SIG-n (whichever fits). */
export function nextSigNo(psgNo) {
  const base = String(psgNo).replace(/^PSG-/i, '')
  const tryN = (fmt) => { for (let n = 1; n < 1000; n++) { const no = fmt(n); if (no.length <= GOAL_NO_MAX && !goalTaken(no)) return no } return null }
  return tryN((n) => `SIG-${base}.${n}`) ?? tryN((n) => `${base}.${n}`) ?? tryN((n) => `SIG-${n}`)
}
export function psgPct(psgNo) {
  const s = sigsOf(psgNo)
  return s.length ? Math.round(s.reduce((a, x) => a + Number(x.pct || 0), 0) / s.length) : 0
}
export const nextSig = (psgNo) => sigsOf(psgNo).find((s) => s.status !== 'done')
/** True if making a goal (PSG or SIG) `fromNo` depend on `toNo` would create a dependency cycle.
 *  Walks "needs" edges from `toNo`: a SIG needs its deps (SIGs or PSGs); a PSG needs all its child SIGs.
 *  A SIG does NOT need its own PSG (the PSG needs it), so sibling SIGs may depend on each other. */
export function sigWouldCycle(fromNo, toNo) {
  if (fromNo === toNo) return true
  const bySig = new Map(allSigs().map((s) => [s.no, s]))
  const seen = new Set()
  const stack = [toNo]
  while (stack.length) {
    const n = stack.pop()
    if (n === fromNo) return true // `fromNo` depends (directly or not) on `toNo`
    if (seen.has(n)) continue
    seen.add(n)
    const s = bySig.get(n)
    if (s) {
      stack.push(...(s.deps ?? []))
      continue
    }
    // not a SIG: a PSG — its child SIGs must complete before it does
    for (const sig of allSigs()) if (sig.psg === n) stack.push(sig.no)
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
  for (const t of todosForDay(date)) if (loadsDay(t, date)) by[categoryOf(t)] += (t.timeMin || 0) / 60
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
// Hover highlight: the hovered todo plus every other part of the same split task, so hovering a
// sitting on the timeline lights up its merged workload card (and the other way round).
const hoverGroup = computed(() => (ui.hoverId ? state.todos.find((t) => t.id === ui.hoverId)?.split?.group ?? null : null))
/** Is todo `id` (or a split part in its group) the one under the pointer? */
export function isHoverLinked(id) {
  if (!id || !ui.hoverId) return false
  if (id === ui.hoverId) return true
  const g = hoverGroup.value
  return !!g && state.todos.some((t) => t.id === id && t.split?.group === g)
}
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
    scheduled: first.date ? { date: first.date, start: first.start === undefined ? (t.scheduled?.date === first.date ? t.scheduled.start : null) : (first.start || null) } : null,
    split: { group },
  })
  return [t, ...rest.map((p, k) => addTodo({
    title: t.title, vital: t.vital, lsd: t.lsd, priority: t.priority, due: t.due, links: [...t.links],
    timeMin: p.min, scheduled: p.date ? { date: p.date, start: p.start === undefined ? null : (p.start || null) } : null,
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

/**
 * The Split dialog's apply: split `id` into `parts`, with an Undo toast that restores every todo of
 * the group exactly as it was. whole = re-split the whole task: merge its open parts first, so a
 * part split again doesn't end up as 2/5, 3/5… next to stale siblings.
 */
export function splitWithUndo(id, parts, { whole = false } = {}) {
  const t = findTodo(id)
  if (!t || parts.length < 2) return []
  const before = (t.split ? splitSiblings(t) : [t]).map((x) => JSON.parse(JSON.stringify(x)))
  const drawerWas = ui.drawerId
  const target = whole && t.split ? (mergeParts(id) ?? t) : t
  const made = splitTodo(target.id, parts)
  const group = made[0].split.group
  const ids = new Set(state.todos.filter((x) => x.split?.group === group).map((x) => x.id))
  if (drawerWas && !findTodo(drawerWas)) ui.drawerId = made[0].id
  const where = parts.every((p) => p.date && p.date === parts[0].date) ? ` on ${wd(parts[0].date)}` : ''
  toast(`Split into ${made.length} parts${where}`, {
    label: 'Undo',
    run: () => {
      for (let i = state.todos.length - 1; i >= 0; i--) if (ids.has(state.todos[i].id)) state.todos.splice(i, 1)
      before.forEach((c) => { if (!findTodo(c.id)) state.todos.push(c) })
    },
  })
  return made
}

/**
 * The task planner's apply. `pieces` = [{ date|null, start|null, min }] — the whole open budget:
 * timed sittings, each day's untimed rest, and an unplanned (backlog) piece. Rewrites the task's open
 * parts to match, reusing existing ids in order (done parts are left alone), and offers Undo.
 */
export function replanTodo(id, pieces) {
  const t = findTodo(id)
  pieces = pieces.filter((p) => p.min > 0)
  if (!t || !pieces.length) return []
  const group = t.split?.group ?? t.id
  const before = (t.split ? splitSiblings(t) : [t]).map((x) => JSON.parse(JSON.stringify(x)))
  const open = t.split ? splitSiblings(t).filter((x) => !x.done) : [t]
  const doneCount = t.split ? splitSiblings(t).length - open.length : 0
  const multi = pieces.length + doneCount > 1
  // chronological: dated before backlog, then by start (untimed rest last within its day)
  pieces.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.start ?? '99:99').localeCompare(b.start ?? '99:99'))
  // the task the planner was opened on keeps its id; the other open parts follow
  const reuse = [t, ...open.filter((x) => x !== t)]
  const out = pieces.map((p, i) => {
    const sched = p.date ? { date: p.date, start: p.start || null } : null
    const ex = reuse[i]
    if (ex) {
      updateTodo(ex.id, { timeMin: p.min, scheduled: sched, pomo: (p.start && p.pomo) || undefined })
      if (multi) ex.split = { group }
      else delete ex.split
      return ex
    }
    return addTodo({
      title: t.title, vital: t.vital, lsd: t.lsd, priority: t.priority, due: t.due, links: [...t.links],
      timeMin: p.min, scheduled: sched, split: { group }, order: t.order + i * 0.001, pomo: (p.start && p.pomo) || undefined,
    })
  })
  reuse.slice(pieces.length).forEach((x) => deleteTodo(x.id))
  if (!multi) state.todos.filter((x) => x.split?.group === group).forEach((x) => { delete x.split })
  if (ui.drawerId && !findTodo(ui.drawerId)) ui.drawerId = out[0].id
  const ids = new Set(state.todos.filter((x) => out.includes(x) || (x.split && x.split.group === group)).map((x) => x.id))
  const days = new Set(pieces.filter((p) => p.date).map((p) => p.date)).size
  const sittings = pieces.filter((p) => p.start).length
  toast(`Planned ${t.id}: ${days} day${days === 1 ? '' : 's'}${sittings ? ` · ${sittings} timed` : ''}${pieces.some((p) => !p.date) ? ' · rest in backlog' : ''}`, {
    label: 'Undo',
    run: () => {
      for (let i = state.todos.length - 1; i >= 0; i--) if (ids.has(state.todos[i].id)) state.todos.splice(i, 1)
      before.forEach((c) => { if (!findTodo(c.id)) state.todos.push(c) })
    },
  })
  return out
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
  if (isContainer(t)) { toast(`${id} has subtasks: plan those instead`); return }
  updateTodo(id, { scheduled: { date, start: t.scheduled?.date === date ? t.scheduled.start : null } })
  const load = dayLoad(date).total
  if (load > cap && t.timeMin >= 30) {
    toast(`${wd(date)} is now ${load.toFixed(1)}h / ${cap}h`, { label: 'Plan it…', run: () => { ui.splitId = id } })
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
  const busy = busyBlocks(date).map((b) => [toMin(b.start), toMin(b.end)])
  let earliest = toMin(from)
  if (date === todayISO()) {
    const n = new Date()
    earliest = Math.max(earliest, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15)
  }
  const end = toMin(to)
  const placed = []
  const unplaced = []
  const P = pomo()
  for (const t of todosForDay(date).filter((x) => !x.done && !x.scheduled.start)) {
    const dur = P.on ? wallMin(t.timeMin || 30, P) : t.timeMin || 30
    let s = earliest
    let found = null
    while (s + dur <= end) {
      const clash = busy.find(([a, b]) => s < b && s + dur > a)
      if (!clash) { found = s; break }
      s = Math.ceil(clash[1] / 15) * 15
    }
    if (found === null) { unplaced.push(t.id); continue }
    updateTodo(t.id, { scheduled: { date, start: fromMin(found) }, pomo: P.on || undefined })
    // after a pomodoro sitting, keep a long break before the next one
    busy.push([found, found + dur + (P.on ? P.long : 0)])
    placed.push(t.id)
  }
  return { placed, unplaced }
}
/**
 * ISS-21: give each of a same-day split's parts a start time — the earliest free gaps after fixed
 * blocks, skipping the original task's own block (its parts replace it). Returns 'HH:MM' or null per part.
 */
export function planDaySpread(date, mins, skipTodoId = null, from = WORK_FROM, to = WORK_TO, extraBusy = []) {
  const skip = new Set([].concat(skipTodoId ?? [])) // one id or a list (a re-split skips every open part)
  const busy = busyBlocks(date)
    .filter((b) => !skip.has(b.todoId))
    .map((b) => [toMin(b.start), toMin(b.end)])
    .concat(extraBusy) // [startMin, endMin] pairs not saved yet (sittings planned in the dialog)
  let earliest = toMin(from)
  if (date === todayISO()) {
    const n = new Date()
    earliest = Math.max(earliest, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15)
  }
  const end = toMin(to)
  return mins.map((m) => {
    const dur = m || 30
    let s = earliest
    let found = null
    while (s + dur <= end) {
      const clash = busy.find(([a, b]) => s < b && s + dur > a)
      if (!clash) { found = s; break }
      s = Math.ceil(clash[1] / 15) * 15
    }
    if (found === null) return null
    busy.push([found, found + dur])
    return fromMin(found)
  })
}

/**
 * Pomodoro auto-times for one day: walk the free gaps from the earliest start and fill each with as
 * many whole pomodoros as fit (at most one set), a long break after every sitting, until `workMin`
 * is placed or the day runs out. Returns [{ start: 'HH:MM', min }] (work minutes); what doesn't
 * fit stays unplaced, so the caller keeps it untimed.
 */
export function planPomodoroDay(date, workMin, skipTodoId = null, extraBusy = [], from = WORK_FROM, to = WORK_TO) {
  const P = pomo()
  const skip = new Set([].concat(skipTodoId ?? []))
  const busy = busyBlocks(date)
    .filter((b) => !skip.has(b.todoId))
    // another pomodoro sitting earns its long break too, so sittings never run back to back
    .map((b) => [toMin(b.start), toMin(b.end) + (b.pomo ? P.long : 0)])
    .concat(extraBusy)
    .sort((a, b) => a[0] - b[0])
  let t = toMin(from)
  if (date === todayISO()) { const n = new Date(); t = Math.max(t, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 5) * 5) }
  const end = toMin(to)
  const up5 = (m) => Math.ceil(m / 5) * 5
  const out = []
  let left = Math.max(0, Math.round(workMin || 0))
  while (left > 0 && t < end) {
    const inside = busy.find(([a, b]) => a <= t && t < b)
    if (inside) { t = up5(inside[1]); continue }
    const next = busy.find(([a]) => a > t)
    const gapEnd = Math.min(end, next ? next[0] : end)
    // the biggest whole-pomodoro sitting (≤ one set, ≤ what's left) that fits this gap
    let w = 0
    for (let k = P.every; k >= 1; k--) {
      const cand = Math.min(k * P.work, left)
      if (t + wallMin(cand, P) <= gapEnd) { w = cand; break }
    }
    if (!w) { t = up5(gapEnd); continue }
    out.push({ start: fromMin(t), min: w })
    left -= w
    t = up5(t + wallMin(w, P) + P.long)
  }
  return out
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
  const dl = { id: `DL-${max + 1}`, title: 'Untitled', vital: '', due: `${todayISO()}T23:59`, source: '', done: false, priority: 2, ...d }
  state.deadlines.push(dl)
  return state.deadlines[state.deadlines.length - 1]
}
export function deleteDeadline(id) {
  const i = state.deadlines.findIndex((d) => d.id === id)
  if (i >= 0) state.deadlines.splice(i, 1)
  if (ui.deadlineId === id) ui.deadlineId = null
}
