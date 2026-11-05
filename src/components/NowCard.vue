<script setup>
// Cockpit NOW instrument for S-01: what to do this minute, with what's next as a one-line hint.
import { ui, toggleTodo, toast } from '../store'
import { useNow, fmtDur, fmtClock } from '../now'
import Prio from './Prio.vue'

const n = useNow()
const { current, next, progress, untilNext, gap, suggestion, suggestionFits, missedAt } = n
function start(t) {
  n.startNow(t)
  toast(`Started ${t.id} now`)
}
</script>

<template>
  <!-- NOW -->
  <section class="panel inst now-inst" :class="current ? 'busy cat-' + current.category : 'free'">
    <div class="inst-lbl">
      <span v-if="current" class="tag mono"><span class="pulse"></span>NOW</span>
      <span v-else class="tag mono free-tag">FREE</span>
      <span class="mono small muted">{{ current ? `${current.start}–${current.end}` : `${fmtDur(gap)} until ${next ? next.start : 'end of day'}` }}</span>
    </div>

    <template v-if="current">
      <div class="title clamp2">{{ current.title }}</div>
      <div class="bar big-bar"><i :style="{ width: progress.pct + '%' }"></i></div>
      <div class="row readout">
        <span class="inst-big mono">{{ fmtClock(progress.remaining) }}</span><span class="muted small">left</span>
        <span class="spacer"></span>
        <button v-if="current.kind === 'todo'" class="btn primary" @click="toggleTodo(current.todoId)"><span class="icon sm">check</span>Done <span class="kbd">X</span></button>
        <router-link to="/focus" class="btn"><span class="icon sm">center_focus_strong</span>Focus <span class="kbd">F</span></router-link>
      </div>
      <button v-if="suggestion" class="do" title="Open this todo" @click="ui.drawerId = suggestion.id">
        <span class="tiny upper muted">Work on</span><Prio :p="suggestion.priority" />
        <span class="ellipsis grow">{{ suggestion.title }}</span><span class="mono small muted">{{ suggestion.timeMin }}m</span>
      </button>
    </template>

    <template v-else-if="suggestion">
      <div class="title clamp2">{{ suggestion.title }}</div>
      <div class="row readout">
        <Prio :p="suggestion.priority" />
        <span class="mono small" :class="suggestionFits ? 'ok' : 'warn'">{{ suggestion.timeMin }}m{{ suggestionFits ? '' : ' · longer than the gap' }}</span>
        <span v-if="missedAt" class="mono small danger">missed {{ missedAt }}</span>
        <span class="spacer"></span>
        <button class="btn primary" @click="start(suggestion)"><span class="icon sm">play_arrow</span>Start now</button>
        <router-link to="/focus" class="btn"><span class="icon sm">center_focus_strong</span>Focus <span class="kbd">F</span></router-link>
      </div>
    </template>
    <div v-else class="title muted">Nothing queued. Press <span class="kbd">N</span> to add a todo.</div>

    <!-- what's next: a hint, not an instrument -->
    <div class="next-hint mono small muted">
      <template v-if="next">Next <b>{{ next.start }}</b> {{ next.title }} · in {{ fmtDur(untilNext) }}</template>
      <template v-else>Nothing else on the timeline today</template>
    </div>
  </section>

</template>

<style scoped>
.now-inst { border-left: 3px solid var(--accent); }
.now-inst.busy { border-left-color: var(--c); background: color-mix(in srgb, var(--c) 5%, var(--surface)); }
.now-inst.free { border-left-color: var(--muted); }
.tag { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 2px; background: var(--stamp); color: #fff; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; }
.free-tag { background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); }
.pulse { width: 6px; height: 6px; border-radius: 50%; background: #fff; animation: pulse 1.6s infinite; }
@keyframes pulse { 50% { opacity: 0.2; } }
.title { font: 600 24px/30px Inter, sans-serif; letter-spacing: -0.01em; }
.big-bar { height: 6px; }
.busy .big-bar > i { background: var(--c); }
.readout { gap: 8px; flex-wrap: wrap; }
.readout .btn { color: inherit; }
.readout .btn.primary { color: var(--on-accent); }
.do { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; background: var(--surface); color: var(--text); font: inherit; text-align: left; cursor: pointer; min-width: 0; }
.do:hover { border-color: var(--accent); }
.next-hint { margin-top: auto; padding-top: 8px; border-top: 1px solid var(--border); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.next-hint b { color: var(--text); font-weight: 600; }
</style>
