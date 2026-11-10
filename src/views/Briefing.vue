<script setup>
// S-02 Briefing: before the day starts, one decision at a time, each previewed on the real schedule.
// Questions, in order: which deadline could hit me with nothing scheduled for it (threat)? does today fit
// (overload)? where does each task without a time go (unscheduled)? what is the one thing today (objective)?
// Only the steps that apply are asked; the set is fixed when the screen opens.
import { useRouter } from 'vue-router'
import { state, todayISO, addDays, wd, toMin, fromMin, CAPACITY_H } from '../store'
import { effDue, countdown, minsTo } from '../glance'
import { threats, coverFor, untimedOn, loadOf, openIn, objectiveIn, freeSlot, deadlineTaskSim, objectiveSim, noSim, overloadStep, dur } from '../review'
import BriefingFlow from '../components/BriefingFlow.vue'

const router = useRouter()
const T = todayISO()
const N = addDays(T, 1)
const move = (id, scheduled) => ({ patch: { [id]: { scheduled } }, add: [] })
const live = (id) => state.todos.find((t) => t.id === id)

const steps = []

/* deadlines within 3 days that nothing on the list works towards */
for (const d of threats(72).slice(0, 3)) {
  steps.push({
    key: 'threat-' + d.id, tone: 'danger', days: () => [T, N],
    title: () => d.title,
    why: () => `${minsTo(effDue(d)) < 0 ? 'Overdue' : `Due in ${countdown(effDue(d))}`} · nothing scheduled for it`,
    stale: () => (coverFor(d).length ? 'A task for it is on the list now.' : null),
    options: () => {
      const s1 = freeSlot(state.todos, T, 30), s2 = freeSlot(state.todos, N, 30)
      return [
        s1 && { label: `Work on it today at ${s1} (30m)`, sim: deadlineTaskSim(d, T, s1), rec: true },
        s2 && { label: `Work on it ${wd(N)} at ${s2} (30m)`, sim: deadlineTaskSim(d, N, s2), rec: !s1 },
        { label: 'Leave it', sim: noSim(), verdict: ['Nothing works towards it yet.', 'danger'] },
      ].filter(Boolean)
    },
  })
}

/* today over capacity */
if (loadOf(state.todos, T) > CAPACITY_H) steps.push(overloadStep(T, N, { who: 'Today' }))

/* today's tasks with no time */
const untimed = untimedOn(T).slice(0, 8)
untimed.forEach((t0, i) => {
  steps.push({
    key: 'untimed-' + t0.id, tone: 'warn', days: () => [T, N],
    grp: `${untimed.length} task${untimed.length > 1 ? 's have' : ' has'} no time · ${i + 1} of ${untimed.length}`,
    title: () => t0.title,
    why: () => `${dur(t0.timeMin || 30)} · P${t0.priority}`,
    stale: () => { const t = live(t0.id); return !t || t.done || t.scheduled?.date !== T || t.scheduled.start ? 'It has a place now.' : null },
    options: () => {
      const m = t0.timeMin || 30
      const s1 = freeSlot(state.todos, T, m)
      const s2 = s1 ? freeSlot(state.todos, T, m, fromMin(toMin(s1) + Math.max(60, m))) : null
      return [
        s1 && { label: `Today at ${s1}`, sim: move(t0.id, { date: T, start: s1 }), rec: true },
        s2 && { label: `Today at ${s2}`, sim: move(t0.id, { date: T, start: s2 }) },
        { label: `${wd(N)}, no time yet`, sim: move(t0.id, { date: N, start: null }), rec: !s1, verdict: [`Off today. ${wd(N)}'s briefing asks again.`, ''] },
        { label: 'Back to the backlog', sim: move(t0.id, null), verdict: ['Off the day. Plan week gives it a day later.', ''] },
      ].filter(Boolean)
    },
  })
})

/* the one thing */
if (openIn(state.todos, T).length > 1) {
  steps.push({
    key: 'objective', days: () => [T],
    title: () => 'Pick the one thing for today',
    why: () => 'If only one task gets done, which? It becomes the day’s objective (P1, top of the list).',
    stale: () => (openIn(state.todos, T).length < 2 ? 'Only one task left today.' : null),
    options: () => {
      const cur = objectiveIn(state.todos, T)
      return openIn(state.todos, T).slice(0, 4).map((t) => ({
        label: t.title, sim: t.id === cur?.id ? noSim() : objectiveSim(t), rec: t.id === cur?.id,
        verdict: [`${dur(t.timeMin || 30)} · ${t.scheduled.start ? `at ${t.scheduled.start}` : 'no time yet'}`, ''],
      }))
    },
  })
}
</script>

<template>
  <BriefingFlow title="Briefing" :date="T" finish="Start day" :steps="steps" :recap-days="[T]" @done="router.push('/')" />
</template>
