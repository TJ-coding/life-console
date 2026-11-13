<script setup>
// S-01 Focus mode — one thing at a glance: the current block, the next one, top 3 actions.
import { computed, watchEffect, onBeforeUnmount } from 'vue'
import { state, ui, wd, workload, getStamps, CAPACITY_H, toggleTodo, toast } from '../store'
import { useNow, fmtDur, fmtClock, toggleClockMode } from '../now'
import Stamps from '../components/Stamps.vue'
import Prio from '../components/Prio.vue'
import Chip from '../components/Chip.vue'
import PomoBar from '../components/PomoBar.vue'

const n = useNow()
const { T, current, next, progress, pomoPhase, readout, untilNext, gap, queue, suggestion, suggestionFits, missedAt } = n
const clock = computed(() => fmtClock(n.nowSec.value).padStart(8, '0'))
const top3 = computed(() => queue.value.slice(0, 3))
watchEffect(() => { ui.focusIds = top3.value.map((t) => t.id) })
onBeforeUnmount(() => { ui.focusIds = [] })

const hours = computed(() => workload(T.value))
const stamped = computed(() => getStamps(T.value).filter(Boolean).length)
const mg = computed(() => (state.caffeine[T.value] ?? []).reduce((s, c) => s + c.mg, 0))
function start(t) { n.startNow(t); toast(`Started ${t.id} now`) }
</script>

<template>
  <div class="focus">
    <header class="fhead">
      <div>
        <div class="row"><span class="chip goal">● FOCUS</span></div>
        <div class="date mono">{{ T }} {{ wd(T) }}</div>
      </div>
      <div class="clock mono">{{ clock }}</div>
    </header>

    <!-- the one thing -->
    <section v-if="current" class="hero panel" :class="'cat-' + current.category">
      <div class="row">
        <span class="tag mono"><span class="pulse"></span>NOW</span>
        <span class="mono muted">WINDOW {{ current.start }} – {{ current.end }}</span>
        <Chip v-if="current.link" :id="current.link" />
        <span class="spacer"></span>
        <button v-if="current.kind === 'todo'" class="btn primary" @click="toggleTodo(current.todoId)"><span class="icon sm">check</span>Done <span class="kbd">X</span></button>
      </div>
      <h1>{{ current.title }}</h1>
      <!-- ISS-25: one countdown; in a pomodoro sitting, click it to switch between the break and the whole block -->
      <button v-if="pomoPhase" class="countdown mono toggle" :class="pomoPhase.phase" :title="readout.title" @click="toggleClockMode">{{ fmtClock(readout.sec) }}<span class="muted pomo-n">POMODORO {{ pomoPhase.n }}/{{ pomoPhase.of }}<template v-if="pomoPhase.phase === 'break'"> · BREAK</template></span></button>
      <div v-else class="countdown mono">{{ fmtClock(readout.sec) }} <span class="muted">{{ readout.label }}</span></div>
      <button v-if="current.pomo" class="bar-toggle" :title="readout?.title" @click="toggleClockMode"><PomoBar :segs="current.pomo" :elapsed="progress.elapsed" :outline="readout?.piece" /></button>
      <div v-else class="bar big"><i :style="{ width: progress.pct + '%' }"></i></div>
      <div class="row mono small muted"><span>START {{ current.start }}</span><span class="spacer"></span><span>elapsed {{ fmtDur(progress.elapsed) }} / {{ fmtDur(progress.total) }}</span><span class="spacer"></span><span>END {{ current.end }}</span></div>
      <div v-if="suggestion" class="do">
        <span class="tiny upper muted">Work on</span> <Prio :p="suggestion.priority" /> {{ suggestion.title }} <span class="mono muted">{{ suggestion.timeMin }}m</span>
      </div>
    </section>

    <section v-else class="hero panel free">
      <div class="row"><span class="tag mono free-tag">FREE</span><span class="mono muted">{{ fmtDur(gap) }} until {{ next ? next.start : 'end of day' }}</span></div>
      <template v-if="suggestion">
        <div class="tiny upper muted">Do this now</div>
        <h1>{{ suggestion.title }}</h1>
        <div class="row">
          <Prio :p="suggestion.priority" />
          <span class="mono" :class="suggestionFits ? 'ok' : 'warn'">{{ suggestion.timeMin }}m {{ suggestionFits ? '· fits the gap' : '· longer than the gap' }}</span>
          <span v-if="missedAt" class="mono danger">missed {{ missedAt }}</span>
          <span v-if="suggestion.vital" class="muted">{{ suggestion.vital }}</span>
          <span class="spacer"></span>
          <button class="btn primary" @click="start(suggestion)"><span class="icon sm">play_arrow</span>Start now</button>
        </div>
      </template>
      <h1 v-else class="muted">Nothing queued.</h1>
    </section>

    <div class="next-line mono">
      <span class="tiny upper muted">Up next</span>
      <template v-if="next"><span class="warn">{{ next.start }}</span> {{ next.title }} <span class="muted">· in {{ fmtDur(untilNext) }}</span></template>
      <span v-else class="muted">no more blocks today</span>
    </div>

    <section class="queue">
      <div class="row qh"><span class="icon sm">checklist</span><span class="mono upper small">Top 3 actions</span><span class="spacer"></span><span class="mono tiny muted">KEYS 1–3 CHECK</span></div>
      <div v-for="(t, i) in top3" :key="t.id" class="qrow panel">
        <span class="kbd">{{ i + 1 }}</span>
        <input type="checkbox" :checked="t.done" @change="toggleTodo(t.id)" />
        <Prio :p="t.priority" />
        <div class="grow">
          <div>{{ t.title }}</div>
          <div class="mono tiny muted">{{ t.id }}<template v-if="t.scheduled?.start"> · {{ t.scheduled.start }}</template><template v-if="t.vital"> · {{ t.vital }}</template></div>
        </div>
        <span class="mono small muted">{{ t.timeMin }}m</span>
      </div>
      <div v-if="!top3.length" class="empty">All of today's todos are done ✓</div>
    </section>

    <section class="tiles">
      <div class="panel tile">
        <div class="row tiny upper muted">Workload<span class="spacer"></span><span class="mono">{{ hours.toFixed(1) }} / {{ CAPACITY_H }}h</span></div>
        <div class="bar" :class="hours > CAPACITY_H ? 'warn' : ''"><i :style="{ width: Math.min(100, (hours / CAPACITY_H) * 100) + '%' }"></i></div>
      </div>
      <div class="panel tile center">
        <div class="row tiny upper muted">Sign-off<span class="spacer"></span><span class="mono" style="color: var(--stamp)">{{ stamped }}/4</span></div>
        <Stamps :date="T" :size="30" />
      </div>
      <div class="panel tile">
        <div class="row tiny upper muted">Caffeine<span class="spacer"></span><span class="mono">{{ mg }} / {{ state.caffeineLimit }} mg</span></div>
        <div class="bar warn"><i :style="{ width: Math.min(100, (mg / state.caffeineLimit) * 100) + '%' }"></i></div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* the pomodoro bar switches the clock too (ISS-25) */
