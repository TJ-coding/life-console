<script setup>
// One day of the Workload sheet: a 7-hour bucket (like the paper "1 Hour … 7 Hours" gauge).
// Todos stack from the bottom, each block sized by its estimate; anything past capacity spills into a red overflow zone.
import { computed, ref } from 'vue'
import { state, ui, todayISO, wd, wdJa, fmtSlash, todosForDay, categoryOf, updateTodo, toMin, diffDays, CAPACITY_H, partLabel, toast } from '../store'
import { TODO_MIME, startDrag, endDrag, overRow, leaveRow, dropOnRow, dropClass } from '../dnd'
// (dropping onto a card goes through dnd.dropOnRow; the bucket's own drop handler covers empty space)

const props = defineProps({
  date: { type: String, required: true },
  withBlocks: Boolean, // include fixed calendar blocks as a grey base layer
  cap: { type: Number, default: CAPACITY_H },
  hourPx: { type: Number, default: 30 },
})
const isToday = computed(() => props.date === todayISO())
const past = computed(() => diffDays(props.date, todayISO()) > 0)
const todos = computed(() => todosForDay(props.date))
const fixedH = computed(() => (props.withBlocks
  ? state.timeBlocks.filter((b) => b.date === props.date).reduce((s, b) => s + (toMin(b.end) - toMin(b.start)) / 60, 0)
  : 0))
const total = computed(() => fixedH.value + todos.value.reduce((s, t) => s + (t.timeMin || 0) / 60, 0))
const rows = computed(() => Math.max(props.cap, Math.ceil(total.value)))
const deadlines = computed(() => state.deadlines.filter((d) => d.due.slice(0, 10) === props.date && !d.done))
const level = computed(() => (total.value > props.cap ? 'danger' : total.value > props.cap * 0.85 ? 'warn' : ''))
const blockH = (min) => Math.max(14, (min / 60) * props.hourPx - 2)

const hot = ref(false)
function onDrop(e) {
  hot.value = false
  const id = e.dataTransfer.getData(TODO_MIME)
  if (!id) return
  const t = state.todos.find((x) => x.id === id)
  // keep the start time only if it stays on the same day
  updateTodo(id, { scheduled: { date: props.date, start: t?.scheduled?.date === props.date ? t.scheduled.start : null } })
  offerSplit(t)
}
/** If the drop pushed this day over capacity, offer to split the task instead. */
function offerSplit(t) {
  if (t && total.value > props.cap && t.timeMin >= 30) {
    toast(`${wd(props.date)} is now ${total.value.toFixed(1)}h / ${props.cap}h`, { label: 'Split it…', run: () => { ui.splitId = t.id } })
  }
}
</script>

<template>
  <div class="day panel" :class="{ today: isToday, past }">
    <header class="dh">
      <div class="row">
        <span class="ja">{{ wdJa(date) }}</span>
        <span class="mono md">{{ fmtSlash(date) }}</span>
        <span class="mono tiny muted">{{ wd(date) }}</span>
        <span class="spacer"></span>
        <span v-if="isToday" class="mono tiny ok">● NOW</span>
      </div>
      <div class="row mono small">
        <span v-if="level === 'danger'" class="icon sm danger">warning</span>
        <b :class="level">{{ total.toFixed(1) }}h</b><span class="muted">/ {{ cap }}h</span>
        <span class="spacer"></span>
        <span class="muted" :title="`${todos.length} tasks`">{{ todos.length }}<span class="icon tiny-i">task_alt</span></span>
      </div>
    </header>

    <div
      class="bucket" :class="{ 'drop-hot': hot }" :style="{ height: rows * hourPx + 'px' }"
      @dragover.prevent="hot = true" @dragleave="hot = false" @drop.prevent="onDrop"
    >
      <div v-for="r in rows" :key="r" class="hrow" :class="{ over: rows - r + 1 > cap }" :style="{ top: (r - 1) * hourPx + 'px', height: hourPx + 'px' }">
        <span class="mono">{{ rows - r + 1 }}h</span>
      </div>
      <div class="capline" :style="{ bottom: cap * hourPx + 'px' }"></div>
      <div class="stack">
        <div v-if="fixedH" class="fixed" :style="{ height: blockH(fixedH * 60) + 'px' }" title="Fixed calendar blocks (lectures, training…)">
          <span class="mono">fixed {{ fixedH.toFixed(1) }}h</span>
        </div>
        <div
          v-for="t in todos" :key="t.id" class="card block" draggable="true"
          :class="['cat-' + categoryOf(t), { 'is-done': t.done, sel: ui.selectedId === t.id, short: blockH(t.timeMin) < 26 }, dropClass(t, true)]"
          :style="{ height: blockH(t.timeMin) + 'px' }"
          :title="`${t.title} · ${t.timeMin}m · P${t.priority}${t.scheduled?.start ? ' · ' + t.scheduled.start : ' · no time yet'}`"
          @dragstart="startDrag($event, t)" @dragend="endDrag"
          @dragover="overRow($event, t, { reverse: true })" @dragleave="leaveRow($event, t)" @drop="dropOnRow($event, t, { adoptDate: true })"
          @click="ui.selectedId = t.id" @dblclick="ui.drawerId = t.id"
        >
          <span class="ttl"><b v-if="partLabel(t)" class="part mono">{{ partLabel(t) }}</b>{{ t.title }}</span>
          <button v-if="!t.done && t.timeMin >= 30" class="splitbtn" title="Split across days" @click.stop="ui.splitId = t.id"><span class="icon">call_split</span></button>
          <span class="meta mono"><span v-if="t.scheduled?.start" class="icon tiny-i" title="Has a time">schedule</span>{{ t.timeMin }}m</span>
        </div>
      </div>
      <div v-if="!todos.length && !fixedH" class="empty-hint small muted">drop tasks here</div>
    </div>

    <div class="sec">
      <div class="tiny upper muted">Deadlines</div>
      <div v-for="d in deadlines" :key="d.id" class="small row dl"><span class="ellipsis grow" :title="d.title">{{ d.title }}</span><span class="mono muted">{{ d.due.slice(11) }}</span></div>
      <div v-if="!deadlines.length" class="small muted">—</div>
    </div>
  </div>
