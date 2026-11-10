<script setup>
/*
 * First-run tour: Strategise → Distribute → Execute. Each move has a few spotlight stops plus one thing the user
 * does themselves (add a task to a milestone, give it a day, tick a task off); the tour waits for it and cheers.
 * Starts by itself for a new account (the demo seed sets state.tour = 'pending'); Settings → Getting started and
 * the ⌘K palette replay it (ui.tourOpen). The dimmed area can't be clicked; on a "your turn" stop the spotlight
 * can. Sparkles and confetti are decoration only and stop under prefers-reduced-motion.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { state, ui, toast, todayISO, isLeaf, workload, CAPACITY_H, addDays, mondayOf, diffDays } from '../store'

const isPhone = () => innerWidth <= 640
const T = () => todayISO()
const backlogIds = () => state.todos.filter((t) => isLeaf(t) && !t.done && !t.scheduled && !t.week).map((t) => t.id)
const doneCount = () => state.todos.filter((t) => t.done).length

/*
 * A stop: route + target (CSS selector, spotlighted) + copy. `move` lights its chip. `backlog`: on phones, show Plan
 * week's Backlog tab instead of Days. `action`: a "your turn" stop: start() takes a baseline, done(baseline) says
 * when the user has done it.
 */
/* the plan the user creates in the tour (falls back to the demo plan if they skip that stop) */
const newPlanId = ref(null)
const newTaskId = ref(null) // and the task they make for it, which Plan week then spotlights
const planRoute = () => `/strategy/${newPlanId.value ?? 'SP-01'}`
const curPlan = () => state.plans.find((p) => p.id === router.currentRoute.value.params.planId)
const count = (key) => curPlan()?.[key]?.length ?? 0
const bounds = () => JSON.stringify([...(curPlan()?.psgs ?? []), ...(curPlan()?.sigs ?? [])].map((g) => g.timeBound ?? ''))
/* Plan week: the over-full day (the demo's tomorrow) and the lightest day left this week to move work to */
const weekLeft = () => { const T = todayISO(), M = mondayOf(T); return [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(M, k)).filter((d) => diffDays(T, d) >= 0) }
const heavyDay = () => weekLeft().find((d) => workload(d) > CAPACITY_H) ?? null
const lightDay = (not) => weekLeft().filter((d) => d !== not).sort((a, b) => workload(a) - workload(b))[0] ?? null
const dayEl = (d, part = '') => (d ? document.querySelector(`.days .day[data-date="${d}"]${part ? ' ' + part : ''}`) : null)
let heavyAtStart = null // remembered so the check still knows which day it was once it's levelled
const timedCount = () => state.todos.filter((t) => t.scheduled?.start).length
const mid = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height, 60) / 2 } }
/** A drag hint from one element to another: { x, y, dx, dy } in viewport px. */
const dragHint = (from, to) => { if (!from || !to) return null; const a = mid(from), b = mid(to); return { x: a.x, y: a.y, dx: b.x - a.x, dy: b.y - a.y } }
const button = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text)) ?? null

