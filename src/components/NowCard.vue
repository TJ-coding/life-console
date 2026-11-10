<script setup>
// Cockpit NOW instrument for S-01 (full width): what to do this minute on the left, the countdown and
// actions on the right, progress across, and what's next as one line at the bottom.
// Between blocks the headline is the free time itself ("You're free for 1h 25m"); the task you could
// pick up sits in its own UP NEXT box with Start now, so it never reads as something already running.
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
  <section class="panel inst now-inst" :class="current ? 'busy cat-' + current.category : 'free'">
    <div class="now-grid">
      <div class="what">
        <div class="inst-lbl">
          <span v-if="current" class="tag mono"><span class="pulse"></span>NOW</span>
          <span v-else class="tag mono free-tag">FREE</span>
          <span v-if="current" class="mono muted range">{{ current.start }}–{{ current.end }}</span>
          <span v-else class="muted range ellipsis">until <b class="mono until">{{ next ? next.start : 'end of day' }}</b><template v-if="next"> · {{ next.title }}</template></span>
        </div>
        <template v-if="current">
          <div class="title clamp2">{{ current.title }}</div>
          <button v-if="suggestion" class="do" title="Open this todo" @click="ui.drawerId = suggestion.id">
            <span class="tiny upper muted">Work on</span><Prio :p="suggestion.priority" />
            <span class="ellipsis grow">{{ suggestion.title }}</span><span class="mono small muted">{{ suggestion.timeMin }}m</span>
          </button>
        </template>
        <template v-else>
          <div class="title">{{ next ? `You're free for ${fmtDur(gap)}` : `You're free for the rest of the day` }}</div>
        </template>
      </div>

      <div class="clock">
        <div v-if="current" class="readout"><span class="inst-big mono">{{ fmtClock(progress.remaining) }}</span><span class="muted">left</span></div>
        <div v-else class="readout"><span class="inst-big mono muted">{{ fmtClock(gap) }}</span><span class="muted">free</span></div>
        <div class="actions">
          <button v-if="current?.kind === 'todo'" class="btn primary" @click="toggleTodo(current.todoId)"><span class="icon sm">check</span>Done <span class="kbd">X</span></button>
          <router-link to="/focus" class="btn"><span class="icon sm">center_focus_strong</span>Focus <span class="kbd">F</span></router-link>
        </div>
      </div>
    </div>

    <div v-if="current" class="bar big-bar"><i :style="{ width: progress.pct + '%' }"></i></div>

    <!-- free: the todo you could start, as the bottom line (the next block is already in the label row) -->
    <div v-if="!current" class="next-row upnext">
      <span class="tiny upper muted">Up next</span>
      <template v-if="suggestion">
        <button class="un-open" title="Open this todo" @click="ui.drawerId = suggestion.id">
          <Prio :p="suggestion.priority" />
          <span class="ellipsis un-title">{{ suggestion.title }}</span>
        </button>
        <span class="mono un-meta" :class="suggestionFits ? 'ok' : 'warn'">{{ suggestion.timeMin }}m{{ suggestionFits ? ' · fits' : ' · longer than the gap' }}</span>
        <span v-if="missedAt" class="mono danger un-meta">missed {{ missedAt }}</span>
        <button class="btn sm primary un-start" @click="start(suggestion)"><span class="icon sm">play_arrow</span>Start now</button>
      </template>
      <span v-else class="muted grow">Nothing queued. Press <span class="kbd">N</span> to add a todo.</span>
    </div>
    <!-- busy: what's next as one readable line -->
    <div v-else class="next-row">
      <span class="tiny upper muted">Next</span>
      <template v-if="next">
        <b class="mono">{{ next.start }}</b>
        <span class="ellipsis grow">{{ next.title }}</span>
        <span class="mono muted in">in {{ fmtDur(untilNext) }}</span>
      </template>
      <span v-else class="muted grow">Nothing else on the timeline today</span>
    </div>
  </section>
</template>

<style scoped>
.now-inst { gap: 12px; padding: 16px 20px; border-left: 3px solid var(--accent); }
.now-inst.busy { border-left-color: var(--c); background: color-mix(in srgb, var(--c) 5%, var(--surface)); }
.now-inst.free { border-left-color: var(--muted); }
.now-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: end; }
.what { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.clock { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.readout { display: flex; align-items: baseline; gap: 8px; }
.actions { display: flex; gap: 6px; }
.actions .btn { color: inherit; }
.actions .btn.primary { color: var(--on-accent); }
.tag { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 2px; background: var(--stamp); color: #fff; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; }
.free-tag { background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); }
.pulse { width: 6px; height: 6px; border-radius: 50%; background: #fff; animation: pulse 1.6s infinite; }
@keyframes pulse { 50% { opacity: 0.2; } }
.range { font-size: 13px; min-width: 0; }
.free .range { font-size: 15px; }
.range .until { color: var(--warn); font-weight: 600; }
.title { font: 600 30px/36px Inter, sans-serif; letter-spacing: -0.015em; }
.now-inst .inst-big { font-size: 48px; line-height: 50px; }
.meta { gap: 10px; font-size: 14px; flex-wrap: wrap; }
.big-bar { height: 8px; }
.busy .big-bar > i { background: var(--c); }
.do { display: flex; align-items: center; gap: 8px; max-width: 640px; border: 1px solid var(--border); border-radius: 2px; padding: 8px 10px; background: var(--surface); color: var(--text); font: inherit; font-size: 15px; text-align: left; cursor: pointer; min-width: 0; }
.do:hover { border-color: var(--accent); }
/* free: the todo you could start, in the bottom line */
.upnext { align-items: center; }
.un-open { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; padding: 0; }
.un-open:hover .un-title { color: var(--accent); }
.un-meta { flex: none; font-size: 14px; }
.un-start { flex: none; color: var(--on-accent); }
.next-row { display: flex; align-items: baseline; gap: 10px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 16px; min-width: 0; }
.next-row b { font-size: 16px; color: var(--warn); }
.next-row .in { font-size: 14px; flex: none; }
@media (max-width: 700px) {
  .now-grid { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .clock { flex-direction: row; align-items: center; justify-content: space-between; }
  /* Done/Focus buttons no longer fit beside the readout on a narrow screen: let them drop to a
     second line, and hide keyboard shortcut hints (useless on touch) so the Focus button fits. */
  .actions { flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
  .actions .kbd { display: none; }
  .title { font-size: 24px; line-height: 30px; }
  .now-inst .inst-big { font-size: 34px; line-height: 38px; }
  .next-row { font-size: 15px; }
  .upnext { flex-wrap: wrap; row-gap: 6px; }
  .un-open { flex-basis: calc(100% - 70px); }
  .un-start { margin-left: auto; }
}
</style>
