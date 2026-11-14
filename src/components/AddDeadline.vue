<script setup>
// The + deadline button for a plan or goal (ISS-36). Press it, then choose: a new deadline, or link one you
// already have. With nothing to link it goes straight to a new one, as before. Linking sets the deadline's
// `source` to this plan / goal number (undo in the toast).
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { state, toast, fmtSlash } from '../store'
import { effDue } from '../glance'

const props = defineProps({
  no: { type: String, required: true }, // plan or goal number the deadline is for
  label: { type: String, default: 'this goal' }, // "this PSG", "this plan"… for titles
  have: { type: Array, default: null }, // sources that already count as linked here (a plan: all its numbers); default [no]
})
const emit = defineEmits(['new'])
const open = ref(false)
const btn = ref(null)
const pos = ref({ top: 0, left: 0 })
/** Open deadlines not already linked here, soonest first. */
const linkable = computed(() => state.deadlines.filter((d) => !d.done && !(props.have ?? [props.no]).includes(d.source)).sort((a, b) => effDue(a).localeCompare(effDue(b))))

function onOutside(e) { if (!e.target.closest?.('.adl-pop') && !btn.value?.contains(e.target)) close() }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close() } }
function close() {
  open.value = false
  document.removeEventListener('mousedown', onOutside, true)
  document.removeEventListener('keydown', onKey, true)
}
async function toggle() {
  if (open.value) return close()
  if (!linkable.value.length) return emit('new') // nothing to choose from: straight to a new one
  const r = btn.value.getBoundingClientRect()
  const w = 320
  pos.value = { top: Math.min(r.bottom + 4, window.innerHeight - 280), left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) }
  open.value = true
  await nextTick()
  document.addEventListener('mousedown', onOutside, true)
  document.addEventListener('keydown', onKey, true)
}
function makeNew() { close(); emit('new') }
function link(d) {
  close()
  const prev = d.source
  d.source = props.no
  toast(`${d.id} linked to ${props.no}${prev ? ` (was ${prev})` : ''}`, { label: 'Undo', run: () => { d.source = prev } })
}
onBeforeUnmount(close)
</script>

<template>
  <button ref="btn" class="btn sm icon-only" :class="{ active: open }" :title="`Add a deadline for ${label}`" @click.stop="toggle"><span class="icon sm">alarm_add</span></button>
  <Teleport to="body">
    <div v-if="open" class="adl-pop panel" :style="{ top: pos.top + 'px', left: pos.left + 'px' }" role="menu" @click.stop>
      <button class="adl-new" role="menuitem" @click="makeNew"><span class="icon sm">add</span>New deadline for {{ no }}</button>
      <div class="adl-h tiny upper muted">or link one you already have</div>
      <div class="adl-list">
        <button v-for="d in linkable" :key="d.id" class="adl-row" role="menuitem" :title="`Link ${d.id} to ${no}`" @click="link(d)">
          <span class="ellipsis grow">{{ d.title }}</span>
          <span class="mono small muted">{{ fmtSlash(d.due) }}</span>
          <span v-if="d.source" class="mono tiny muted adl-src">{{ d.source }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.adl-pop { position: fixed; z-index: 200; width: 320px; padding: 4px; display: flex; flex-direction: column; gap: 2px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); }
.adl-new, .adl-row { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; text-align: left; padding: 6px 8px; border-radius: 2px; cursor: pointer; }
.adl-new { color: var(--info); font-weight: 600; }
.adl-new:hover, .adl-row:hover { background: var(--surface-2); }
.adl-h { padding: 6px 8px 2px; border-top: 1px solid var(--border); margin-top: 2px; }
.adl-list { max-height: 220px; overflow-y: auto; }
.adl-src { border: 1px solid var(--border); border-radius: 2px; padding: 0 4px; }
</style>
