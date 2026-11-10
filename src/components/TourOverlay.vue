<script setup>
/*
 * First-run tour: Strategise → Distribute → Execute, in five short stops (welcome, one per move, finish).
 * Starts by itself for a new account (the demo seed sets state.tour = 'pending'); Settings → Getting started
 * replays it (ui.tourOpen). Each stop opens its screen and spotlights one element; the rest of the app is dimmed
 * and can't be clicked until the tour ends. Sparkles and confetti are decoration only and stop under
 * prefers-reduced-motion.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { state, ui } from '../store'

const STEPS = [
  { kind: 'welcome', icon: 'auto_awesome', title: 'Welcome to Life Console', body: 'Three moves turn a goal into what you do next. Here they are in 30 seconds, using a small demo planner.', next: 'Show me' },
  { move: 0, route: '/strategy/SP-01', target: '.tree', icon: 'target', title: 'Strategise: start from a goal', body: 'A plan breaks a goal into milestones. The demo is training for a half marathon: Sign up, Build the base, then the Long run.' },
  { move: 1, route: '/week', target: '.backlog', icon: 'calendar_month', title: 'Distribute: give tasks a day', body: 'Tasks wait in the backlog until you give them a day. Each day has a 7-hour budget, so you can see when it’s too full.' },
  { move: 2, route: '/', target: '.now-inst', icon: 'radar', title: 'Execute: do what’s on top', body: 'The NOW card shows what to do right now and how long is left. Focus opens it full screen.' },
  { kind: 'finish', icon: 'celebration', title: 'You’re ready', body: 'Everything here is demo data, so change anything you like. You can replay this tour from Settings.', next: 'Start planning' },
]
const MOVES = ['Strategise', 'Distribute', 'Execute']

const router = useRouter()
const i = ref(0)
const step = computed(() => STEPS[i.value])
const rect = ref(null) // spotlight box in viewport px, or null for the centred cards
const cardEl = ref(null)
const cardPos = ref({})
const phone = ref(false)
const canvas = ref(null)
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/* sparkles sit on the spotlight's edge; positions are fractions of its width/height */
const SPARKS = [[0, 0.2], [0.15, 0], [0.55, 0], [0.9, 0], [1, 0.35], [1, 0.8], [0.8, 1], [0.4, 1], [0.05, 1], [0, 0.65]]

let poll = 0
async function locate() {
  cancelAnimationFrame(poll)
  rect.value = null
  const s = step.value
  // phones show Plan week's backlog behind a Days | Backlog switch: open it for the Distribute stop, close it after
  if (innerWidth <= 640) ui.backlogOnly = s.move === 1
  if (!s.target) return place()
  if (router.currentRoute.value.path !== s.route) await router.push(s.route)
  const t0 = performance.now()
  const find = () => {
    const el = document.querySelector(s.target)
    if (el && el.getBoundingClientRect().height > 0) {
      el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
      setTimeout(measure, reduced ? 0 : 350)
    } else if (performance.now() - t0 < 2500) poll = requestAnimationFrame(find)
    else place() // the element never showed up: still show the card, centred
  }
  find()
}
function measure() {
  const el = step.value.target && document.querySelector(step.value.target)
  if (!el) { rect.value = null; return place() }
  const r = el.getBoundingClientRect()
  const pad = 8
  const vw = innerWidth, vh = innerHeight
  const top = Math.max(pad, r.top - pad), left = Math.max(pad, r.left - pad)
  const bottom = Math.min(vh - pad, r.bottom + pad), right = Math.min(vw - pad, r.right + pad)
  rect.value = { top, left, width: right - left, height: Math.max(40, bottom - top) }
  place()
}
/** Put the card beside the spotlight where there's room (below, above, right, left), else over its lower part. */
async function place() {
  phone.value = innerWidth <= 640
  await nextTick()
  const c = cardEl.value
  if (!c) return
  const r = rect.value
  if (!r || phone.value) { cardPos.value = {}; return }
  const w = c.offsetWidth, h = c.offsetHeight, gap = 18, vw = innerWidth, vh = innerHeight
  const clampX = (x) => Math.min(vw - w - 12, Math.max(12, x))
  const clampY = (y) => Math.min(vh - h - 12, Math.max(12, y))
  let p
  if (r.top + r.height + gap + h < vh) p = { top: r.top + r.height + gap, left: clampX(r.left) }
  else if (r.top - gap - h > 0) p = { top: r.top - gap - h, left: clampX(r.left) }
  else if (r.left + r.width + gap + w < vw) p = { top: clampY(r.top + 24), left: r.left + r.width + gap }
  else if (r.left - gap - w > 0) p = { top: clampY(r.top + 24), left: r.left - gap - w }
  else p = { top: clampY(r.top + r.height - h - 24), left: clampX(r.left + (r.width - w) / 2) }
  cardPos.value = { top: p.top + 'px', left: p.left + 'px' }
}

function go(n) {
  if (n < 0) return
  if (n >= STEPS.length) return finish()
  i.value = n
}
function finish() {
  state.tour = 'done'
  ui.tourOpen = false
}
function skip() {
  state.tour = 'done'
  ui.tourOpen = false
}

