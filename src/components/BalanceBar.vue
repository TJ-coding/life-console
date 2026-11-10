<script setup>
// ② Assign day: how even the week is, above the day columns. Verdict and numbers on the left,
// the planner's suggested moves as one-click chips on the right. The same moves are tagged
// "→ Thu" on the cards in the buckets below.
import { computed } from 'vue'
import { state, ui, wd, fmtSlash, BALANCE_LEVEL, updateTodo, toast, isLeaf } from '../store'

const props = defineProps({ balance: { type: Object, required: true }, moves: { type: Array, default: () => [] } })
const lv = computed(() => BALANCE_LEVEL[props.balance.level])
const backlogH = computed(() => state.todos.filter((t) => !t.done && !t.scheduled && isLeaf(t)).reduce((s, t) => s + (t.timeMin || 0) / 60, 0))
const h1 = (v) => v.toFixed(1)
const scope = computed(() => (props.balance.days.length === 5 ? 'Mon–Fri' : `${wd(props.balance.days[0])}–Fri (days still ahead)`))

function move(s) {
  updateTodo(s.todo.id, { scheduled: { date: s.to, start: null } })
  toast(`${s.todo.id} → ${wd(s.to)} ${fmtSlash(s.to)}`)
}
function moveAll() {
  const n = props.moves.length
  props.moves.forEach((s) => updateTodo(s.todo.id, { scheduled: { date: s.to, start: null } }))
  toast(`Moved ${n} tasks`)
}
</script>

<template>
  <section class="bal" :class="lv.cls" aria-label="Week balance">
    <div class="verdict" :title="`Balance of ${scope}: unbalanced when a day is over capacity or the spread is over 3h; uneven over 1.5h`">
      <span class="icon">{{ lv.icon }}</span>{{ lv.label }}
    </div>
    <div class="facts mono">
      <span title="Heaviest day minus lightest day"><span class="muted">spread</span> {{ h1(balance.spread) }}h</span>
      <span title="Average planned hours per day"><span class="muted">avg</span> {{ h1(balance.avg) }}h</span>
      <span title="Hours left under capacity on these days"><span class="muted">free</span> {{ h1(balance.free) }}h</span>
      <span v-if="backlogH" :class="backlogH > balance.free ? 'danger' : ''" :title="backlogH > balance.free ? 'The backlog is bigger than the free time left this week' : 'The backlog fits in the free time left this week'">
        <span class="muted">backlog</span> {{ h1(backlogH) }}h {{ backlogH > balance.free ? "won't fit" : 'fits' }}
      </span>
      <span v-if="balance.over.length" class="danger">over {{ balance.over.map(wd).join(' · ') }}</span>
    </div>
    <div class="moves">
      <template v-if="moves.length">
        <span class="tiny upper muted">To even it out</span>
        <button
          v-for="s in moves" :key="s.todo.id" class="mv" :title="`Move ${s.todo.title} (${s.todo.timeMin}m) from ${wd(s.from)} to ${wd(s.to)}`"
          @click="move(s)" @mouseenter="ui.hoverId = s.todo.id" @mouseleave="ui.hoverId = null"
        >
          <span class="ellipsis t">{{ s.todo.title }}</span><span class="mono">{{ wd(s.from) }}→<b>{{ wd(s.to) }}</b></span>
        </button>
        <button v-if="moves.length > 1" class="btn sm" @click="moveAll">Move all</button>
      </template>
      <span v-else class="small muted row"><span class="icon sm ok">check_circle</span>Nothing to move: the days are even and under capacity.</span>
    </div>
  </section>
</template>

<style scoped>
.bal { display: flex; align-items: center; gap: 8px 18px; flex-wrap: wrap; padding: 8px 16px; border-bottom: 1px solid var(--border); background: var(--surface); border-left: 3px solid currentColor; }
.verdict { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 15px; white-space: nowrap; }
.facts { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--text); }
.moves { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; justify-content: flex-end; color: var(--text); }
.mv { display: flex; align-items: center; gap: 8px; max-width: 260px; border: 1px solid var(--border); background: var(--surface-2); border-radius: 2px; padding: 3px 8px; font: inherit; font-size: 13px; color: var(--text); cursor: pointer; }
.mv:hover { border-color: var(--accent); }
.mv .t { min-width: 0; }
.mv .mono { white-space: nowrap; color: var(--muted); font-size: 12px; }
.mv b { color: var(--accent); }
/* phones: the cards carry the "→ Wed" tags and the ⚖ panel lists the moves, so keep the bar to two lines */
@media (max-width: 640px) { .bal { padding: 6px 10px; gap: 4px 12px; } .moves { display: none; } }
</style>
