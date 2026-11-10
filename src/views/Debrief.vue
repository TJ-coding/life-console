<script setup>
// Debrief (evening review, opened by the evening notification). Questions, in order:
//   1. How much of today got done?
//   2. Where does each unfinished task go: tomorrow or the backlog?
//   3. What starts tomorrow, and what's due by then?
//   4. Is today signed off?
// Before 04:00 it reviews the previous day, so a late-night debrief still covers "today".
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ui, todayISO, addDays, blocksForDay, todosForDay, isLeaf, toMin, pad, updateTodo, unscheduleTodo, toast, wd } from '../store'
import { openDeadlines, effDue, countdown, urgency } from '../glance'
import ReviewSheet from '../components/ReviewSheet.vue'
import Stamps from '../components/Stamps.vue'

const router = useRouter()
const D = computed(() => { void ui.now; return ui.now.getHours() < 4 ? addDays(todayISO(), -1) : todayISO() })
const next = computed(() => addDays(D.value, 1))
const dur = (m) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${pad(m % 60)}m` : ''}`)

const tasks = computed(() => todosForDay(D.value).filter(isLeaf))
const done = computed(() => tasks.value.filter((t) => t.done))
const notDone = computed(() => tasks.value.filter((t) => !t.done))
const doneMin = computed(() => done.value.reduce((s, t) => s + (t.timeMin || 0), 0))

const first = computed(() => blocksForDay(next.value).sort((a, b) => toMin(a.start) - toMin(b.start))[0] ?? null)
const dueSoon = computed(() => {
  const until = `${next.value}T23:59`
  return openDeadlines().filter((d) => effDue(d) <= until)
})

function toTomorrow(t) {
  const prev = { ...t.scheduled }
  updateTodo(t.id, { scheduled: { date: next.value, start: null } })
  toast(`${t.id} moved to ${wd(next.value)}`, { label: 'Undo', run: () => updateTodo(t.id, { scheduled: prev }) })
}
</script>

<template>
  <ReviewSheet title="Debrief" :date="D" action="Done" @done="router.push('/')">
    <section>
      <div class="lbl">Done <b class="mono">{{ done.length }} of {{ tasks.length }}</b><span v-if="doneMin" class="mono">· {{ dur(doneMin) }}</span></div>
      <div v-for="t in done" :key="t.id" class="r muted">
        <span class="icon sm ok-mark">check</span>
        <span class="n">{{ t.title }}</span>
      </div>
      <div v-if="!tasks.length" class="none">No tasks were on this day.</div>
    </section>

    <section v-if="notDone.length">
      <div class="lbl">Not done <span class="spacer"></span><span>move to</span></div>
      <div v-for="t in notDone" :key="t.id" class="r">
        <span class="n">{{ t.title }}</span>
        <button class="btn sm" @click="toTomorrow(t)">Tomorrow</button>
        <button class="btn sm" @click="unscheduleTodo(t.id, 'day')">Backlog</button>
      </div>
    </section>

    <section>
      <div class="lbl">Tomorrow <span class="mono">{{ wd(next) }}</span></div>
      <div v-if="first" class="r">
        <span class="t mono warn">{{ first.start }}</span>
        <span class="n">{{ first.title }}</span>
        <span class="d muted">first block</span>
      </div>
      <div v-for="d in dueSoon" :key="d.id" class="r">
        <span class="cd mono" :class="urgency(effDue(d)) !== 'ok' ? urgency(effDue(d)) : ''">{{ countdown(effDue(d)) }}</span>
        <span class="n">{{ d.title }}</span>
        <span class="d muted">due</span>
      </div>
      <div v-if="!first && !dueSoon.length" class="none">Nothing scheduled or due yet.</div>
    </section>

    <section>
      <div class="lbl">Sign-off</div>
      <div class="signoff"><Stamps :date="D" :size="40" /></div>
    </section>
  </ReviewSheet>
</template>

<style scoped>
.ok-mark { color: var(--accent); width: 64px; flex: none; }
.warn { color: var(--warn); }
.danger { color: var(--danger); }
.signoff { padding-top: 14px; }
/* the owner finds dashed outlines ugly: solid rings here */
.signoff :deep(.stamp) { border-style: solid; }
</style>