const STEPS = [
  { kind: 'welcome', icon: 'auto_awesome', title: 'Plan like a strategist', body: 'Build your first plan, give it a week, then run your day. About two minutes.', next: 'Take a tour' },

  // Strategise: on the Strategy tab, the user builds a plan of their own
  { move: 0, optional: true, target: '.sidebar a[href="#/strategy"]', icon: 'target', title: 'Everything starts with a strategy', body: 'Open the Strategy tab.', phoneBody: 'Your plans live on the Strategy screen.', next: 'Open Strategy',
    action: { start: () => 0, done: () => router.currentRoute.value.path.startsWith('/strategy') }, then: '/strategy' },
  { move: 0, route: '/strategy', target: () => document.querySelector('.plantabs .add') ?? document.querySelector('.plantabs .tab.new'), icon: 'add_circle', title: '1 · Create a strategy', body: 'Tap New plan, name it after something you want, and hit Create.',
    action: { start: () => state.plans.length, done: (n) => state.plans.length > n, after: () => { newPlanId.value = state.plans[state.plans.length - 1].id } } },
  { move: 0, route: planRoute, target: () => button('.tree .panel-h button', 'PSG'), icon: 'flag', title: '2 · Prioritised goals', body: 'Tap + PSG to add the goal that matters most.', doneBody: 'Click its name any time to rename it.',
    action: { start: () => count('psgs'), done: (n) => count('psgs') > n } },
  { move: 0, route: planRoute, target: '.tree .add-sig', icon: 'account_tree', title: '3 · Cascading goals', body: 'Tap + SIG to add a milestone. Milestones cascade up into the goal.',
    action: { start: () => count('sigs'), done: (n) => count('sigs') > n } },
  { move: 0, route: planRoute, target: '.tree .add-task', icon: 'add_task', title: '4 · Create a task', body: 'Tap + task. Now the milestone has something you can actually do.',
    action: { start: () => state.todos.length, done: (n) => state.todos.length > n, after: () => { ui.drawerId = null; newTaskId.value = state.todos[state.todos.length - 1].id } } },
  { move: 0, route: planRoute, target: '.flow-panel', hint: '.flow-panel .fn.movable', desktopOnly: true, icon: 'schema', title: '5 · Goal flow', body: 'Your plan on a timeline. Drag a goal sideways to set its date.', phoneBody: 'Your plan on a timeline. On a computer, drag a goal along it to move its date.', doneBody: 'Dates move with a drag. Red arrows warn when the order stops making sense.',
    action: { start: () => bounds(), done: (b) => bounds() !== b } },

  // Distribute: Plan week. Drag and drop, levelling the load (平準化), then planning a day
  { move: 1, route: '/week', backlog: true, target: '.backlog', icon: 'inbox', title: 'Plan week: the backlog', body: 'Your new task waits here. Tasks stay in the backlog until they get a day.' },
  { move: 1, route: '/week', backlog: true, target: () => [firstBacklogRow(), dayEl(lightDay(), '.sec-load')], hint: () => dragHint(firstBacklogRow(), dayEl(lightDay(), '.sec-load')),
    icon: 'move_item', title: 'Your turn: drag it onto a day', body: 'Drag your task into a day’s bucket. Its estimate fills that day. Tapping a day button works too.', phoneBody: 'Tap a week for this task. Plan the exact day later.',
    action: { start: () => { const ids = backlogIds(); ui.selectedId = firstBacklogId(); return ids }, done: (ids) => ids.some((id) => { const t = state.todos.find((x) => x.id === id); return t && (t.scheduled || t.week) }) } },
  { move: 1, route: '/week', planMode: 'days', target: '.days', icon: 'balance', title: '平準化: level the load', body: 'Heijunka: give every day about the same amount. A steady week beats one heroic day and a crash. The avg line marks the week’s average; work above 7h turns red.' },
  { move: 1, route: '/week', planMode: 'days', target: () => (isPhone() ? dayEl(heavyDay(), '.sec-out') : [dayEl(heavyAtStart ?? heavyDay()), dayEl(lightDay(heavyAtStart ?? heavyDay()), '.sec-load')]),
    hint: () => (isPhone() ? null : dragHint(dayEl(heavyDay(), '.card.block'), dayEl(lightDay(heavyDay()), '.sec-load'))),
    icon: 'swap_horiz', title: 'Your turn: level the week', body: 'Tomorrow is over 7 hours. Drag one of its tasks to a lighter day, or tap a Move out suggestion.', phoneBody: 'Tomorrow is over 7 hours. Tap a Move out suggestion to send a task to a lighter day.', doneBody: 'Levelled. That’s 平準化.',
    action: { start: () => { heavyAtStart = heavyDay(); return heavyAtStart }, done: (d) => !!d && workload(d) <= CAPACITY_H } },
  { move: 1, route: '/week', target: () => dayEl(todayISO()), hint: () => (isPhone() ? null : dragHint(dayEl(todayISO(), '.card.block.untimed'), [...(dayEl(todayISO())?.querySelectorAll('.vt .hr') ?? [])].find((h) => h.textContent.trim() === '19'))),
    icon: 'schedule', title: 'Your turn: plan the day', body: 'Drag a task from the bucket down onto the schedule to give it a time, or tap ⚡ to fit them all in.', phoneBody: 'Tap ⚡ to fit today’s tasks into your free time.', doneBody: 'Your day has a plan.',
    action: { start: () => timedCount(), done: (n) => timedCount() > n } },

  // Execute: Command Center
  { move: 2, route: '/', target: '.now-inst', icon: 'radar', title: 'Command Center: what now?', body: 'What to do right now, and how long is left.' },
  { move: 2, route: '/', target: '.todo-panel', icon: 'task_alt', title: 'Your turn: tick one off', body: 'Finished something today? Tick it. That’s the whole job.',
    action: { start: () => doneCount(), done: (n) => doneCount() > n } },
  { move: 2, route: '/', target: '.now-inst a[href="#/focus"]', icon: 'center_focus_strong', title: 'Focus mode', body: 'One tap hides everything else.' },

  { kind: 'finish', icon: 'celebration', title: 'You’re ready', body: 'Strategise, distribute, execute. Your plan is saved; the rest is demo data, so play freely.', next: 'Start planning' },
]
const MOVES = ['Strategise', 'Distribute', 'Execute']