/* confetti: one burst on the finish card, drawn on a canvas, gone after ~3s */
function confetti() {
  const cv = canvas.value
  if (!cv || reduced) return
  const dpr = devicePixelRatio || 1
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr
  const g = cv.getContext('2d')
  g.scale(dpr, dpr)
  const css = getComputedStyle(document.documentElement)
  const colors = ['--accent', '--info', '--warn', '--danger', '--cat-research', '--cat-academic'].map((v) => css.getPropertyValue(v).trim() || '#3fb68b')
  const cx = innerWidth / 2, cy = innerHeight * 0.42
  const bits = Array.from({ length: 160 }, () => {
    const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 9
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
  if (step.value.kind === 'finish') { await nextTick(); confetti() }
})

/* the tour owns the keyboard while it's open: no app shortcuts underneath it */
function onKey(e) {
  e.stopImmediatePropagation()
  if (e.key === 'Escape') { e.preventDefault(); skip() }
  else if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(i.value + 1) }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i.value - 1) }
}
const onResize = () => (rect.value ? measure() : place())
onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', onResize)
  locate()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(poll)
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', onResize)
})

const spotStyle = computed(() => rect.value && ({ top: rect.value.top + 'px', left: rect.value.left + 'px', width: rect.value.width + 'px', height: rect.value.height + 'px' }))
</script>

<template>
  <div class="tour" role="dialog" aria-modal="true" :aria-label="step.title">
    <!-- dimmer: a full scrim for the centred cards, or the spotlight's own shadow -->
    <div v-if="!rect" class="tour-scrim"></div>
    <div v-else class="tour-spot" :style="spotStyle">
      <span class="tour-ring"></span>
      <span v-for="(s, k) in SPARKS" :key="k" class="tour-spark" :style="{ left: s[0] * 100 + '%', top: s[1] * 100 + '%', animationDelay: k * 0.17 + 's' }">✦</span>
    </div>
    <canvas ref="canvas" class="tour-confetti"></canvas>

    <transition name="tour-pop" mode="out-in">
      <div :key="i" ref="cardEl" class="tour-card" :class="[step.kind ?? 'move', { centred: !rect, sheet: phone && rect }]" :style="rect && !phone ? cardPos : null">
        <div class="tour-badge"><span class="icon">{{ step.icon }}</span>
          <span v-if="!rect" class="tour-burst" aria-hidden="true"><i v-for="k in 8" :key="k" :style="{ '--a': k * 45 + 'deg' }"></i></span>
        </div>
        <div class="tour-moves mono" aria-label="Progress">
          <span v-for="(m, k) in MOVES" :key="m" :class="{ on: step.move === k, past: step.kind === 'finish' || (step.move ?? -1) > k }">{{ k + 1 }} {{ m }}</span>
        </div>
        <h2 class="tour-title" :class="{ shimmer: !rect }">{{ step.title }}</h2>
        <p class="tour-body">{{ step.body }}</p>
        <div class="tour-actions">
          <button v-if="step.kind !== 'finish'" class="btn ghost" @click="skip">Skip tour</button>
          <span class="spacer"></span>
          <button v-if="i > 0 && step.kind !== 'finish'" class="btn" @click="go(i - 1)">Back</button>
          <button class="btn primary tour-next" @click="go(i + 1)">{{ step.next ?? 'Next' }}<span class="icon sm">{{ step.kind === 'finish' ? 'rocket_launch' : 'arrow_forward' }}</span></button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.tour { position: fixed; inset: 0; z-index: 400; }
.tour-scrim { position: absolute; inset: 0; background: var(--scrim); backdrop-filter: blur(2px); animation: tour-fade 0.3s ease; }
.tour-confetti { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

/* spotlight: the box-shadow dims everything outside it; the ring is a rotating gradient border */
.tour-spot {
  position: absolute; border-radius: 12px; pointer-events: none;
  box-shadow: 0 0 0 200vmax var(--scrim);
  transition: top 0.45s cubic-bezier(.2,.8,.2,1), left 0.45s cubic-bezier(.2,.8,.2,1), width 0.45s cubic-bezier(.2,.8,.2,1), height 0.45s cubic-bezier(.2,.8,.2,1);
}
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
  padding: 20px 20px 16px; display: flex; flex-direction: column; gap: 10px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45), 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
  transition: top 0.4s cubic-bezier(.2,.8,.2,1), left 0.4s cubic-bezier(.2,.8,.2,1);
}
.tour-card.centred { top: 50%; left: 50%; transform: translate(-50%, -50%); width: 440px; text-align: center; align-items: center; padding-top: 26px; }
.tour-card.sheet { top: auto; left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom)); width: auto; max-width: none; }
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

.tour-pop-enter-active { transition: opacity 0.3s, scale 0.35s cubic-bezier(.3,1.5,.5,1); }
.tour-pop-leave-active { transition: opacity 0.15s, scale 0.15s; }
.tour-pop-enter-from { opacity: 0; scale: 0.85; }
.tour-pop-leave-to { opacity: 0; scale: 0.95; }
@keyframes tour-fade { from { opacity: 0; } }

@media (max-width: 640px) {
  .tour-card.centred { width: calc(100vw - 32px); }
  .tour-title { font-size: 19px; line-height: 25px; }
  .tour-title.shimmer { font-size: 22px; line-height: 28px; }
  .tour-body { font-size: 14px; line-height: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .tour-ring, .tour-spark, .tour-badge, .tour-burst i, .tour-moves span.on, .tour-title.shimmer, .tour-next::after { animation: none; }
  .tour-spark, .tour-burst { display: none; }
  .tour-spot, .tour-card { transition: none; }
}
</style>
