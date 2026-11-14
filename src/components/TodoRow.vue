<script setup>
// Compact todo row: checkbox · title + vital points · time · L/S/D · linked chips. Draggable.
import PartBadge from './PartBadge.vue'
import { computed } from 'vue'
import { ui, toggleTodo, updateTodo, partLabel, isContainer, subCount, parentPath, sendToNextDay, addDays, todayISO, wd, fmtSlash, rowSelectClick, isTodoSel, openCtxMenu } from '../store'
import { startDrag, endDrag, overRow, leaveRow, dropOnRow, dropClass } from '../dnd'
import LsdToggle from './LsdToggle.vue'
import Chip from './Chip.vue'
import Prio from './Prio.vue'
const props = defineProps({ todo: { type: Object, required: true }, showLinks: { type: Boolean, default: true }, compact: Boolean, dim: Boolean, adoptDate: Boolean, flagUntimed: Boolean, removable: Boolean, showStart: Boolean, showPrio: Boolean, nextDay: Boolean })
defineEmits(['remove'])
const box = computed(() => isContainer(props.todo))
const sub = computed(() => (box.value ? subCount(props.todo) : null))
/** ISS-31: where "move to the next day" would put it, said in words: Tomorrow, or the weekday + date */
const nextLabel = computed(() => {
  const d = addDays(props.todo.scheduled?.date ?? todayISO(), 1)
  return d === addDays(todayISO(), 1) ? 'tomorrow' : `${wd(d)} ${fmtSlash(d)}`
})
const crumb = computed(() => (props.todo.parent ? parentPath(props.todo) : ''))
</script>
<template>
  <div
    class="trow" :class="[{ done: todo.done, sel: ui.selectedId === todo.id, msel: isTodoSel(todo), compact, dim }, dropClass(todo)]" :draggable="!box" :data-bkey="'todo:' + todo.id"
    @dragstart="startDrag($event, todo)" @dragend="endDrag"
    @dragover="overRow($event, todo)" @dragleave="leaveRow($event, todo)" @drop="dropOnRow($event, todo, { adoptDate })" @click="rowSelectClick($event, todo) || (ui.selectedId = todo.id)" @contextmenu.prevent="openCtxMenu($event, ['todo:' + todo.id])" @dblclick="ui.drawerId = todo.id"
  >
    <input type="checkbox" :checked="todo.done" @click.stop @change="toggleTodo(todo.id)" />
    <span v-if="showStart" class="mono small start" :class="{ muted: !todo.scheduled?.start }">{{ todo.scheduled?.start ?? '--:--' }}</span>
    <Prio v-if="showPrio" :p="todo.priority" />
    <div class="grow">
      <div class="title ellipsis"><span v-if="crumb" class="crumb" :title="crumb">{{ crumb }} › </span><PartBadge v-if="partLabel(todo)" :todo="todo" class="part mono" />{{ todo.title }}<span v-if="sub" class="subc mono" :title="`${sub.done} of ${sub.total} subtasks done`">{{ sub.done }}/{{ sub.total }}</span></div>
      <div v-if="todo.vital && !compact" class="small muted ellipsis">{{ todo.vital }}</div>
    </div>
    <span class="mono small time" :class="{ warn: todo.timeMin >= 90 }">{{ todo.timeMin }}m</span>
    <LsdToggle v-if="!compact" :model-value="todo.lsd" @update:model-value="(v) => updateTodo(todo.id, { lsd: v })" />
    <span v-else class="mono tiny muted lsd-c">{{ todo.lsd }}</span>
    <span v-if="flagUntimed && !todo.done && !todo.scheduled?.start" class="icon untimed" title="No time yet — drag onto the schedule">more_time</span>
    <span v-if="showLinks && todo.links.length" class="links"><Chip :id="todo.links[todo.links.length - 1]" /></span>
    <button v-if="nextDay && !todo.done && !box" class="nd mono" :title="`Move to ${nextLabel} (>) · undo in the toast`" @click.stop="sendToNextDay(todo.id)">Move to {{ nextLabel }}</button>
    <button v-if="removable" class="rm" title="Delete this todo" @click.stop="$emit('remove', todo)"><span class="icon sm">close</span></button>
    <button class="open" title="Open (Enter)" @click.stop="ui.drawerId = todo.id"><span class="icon sm">chevron_right</span></button>
  </div>
</template>
<style scoped>
.trow { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 4px 8px; border-bottom: 1px solid var(--border); cursor: grab; }
.trow.compact { gap: 5px; padding: 3px 6px; min-height: 26px; font-size: 11px; }
.trow:hover { background: var(--surface-2); }
.trow.sel, .trow.msel { box-shadow: inset 0 0 0 1px var(--info); }
.trow.done .title { text-decoration: line-through; color: var(--muted); }
.trow.dim { opacity: 0.3; }
.time { color: var(--muted); }
.time.warn { color: var(--warn); }
.links { display: flex; gap: 4px; }
.open { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; display: flex; opacity: 0; }
.trow:hover .open, .trow.sel .open { opacity: 1; }
.compact .open { display: none; }
.part { font-size: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 2px; padding: 0 3px; margin-right: 5px; }
.start { flex: none; width: 38px; }
.rm { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; display: flex; opacity: 0.35; }
.rm:hover { color: var(--danger); opacity: 1; }
.trow:hover .rm, .trow.sel .rm { opacity: 1; }
/* next-day button: only on hover / when the row is selected, so the list stays quiet */
.nd { display: none; border: 1px solid var(--border); border-radius: 2px; background: var(--surface); color: var(--info); font-size: 10px; padding: 1px 6px; cursor: pointer; white-space: nowrap; }
.nd:hover { border-color: var(--info); }
.trow:hover .nd, .trow.sel .nd { display: inline-block; }
/* phones: make room for it on the selected row so the title stays readable */
@media (max-width: 640px) { .trow.sel:has(.nd) .time, .trow.sel:has(.nd) .lsd-c { display: none; } }
.untimed { font-size: 13px; color: var(--warn); }
.crumb { color: var(--muted); font-size: 0.9em; }
.subc { font-size: 10px; color: var(--info); border: 1px solid color-mix(in srgb, var(--info) 50%, var(--border)); border-radius: 2px; padding: 0 3px; margin-left: 6px; }
</style>