function last(sel) { const all = document.querySelectorAll(sel); return all[all.length - 1] ?? null }
/** The backlog row to plan: the task made in the tour if it's there, else the first one. */
function firstBacklogRow() {
  const rows = [...document.querySelectorAll('.backlog .list .card, .backlog .trow')]
  const mine = newTaskId.value && state.todos.find((t) => t.id === newTaskId.value)
  return (mine && rows.find((r) => r.textContent.includes(mine.title))) ?? rows[0] ?? null
}
function firstBacklogId() {
  const el = firstBacklogRow()
  if (!el) return null
  // rows don't carry their id; match by title against the open backlog (longest title first, so no prefix clash)
  const text = el.textContent ?? ''
  return state.todos.filter((t) => !t.scheduled && !t.done && isLeaf(t) && text.includes(t.title)).sort((a, b) => b.title.length - a.title.length)[0]?.id ?? null
}

const router = useRouter()
const i = ref(0)
const step = computed(() => STEPS[i.value])
const body = computed(() => (isPhone() && step.value.phoneBody) || step.value.body)
const centreBox = () => ({ top: innerHeight / 2, left: innerWidth / 2, width: 0, height: 0 })
/* the spotlight's box in viewport px. On the centred cards it shrinks to a point mid-screen (its shadow still dims
   everything), so moving between any two stops is one continuous glide */
const rect = ref(centreBox())
const centred = ref(true) // welcome / finish, or a stop whose target isn't on screen
const ready = ref(false) // the card has its first position (hidden until then, so it never flashes elsewhere)
const cardEl = ref(null)
const cardPos = ref({})
const phone = ref(isPhone())
const canvas = ref(null)
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const done = ref(false) // the current "your turn" stop has been done
const hand = ref(null) // { left, top, dx }: the animated drag hint over a goal card
const missing = ref(false) // this stop's target isn't on screen (e.g. a phone without the sidebar)
const waiting = computed(() => !!step.value.action && !missing.value && !(phone.value && step.value.desktopOnly))
const baseline = shallowRef(null) // what the planner looked like when a "your turn" stop began

/* sparkles sit on the spotlight's edge; positions are fractions of its width/height */
const SPARKS = [[0, 0.2], [0.15, 0], [0.55, 0], [0.9, 0], [1, 0.35], [1, 0.8], [0.8, 1], [0.4, 1], [0.05, 1], [0, 0.65]]

const targetEls = () => { const t = step.value.target; const v = !t ? null : typeof t === 'function' ? t() : document.querySelector(t); return [].concat(v ?? []).filter(Boolean) }
const targetEl = () => targetEls()[0] ?? null

