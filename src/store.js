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

/* ───────────── seed data (relative to the current week) ─────────────
 * The demo planner a new account starts with: someone with a day job who is switching careers into
 * UX design through an online course, training for a half marathon, saving for a trip to Japan,
 * and has paused learning Spanish. Everything links up the way real use does: tasks → goals,
 * deadlines and the course; goals → dependency chains; deadlines with an earlier personal target;
 * split pomodoro sittings; a task with subtasks. Dates are relative to today, so it always looks current.
 */
function seed() {
  const T = todayISO()
  const M = mondayOf(T)
  const D = (n) => addDays(M, n) // 0 = Monday … 6 = Sunday
  const R = (n) => addDays(T, n) // relative to today
  const past = (d) => diffDays(d, T) > 0
  const now = new Date().toISOString()
  const todo = (id, title, o = {}) => ({
    id, title, vital: '', timeMin: 30, done: false, lsd: 'S', priority: 3,
    due: null, scheduled: null, links: [], notes: '', createdAt: now, updatedAt: now, ...o,
  })
  const on = (date, start = null) => ({ date, start })
  /** a task planned for weekday i: done if that day has passed */
  const wk = (i, o = {}) => ({ scheduled: on(D(i), o.start ?? null), done: past(D(i)), ...o })
  const at = (date, t) => new Date(`${date}T${t}:00`).toISOString()

  /* ── fixed calendar: the day job, the course's live classes, runs, a weekly review ── */
  const block = (date, start, end, title, category, link = null) => ({ id: `B-${date}-${start}`, date, start, end, title, category, link })
  const week = [
    // [weekday, start, end, title, category, link]
    [0, '06:45', '07:30', 'Easy run · 5 km', 'kaizen', 'BASE'],
    [2, '06:45', '07:30', 'Easy run · 6 km', 'kaizen', 'BASE'],
    [4, '06:45', '07:30', 'Easy run · 5 km', 'kaizen', 'BASE'],
    [1, '18:00', '19:00', 'UX-101 live class', 'academic', 'UX-101'],
    [3, '18:00', '19:00', 'UX-101 live class', 'academic', 'UX-101'],
    [2, '18:00', '18:45', 'Coffee chat with a product designer', 'research', 'NET'],
    [5, '09:00', '10:45', 'Long run · 14 km', 'kaizen', 'BASE'],
    [6, '18:00', '18:30', 'Weekly review', 'kaizen', 'KZ-02'],
  ]
  for (let i = 0; i < 5; i++) week.push([i, '09:00', '12:30', 'Work', 'experiment', null], [i, '13:30', '17:30', 'Work', 'experiment', null])
  const timeBlocks = week.map(([i, s, e, title, cat, link]) => block(D(i), s, e, title, cat, link))

  /* lectures follow the class blocks */
  const lectures = week.filter((b) => b[5] === 'UX-101').map(([i, s], k) => {
    const d = D(i)
    return { id: `L-UX-101-${k + 7}`, course: 'UX-101', title: ['Usability testing', 'Clickable prototypes'][k], no: k + 7, date: d, time: s, readAhead: past(d), attended: past(d), cheatSheet: false }
  })

  /* sign-offs: earlier days stamped, today half-way */
  const signOffs = {}
  for (let i = 0; i < 7; i++) {
    const d = D(i)
    const n = diffDays(d, T)
    if (n > 0) signOffs[d] = [at(d, '06:35'), at(d, '08:50'), at(d, '17:40'), n > 1 || i % 2 ? at(d, '22:30') : null]
  }
  signOffs[T] = [at(T, '06:40'), at(T, '08:55'), null, null]

  /* sleep for the last week: drifting late mid-week, back on track today */
  const SLEEP = [['23:30', '06:30'], ['23:05', '06:30'], ['00:15', '06:40'], ['23:20', '06:30'], ['22:50', '06:25'], ['23:45', '08:00'], ['23:00', '06:35']]
  const sleep = {}
  SLEEP.forEach(([bed, wake], k) => { sleep[R(k - 6)] = { bed, bedTarget: '23:00', wake, wakeTarget: '06:30', targetMin: 450 } })

  const todos = [
    /* ── today ── */
    todo('T-101', 'Case study: write the research section', { vital: 'Interview quotes → 3 key insights', timeMin: 50, pomo: true, lsd: 'D', priority: 1, due: R(3), scheduled: on(T, '19:30'), links: ['CASE1', 'DL-3'], split: { group: 'T-101' }, notes: '## Insights so far\n- People give up at the shopping-list step\n- Nobody trusts the "15 min" prep times\n- Photos matter more than ratings' }),
    todo('T-102', 'Case study: write the research section', { vital: 'Interview quotes → 3 key insights', timeMin: 50, pomo: true, lsd: 'D', priority: 1, due: R(3), scheduled: on(R(1), '19:30'), links: ['CASE1', 'DL-3'], split: { group: 'T-101' }, order: 1000.001 }),
    todo('T-103', 'UX-101 Assignment 3: summarise 5 interviews', { vital: 'Affinity map + top 3 user needs', timeMin: 50, pomo: true, lsd: 'L', priority: 1, scheduled: on(T, '07:45'), links: ['UX-101', 'DL-1'] }),
    todo('T-104', 'Pay the credit card bill', { timeMin: 10, lsd: 'L', priority: 1, scheduled: on(T, '20:45'), links: ['DL-2'] }),
    todo('T-105', 'Book a dentist check-up', { timeMin: 10, lsd: 'L', priority: 2, scheduled: on(T, '12:35') }),
    todo('T-106', 'Compare flight prices on 3 sites', { vital: 'Under 900 return, max one stop', timeMin: 20, lsd: 'L', priority: 2, scheduled: on(T), links: ['FLY', 'DL-6'] }),
    todo('T-107', 'Groceries for the next 3 days', { timeMin: 40, lsd: 'L', priority: 3, scheduled: on(T), links: ['KZ-03'] }),
    todo('T-108', 'Cancel the streaming service I never use', { timeMin: 10, lsd: 'L', priority: 2, done: true, scheduled: on(T), links: ['CUT'] }),
    todo('T-109', '10-minute stretch', { timeMin: 10, lsd: 'D', priority: 4, scheduled: on(T), links: ['KZ-01'] }),

    /* ── the rest of this week ── */
    todo('T-110', 'Plan this week\'s meals', { timeMin: 20, lsd: 'L', priority: 4, links: ['KZ-03'], ...wk(0) }),
    todo('T-111', 'UX-101 Module 6 quiz', { timeMin: 30, lsd: 'S', priority: 2, links: ['UX-101', 'MOD'], ...wk(0) }),
    todo('T-112', 'User interviews #4 and #5', { vital: 'Record with permission', timeMin: 60, lsd: 'D', priority: 1, links: ['UX-101', 'DL-1'], ...wk(1) }),
    todo('T-113', 'Laundry + change the bedsheets', { timeMin: 30, lsd: 'L', priority: 4, links: ['KZ-03'], ...wk(1) }),
    todo('T-114', 'Sketch 3 onboarding flows', { timeMin: 45, lsd: 'D', priority: 2, links: ['CASE1'], ...wk(1) }),
    todo('T-115', 'Questions for the coffee chat', { vital: 'How did you land your first UX role?', timeMin: 15, lsd: 'S', priority: 2, links: ['NET'], ...wk(2) }),
    todo('T-116', 'Move 300 into the trip account', { timeMin: 5, lsd: 'L', priority: 2, links: ['AUTO'], ...wk(2) }),
    todo('T-117', 'Draft the usability test plan', { timeMin: 40, lsd: 'S', priority: 2, links: ['CAP'], ...wk(3) }),
    todo('T-118', 'Call the bank about the card fee', { timeMin: 15, lsd: 'L', priority: 3, ...wk(3) }),
    todo('T-119', 'Weekly money check', { timeMin: 15, lsd: 'D', priority: 3, links: ['KZ-02'], ...wk(4) }),
    todo('T-150', 'Share interview notes on the course forum', { timeMin: 15, lsd: 'L', priority: 3, links: ['UX-101'], ...wk(4) }),
    todo('T-151', 'Farmers market + batch cooking', { timeMin: 90, lsd: 'D', priority: 4, links: ['KZ-03'], ...wk(5) }),
    todo('T-152', 'Call Mum and Dad', { timeMin: 30, lsd: 'D', priority: 3, ...wk(6) }),

    /* ── portfolio website: a task with subtasks; its estimate is the budget ── */
    todo('T-120', 'Portfolio website', { vital: 'Live before the mentor review', timeMin: 360, lsd: 'D', priority: 1, due: R(20), links: ['SITE'] }),
    todo('T-121', 'Pick a template', { timeMin: 45, lsd: 'L', priority: 1, due: R(20), links: ['SITE'], parent: 'T-120', done: true }),
    todo('T-122', 'Write the About page', { vital: 'Why I\'m switching, in 120 words', timeMin: 60, lsd: 'D', priority: 1, due: R(20), links: ['SITE'], parent: 'T-120', scheduled: on(R(2)) }),
    todo('T-123', 'Buy a domain', { timeMin: 15, lsd: 'L', priority: 2, due: R(20), links: ['SITE'], parent: 'T-120' }),
    todo('T-124', 'Add case study 1', { timeMin: 150, lsd: 'D', priority: 1, due: R(20), links: ['SITE', 'CASE1'], parent: 'T-120' }),
    todo('T-125', 'Ask 2 friends to try it on their phones', { timeMin: 30, lsd: 'S', priority: 2, due: R(20), links: ['SITE'], parent: 'T-120' }),

    /* ── backlog ── */
    todo('T-130', 'Update LinkedIn headline and summary', { timeMin: 30, lsd: 'S', priority: 2, links: ['NET'] }),
    todo('T-131', 'Cover letter template', { timeMin: 45, lsd: 'D', priority: 3, links: ['APPLY'] }),
    todo('T-132', 'Register for the half marathon', { vital: 'Entry fee + pick-up date', timeMin: 15, lsd: 'L', priority: 2, links: ['RUN', 'DL-5'] }),
    todo('T-133', 'Replace running shoes (600 km)', { timeMin: 30, lsd: 'L', priority: 4, links: ['RUN'] }),
    todo('T-134', 'Passport photos + renewal form', { timeMin: 30, lsd: 'L', priority: 2, links: ['PASS', 'DL-7'] }),
    todo('T-135', 'Tax return: gather receipts', { timeMin: 45, lsd: 'L', priority: 2, links: ['DL-4'] }),
    todo('T-136', 'Back up phone photos', { timeMin: 20, lsd: 'L', priority: 4, links: ['KZ-03'] }),
    todo('T-137', 'Fix the wobbly desk chair', { timeMin: 20, lsd: 'L', priority: 5 }),
  ]

  const plans = [
    {
      id: 'SP-01', planNo: 'SP-01', title: 'Career switch to UX design', status: 'active', health: 'On-track',
      intent: 'Move from marketing into a UX design role within a year, without quitting before I have an offer.',
      vision: 'Doing work I\'m proud to show people',
      psgs: [
        { no: 'PORT', name: '🎨 A portfolio people remember', priority: 1, indicators: '3 case studies on a live site', timeBound: R(60), status: 'doing', boundLocked: true },
        { no: 'COURSE', name: '📚 Finish the UX certificate', priority: 2, indicators: 'All 8 modules + capstone passed', timeBound: R(45), status: 'doing' },
        { no: 'JOB', name: '💼 Land a UX role', priority: 3, indicators: 'A signed offer', timeBound: R(150), status: 'open' },
      ],
      sigs: [
        { no: 'MOD', psg: 'COURSE', name: 'Modules 1–6', priority: 1, criteria: 'Every quiz at 80% or more', timeBound: R(-2), status: 'done', pct: 100, deps: [] },
        { no: 'CAP', psg: 'COURSE', name: 'Capstone project', priority: 1, criteria: 'Usability test with 5 people', timeBound: R(40), status: 'doing', pct: 30, deps: ['MOD'], boundLocked: true },
        { no: 'CASE1', psg: 'PORT', name: 'Case study 1: recipe app', priority: 1, criteria: 'Problem → research → design → results', timeBound: R(10), status: 'doing', pct: 60, deps: [] },
        { no: 'CASE2', psg: 'PORT', name: 'Case study 2: the capstone', priority: 2, criteria: 'Written up with test results', timeBound: R(50), status: 'open', pct: 0, deps: ['CAP'] },
        { no: 'SITE', psg: 'PORT', name: 'Portfolio website', priority: 2, criteria: 'Live on my own domain', timeBound: R(20), status: 'doing', pct: 15, deps: ['CASE1'] },
        { no: 'NET', psg: 'JOB', name: 'Meet designers', priority: 2, criteria: '10 coffee chats', timeBound: R(90), status: 'doing', pct: 30, deps: [] },
        { no: 'APPLY', psg: 'JOB', name: 'Applications', priority: 1, criteria: '20 tailored applications', timeBound: R(120), status: 'open', pct: 0, deps: ['PORT'] },
      ],
      checkEveryDays: 7,
      checkLog: [
        { date: R(-14), reminder: true, checked: true, updated: true },
        { date: R(-7), reminder: true, checked: true, updated: false },
      ],
      events: [
        { sym: '◆', event: 'Mentor portfolio review', date: R(4) },
        { sym: '▲', event: 'Capstone demo day', date: R(40) },
        { sym: '■', event: 'Start applying', date: R(60) },
      ],
    },
    {
      id: 'SP-02', planNo: 'SP-02', title: 'Health & Energy', status: 'active', health: 'On-track',
      intent: 'Feel fit and rested enough that evenings are for my goals, not the sofa.',
      vision: 'Energy left over at the end of the day',
      psgs: [
        { no: 'RUN', name: '🏃 Run a half marathon', priority: 1, indicators: 'Finish in under 2 hours', timeBound: R(63), status: 'doing', boundLocked: true },
        { no: 'SLEEP', name: '😴 Sleep 7½ hours', priority: 2, indicators: 'Lights out by 23:00 most nights', timeBound: 'Continuous', status: 'doing' },
      ],
      sigs: [
        { no: 'BASE', psg: 'RUN', name: 'Build the base', priority: 1, criteria: '30 km a week for 3 weeks', timeBound: R(21), status: 'doing', pct: 60, deps: [] },
        { no: 'LONG', psg: 'RUN', name: 'Long run 18 km', priority: 2, criteria: 'Comfortably, without walking', timeBound: R(49), status: 'open', pct: 0, deps: ['BASE'] },
        { no: 'BED', psg: 'SLEEP', name: 'Phone out of the bedroom', priority: 1, criteria: '6 nights out of 7', timeBound: 'Continuous', status: 'doing', pct: 55, deps: [] },
        { no: 'CAFF', psg: 'SLEEP', name: 'No coffee after 2 pm', priority: 3, criteria: 'Logged every day', timeBound: 'Continuous', status: 'doing', pct: 80, deps: [] },
      ],
      checkEveryDays: 7,
      checkLog: [{ date: R(-4), reminder: true, checked: true, updated: true }],
      events: [{ sym: '■', event: 'Race day', date: R(63) }],
    },
    {
      id: 'SP-03', planNo: 'SP-03', title: 'Japan trip in spring', status: 'active', health: 'Needs attention',
      intent: 'Two weeks in Japan next spring, paid for in cash before I go.',
      vision: 'Cherry blossoms, no credit card debt',
      psgs: [
        { no: 'FUND', name: '💰 Save 3,000 for the trip', priority: 1, indicators: '3,000 in the trip account', timeBound: R(120), status: 'doing' },
        { no: 'TRIP', name: '✈️ Two weeks in Japan', priority: 2, indicators: 'Flights and stays booked', timeBound: R(150), status: 'open' },
      ],
      sigs: [
        { no: 'AUTO', psg: 'FUND', name: 'Automatic saving', priority: 1, criteria: '300 moved on every payday', timeBound: 'Continuous', status: 'doing', pct: 40, deps: [] },
        { no: 'CUT', psg: 'FUND', name: 'Cut subscriptions', priority: 2, criteria: 'Save 40 a month', timeBound: R(7), status: 'doing', pct: 50, deps: [] },
        { no: 'FLY', psg: 'TRIP', name: 'Flights booked', priority: 1, criteria: 'Under 900 return', timeBound: R(6), status: 'open', pct: 0, deps: [] },
        { no: 'PASS', psg: 'TRIP', name: 'Passport renewed', priority: 1, criteria: 'New passport in hand', timeBound: R(30), status: 'doing', pct: 20, deps: [] },
        { no: 'STAY', psg: 'TRIP', name: 'Itinerary + places to stay', priority: 2, criteria: 'Tokyo → Kyoto → Osaka, all booked', timeBound: R(90), status: 'open', pct: 0, deps: ['FLY', 'PASS'] },
      ],
      checkEveryDays: 14,
      checkLog: [{ date: R(-10), reminder: true, checked: true, updated: true }],
      events: [{ sym: '▲', event: 'Fare sale ends', date: R(6) }, { sym: '■', event: 'Fly to Tokyo', date: R(150) }],
    },
    {
      id: 'SP-04', planNo: 'SP-04', title: 'Learn Spanish', status: 'paused', health: 'Paused until the course ends',
      intent: 'Chat with my partner\'s family without switching to English.',
      vision: 'Relaxed conversations in Spanish',
      psgs: [
        { no: 'SPAN', name: '🗣️ Hold a 30-minute conversation', priority: 1, indicators: 'A full dinner in Spanish', timeBound: R(240), status: 'open' },
      ],
      sigs: [
        { no: 'DAILY', psg: 'SPAN', name: 'Daily practice', priority: 1, criteria: '10 minutes a day, 100-day streak', timeBound: R(180), status: 'doing', pct: 35, deps: [] },
        { no: 'TALK', psg: 'SPAN', name: 'Conversation class', priority: 2, criteria: 'One class a week for 3 months', timeBound: R(220), status: 'open', pct: 0, deps: ['DAILY'] },
      ],
      checkEveryDays: 30,
      checkLog: [],
      events: [],
    },
  ]

  return {
    version: 1,
    schemaVersion: 2,
    todos,
    timeBlocks,
    deadlines: [
      { id: 'DL-1', title: 'UX-101 Assignment 3: user interviews', vital: 'Affinity map + summary PDF', due: `${R(1)}T23:59`, internal: T, source: 'UX-101', done: false, priority: 1 },
      { id: 'DL-2', title: 'Credit card payment', vital: 'Pay in full to avoid interest', due: `${T}T23:59`, internal: '', source: 'FUND', done: false, priority: 1 },
      { id: 'DL-3', title: 'Send case study draft to mentor', vital: 'Before the portfolio review', due: `${R(3)}T20:00`, internal: R(2), source: 'CASE1', done: false, priority: 1 },
      { id: 'DL-4', title: 'Tax return', vital: 'Receipts + payslips', due: `${R(20)}T23:59`, internal: R(14), source: '', done: false, priority: 2 },
      { id: 'DL-5', title: 'Half-marathon entries close', vital: 'Entry fee + pick-up date', due: `${R(9)}T23:59`, internal: R(7), source: 'RUN', done: false, priority: 2 },
      { id: 'DL-6', title: 'Flight fare sale ends', vital: 'Under 900 return', due: `${R(6)}T23:59`, internal: R(4), source: 'FLY', done: false, priority: 2 },
      { id: 'DL-7', title: 'Passport renewal application', vital: 'Photos + old passport', due: `${R(30)}T17:00`, internal: R(21), source: 'PASS', done: false, priority: 3 },
      { id: 'DL-8', title: 'Grandma\'s birthday card', vital: '', due: `${D(1)}T12:00`, internal: '', source: '', done: past(D(1)), priority: 2 },
    ],
    plans,
    routines: [
      'Make the bed', 'Clear the desk', 'Dishes', 'Laundry', 'Take out the bins', 'Vacuum', 'Water the plants',
      'Clear the inbox', 'Back up the laptop', 'Tidy the fridge', 'Charge watch & earbuds', 'Meal prep',
    ],
    routineLog: { [M]: [0, 1, 2, 3, 4, 6, 7, 10] },
    monthlyGroups: { A: ['Clean the bathroom', 'Descale the kettle'], B: ['Sort the wardrobe', 'Wash the running kit'], C: ['Clean the oven', 'Change the bedsheets'] },
    monthlyLog: {},
    signOffs,
    notes: { [T]: 'Interview 4 gave up on recipe apps at the shopping-list step. Lead the case study with that.' },
    sleep,
    caffeine: { [T]: [{ t: '07:30', what: 'Coffee', mg: 95 }, { t: '11:00', what: 'Tea', mg: 45 }] },
    caffeineCutoff: '14:00',
    caffeineLimit: 300,
    lectures,
    reviews: [{ id: 'RV-1', title: 'Monthly budget review', date: R(1) }],
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
  shareUsage: true, // anonymous usage statistics, when the server collects them (Settings → Privacy)
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
/** Phones/tablets: the schedule lock (ISS-14) guards against accidental drags while scrolling.
 *  With a mouse there's no such risk, so the lock is off and its padlock buttons are hidden. */
export const touchUI = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

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
    if (!touchUI) return false
    try {
      const s = localStorage.getItem('life-console/schedule-lock')
      if (s !== null) return s === '1'
    } catch { /* ignore */ }
    return true
  })(),
  backlogOnly: false, // Plan week: hide the day columns, spread the backlog over the next weeks (ISS-16)
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

