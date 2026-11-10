<script setup>
// S-02 Briefing: the pre-race briefing, one card per thing that needs the driver before the start.
// Questions, in order: what needs me before I start (situation)? which deadline could hit me with
// nothing scheduled for it (threat)? which of today's tasks have no time (unscheduled)? is today
// over capacity (overload)? which milestones are late (goals)? what's first, and what's the objective (go)?
// Cards appear only when they have something to report; SITUATION and GO always do.
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ui, todayISO, workload, CAPACITY_H, autoTimebox, toast, wd } from '../store'
import { useNow, fmtClock } from '../now'
import { effDue, bigCountdown, countdown, minsTo } from '../glance'
import { threats, coverFor, untimedOn, overBy, lateSigs, objectiveOf, addTaskFor, shedLoad, dur } from '../review'
import MissionCards from '../components/MissionCards.vue'

const router = useRouter()
const n = useNow()
const T = n.T

// what needed attention when the briefing opened: these cards stay put while you fix them
const threatList = threats(72).slice(0, 3)
const had = { untimed: untimedOn(T.value).length > 0, over: overBy(T.value) > 0, goals: lateSigs().length > 0 }
const cards = [
  { key: 'situation', label: 'SITUATION' },
  ...threatList.map((d) => ({ key: `threat-${d.id}`, label: 'THREAT', tone: 'danger' })),
  had.untimed && { key: 'untimed', label: 'UNSCHEDULED', tone: 'warn' },
  had.over && { key: 'over', label: 'OVERLOAD', tone: 'warn' },
  had.goals && { key: 'goals', label: 'GOALS BEHIND', tone: 'warn' },
  { key: 'go', label: 'GO', tone: 'ok' },
].filter(Boolean)
cards[0].tone = cards.length > 2 ? 'warn' : 'ok'

const untimed = computed(() => untimedOn(T.value))
const load = computed(() => workload(T.value))
const late = computed(() => lateSigs())
const objective = computed(() => objectiveOf(T.value))
const covered = (d) => coverFor(d)[0] ?? null
const overdue = (d) => minsTo(effDue(d)) < 0

/** Situation lines: open items first (!), fixed ones turn into a quiet ✓. */
const items = computed(() => [
  ...threatList.map((d) => covered(d)
    ? { ok: true, text: `${d.title}: ${covered(d).id} scheduled` }
    : { text: `${d.title} ${overdue(d) ? 'overdue' : `due in ${countdown(effDue(d))}`}, nothing scheduled` }),
  had.untimed && (untimed.value.length ? { text: `${untimed.value.length} task${untimed.value.length > 1 ? 's' : ''} today ${untimed.value.length > 1 ? 'have' : 'has'} no start time` } : { ok: true, text: 'Every task has a time' }),
  had.over && (overBy(T.value) > 0 ? { text: `Today is over capacity: ${load.value.toFixed(1)}h / ${CAPACITY_H}h` } : { ok: true, text: 'Today fits' }),
  had.goals && (late.value.length ? { text: `${late.value.length} milestone${late.value.length > 1 ? 's' : ''} past ${late.value.length > 1 ? 'their' : 'its'} time bound` } : { ok: true, text: 'Goals on track' }),
].filter(Boolean))
const open = computed(() => items.value.filter((x) => !x.ok).length)

function timebox() {
  const r = autoTimebox(T.value)
  toast(r.unplaced.length ? `Time-boxed ${r.placed.length}; ${r.unplaced.length} didn't fit 08:00–21:00` : `Time-boxed ${r.placed.length} task${r.placed.length === 1 ? '' : 's'}`)
}
const openGoal = (g) => router.push({ path: `/strategy/${g.plan.id}`, query: { goal: g.sig.no } })
</script>