let poll = 0
let tick = 0
async function locate() {
  cancelAnimationFrame(poll)
  clearInterval(tick)
  hand.value = null
  done.value = false
  missing.value = false
  const s = step.value
  if (isPhone()) ui.backlogOnly = !!s.backlog
  else if (s.route === '/week') ui.backlogOnly = false
  if (s.route === '/week') ui.planMode = s.planMode ?? 'both' // ② Assign day shows the average line and Move out; the others need the schedule
  if (!s.target) return centre()
  const route = typeof s.route === 'function' ? s.route() : s.route
  if (route && router.currentRoute.value.path !== route) await router.push(route)
  const visible = (el) => el && el.getBoundingClientRect().height > 0
  if (s.optional && !visible(targetEl())) { missing.value = true; return centre() } // e.g. no sidebar on phones
  const t0 = performance.now()
  const find = () => {
    const el = targetEl()
    if (el && el.getBoundingClientRect().height > 0) {
      // small targets go mid-screen, clear of the phone's bottom card; big ones only as far as needed
      const small = el.getBoundingClientRect().height < innerHeight / 2
      el.scrollIntoView({ block: small && isPhone() ? 'center' : 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
      // start gliding now and keep following while the page scrolls or the layout changes
      if (s.action) baseline.value = s.action.start()
      measure()
      tick = setInterval(measure, 120)
    } else if (performance.now() - t0 < 2500) poll = requestAnimationFrame(find)
    else { missing.value = true; centre() } // the element never showed up: centred card with a Next button
  }
  find()
}
function centre() {
  centred.value = true
  rect.value = centreBox()
  place()
}
function measure() {
  const els = targetEls()
  if (!els.length) return
  centred.value = false
  const rs = els.map((e) => e.getBoundingClientRect())
  const r = { left: Math.min(...rs.map((q) => q.left)), top: Math.min(...rs.map((q) => q.top)), right: Math.max(...rs.map((q) => q.right)), bottom: Math.max(...rs.map((q) => q.bottom)) }
  r.width = r.right - r.left; r.height = r.bottom - r.top
  const pad = 8
  const vw = innerWidth, vh = innerHeight
  const top = Math.max(pad, r.top - pad), left = Math.max(pad, r.left - pad)
  const bottom = Math.min(vh - pad, r.bottom + pad), right = Math.min(vw - pad, r.right + pad)
  const next = { top, left, width: Math.max(40, right - left), height: Math.max(40, bottom - top) }
  hand.value = typeof step.value.hint === 'function' ? step.value.hint() : handAt(step.value.hint, r)
  const cur = rect.value
  if (cur && ['top', 'left', 'width', 'height'].every((k) => Math.abs(cur[k] - next[k]) < 1)) return
  rect.value = next
  place()
}
/**
 * Where to show the drag hint: the middle of the first movable goal card. An undated goal (in the "∞ / no end"
 * column) swings left until its end (the card's right edge) sits between today and that column; a dated one
 * swings toward the middle of the panel.
 */
function handAt(sel, panel) {
  const el = sel && document.querySelector(sel)
  if (!el) return null
  const c = el.getBoundingClientRect()
  if (c.bottom < 0 || c.top > innerHeight) return null
  const cx = c.left + c.width / 2
  const inf = document.querySelector('.flow-panel .inf')?.getBoundingClientRect()
  const today = document.querySelector('.flow-panel .today')?.getBoundingClientRect()
  let dx
  if (inf && today && c.left >= inf.left - 4) dx = Math.min(-60, (today.left + inf.left) / 2 - c.right)
  else { const mid = panel.left + panel.width / 2; dx = Math.abs(mid - cx) < 40 ? 90 : Math.sign(mid - cx) * Math.min(140, Math.abs(mid - cx)) }
  return { x: cx, y: c.top + c.height / 2, dx, dy: 0 }
}
/**
 * Put the card beside the spotlight where there's room (below, above, right, left), else over its lower part;
 * centred cards in the middle; phones as a sheet at the bottom. Always top/left/width in px, so the one card
 * glides between stops (CSS transitions) instead of jumping.
 */
async function place() {
  phone.value = isPhone()
  await nextTick()
  const c = cardEl.value
  if (!c) return
  const vw = innerWidth, vh = innerHeight
  const w = phone.value ? vw - (centred.value ? 32 : 24) : Math.min(vw - 24, centred.value ? 440 : 380)
  c.style.width = w + 'px' // so the height below is measured at the width it's about to have
  const h = c.scrollHeight, gap = 18, r = rect.value
  const clampX = (x) => Math.min(vw - w - 12, Math.max(12, x))
  const clampY = (y) => Math.min(vh - h - 12, Math.max(12, y))
  let p
  if (centred.value) p = { top: (vh - h) / 2, left: (vw - w) / 2 }
  else if (phone.value) p = { top: r.top + r.height / 2 > vh * 0.55 && r.top > h + 24 ? 12 : vh - h - 12, left: 12 } // a sheet at the bottom, or at the top when the spotlight is down there
  else if (r.top + r.height + gap + h < vh) p = { top: r.top + r.height + gap, left: clampX(r.left) }
  else if (r.top - gap - h > 0) p = { top: r.top - gap - h, left: clampX(r.left) }
  else if (r.left + r.width + gap + w < vw) p = { top: clampY(r.top + 24), left: r.left + r.width + gap }
  else if (r.left - gap - w > 0) p = { top: clampY(r.top + 24), left: r.left - gap - w }
  else p = { top: clampY(r.top + r.height - h - 24), left: clampX(r.left + (r.width - w) / 2) }
  cardPos.value = { top: p.top + 'px', left: p.left + 'px', width: w + 'px' }
  if (!ready.value) requestAnimationFrame(() => { ready.value = true })
}
/** Change the card's content and let its height follow smoothly (height: auto can't transition by itself). */
async function morph(change) {
  const c = cardEl.value
  const h0 = c?.offsetHeight
  await change()
  await nextTick()
  if (!c || reduced || !h0) return
  const h1 = c.scrollHeight
  if (Math.abs(h1 - h0) <= 1) return
  c.style.overflow = 'hidden' // only while it grows or shrinks; the badge's rays may poke out otherwise
  c.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => { c.style.overflow = '' }
}

/* "your turn": watch the planner for the action, then cheer and move on */
watch(() => step.value.action && baseline.value !== null && !done.value && step.value.action.done(baseline.value), (ok) => {
  if (!ok) return
  morph(() => { done.value = true })
  place()
  step.value.action.after?.()
  const r = rect.value
  burst(r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top + Math.min(r.height, 120) / 2 : innerHeight / 2, 60)
  setTimeout(() => { if (done.value) go(i.value + 1) }, reduced ? 600 : 1300)
})

async function go(n) {
  if (n < 0) return
  const then = step.value.then // a stop can send the user somewhere when they press Next instead of doing it
  if (n > i.value && then && !router.currentRoute.value.path.startsWith(then)) await router.push(then)
  if (n >= STEPS.length) return finish()
  baseline.value = null
  await morph(() => { i.value = n })
  place() // the new content's size, at the old spot until the next target is found
}
function finish() {
  close()
}
function skip() {
  close()
  toast('Take the tour anytime: Settings → Getting started')
}
const startMode = ui.planMode // Plan week's layout before the tour switched it around
function close() {
  ui.planMode = startMode
  state.tour = 'done'
  ui.tourOpen = false
  ui.selectedId = null
  if (isPhone()) ui.backlogOnly = false
}

/* confetti: a burst drawn on a canvas, gone after ~3s */
function burst(cx = innerWidth / 2, cy = innerHeight * 0.42, count = 160) {
  const cv = canvas.value
  if (!cv || reduced) return
  const dpr = devicePixelRatio || 1
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr
  const g = cv.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  const css = getComputedStyle(document.documentElement)
  const colors = ['--accent', '--info', '--warn', '--danger', '--cat-research', '--cat-academic'].map((v) => css.getPropertyValue(v).trim() || '#3fb68b')
  const power = count > 100 ? 9 : 6
  const bits = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * power
    return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, r: 3 + Math.random() * 5, c: colors[(Math.random() * colors.length) | 0], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, round: Math.random() < 0.3 }
  })
  const t0 = performance.now()
  const frame = (t) => {
    const k = (t - t0) / 3000
    g.clearRect(0, 0, innerWidth, innerHeight)
    if (k >= 1 || !ui.tourOpen) return
    g.globalAlpha = 1 - k * k
    for (const b of bits) {
      b.vy += 0.22; b.vx *= 0.985; b.x += b.vx; b.y += b.vy; b.rot += b.vr
      g.save(); g.translate(b.x, b.y); g.rotate(b.rot); g.fillStyle = b.c
      if (b.round) { g.beginPath(); g.arc(0, 0, b.r * 0.6, 0, 7); g.fill() } else g.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2)
      g.restore()
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

watch(i, async () => {
  await locate()
  if (step.value.kind === 'finish') { await nextTick(); burst() }
})

/* the tour owns the keyboard while it's open (no app shortcuts underneath), except on "your turn" stops */
function onKey(e) {
  if (waiting.value) { if (e.key === 'Escape' && !e.target.closest?.('input, textarea')) skip(); return }
  e.stopImmediatePropagation()
  if (e.key === 'Escape') { e.preventDefault(); skip() }
  else if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(i.value + 1) }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i.value - 1) }
}
const onResize = () => (centred.value ? centre() : measure())
onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', onResize)
  locate()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(poll)
  clearInterval(tick)
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', onResize)
})