.bar-toggle { display: block; width: 100%; border: 0; padding: 4px 0; margin: -4px 0; background: transparent; cursor: pointer; }
.focus { max-width: 1040px; margin: 0 auto; padding: 32px 24px 48px; display: flex; flex-direction: column; gap: 22px; }
.fhead { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 18px; }
.date { font-size: 34px; line-height: 42px; font-weight: 700; margin-top: 8px; }
.clock { font-size: 28px; font-weight: 600; color: var(--muted); }
.countdown.toggle { border: 0; padding: 0; background: transparent; font: inherit; font-size: 44px; line-height: 48px; font-weight: 700; color: var(--text); text-align: left; cursor: pointer; }
.countdown.toggle.break { color: var(--accent); }
.pomo-n { margin-left: 14px; font-size: 16px; font-weight: 500; }

.hero { padding: 26px 30px; gap: 14px; border-left: 4px solid var(--c, var(--accent)); }
.hero.free { border-left-color: var(--muted); }
.hero h1 { margin: 0; font: 700 32px/40px 'JetBrains Mono', monospace; letter-spacing: -0.02em; }
.countdown { font-size: 44px; line-height: 48px; font-weight: 700; color: var(--text); }
.countdown .muted { font-size: 16px; font-weight: 500; }
.bar.big { height: 8px; }
.hero .bar.big > i { background: var(--c); }
.tag { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 2px; background: var(--stamp); color: #fff; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; }
.free-tag { background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); }
.pulse { width: 7px; height: 7px; border-radius: 50%; background: #fff; animation: pulse 1.6s infinite; }
@keyframes pulse { 50% { opacity: 0.2; } }
.do { border-top: 1px solid var(--border); padding-top: 12px; display: flex; align-items: center; gap: 8px; }
.next-line { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.queue { display: flex; flex-direction: column; gap: 6px; }
.qh { padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.qrow { flex-direction: row; align-items: center; gap: 12px; padding: 12px 16px; font-size: 14px; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.tile { padding: 14px 16px; gap: 12px; }
.tile.center { align-items: stretch; }
.tile.center :deep(.stamps) { justify-content: center; }
@media (max-width: 760px) { .tiles { grid-template-columns: 1fr; } .hero h1 { font-size: 24px; line-height: 30px; } .countdown, .countdown.toggle { font-size: 32px; line-height: 38px; } }
</style>
