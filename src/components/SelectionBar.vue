<script setup>
// Shown while schedule blocks are multi-selected (box select, Shift/⌘-click, long-press on phones):
// move them together by 15 min / a day, take them off the schedule, or clear the selection.
import { ui, shiftSelected, removeSelected, clearBlockSel } from '../store'
</script>

<template>
  <div v-if="ui.selBlocks.length" class="selbar" role="toolbar" aria-label="Selected schedule items">
    <b class="mono n">{{ ui.selBlocks.length }}</b><span class="lbl">selected</span>
    <span class="sep"></span>
    <button class="btn sm icon-only" title="15 min earlier (↑ · Shift+↑ = 1 h)" aria-label="15 minutes earlier" @click="shiftSelected(-15)"><span class="icon sm">keyboard_arrow_up</span></button>
    <button class="btn sm icon-only" title="15 min later (↓ · Shift+↓ = 1 h)" aria-label="15 minutes later" @click="shiftSelected(15)"><span class="icon sm">keyboard_arrow_down</span></button>
    <button class="btn sm icon-only" title="A day earlier (←)" aria-label="A day earlier" @click="shiftSelected(0, -1)"><span class="icon sm">keyboard_arrow_left</span></button>
    <button class="btn sm icon-only" title="A day later (→)" aria-label="A day later" @click="shiftSelected(0, 1)"><span class="icon sm">keyboard_arrow_right</span></button>
    <span class="sep"></span>
    <button class="btn sm icon-only" title="Take them off the schedule (Delete) · tasks stay on their day" aria-label="Take off the schedule" @click="removeSelected"><span class="icon sm">event_busy</span></button>
    <button class="btn sm icon-only" title="Clear selection (Esc)" aria-label="Clear selection" @click="clearBlockSel"><span class="icon sm">close</span></button>
    <span class="hint tiny muted">drag any to move all · ↑↓ ←→</span>
  </div>
</template>

<style scoped>
.selbar {
  position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 59;
  display: flex; align-items: center; gap: 6px; padding: 5px 8px 5px 12px;
  background: var(--surface-2); border: 1px solid var(--accent); border-radius: 4px;
  box-shadow: 0 6px 24px color-mix(in srgb, #000 35%, transparent);
}
.n { color: var(--accent); font-size: 15px; }
.lbl { font-size: 12px; margin-right: 2px; }
.sep { width: 1px; align-self: stretch; background: var(--border); margin: 0 2px; }
.hint { margin-left: 4px; white-space: nowrap; }
@media (max-width: 640px) {
  .selbar { bottom: calc(112px + env(safe-area-inset-bottom)); gap: 4px; padding: 4px 6px 4px 10px; }
  .selbar .btn { min-width: 36px; min-height: 36px; }
  .hint { display: none; }
}
</style>
