<script setup>
// ISS-28: the right-click / long-press menu for the current selection (store.openCtxMenu opens it).
// Recombine shows when ≥ 2 open parts of one split task are selected: only those parts join.
import { computed, nextTick, ref, watch } from 'vue'
import { ui, findTodo, state, selectedPartGroups, recombineParts, shiftSelected, removeSelected, clearBlockSel, sendToNextDay } from '../store'

const el = ref(null)
const pos = ref({ left: 0, top: 0 })
const keys = computed(() => ui.selBlocks)
const groups = computed(() => (ui.ctxMenu ? selectedPartGroups() : []))
const single = computed(() => {
  if (keys.value.length !== 1) return null
  const [kind, id] = [keys.value[0].slice(0, keys.value[0].indexOf(':')), keys.value[0].slice(keys.value[0].indexOf(':') + 1)]
  return kind === 'todo' ? { kind, todo: findTodo(id) } : { kind, block: state.timeBlocks.find((b) => b.id === id) }
})
const n = computed(() => keys.value.length)
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`)

function close() { ui.ctxMenu = null }
function run(fn) { close(); fn() }
const open = () => run(() => { const s = single.value; if (s?.todo) ui.drawerId = s.todo.id; else if (s?.block) ui.blockId = s.block.id; clearBlockSel() })
const recombine = (g) => run(() => { recombineParts(g.parts.map((p) => p.id)) })
const nextDay = () => run(() => { const s = single.value; if (s?.todo) { sendToNextDay(s.todo.id); clearBlockSel() } else shiftSelected(0, 1) })
const offSchedule = () => run(removeSelected)

watch(() => ui.ctxMenu, async (m) => {
  if (!m) return
  pos.value = { left: m.x, top: m.y }
  await nextTick()
  const r = el.value?.getBoundingClientRect()
  if (r) pos.value = { left: Math.max(8, Math.min(m.x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(m.y, window.innerHeight - r.height - 8)) }
  el.value?.querySelector('button')?.focus()
})
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close() } }
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.ctxMenu" class="ctx-scrim" @mousedown.self="close" @contextmenu.prevent.self="close" @wheel="close">
      <div ref="el" class="ctxmenu panel" role="menu" :style="{ left: pos.left + 'px', top: pos.top + 'px' }" @keydown="onKey">
        <div class="ctx-h tiny upper muted">{{ n === 1 ? (single?.todo?.title ?? single?.block?.title ?? '1 item') : `${n} selected` }}</div>
        <button v-for="g in groups" :key="g.group" class="ctx-i strong" role="menuitem" @click="recombine(g)">
          <span class="icon sm">merge</span><span class="grow">Recombine {{ g.parts.length }} parts</span><span class="mono small muted">{{ hm(g.min) }}</span>
        </button>
        <button v-if="single" class="ctx-i" role="menuitem" @click="open"><span class="icon sm">open_in_new</span><span class="grow">Open</span></button>
        <button class="ctx-i" role="menuitem" @click="nextDay"><span class="icon sm">redo</span><span class="grow">Move to next day</span><span class="mono small muted">→</span></button>
        <button class="ctx-i" role="menuitem" @click="offSchedule"><span class="icon sm">event_busy</span><span class="grow">Take off the schedule</span><span class="mono small muted">Del</span></button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-scrim { position: fixed; inset: 0; z-index: 210; }
.ctxmenu { position: fixed; min-width: 220px; max-width: 300px; padding: 4px; display: flex; flex-direction: column; gap: 1px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); }
.ctx-h { padding: 4px 8px 6px; border-bottom: 1px solid var(--border); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ctx-i { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; text-align: left; padding: 7px 8px; border-radius: 2px; cursor: pointer; }
.ctx-i:hover, .ctx-i:focus-visible { background: var(--surface-2); outline: none; }
.ctx-i.strong { color: var(--info); font-weight: 600; }
</style>
