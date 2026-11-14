<script setup>
// The "2/3" badge on a split task (ISS-28). Tap it to see all the parts, open one, or select them all
// (then right-click → Recombine joins the selected ones). The parent's `.part` styling applies to the root span.
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { ui, partLabel, splitSiblings, wd, fmtSlash } from '../store'

const props = defineProps({ todo: { type: Object, required: true } })
const open = ref(false)
const root = ref(null)
const pos = ref({ top: 0, left: 0 })
const parts = computed(() => splitSiblings(props.todo))
const openParts = computed(() => parts.value.filter((p) => !p.done))
const total = computed(() => openParts.value.reduce((s, p) => s + p.timeMin, 0))
const when = (p) => (p.scheduled ? `${wd(p.scheduled.date)} ${fmtSlash(p.scheduled.date)}${p.scheduled.start ? ' ' + p.scheduled.start : ''}` : 'backlog')

function onOutside(e) { if (!e.target.closest?.('.pb-pop') && !root.value?.contains(e.target)) close() }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close() } }
function close() {
  open.value = false
  document.removeEventListener('mousedown', onOutside, true)
  document.removeEventListener('touchstart', onOutside, true)
  document.removeEventListener('keydown', onKey, true)
}
async function toggle() {
  if (open.value) return close()
  const r = root.value.getBoundingClientRect()
  const w = Math.min(300, window.innerWidth - 16)
  pos.value = { top: Math.min(r.bottom + 4, window.innerHeight - 260), left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), width: w }
  open.value = true
  await nextTick()
  document.addEventListener('mousedown', onOutside, true)
  document.addEventListener('touchstart', onOutside, true)
  document.addEventListener('keydown', onKey, true)
}
/** Put every open part into the selection; deselect any you want to keep apart, then right-click → Recombine. */
function selectAll() {
  close()
  for (const p of openParts.value) { const k = `todo:${p.id}`; if (!ui.selBlocks.includes(k)) ui.selBlocks.push(k) }
}
function openPart(p) { close(); ui.drawerId = p.id }
onBeforeUnmount(close)
</script>

<template>
  <span ref="root" class="pb" role="button" tabindex="0" :title="`Part ${partLabel(todo)} of a split task · tap to see the parts or recombine them`" @click.stop="toggle" @mousedown.stop @keydown.enter.stop="toggle">{{ partLabel(todo) }}
    <Teleport to="body">
      <div v-if="open" class="pb-pop panel" :style="{ top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px' }" @click.stop>
        <div class="pb-h tiny upper muted">Split into {{ parts.length }} parts</div>
        <button v-for="p in parts" :key="p.id" class="pb-row" :class="{ cur: p.id === todo.id, done: p.done }" :title="`Open ${p.id}`" @click="openPart(p)">
          <span class="mono">{{ partLabel(p) }}</span>
          <span class="grow mono small">{{ when(p) }}</span>
          <span class="mono small">{{ p.timeMin }}m</span>
          <span v-if="p.done" class="ok">✓</span>
        </button>
        <button v-if="openParts.length > 1" class="btn sm pb-go" title="Select the open parts, then right-click one → Recombine (or use the selection bar)" @click="selectAll"><span class="icon sm">select_all</span>Select all parts</button>
        <div class="tiny muted pb-note">To recombine: select the parts (⌘-click, or long-press then tap), then right-click → Recombine.</div>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.pb { cursor: pointer; display: inline-block; }
.pb:hover { border-color: var(--info) !important; color: var(--info) !important; }
.pb-pop { position: fixed; z-index: 200; padding: 6px; display: flex; flex-direction: column; gap: 2px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); font-size: 13px; color: var(--text); text-transform: none; letter-spacing: normal; font-weight: 400; white-space: normal; }
.pb-h { padding: 2px 6px 4px; }
.pb-row { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; padding: 6px; border-radius: 2px; cursor: pointer; }
.pb-row:hover { background: var(--surface-2); }
.pb-row.cur { background: var(--surface-2); outline: 1px solid var(--border); }
.pb-row.done { color: var(--muted); text-decoration: line-through; }
.pb-go { margin-top: 6px; justify-content: center; }
.pb-note { padding: 6px; }
</style>
