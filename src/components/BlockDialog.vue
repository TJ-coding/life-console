<script setup>
// Edit / delete a fixed calendar block (opened by clicking it on any timeline — ISS-8).
import { computed } from 'vue'
import { ui, state, deleteBlock, toast, toMin } from '../store'

const b = computed(() => (ui.blockId ? state.timeBlocks.find((x) => x.id === ui.blockId) : null))
const durMin = computed(() => (b.value ? toMin(b.value.end) - toMin(b.value.start) : 0))
// what this block's category colour means; same palette as the timeline
const CATS = {
  research: 'Research · thesis work',
  academic: 'Academic · coursework',
  experiment: 'Experiment · lab',
  kaizen: 'Kaizen · maintenance',
}
function close() { ui.blockId = null }
function remove() {
  const copy = deleteBlock(b.value.id)
  if (copy) {
    close()
    toast(`Removed ${copy.title} ${copy.start}–${copy.end}`, { label: 'Undo', run: () => state.timeBlocks.push(copy) })
  }
}
</script>

<template>
  <div v-if="b" class="scrim" @mousedown.self="close" @keydown.esc.stop="close">
    <div class="dlg" role="dialog" aria-label="Edit block">
      <header class="hd">
        <span class="icon cat-ic" :class="'cat-' + b.category">event</span>
        <span class="mono btime">{{ b.start }}–{{ b.end }}{{ durMin ? ` · ${Math.floor(durMin / 60) ? Math.floor(durMin / 60) + 'h' : ''}${durMin % 60 ? (durMin % 60) + 'm' : ''}` : '' }}</span>
        <span class="spacer"></span>
        <button class="btn icon-only" title="Close (Esc)" @click="close"><span class="icon sm">close</span></button>
      </header>
      <div class="bd">
        <label class="field"><span>Title</span><input v-model="b.title" class="input big" autofocus /></label>
        <div class="grid">
          <label class="field"><span>Date</span><input v-model="b.date" type="date" class="input mono" /></label>
          <label class="field"><span>Link (goal / plan / course)</span><input v-model.trim="b.link" class="input mono" placeholder="BASE, SP-01" /></label>
          <label class="field"><span>Start</span><input v-model="b.start" type="time" step="900" class="input mono" /></label>
          <label class="field"><span>End</span><input v-model="b.end" type="time" step="900" class="input mono" /></label>
        </div>
        <div class="field">
          <span class="lbl">Category</span>
          <div class="segs">
            <button v-for="(d, k) in CATS" :key="k" class="seg" :class="{ on: b.category === k, ['cat-' + k]: true }" @click="b.category = k">{{ d }}</button>
          </div>
        </div>
      </div>
      <footer class="ft">
        <button class="btn danger-ghost" title="Remove this block from the schedule · undo in the toast" @click="remove"><span class="icon sm">event_busy</span>Remove from schedule</button>
        <span class="spacer"></span>
        <button class="btn primary" @click="close">Done</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--scrim); z-index: 55; display: flex; justify-content: center; align-items: flex-start; padding-top: 10vh; }
.dlg { width: 460px; max-width: calc(100vw - 32px); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; display: flex; flex-direction: column; }
.hd { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.btime { font-size: 13px; font-weight: 600; }
.cat-ic.cat-research, .seg.cat-research.on { color: var(--cat-research); }
.cat-ic.cat-academic, .seg.cat-academic.on { color: var(--cat-academic); }
.cat-ic.cat-experiment, .seg.cat-experiment.on { color: var(--cat-experiment); }
.cat-ic.cat-kaizen, .seg.cat-kaizen.on { color: var(--cat-kaizen); }
.bd { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.input.big { height: 34px; font-size: 15px; font-weight: 600; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.lbl { font: 600 10px/12px 'JetBrains Mono', monospace; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 4px; }
.segs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.seg { border: 1px solid var(--border); background: transparent; color: var(--muted); border-radius: 2px; padding: 6px; font: inherit; font-size: 12px; cursor: pointer; text-align: left; }
.seg.on { border-color: currentColor; background: color-mix(in srgb, currentColor 8%, transparent); color: currentColor; }
.ft { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }
</style>