</template>

<style scoped>
.day { min-width: 150px; overflow: hidden; }
.day.today { border-color: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent); }
.day.past { opacity: 0.8; }
.dh { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border); }
.ja { font-family: 'Noto Sans JP'; font-weight: 700; font-size: 16px; }
.today .ja { color: var(--accent); }
.md { font-size: 15px; font-weight: 700; }
.bucket { position: relative; margin: 6px; border: 1px solid var(--border); border-radius: 2px; background: var(--surface-2); }
.hrow { position: absolute; left: 0; right: 0; border-top: 1px solid var(--border); }
.hrow:first-child { border-top: 0; }
.hrow span { position: absolute; left: 3px; top: 2px; font-size: 9px; color: var(--muted); }
.hrow.over { background: color-mix(in srgb, var(--danger) 10%, transparent); }
.capline { position: absolute; left: 0; right: 0; border-top: 2px solid var(--muted); z-index: 1; pointer-events: none; }
.stack { position: absolute; left: 24px; right: 3px; bottom: 1px; display: flex; flex-direction: column-reverse; gap: 2px; z-index: 2; }
.fixed {
  flex: none; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--muted);
  background: repeating-linear-gradient(45deg, var(--border) 0 2px, transparent 2px 7px); border: 1px solid var(--border);
}
.card { flex: none; padding: 2px 5px; display: flex; gap: 4px; align-items: flex-start; cursor: grab; position: relative; }
.card .ttl { flex: 1; min-width: 0; font-size: 11px; line-height: 13px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; word-break: break-word; }
.card.short .ttl { -webkit-line-clamp: 1; white-space: nowrap; display: block; text-overflow: ellipsis; }
.card .meta { font-size: 9px; color: var(--muted); display: flex; align-items: center; gap: 2px; white-space: nowrap; }
.tiny-i { font-size: 11px; }
.part { font-weight: 600; font-size: 9px; margin-right: 4px; opacity: 0.8; }
.splitbtn { position: absolute; top: 1px; right: 1px; display: none; border: 1px solid var(--border); background: var(--surface); border-radius: 2px; padding: 0 1px; cursor: pointer; color: var(--text); line-height: 1; }
.splitbtn .icon { font-size: 13px; }
.card:hover .splitbtn { display: block; }
.card.sel { outline: 1px solid var(--info); }
.card.is-done .ttl { text-decoration: line-through; }
.empty-hint { position: absolute; left: 24px; right: 4px; bottom: 8px; text-align: center; border: 1px dashed var(--border); border-radius: 2px; padding: 6px; }
.sec { padding: 6px 10px 10px; display: flex; flex-direction: column; gap: 3px; border-top: 1px solid var(--border); }
.dl { gap: 6px; }
</style>
