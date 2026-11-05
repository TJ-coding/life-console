<script setup>
// Edit / delete a deadline (opened by setting ui.deadlineId anywhere in the app).
import { computed } from 'vue'
import { ui, state, deleteDeadline, isOverdue, relDay, todayISO } from '../store'

const d = computed(() => (ui.deadlineId ? state.deadlines.find((x) => x.id === ui.deadlineId) : null))
const date = computed({ get: () => d.value.due.slice(0, 10), set: (v) => { if (v) d.value.due = `${v}T${d.value.due.slice(11)}` } })
const time = computed({ get: () => d.value.due.slice(11), set: (v) => { if (v) d.value.due = `${d.value.due.slice(0, 10)}T${v}` } })
const close = () => { ui.deadlineId = null }
function remove() {
  if (confirm(`Delete ${d.value.id} "${d.value.title}"?`)) deleteDeadline(d.value.id)
}
</script>

<template>
  <div v-if="d" class="scrim" @mousedown.self="close" @keydown.esc.stop="close">
    <div class="dlg" role="dialog" aria-label="Edit deadline">
      <header class="hd">
        <span class="icon warn">alarm</span>
        <span class="mono">{{ d.id }}</span>
        <span class="status" :class="d.done ? 'done' : isOverdue(d) ? '' : 'doing'" :style="isOverdue(d) ? 'color: var(--danger); border-color: var(--danger)' : ''">
          {{ d.done ? 'DONE ✓' : isOverdue(d) ? 'OVERDUE' : relDay(d.due, todayISO()).toUpperCase() }}
        </span>
        <span class="spacer"></span>
        <button class="btn icon-only" title="Close (Esc)" @click="close"><span class="icon sm">close</span></button>
      </header>
      <div class="bd">
        <label class="field"><span>Deadline</span><input v-model="d.title" class="input big" autofocus /></label>
        <label class="field"><span>Vital points</span><input v-model="d.vital" class="input" placeholder="What must be true when it's handed in" /></label>
        <div class="grid">
          <label class="field"><span>Date</span><input v-model="date" type="date" class="input mono" /></label>
          <label class="field"><span>Time</span><input v-model="time" type="time" class="input mono" /></label>
          <label class="field"><span>Source (course / plan / goal)</span><input v-model.trim="d.source" class="input mono" placeholder="ST2001spA" /></label>
          <label class="field"><span>Priority</span>
            <select v-model.number="d.priority" class="select mono"><option v-for="p in 5" :key="p" :value="p">P{{ p }}</option></select>
          </label>
        </div>
        <div class="row checks">
          <label class="row"><input v-model="d.done" type="checkbox" /> Done</label>
          <label class="row"><input v-model="d.clickUp" type="checkbox" /> Synced with ClickUp</label>
        </div>
      </div>
      <footer class="ft">
        <button class="btn danger-ghost" @click="remove"><span class="icon sm">delete</span>Delete</button>
        <span class="spacer"></span>
        <button class="btn primary" @click="close">Done</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--scrim); z-index: 55; display: flex; justify-content: center; align-items: flex-start; padding-top: 10vh; }
.dlg { width: 520px; max-width: calc(100vw - 32px); background: var(--surface); border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--border)); border-radius: 4px; display: flex; flex-direction: column; }
.hd { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.bd { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.input.big { height: 34px; font-size: 15px; font-weight: 600; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.checks { gap: 18px; }
.checks label { gap: 6px; cursor: pointer; }
.ft { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }
</style>