export const BALANCE_LEVEL = {
  balanced: { icon: 'check_circle', label: 'Balanced', cls: 'ok' },
  uneven: { icon: 'error', label: 'Uneven', cls: 'warn' },
  unbalanced: { icon: 'warning', label: 'Unbalanced', cls: 'danger' },
}
/**
 * How even the week's weekdays are: only the ones still ahead count (a past Monday can't be
 * changed), or all five for a week that's already over. Feeds the Balance panel and the ② bar.
 */
export function weekBalance(weekStart) {
  const wk = [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i))
  const ahead = wk.filter((d) => d >= todayISO())
  const days = ahead.length ? ahead : wk
  const loads = Object.fromEntries(days.map((d) => [d, dayLoad(d).total]))
  const v = Object.values(loads)
  const avg = v.reduce((a, b) => a + b, 0) / v.length
  const spread = Math.max(...v) - Math.min(...v)
  const over = days.filter((d) => loads[d] > CAPACITY_H)
  const level = over.length || spread > 3 ? 'unbalanced' : spread > 1.5 ? 'uneven' : 'balanced'
  const free = v.reduce((s, x) => s + Math.max(0, CAPACITY_H - x), 0)
  return { days, loads, avg, spread, over, level, free }
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

/* Step ① (backlog-only view): a backlog task can get a week before it gets a day. t.week is that
   week's Monday; once the week has passed the task rolls over into the current one. */
