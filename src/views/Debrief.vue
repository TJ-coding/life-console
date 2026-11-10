<script setup>
// S-03 Debrief: the post-race debrief, one card per question. In order: how did today go against its
// objective (result)? where does each unfinished task go (unfinished; Next stays locked until each has a
// place)? which deadline looms with nothing scheduled (threats ahead)? is tomorrow set up, and is today
// signed off (sign-off)? Before 04:00 it debriefs the previous day.
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ui, todayISO, addDays, todosForDay, isLeaf, blocksForDay, toMin, autoTimebox, toggleTodo, unscheduleTodo, toast, wd } from '../store'
import { effDue, countdown, urgency } from '../glance'
import { threats, coverFor, untimedOn, objectiveOf, addTaskFor, toNextDay, allToNextDay, dur } from '../review'
import MissionCards from '../components/MissionCards.vue'
import Stamps from '../components/Stamps.vue'

const router = useRouter()
const D = computed(() => { void ui.now; return ui.now.getHours() < 4 ? addDays(todayISO(), -1) : todayISO() })
const next = computed(() => addDays(D.value, 1))

const tasks = computed(() => todosForDay(D.value).filter(isLeaf))
const done = computed(() => tasks.value.filter((t) => t.done))
const notDone = computed(() => tasks.value.filter((t) => !t.done))
const doneMin = computed(() => done.value.reduce((s, t) => s + (t.timeMin || 0), 0))
const objective = computed(() => objectiveOf(D.value))

// fixed when the debrief opens: deadlines looming before the end of the day after tomorrow
const threatList = threats((24 - ui.now.getHours()) + 48, addDays(D.value, 1)).slice(0, 4)
const cards = [
  { key: 'result', label: 'RESULT', tone: tasks.value.length && !notDone.value.length ? 'ok' : undefined },
  notDone.value.length && { key: 'unfinished', label: 'UNFINISHED', tone: 'warn' },
  threatList.length && { key: 'ahead', label: 'THREATS AHEAD', tone: 'danger' },
  { key: 'signoff', label: 'SIGN-OFF' },
].filter(Boolean)
const blocked = computed(() => ({ unfinished: notDone.value.length ? `${notDone.value.length} left to place` : '' }))

const covered = (d) => coverFor(d, next.value)[0] ?? null
/** due before tomorrow starts: nothing to schedule any more, only to finish or re-date */
const tonight = (d) => effDue(d).slice(0, 10) < next.value
const tomorrow = computed(() => todosForDay(next.value).filter((t) => !t.done && isLeaf(t)))
const untimedNext = computed(() => untimedOn(next.value))
const firstNext = computed(() => blocksForDay(next.value).sort((a, b) => toMin(a.start) - toMin(b.start))[0] ?? null)

function markDone(t) {
  toggleTodo(t.id)
  toast(`${t.id} done`, { label: 'Undo', run: () => toggleTodo(t.id) })
}
function timebox() {
  const r = autoTimebox(next.value)
  toast(r.unplaced.length ? `Time-boxed ${r.placed.length}; ${r.unplaced.length} didn't fit 08:00–21:00` : `Time-boxed ${r.placed.length} task${r.placed.length === 1 ? '' : 's'}`)
}
</script>

<template>
  <MissionCards title="Debrief" :date="D" action="Done" :cards="cards" :blocked="blocked" @done="router.push('/')">
    <template #result>
      <template v-if="tasks.length">
        <div class="hero">{{ done.length }}/{{ tasks.length }} <small>tasks done<template v-if="doneMin"> · {{ dur(doneMin) }}</template></small></div>
        <div v-if="objective" class="rows">
          <div class="r">
            <span class="k mono muted">OBJ</span><span class="n">{{ objective.title }}</span>
            <span class="mono" :class="objective.done ? 'ok-mark' : 'warn'">{{ objective.done ? '✓ done' : '✗ not done' }}</span>
          </div>
        </div>
      </template>
      <h2 v-else class="head">No tasks were on {{ wd(D) }}'s list</h2>
    </template>

    <template #unfinished>
      <template v-if="notDone.length">
        <h2 class="head">{{ notDone.length }} unfinished. Where do they go?</h2>
        <div class="rows">
          <div v-for="t in notDone" :key="t.id" class="r">
            <span class="n">{{ t.title }}</span>
            <button class="btn sm" @click="toNextDay(t, D)">{{ wd(next) }}</button>
            <button class="btn sm" @click="unscheduleTodo(t.id, 'day')">Backlog</button>
            <button class="btn sm" @click="markDone(t)">Done</button>
          </div>
        </div>
        <div v-if="notDone.length > 1" class="acts"><button class="btn" @click="allToNextDay(notDone, D)">Move all {{ notDone.length }} to {{ wd(next) }}</button></div>
      </template>
      <p v-else class="clear"><span class="icon sm">check</span>Every task has a place.</p>
    </template>

    <template #ahead>
      <h2 class="head">Due soon, nothing scheduled for it</h2>
      <div class="rows">
        <div v-for="d in threatList" :key="d.id" class="r" :class="{ muted: covered(d) }">
          <span class="k mono" :class="covered(d) ? '' : urgency(effDue(d)) !== 'ok' ? urgency(effDue(d)) : ''">{{ countdown(effDue(d)) }}</span>
          <span class="n">{{ d.title }}</span>
          <span v-if="covered(d)" class="d">✓ {{ covered(d).id }} on {{ wd(covered(d).scheduled.date) }}</span>
          <button v-else-if="tonight(d)" class="btn sm" @click="ui.deadlineId = d.id">Edit deadline</button>
          <button v-else class="btn sm" @click="addTaskFor(d, next)">Add for {{ wd(next) }}</button>
        </div>
      </div>
    </template>

    <template #signoff>
      <h2 class="head">Tomorrow: {{ tomorrow.length }} task{{ tomorrow.length === 1 ? '' : 's' }}<template v-if="untimedNext.length">, {{ untimedNext.length }} untimed</template></h2>
      <div v-if="firstNext" class="rows">
        <div class="r"><span class="k mono warn">{{ firstNext.start }}</span><span class="n">{{ firstNext.title }}</span><span class="d">first block</span></div>
      </div>
      <div v-if="untimedNext.length" class="acts acts-top"><button class="btn" @click="timebox"><span class="icon sm">auto_awesome</span>Auto time-box {{ wd(next) }}</button></div>
      <div class="stamp-row"><Stamps :date="D" :size="48" /></div>
    </template>
  </MissionCards>
</template>

<style scoped>
.ok-mark { color: var(--accent); }
.acts-top { margin-top: 0; }
.stamp-row { padding-top: 6px; }
/* the owner finds dashed outlines ugly: solid rings here */
.stamp-row :deep(.stamp) { border-style: solid; }
</style>