const px = (n) => n + 'px'
const spotStyle = computed(() => ({ top: px(rect.value.top), left: px(rect.value.left), width: px(rect.value.width), height: px(rect.value.height) }))
/* four click-blockers around the spotlight; on info stops a fifth covers the spotlight too */
const blockers = computed(() => {
  const r = rect.value
  return [
    { top: 0, left: 0, right: 0, height: px(r.top) },
    { top: px(r.top + r.height), left: 0, right: 0, bottom: 0 },
    { top: px(r.top), left: 0, width: px(r.left), height: px(r.height) },
    { top: px(r.top), left: px(r.left + r.width), right: 0, height: px(r.height) },
    ...(waiting.value && !done.value ? [] : [spotStyle.value]),
  ]
})
</script>

<template>
  <div class="tour" role="dialog" aria-modal="true" :aria-label="step.title">
    <!-- the spotlight's shadow dims everything else; on the centred cards it's a point mid-screen -->
    <div v-for="(b, k) in blockers" :key="k" class="tour-block" :style="b"></div>
    <div class="tour-spot" :class="{ act: waiting && !done, centred }" :style="spotStyle">
      <span class="tour-ring"></span>
      <span v-for="(s, k) in SPARKS" :key="k" class="tour-spark" :style="{ left: s[0] * 100 + '%', top: s[1] * 100 + '%', animationDelay: k * 0.17 + 's' }">✦</span>
    </div>
    <div v-if="hand && waiting && !done" class="tour-hand" :style="{ left: hand.x + 'px', top: hand.y + 'px', '--dx': hand.dx + 'px', '--dy': hand.dy + 'px', '--w': Math.hypot(hand.dx, hand.dy) + 'px', '--ang': Math.atan2(hand.dy, hand.dx) + 'rad' }" aria-hidden="true">
      <span class="trail"></span><span class="icon">pan_tool_alt</span>
    </div>
    <canvas ref="canvas" class="tour-confetti"></canvas>

    <div ref="cardEl" class="tour-card" :class="[step.kind ?? 'move', { centred, act: waiting, ready }]" :style="cardPos">
      <div :key="i + (done ? '-ok' : '')" class="tour-in">
        <div class="tour-badge" :class="{ ok: done }"><span class="icon">{{ done ? 'check' : step.icon }}</span>
          <span v-if="centred || done" class="tour-burst" aria-hidden="true"><i v-for="k in 8" :key="k" :style="{ '--a': k * 45 + 'deg' }"></i></span>
        </div>
        <div class="tour-moves mono" aria-label="Progress">
          <span v-for="(m, k) in MOVES" :key="m" :class="{ on: step.move === k, past: step.kind === 'finish' || (step.move ?? -1) > k }">{{ k + 1 }} {{ m }}</span>
        </div>
        <h2 class="tour-title" :class="{ shimmer: centred || done }">{{ done ? 'Nice!' : step.title }}</h2>
        <p v-if="!done" class="tour-body">{{ body }}</p>
        <p v-else-if="step.doneBody" class="tour-body">{{ step.doneBody }}</p>
        <div v-if="waiting && !done" class="tour-wait mono small">waiting for you <i>✦</i></div>
        <div v-if="!done" class="tour-actions">
          <button v-if="step.kind !== 'finish'" class="btn ghost" @click="skip">Skip tour</button>
          <span class="spacer"></span>
          <button v-if="i > 0 && step.kind !== 'finish'" class="btn" @click="go(i - 1)">Back</button>
          <button v-if="waiting" class="btn ghost" title="Skip this step" @click="go(i + 1)">Skip step</button>
          <button v-else class="btn primary tour-next" @click="go(i + 1)">{{ step.next ?? 'Next' }}<span class="icon sm">{{ step.kind === 'finish' ? 'rocket_launch' : 'arrow_forward' }}</span></button>
        </div>
        <div v-if="step.move !== undefined" class="tour-count mono tiny muted">{{ i }} / {{ STEPS.length - 2 }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tour { position: fixed; inset: 0; z-index: 400; pointer-events: none; animation: tour-fade 0.35s ease; }
.tour-scrim, .tour-card, .tour-block { pointer-events: auto; }
.tour-block { position: absolute; }
.tour-scrim { position: absolute; inset: 0; background: var(--scrim); backdrop-filter: blur(2px); animation: tour-fade 0.3s ease; }
.tour-confetti { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

/* spotlight: the box-shadow dims everything outside it; the ring is a rotating gradient border */
.tour-spot {
  position: absolute; border-radius: 12px; pointer-events: none;
  box-shadow: 0 0 0 200vmax var(--scrim);
  transition: top 0.5s cubic-bezier(.2,.8,.2,1), left 0.5s cubic-bezier(.2,.8,.2,1), width 0.5s cubic-bezier(.2,.8,.2,1), height 0.5s cubic-bezier(.2,.8,.2,1), border-radius 0.5s;
}
/* shrunk to a point for the centred cards: ring and sparkles fade out */
.tour-ring, .tour-spark { transition: opacity 0.3s; }
.tour-spot.centred { border-radius: 50%; }
.tour-spot.centred .tour-ring, .tour-spot.centred .tour-spark { opacity: 0 !important; }
.tour-ring {
  position: absolute; inset: -3px; border-radius: 14px; padding: 3px;
  background: conic-gradient(from var(--tour-angle, 0deg), var(--accent), var(--info), var(--warn), var(--accent));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  animation: tour-spin 3s linear infinite;
  filter: drop-shadow(0 0 10px color-mix(in srgb, var(--accent) 70%, transparent));
}
@property --tour-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
@keyframes tour-spin { to { --tour-angle: 360deg; } }
.tour-spark {
  position: absolute; transform: translate(-50%, -50%); font-size: 16px; line-height: 1;
  color: var(--warn); text-shadow: 0 0 8px var(--warn);
  animation: tour-twinkle 1.7s ease-in-out infinite;
}
.tour-spark:nth-child(3n) { color: var(--info); text-shadow: 0 0 8px var(--info); font-size: 12px; }
.tour-spark:nth-child(3n + 1) { color: var(--accent); text-shadow: 0 0 8px var(--accent); }
@keyframes tour-twinkle {
  0%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(0.3) rotate(0deg); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.15) rotate(90deg); }
}

