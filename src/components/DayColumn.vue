<script setup>
// One day column of the Weekly Planner (S-10): header · schedule · todos · deadlines · notes · stamps.
import { computed, ref } from 'vue'
import { state, ui, todayISO, wd, wdJa, fmtSlash, todosForDay, blocksForDay, workload, updateTodo, diffDays } from '../store'
import DayTimeline from './DayTimeline.vue'
import TodoRow from './TodoRow.vue'
import Gauge from './Gauge.vue'
import Stamps from './Stamps.vue'

const props = defineProps({ date: String, filter: String })
const isToday = computed(() => props.date === todayISO())
const todos = computed(() => todosForDay(props.date))
const blocks = computed(() => blocksForDay(props.date))
const hours = computed(() => workload(props.date))
const deadlines = computed(() => state.deadlines.filter((d) => d.due.slice(0, 10) === props.date))
const matches = (links) => !props.filter || links.includes(props.filter)
const dimBlock = (b) => props.filter && b.link !== props.filter && !(b.todoId && matches(state.todos.find((t) => t.id === b.todoId)?.links ?? []))
const notes = computed({ get: () => state.notes[props.date] ?? '', set: (v) => { state.notes[props.date] = v } })
const hot = ref(false)
function onDrop(e) {
  hot.value = false
  const id = e.dataTransfer.getData('text/x-todo')
  if (id) updateTodo(id, { scheduled: { date: props.date, start: null } })
}
const schedule = (id, start) => updateTodo(id, { scheduled: { date: props.date, start } })
</script>

<template>
  <div class="day panel" :class="{ today: isToday, past: diffDays(date, todayISO()) > 0 }">
    <header class="dh">
      <div class="row">
        <span class="ja">{{ wdJa(date) }}</span>
        <span class="mono md">{{ fmtSlash(date) }}</span>
        <span class="mono tiny muted">{{ wd(date) }}</span>
        <span class="spacer"></span>
        <span v-if="isToday" class="mono tiny ok">● NOW</span>
      </div>
      <div class="row">
        <span class="mono small" :class="hours > 8 ? 'danger' : hours > 7 ? 'warn' : ''">{{ hours.toFixed(1) }}h</span>
        <div class="grow"><Gauge :hours="hours" horizontal /></div>
      </div>
    </header>

    <div class="sec"><DayTimeline :date="date" :blocks="blocks" :dim-fn="filter ? dimBlock : null" @drop-todo="schedule" @open="(id) => (ui.drawerId = id)" /></div>

    <div class="sec drop" :class="{ 'drop-hot': hot }" @dragover.prevent="hot = true" @dragleave="hot = false" @drop.prevent="onDrop">
      <div class="sh tiny upper muted">Todo list <span class="spacer"></span>{{ todos.filter((t) => t.done).length }}/{{ todos.length }}</div>
      <TodoRow v-for="t in todos" :key="t.id" :todo="t" adopt-date flag-untimed compact :show-links="false" :dim="!matches(t.links)" />
      <div v-if="!todos.length" class="drop-empty small muted">drop todos here</div>
    </div>

    <div class="sec">
      <div class="sh tiny upper muted">Deadlines</div>
      <label v-for="d in deadlines" :key="d.id" class="dl small" :class="{ done: d.done }">
        <input v-model="d.done" type="checkbox" />
        <span class="ellipsis grow" :title="d.title">{{ d.title }}</span>
        <span v-if="d.clickUp" class="ok" title="ClickUp">●</span>
        <span class="mono muted">{{ d.due.slice(11) }}</span>
      </label>
      <div v-if="!deadlines.length" class="small muted pad">—</div>
    </div>

    <div class="sec">
      <div class="sh tiny upper muted">Notes</div>
      <textarea v-model="notes" class="textarea notes" rows="2" placeholder="…"></textarea>
    </div>

    <div class="sec stamps-sec"><Stamps :date="date" :size="24" /></div>
  </div>
</template>

<style scoped>
.day { min-width: 150px; overflow: hidden; }
.day.today { border-color: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent); }
.day.past { opacity: 0.88; }
.dh { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border); }
.ja { font-family: 'Noto Sans JP'; font-weight: 700; font-size: 16px; }
.today .ja { color: var(--accent); }
.md { font-size: 15px; font-weight: 700; }
.sec { border-bottom: 1px solid var(--border); padding: 6px 6px; }
.sh { display: flex; padding: 2px 2px 4px; }
.drop { min-height: 70px; }
.drop-empty { border: 1px dashed var(--border); border-radius: 2px; text-align: center; padding: 8px; }
.dl { display: flex; align-items: center; gap: 5px; padding: 3px 2px; cursor: pointer; }
.dl.done span.grow { text-decoration: line-through; color: var(--muted); }
.pad { padding: 2px; }
.notes { width: 100%; font-size: 11px; line-height: 15px; }
.stamps-sec { display: flex; justify-content: center; border-bottom: 0; padding: 8px; }
</style>
