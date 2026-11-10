<script setup>
// S-03 Debrief: after the day, one decision at a time, each previewed on tomorrow's real schedule.
// Questions, in order: where does each unfinished task go? which deadline looms with nothing scheduled
// from tomorrow on? do tomorrow's tasks have times? what is tomorrow's one thing? Then sign off.
// Before 04:00 it debriefs the previous day. The set of steps is fixed when the screen opens.
import { useRouter } from 'vue-router'
import { state, ui, todayISO, addDays, wd, todosForDay, isLeaf, CAPACITY_H } from '../store'
import { effDue, countdown, minsTo } from '../glance'
import { threats, coverFor, untimedOn, openIn, objectiveIn, freeSlot, timeboxSim, deadlineTaskSim, objectiveSim, noSim, overloadStep, fitsWith, loadOf, dur } from '../review'
import BriefingFlow from '../components/BriefingFlow.vue'
import Stamps from '../components/Stamps.vue'

const router = useRouter()
const D = ui.now.getHours() < 4 ? addDays(todayISO(), -1) : todayISO()
const N = addDays(D, 1)
const move = (id, scheduled) => ({ patch: { [id]: { scheduled } }, add: [] })
const live = (id) => state.todos.find((t) => t.id === id)

const steps = []

/* unfinished tasks */
const notDone = todosForDay(D).filter((t) => isLeaf(t) && !t.done).slice(0, 10)
notDone.forEach((t0, i) => {
  steps.push({
    key: 'left-' + t0.id, tone: 'warn', days: () => [N],
    grp: `${notDone.length} unfinished · ${i + 1} of ${notDone.length}`,
    title: () => t0.title,
    why: () => `${dur(t0.timeMin || 30)} · P${t0.priority}`,
    stale: () => { const t = live(t0.id); return !t || t.done || t.scheduled?.date !== D ? 'It has a place now.' : null },
    options: () => {
      const s = freeSlot(state.todos, N, t0.timeMin || 30)
      const fits = fitsWith(move(t0.id, { date: N, start: null }), N)
      return [
        s && { label: `${wd(N)} at ${s}`, sim: move(t0.id, { date: N, start: s }), rec: fits },
        { label: `${wd(N)}, no time yet`, sim: move(t0.id, { date: N, start: null }), rec: fits && !s },
        { label: 'Back to the backlog', sim: move(t0.id, null), rec: !fits, verdict: ['Off the days. Plan week gives it a day later.', ''] },
        { label: 'It’s actually done', sim: { patch: { [t0.id]: { done: true } }, add: [] }, verdict: ['Ticked off.', 'ok'] },
      ].filter(Boolean)
    },
  })
})

/* tomorrow over capacity (unfinished tasks moved there count too) */
if (loadOf(state.todos, N) > CAPACITY_H || notDone.length) steps.push(overloadStep(N, addDays(N, 1)))

/* deadlines before the end of the day after tomorrow with nothing scheduled from tomorrow on */
// (one due before tomorrow can't be scheduled any more: it stays on the Command Center)
for (const d of threats((24 - ui.now.getHours()) + 48, N).filter((x) => effDue(x).slice(0, 10) >= N).slice(0, 3)) {
  steps.push({
    key: 'threat-' + d.id, tone: 'danger', days: () => [N],
    title: () => d.title,
    why: () => `${minsTo(effDue(d)) < 0 ? 'Overdue' : `Due in ${countdown(effDue(d))}`} · nothing scheduled for it from ${wd(N)}`,
    stale: () => (coverFor(d, N).length ? 'A task for it is on the list now.' : null),
    options: () => {
      const s = freeSlot(state.todos, N, 30)
      return [
        s && { label: `Work on it ${wd(N)} at ${s} (30m)`, sim: deadlineTaskSim(d, N, s), rec: true },
        { label: 'Leave it', sim: noSim(), verdict: ['Nothing works towards it yet.', 'danger'] },
      ].filter(Boolean)
    },
  })
}

/* tomorrow's tasks without a time (unfinished ones moved there count too) */
if (untimedOn(N).length || notDone.length) {
  steps.push({
    key: 'timebox', days: () => [N],
    title: () => { const k = untimedOn(N).length; return `${k} task${k === 1 ? '' : 's'} on ${wd(N)} ${k === 1 ? 'has' : 'have'} no time` },
    why: () => 'Give them times now and tomorrow starts without a decision.',
    stale: () => (untimedOn(N).length ? null : `Every task on ${wd(N)} has a time.`),
    options: () => {
      const { sim, placed } = timeboxSim(noSim(), N)
      const left = untimedOn(N).length - placed.length
      return [
        placed.length && { label: `Time-box ${placed.length === untimedOn(N).length ? 'them' : `${placed.length} of them`} (08:00–21:00)`, sim, rec: true, verdict: left ? [`${left} didn't fit between 08:00 and 21:00.`, 'warn'] : undefined },
        { label: 'Leave them untimed', sim: noSim(), verdict: ['Tomorrow’s briefing asks again.', ''] },
      ].filter(Boolean)
    },
  })
}

/* tomorrow's one thing */
steps.push({
  key: 'objective', days: () => [N],
  title: () => `What does ${wd(N)} start with?`,
  why: () => 'The one thing that has to happen. It becomes the day’s objective (P1, top of the list).',
  stale: () => (openIn(state.todos, N).length < 2 ? (openIn(state.todos, N).length ? `Only one task on ${wd(N)}.` : `Nothing on ${wd(N)} yet.`) : null),
  options: () => {
    const cur = objectiveIn(state.todos, N)
    return openIn(state.todos, N).slice(0, 4).map((t) => ({
      label: t.title, sim: t.id === cur?.id ? noSim() : objectiveSim(t), rec: t.id === cur?.id,
      verdict: [`${dur(t.timeMin || 30)} · ${t.scheduled.start ? `at ${t.scheduled.start}` : 'no time yet'}`, ''],
    }))
  },
})
</script>

<template>
  <BriefingFlow title="Debrief" :date="D" finish="Done" :steps="steps" :recap-days="[N]" @done="router.push('/')">
    <template #recap>
      <div class="so"><span class="tiny upper muted">Sign off {{ wd(D) }}</span><Stamps :date="D" :size="44" /></div>
    </template>
  </BriefingFlow>
</template>

<style scoped>
.so { display: flex; flex-direction: column; gap: 8px; }
/* the owner finds dashed outlines ugly: solid rings here */
.so :deep(.stamp) { border-style: solid; }
</style>