/* the card */
.tour-card {
  position: absolute; width: 380px; max-width: calc(100vw - 24px);
  background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 14px;
  padding: 20px 20px 16px; opacity: 0;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45), 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
  transition: top 0.5s cubic-bezier(.2,.8,.2,1), left 0.5s cubic-bezier(.2,.8,.2,1), width 0.5s cubic-bezier(.2,.8,.2,1), padding 0.5s, border-color 0.3s;
}
.tour-card:not(.ready) { transition: none; }
.tour-card.ready { opacity: 1; animation: tour-pop-in 0.45s cubic-bezier(.3,1.4,.5,1); }
@keyframes tour-pop-in { from { opacity: 0; scale: 0.88; } }
.tour-card.centred { padding-top: 26px; }
/* the content cross-fades in place while the card glides */
.tour-in { display: flex; flex-direction: column; gap: 10px; animation: tour-in 0.4s ease both; }
.tour-card.centred .tour-in { text-align: center; align-items: center; }
@keyframes tour-in { from { opacity: 0; transform: translateY(6px); } }
.tour-badge {
  position: relative; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center;
  background: linear-gradient(135deg, var(--accent), var(--info)); color: var(--on-accent);
  box-shadow: 0 0 20px color-mix(in srgb, var(--accent) 55%, transparent);
  animation: tour-bob 2.4s ease-in-out infinite;
}
.tour-card.centred .tour-badge { width: 64px; height: 64px; border-radius: 18px; }
.tour-card.centred .tour-badge .icon { font-size: 34px; }
@keyframes tour-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.tour-burst { position: absolute; inset: 0; pointer-events: none; }
.tour-burst i {
  position: absolute; left: 50%; top: 50%; width: 4px; height: 12px; margin: -6px 0 0 -2px; border-radius: 2px;
  background: var(--warn); transform: rotate(var(--a)) translateY(-46px); opacity: 0;
  animation: tour-ray 2.2s ease-out infinite;
}
.tour-burst i:nth-child(even) { background: var(--accent); animation-delay: 0.25s; }
@keyframes tour-ray {
  0% { opacity: 0; transform: rotate(var(--a)) translateY(-30px) scaleY(0.4); }
  25% { opacity: 1; }
  60%, 100% { opacity: 0; transform: rotate(var(--a)) translateY(-58px) scaleY(1); }
}
.tour-moves { display: flex; gap: 6px; flex-wrap: wrap; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.tour-card.centred .tour-moves { justify-content: center; }
.tour-moves span { padding: 3px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); transition: all 0.3s; }
.tour-moves span.past { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
.tour-moves span.on {
  color: var(--on-accent); border-color: transparent;
  background: linear-gradient(90deg, var(--accent), var(--info), var(--accent)); background-size: 200% 100%;
  animation: tour-sheen 2.5s linear infinite;
}
.tour-title { margin: 2px 0 0; font-size: 22px; line-height: 28px; font-weight: 600; }
.tour-title.shimmer {
  font-size: 26px; line-height: 32px;
  background: linear-gradient(90deg, var(--text) 20%, var(--accent) 40%, var(--info) 50%, var(--warn) 60%, var(--text) 80%);
  background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: tour-sheen 3.5s linear infinite;
}
@keyframes tour-sheen { from { background-position: 100% 0; } to { background-position: -150% 0; } }
.tour-body { margin: 0; font-size: 15px; line-height: 22px; color: var(--text); }
.tour-actions { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 4px; }
.tour-next { position: relative; overflow: hidden; }
.tour-next::after {
  content: ''; position: absolute; inset: 0; transform: translateX(-120%);
  background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.45) 50%, transparent 70%);
  animation: tour-glint 2.6s ease-in-out infinite 0.6s;
}
@keyframes tour-glint { 0% { transform: translateX(-120%); } 45%, 100% { transform: translateX(120%); } }

