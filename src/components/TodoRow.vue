<script setup>
// Compact todo row: checkbox · title + vital points · time · L/S/D · linked chips. Draggable.
import { ui, toggleTodo, updateTodo, partLabel } from '../store'
import { startDrag, endDrag, overRow, leaveRow, dropOnRow, dropClass } from '../dnd'
import LsdToggle from './LsdToggle.vue'
import Chip from './Chip.vue'
defineProps({ todo: { type: Object, required: true }, showLinks: { type: Boolean, default: true }, compact: Boolean, dim: Boolean, adoptDate: Boolean, flagUntimed: Boolean })
</script>
<template>
  <div
    class="trow" :class="[{ done: todo.done, sel: ui.selectedId === todo.id, compact, dim }, dropClass(todo)]" draggable="true"
    @dragstart="startDrag($event, todo)" @dragend="endDrag"
    @dragover="overRow($event, todo)" @dragleave="leaveRow($event, todo)" @drop="dropOnRow($event, todo, { adoptDate })" @click="ui.selectedId = todo.id" @dblclick="ui.drawerId = todo.id"
  >
    <input type="checkbox" :checked="todo.done" @click.stop @change="toggleTodo(todo.id)" />
    <div class="grow">
      <div class="title ellipsis"><span v-if="partLabel(todo)" class="part mono">{{ partLabel(todo) }}</span>{{ todo.title }}</div>
      <div v-if="todo.vital && !compact" class="small muted ellipsis">{{ todo.vital }}</div>
    </div>
    <span class="mono small time" :class="{ warn: todo.timeMin >= 90 }">{{ todo.timeMin }}m</span>
    <LsdToggle v-if="!compact" :model-value="todo.lsd" @update:model-value="(v) => updateTodo(todo.id, { lsd: v })" />
    <span v-else class="mono tiny muted">{{ todo.lsd }}</span>
    <span v-if="flagUntimed && !todo.done && !todo.scheduled?.start" class="icon untimed" title="No time yet — drag onto the schedule">more_time</span>
    <span v-if="showLinks && todo.links.length" class="links"><Chip :id="todo.links[todo.links.length - 1]" /></span>
    <button class="open" title="Open (Enter)" @click.stop="ui.drawerId = todo.id"><span class="icon sm">chevron_right</span></button>
  </div>
</template>
<style scoped>
.trow { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 4px 8px; border-bottom: 1px solid var(--border); cursor: grab; }
.trow.compact { gap: 5px; padding: 3px 6px; min-height: 26px; font-size: 11px; }
.trow:hover { background: var(--surface-2); }
.trow.sel { box-shadow: inset 0 0 0 1px var(--info); }
.trow.done .title { text-decoration: line-through; color: var(--muted); }
.trow.dim { opacity: 0.3; }
.time { color: var(--muted); }
.time.warn { color: var(--warn); }
.links { display: flex; gap: 4px; }
.open { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; display: flex; opacity: 0; }
.trow:hover .open, .trow.sel .open { opacity: 1; }
.compact .open { display: none; }
.part { font-size: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 2px; padding: 0 3px; margin-right: 5px; }
.untimed { font-size: 13px; color: var(--warn); }
</style>
