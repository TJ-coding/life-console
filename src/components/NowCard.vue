<script setup>
// "Right now" briefing card: current block + countdown, what to do, what's next.
import { ui, toggleTodo, toast } from '../store'
import { useNow, fmtDur, fmtClock } from '../now'
import Chip from './Chip.vue'
import Prio from './Prio.vue'

const n = useNow()
const { current, overlapping, next, progress, untilNext, gap, suggestion, suggestionFits, missedAt } = n
function start(t) {
  n.startNow(t)
  toast(`Started ${t.id} now`)
}
</script>

<template>
  <section class="now-card panel" :class="current ? 'busy cat-' + current.category : 'free'">
    <div class="main">
      <!-- in a block -->
      <template v-if="current">
        <div class="row tag-row">
          <span class="tag mono"><span class="pulse"></span>NOW</span>
          <span class="mono small muted">{{ current.start }} – {{ current.end }}</span>
          <Chip v-if="current.link" :id="current.link" />
          <span v-if="current.kind === 'todo'" class="mono tiny muted">TODO {{ current.todoId }}</span>
        </div>
        <div class="title">{{ current.title }}</div>
        <div class="bar big-bar"><i :style="{ width: progress.pct + '%' }"></i></div>
        <div class="row mono small">
          <span class="muted">elapsed {{ fmtDur(progress.elapsed) }}</span>
          <span class="spacer"></span>
          <span class="left">{{ fmtClock(progress.remaining) }}</span><span class="muted">left</span>
        </div>
        <div v-if="suggestion" class="do row">
          <span class="tiny upper muted">Work on</span>
          <Prio :p="suggestion.priority" />
          <span class="ellipsis grow">{{ suggestion.title }}</span>
          <span class="mono small muted">{{ suggestion.timeMin }}m</span>
          <button class="btn sm" @click="ui.drawerId = suggestion.id">Open</button>
        </div>
        <div v-if="overlapping.length" class="small muted">Also running: {{ overlapping.map((b) => b.title).join(' · ') }}</div>
      </template>

      <!-- free time -->
      <template v-else>
        <div class="row tag-row">
          <span class="tag mono free-tag">FREE</span>
          <span class="mono small muted">{{ fmtDur(gap) }} until {{ next ? next.start : 'end of day' }}</span>
        </div>
        <template v-if="suggestion">
          <div class="tiny upper muted">Do this now</div>
          <div class="title">{{ suggestion.title }}</div>
          <div class="row small">
            <Prio :p="suggestion.priority" />
            <span class="mono" :class="suggestionFits ? 'ok' : 'warn'">{{ suggestion.timeMin }}m {{ suggestionFits ? '· fits' : '· longer than the gap' }}</span>
            <span v-if="missedAt" class="mono danger">missed {{ missedAt }}</span>
            <span v-if="suggestion.vital" class="muted ellipsis">{{ suggestion.vital }}</span>
            <Chip v-for="l in suggestion.links" :key="l" :id="l" />
          </div>
        </template>
        <div v-else class="title muted">Nothing queued — press <span class="kbd">N</span> to add a todo.</div>
      </template>
    </div>

    <div class="side">
      <div class="actions">
        <button v-if="current?.kind === 'todo'" class="btn primary" @click="toggleTodo(current.todoId)"><span class="icon sm">check</span>Done <span class="kbd">X</span></button>
        <button v-if="!current && suggestion" class="btn primary" @click="start(suggestion)"><span class="icon sm">play_arrow</span>Start now</button>
        <router-link to="/focus" class="btn"><span class="icon sm">center_focus_strong</span>Focus <span class="kbd">F</span></router-link>
      </div>
      <div class="next">
        <div class="tiny upper muted">Up next</div>
        <template v-if="next">
          <div class="row"><span class="mono warn">{{ next.start }}</span><span class="ellipsis">{{ next.title }}</span></div>
          <div class="mono small muted">in {{ fmtDur(untilNext) }}</div>
        </template>
        <div v-else class="small muted">No more blocks today</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.now-card { flex-direction: row; gap: 20px; padding: 16px 18px; border-left: 3px solid var(--accent); }
.now-card.busy { border-left-color: var(--c); background: color-mix(in srgb, var(--c) 5%, var(--surface)); }
.now-card.free { border-left-color: var(--muted); }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.tag-row { gap: 10px; }
.main > .row { flex-wrap: wrap; row-gap: 4px; }
.main > .row > * { flex: none; }
.main > .row > .ellipsis { flex: 1 1 140px; }
.tag { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 2px; background: var(--stamp); color: #fff; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; }
.free-tag { background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); }
.pulse { width: 6px; height: 6px; border-radius: 50%; background: #fff; animation: pulse 1.6s infinite; }
@keyframes pulse { 50% { opacity: 0.2; } }
.title { font: 600 22px/28px Inter, sans-serif; letter-spacing: -0.01em; }
.big-bar { height: 6px; }
.busy .big-bar > i { background: var(--c); }
.left { font-size: 16px; font-weight: 700; margin-right: 4px; }
.do { border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; background: var(--surface); }
.side { width: 240px; flex: none; display: flex; flex-direction: column; gap: 12px; border-left: 1px solid var(--border); padding-left: 16px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.actions .btn { color: inherit; }
.actions .btn.primary { color: var(--on-accent); }
.next { display: flex; flex-direction: column; gap: 4px; }
@media (max-width: 800px) { .now-card { flex-direction: column; } .side { width: auto; border-left: 0; padding-left: 0; } }
</style>
