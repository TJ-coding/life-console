<script setup>
// Briefing (morning review, opened by the morning notification). Questions, in order:
//   1. Which deadlines are coming this week, and how long do I have?
//   2. What's on today, and how much is planned?
//   3. Which three tasks matter most today?
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ui, todayISO, addDays, blocksForDay, todosForDay, isLeaf, toMin, pad } from '../store'
import { openDeadlines, effDue, countdown, urgency } from '../glance'
import ReviewSheet from '../components/ReviewSheet.vue'

const router = useRouter()
const T = computed(() => { void ui.now; return todayISO() })
const dur = (m) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${pad(m % 60)}m` : ''}`)

const deadlines = computed(() => {
  const until = `${addDays(T.value, 7)}T23:59`
  return openDeadlines().filter((d) => effDue(d) <= until)
})
const blocks = computed(() => blocksForDay(T.value).filter((b) => !b.done).sort((a, b) => toMin(a.start) - toMin(b.start)))
const open = computed(() => todosForDay(T.value).filter((t) => !t.done && isLeaf(t)))
const untimed = computed(() => open.value.filter((t) => !t.scheduled.start).length)
const planned = computed(() => open.value.reduce((s, t) => s + (t.timeMin || 0), 0))
const top3 = computed(() => open.value.slice(0, 3))
</script>

<template>
  <ReviewSheet title="Briefing" :date="T" action="Start day" @done="router.push('/')">
    <section>
      <div class="lbl">Deadlines <span>next 7 days</span></div>
      <div v-for="d in deadlines" :key="d.id" class="r">
        <span class="cd mono" :class="urgency(effDue(d)) !== 'ok' ? urgency(effDue(d)) : ''">{{ countdown(effDue(d)) }}</span>
        <span class="n">{{ d.title }}</span>
      </div>
      <div v-if="!deadlines.length" class="none">Nothing due this week.</div>
    </section>

    <section>
      <div class="lbl">Today <span v-if="planned">· tasks <b class="mono">{{ dur(planned) }}</b></span></div>
      <div v-for="b in blocks" :key="b.kind + b.id" class="r">
        <span class="t mono muted">{{ b.start }}</span>
        <span class="n">{{ b.title }}</span>
        <span class="d mono muted">{{ dur(toMin(b.end) - toMin(b.start)) }}</span>
      </div>
      <div v-if="untimed" class="r muted"><span class="t"></span><span class="n">+{{ untimed }} untimed</span></div>
      <div v-if="!blocks.length && !untimed" class="none">Nothing planned today.</div>
    </section>

    <section v-if="top3.length">
      <div class="lbl">Top 3</div>
      <div v-for="(t, i) in top3" :key="t.id" class="r">
        <span class="t mono muted">{{ i + 1 }}</span>
        <span class="n">{{ t.title }}</span>
        <span class="d mono muted">{{ t.timeMin ? dur(t.timeMin) : '' }}</span>
      </div>
    </section>
  </ReviewSheet>
</template>

<style scoped>
.warn { color: var(--warn); }
.danger { color: var(--danger); }
</style>