<template>
  <MissionCards title="Briefing" :date="T" action="Start day" :cards="cards" @done="router.push('/')">
    <template #situation>
      <h2 class="head">{{ open ? `${open} item${open > 1 ? 's' : ''} before you start` : 'All clear' }}</h2>
      <div class="rows big">
        <div v-for="(x, k) in items" :key="k" class="r" :class="{ muted: x.ok }">
          <span class="k mark mono" :class="x.ok ? '' : 'warn'">{{ x.ok ? '✓' : '!' }}</span><span class="n">{{ x.text }}</span>
        </div>
      </div>
      <p v-if="!items.length" class="say muted">No deadline threats, every task has a time, and today fits.</p>
    </template>

    <template v-for="d in threatList" :key="d.id" #[`threat-${d.id}`]>
      <h2 class="head">{{ d.title }}</h2>
      <div class="hero" :class="covered(d) ? '' : 'danger'">{{ bigCountdown(effDue(d)) }} <small>{{ overdue(d) ? 'overdue' : 'left' }}</small></div>
      <p v-if="covered(d)" class="clear"><span class="icon sm">check</span>{{ covered(d).title }} is on {{ wd(covered(d).scheduled.date) }}'s list.</p>
      <p v-else class="say">No task is scheduled for it before then.</p>
      <div class="acts">
        <button v-if="!covered(d)" class="btn primary" @click="addTaskFor(d, T)"><span class="icon sm">add</span>Add a task for today</button>
        <button class="btn" @click="ui.deadlineId = d.id">Edit deadline</button>
      </div>
    </template>

    <template #untimed>
      <template v-if="untimed.length">
        <h2 class="head">{{ untimed.length }} task{{ untimed.length > 1 ? 's have' : ' has' }} no start time</h2>
        <div class="rows">
          <div v-for="t in untimed" :key="t.id" class="r"><span class="k mono muted">P{{ t.priority }}</span><span class="n">{{ t.title }}</span><span class="d mono">{{ dur(t.timeMin || 30) }}</span></div>
        </div>
        <div class="acts"><button class="btn primary" @click="timebox"><span class="icon sm">auto_awesome</span>Auto time-box</button></div>
      </template>
      <p v-else class="clear"><span class="icon sm">check</span>Every task today has a start time.</p>
    </template>

    <template #over>
      <h2 class="head">Today is over capacity</h2>
      <div class="hero" :class="overBy(T) > 0 ? 'warn' : ''">{{ load.toFixed(1) }}h <small>/ {{ CAPACITY_H }}h of tasks</small></div>
      <template v-if="overBy(T) > 0">
        <p class="say">{{ untimed.length ? 'Move the lowest-priority untimed tasks to tomorrow until today fits.' : 'Every task has a time; move one in Plan week.' }}</p>
        <div class="acts">
          <button v-if="untimed.length" class="btn primary" @click="shedLoad(T)">Move to tomorrow until it fits</button>
          <button v-else class="btn" @click="router.push('/week')">Open Plan week</button>
        </div>
      </template>
      <p v-else class="clear"><span class="icon sm">check</span>Today fits.</p>
    </template>

    <template #goals>
      <template v-if="late.length">
        <h2 class="head">{{ late.length }} milestone{{ late.length > 1 ? 's' : '' }} behind</h2>
        <div class="rows">
          <div v-for="g in late.slice(0, 5)" :key="g.sig.no" class="r">
            <span class="k mono warn">{{ g.days }}d</span><span class="n">{{ g.sig.no }} · {{ g.sig.name }}</span>
            <button class="btn sm" @click="openGoal(g)">Open</button>
          </div>
        </div>
        <p class="say muted">Move its time bound, or add a task for it today.</p>
      </template>
      <p v-else class="clear"><span class="icon sm">check</span>Goals on track.</p>
    </template>

    <template #go>
      <template v-if="n.current.value">
        <div class="say muted">Now</div>
        <h2 class="head">{{ n.current.value.title }}</h2>
        <div class="hero">{{ fmtClock(n.progress.value.remaining) }} <small>left</small></div>
      </template>
      <template v-else-if="n.next.value">
        <div class="say muted">First · {{ n.next.value.start }}</div>
        <h2 class="head">{{ n.next.value.title }}</h2>
        <div class="hero">{{ fmtClock(n.untilNext.value) }} <small>to the start</small></div>
      </template>
      <h2 v-else class="head">No more blocks today</h2>
      <div v-if="objective" class="rows">
        <div class="r"><span class="k mono muted">OBJ</span><span class="n">{{ objective.title }}</span><span class="d mono">{{ dur(objective.timeMin || 30) }}</span></div>
      </div>
    </template>
  </MissionCards>
</template>
