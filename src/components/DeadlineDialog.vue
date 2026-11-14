<script setup>
// Edit / delete a deadline (opened by setting ui.deadlineId anywhere in the app).
import DateInput from './DateInput.vue'
import { computed } from 'vue'
import { ui, state, deleteDeadline, isOverdue, relDay, todayISO } from '../store'
/** ISS-36: what Source can point at — every plan and goal number, with its name, as suggestions */
const sourceOpts = computed(() => state.plans.flatMap((p) => [{ no: p.planNo, name: p.title }, ...p.psgs.map((g) => ({ no: g.no, name: `${g.name} (${p.planNo})` })), ...p.sigs.map((g) => ({ no: g.no, name: `${g.name} (${p.planNo})` }))]))

const d = computed(() => (ui.deadlineId ? state.deadlines.find((x) => x.id === ui.deadlineId) : null))
const date = computed({ get: () => d.value.due.slice(0, 10), set: (v) => { if (v) d.value.due = `${v}T${d.value.due.slice(11)}` } })
const time = computed({ get: () => d.value.due.slice(11), set: (v) => { if (v) d.value.due = `${d.value.due.slice(0, 10)}T${v}` } })
/** Tasks linked to this deadline (links contain the DL id), or heading to it via source. */
const linked = computed(() => state.todos.filter((t) => t.links.includes(d.value.id)).sort((a, b) => a.done - b.done))
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
          <label class="field"><span>Date</span><DateInput v-model="date" class="input mono" /></label>
          <label class="field"><span>Time</span><input v-model="time" type="time" class="input mono" /></label>
          <label class="field"><span>Internal deadline (yours)</span><DateInput v-model="d.internal" class="input mono" title="Working target before the hard deadline; leave empty if none" /></label>
          <label class="field"><span>Source (course / plan / goal)</span><input v-model.trim="d.source" class="input mono" placeholder="RUN" list="dl-sources" title="A course code, or a plan / goal number — type to pick one" /></label>
          <datalist id="dl-sources"><option v-for="o in sourceOpts" :key="o.no" :value="o.no">{{ o.name }}</option></datalist>
          <label class="field"><span>Priority</span>
            <select v-model.number="d.priority" class="select mono"><option v-for="p in 5" :key="p" :value="p">P{{ p }}</option></select>
          </label>
        </div>
        <div class="row checks">
          <label class="row"><input v-model="d.done" type="checkbox" /> Done</label>
        </div>
        <!-- ISS-15: tasks linked to this deadline (link them from a task's drawer: + link deadline…) -->
        <div class="field">
          <span class="lbl">Tasks</span>
          <button v-for="t in linked" :key="t.id" class="lt row" :class="{ done: t.done }" :title="t.scheduled?.date ? `${t.scheduled.date}${t.scheduled.start ? ' ' + t.scheduled.start : ''}` : 'Backlog'" @click="ui.drawerId = t.id">
            <span class="mono tiny muted">{{ t.id }}</span>
            <span class="ellipsis">{{ t.title }}</span>
            <span class="mono tiny muted">{{ t.timeMin }}m</span>
            <span v-if="!t.scheduled" class="tiny muted">backlog</span>
          </button>
          <div v-if="!linked.length" class="small muted">None. Open a task (double-click it) and add <b class="mono">{{ d.id }}</b> under Linked records.</div>
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
.field .lbl { font: 600 10px/12px 'JetBrains Mono', monospace; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 4px; }
.lt { width: 100%; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 2px; padding: 4px 8px; gap: 8px; cursor: pointer; font: inherit; font-size: 12px; margin-bottom: 4px; }
.lt:hover { border-color: var(--info); }
.lt.done .ellipsis { text-decoration: line-through; color: var(--muted); }
.checks { gap: 18px; }
.checks label { gap: 6px; cursor: pointer; }
.ft { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }
</style>