@keyframes tour-fade { from { opacity: 0; } }


/* "your turn": the spotlight pulses and the card waits */
.tour-spot.act .tour-ring { animation: tour-spin 1.6s linear infinite, tour-pulse 1.2s ease-in-out infinite; }
@keyframes tour-pulse { 50% { filter: drop-shadow(0 0 18px color-mix(in srgb, var(--warn) 80%, transparent)); } }
.tour-card.act { border-color: color-mix(in srgb, var(--warn) 55%, var(--border)); }
.tour-badge.ok { background: linear-gradient(135deg, var(--accent), var(--warn)); }
.tour-wait { color: var(--warn); white-space: nowrap; }
.tour-wait i { display: inline-block; font-style: normal; animation: tour-twinkle-i 1.2s ease-in-out infinite; }
@keyframes tour-twinkle-i { 50% { opacity: 0.2; transform: scale(0.6) rotate(45deg); } }
.tour-count { position: absolute; top: 12px; right: 14px; }

/* drag hint: a hand that grabs the card and swings it along the timeline, leaving a sparkly trail */
.tour-hand { position: absolute; pointer-events: none; z-index: 2; }
.tour-hand .icon {
  position: absolute; left: -14px; top: -6px; font-size: 30px; color: #fff;
  filter: drop-shadow(0 0 6px var(--warn)) drop-shadow(0 2px 3px rgba(0, 0, 0, 0.6));
  animation: tour-drag 2.4s cubic-bezier(.5,0,.3,1) infinite;
}
.tour-hand .trail {
  position: absolute; top: 0; left: 0; height: 3px; width: var(--w); border-radius: 3px;
  transform-origin: 0 50%; rotate: var(--ang); background: linear-gradient(90deg, transparent, var(--warn), var(--accent));
  animation: tour-trail 2.4s cubic-bezier(.5,0,.3,1) infinite;
}
@keyframes tour-drag {
  0% { transform: translate(0, 0) scale(1); opacity: 0; }
  12% { opacity: 1; transform: translate(0, 0) scale(1); }
  22% { transform: translate(0, 0) scale(0.85); }
  70% { transform: translate(var(--dx), var(--dy)) scale(0.85); opacity: 1; }
  80% { transform: translate(var(--dx), var(--dy)) scale(1); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(1); opacity: 0; }
}
@keyframes tour-trail {
  0%, 22% { transform: scaleX(0); opacity: 0; }
  30% { opacity: 0.9; }
  70% { transform: scaleX(1); opacity: 0.9; }
  100% { transform: scaleX(1); opacity: 0; }
}

@media (max-width: 640px) {
  .tour-title { font-size: 19px; line-height: 25px; }
  .tour-title.shimmer { font-size: 22px; line-height: 28px; }
  .tour-body { font-size: 14px; line-height: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .tour-ring, .tour-spark, .tour-badge, .tour-burst i, .tour-spot.act .tour-ring, .tour-wait i, .tour-moves span.on, .tour-title.shimmer, .tour-next::after { animation: none; }
  .tour-spark, .tour-burst, .tour-hand .trail { display: none; }
  .tour-hand .icon { animation: none; }
  .tour-spot, .tour-card { transition: none; }
  .tour-in, .tour-card.ready, .tour { animation: none; }
}
</style>