export const planWeek = (t) => {
  if (!t.week) return null
  const now = mondayOf(todayISO())
  return t.week < now ? now : t.week
}
export const backlogTodos = () => state.todos.filter((t) => !t.done && !t.scheduled && isLeaf(t))
/** The backlog the week view of `weekStart` offers: tasks planned for that week, then unplanned ones. */
export const backlogFor = (weekStart) => backlogTodos()
  .filter((t) => { const w = planWeek(t); return !w || w === weekStart })
  .sort((a, b) => Number(!planWeek(a)) - Number(!planWeek(b)) || byPriority(a, b))
/** Hours left in a week: free time on its weekdays still ahead (the weekend if none are), minus the
   backlog already planned for it. Negative = over-planned. */
export function weekFree(weekStart, cap = CAPACITY_H) {
  const T = todayISO()
  const ahead = (ids) => ids.map((i) => addDays(weekStart, i)).filter((d) => d >= T)
  const ds = ahead([0, 1, 2, 3, 4]).length ? ahead([0, 1, 2, 3, 4]) : ahead([5, 6])
  const planned = backlogTodos().filter((t) => planWeek(t) === weekStart).reduce((s, t) => s + (t.timeMin || 0) / 60, 0)
  return { free: ds.reduce((s, d) => s + freeHours(d, cap), 0) - planned, planned }
}
/** The weeks the backlog-only view lays out as columns: from the week in the week bar (never a past one). */
export const PLAN_WEEKS = 4
export const planWeeks = (n = PLAN_WEEKS) => {
  const now = mondayOf(todayISO())
  const from = ui.weekStart < now ? now : ui.weekStart
  return Array.from({ length: n }, (_, i) => addDays(from, i * 7))
}
/** Give a backlog task a week (null = back to unplanned), with Undo. */
export function assignToWeek(id, week) {
  const t = findTodo(id)
  if (!t) return
  if (isContainer(t)) { toast(`${id} has subtasks: plan those instead`); return }
  const was = t.week ?? null
  if ((planWeek(t) ?? null) === (week ?? null) && !t.scheduled) return
  updateTodo(id, { week: week || null, scheduled: null })
  toast(week ? `${id} → W${isoWeek(week)}` : `${id} → unplanned`, { label: 'Undo', run: () => updateTodo(id, { week: was }) })
}

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
