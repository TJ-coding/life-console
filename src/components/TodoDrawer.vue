<script setup>
// Right 480px side drawer for editing a todo (spec §2.4 "Side drawer").
import { computed } from 'vue'
import { ui, state, findTodo, deleteTodo, toggleTodo, updateTodo, linkType, splitSiblings, partLabel, mergeParts, wd, fmtSlash, toast } from '../store'
import Chip from './Chip.vue'

const t = computed(() => (ui.drawerId ? findTodo(ui.drawerId) : null))
const touch = () => { if (t.value) t.value.updatedAt = new Date().toISOString() }
const linksText = computed({
  get: () => t.value?.links.join(', ') ?? '',
  set: (v) => { t.value.links = v.split(/[,\s]+/).map((s) => s.replace(/^[#@]/, '')).filter(Boolean) },
})
const schedDate = computed({
  get: () => t.value?.scheduled?.date ?? '',
  set: (v) => { t.value.scheduled = v ? { date: v, start: t.value.scheduled?.start ?? null } : null },
})
const schedStart = computed({
  get: () => t.value?.scheduled?.start ?? '',
  set: (v) => { if (t.value.scheduled) t.value.scheduled.start = v || null },
})
const goalOptions = computed(() => state.plans.filter((p) => p.status !== 'archived').flatMap((p) => [...p.psgs.map((g) => g.no), ...p.sigs.map((s) => s.no)]))
const deadlineOptions = computed(() => state.deadlines.filter((d) => !d.done && !t.value?.links.includes(d.id)).sort((a, b) => a.due.localeCompare(b.due)))
function addLink(id) {
  if (id && !t.value.links.includes(id)) t.value.links.push(id)
}
const fmt = (s) => new Date(s).toLocaleString()
const parts = computed(() => splitSiblings(t.value))
function merge() {
  const k = mergeParts(t.value.id)
  if (k) { ui.drawerId = k.id; toast(`Merged into ${k.id} (${k.timeMin}m)`) }
}
function remove() {
  if (confirm(`Delete ${t.value.id}?`)) deleteTodo(t.value.id)
}
</script>

<template>
  <transition name="slide">
    <aside v-if="t" class="drawer" @change="touch" @input="touch">
      <header class="dh">
        <span class="mono id">{{ t.id }}</span>
        <span v-if="partLabel(t)" class="chip">part {{ partLabel(t) }}</span>
        <span class="prio" :class="'p' + t.priority">P{{ t.priority }}</span>
        <span class="status" :class="t.done ? 'done' : t.scheduled ? 'doing' : ''">{{ t.done ? 'DONE ✓' : t.scheduled ? 'SCHEDULED' : 'INBOX' }}</span>
        <span class="spacer"></span>
        <button class="btn icon-only" title="Close (Esc)" @click="ui.drawerId = null"><span class="icon">close</span></button>
      </header>
      <div class="db">
        <label class="field"><span>Task title</span><input v-model="t.title" class="input big" /></label>
        <label class="field"><span>Vital points</span><input v-model="t.vital" class="input" placeholder="Key notes shown under the title" /></label>
        <div class="grid2">
          <label class="field"><span>Est. min (takt)</span><input v-model.number="t.timeMin" type="number" min="0" step="5" class="input mono" /></label>
          <label class="field"><span>Due</span><input v-model="t.due" type="date" class="input mono" /></label>
          <label class="field"><span>Scheduled day</span><input v-model="schedDate" type="date" class="input mono" /></label>
          <label class="field"><span>Start time</span><input v-model="schedStart" type="time" step="900" class="input mono" :disabled="!t.scheduled" /></label>
        </div>
        <div class="field">
          <span class="lbl">Priority</span>
          <div class="row">
            <button v-for="p in 5" :key="p" class="btn sm" :class="{ active: t.priority === p }" @click="updateTodo(t.id, { priority: p })">P{{ p }}</button>
          </div>
        </div>
        <div class="field">
          <span class="lbl">Scope classification</span>
          <div class="seg">
            <button v-for="(d, k) in { L: ['Large', 'Deep focus'], S: ['Small', 'Quick hit'], D: ['Daily', 'Routine'] }" :key="k" :class="{ on: t.lsd === k }" @click="updateTodo(t.id, { lsd: k })">
              <b class="mono">[{{ k }}] {{ d[0] }}</b><small>{{ d[1] }}</small>
            </button>
          </div>
        </div>
        <div class="field">
          <span class="lbl">Split across days</span>
          <div v-if="parts.length > 1" class="parts">
            <div v-for="p in parts" :key="p.id" class="prt row small" :class="{ cur: p.id === t.id, done: p.done }" @click="ui.drawerId = p.id">
              <span class="mono">{{ partLabel(p) }}</span>
              <span class="mono muted">{{ p.id }}</span>
              <span class="grow mono">{{ p.scheduled ? `${wd(p.scheduled.date)} ${fmtSlash(p.scheduled.date)}${p.scheduled.start ? ' ' + p.scheduled.start : ''}` : 'backlog' }}</span>
              <span class="mono">{{ p.timeMin }}m</span>
              <span v-if="p.done" class="ok">✓</span>
            </div>
          </div>
          <div class="row">
            <button class="btn sm" :disabled="t.done" @click="ui.splitId = t.id"><span class="icon sm">call_split</span>{{ parts.length > 1 ? 'Split this part further…' : 'Split across days…' }}</button>
            <button v-if="parts.filter((p) => !p.done).length > 1" class="btn sm" @click="merge"><span class="icon sm">merge</span>Merge open parts</button>
          </div>
        </div>
        <label class="field">
          <span>Linked records</span>
          <input v-model.lazy="linksText" class="input mono" placeholder="SIG-02.1, ST2001spA" />
        </label>
        <div class="row wrap">
          <Chip v-for="l in t.links" :key="l" :id="l" />
          <select class="select sm" @change="addLink($event.target.value); $event.target.value = ''">
            <option value="">+ link goal…</option>
            <option v-for="g in goalOptions" :key="g" :value="g">{{ g }}</option>
          </select>
          <select class="select sm" @change="addLink($event.target.value); $event.target.value = ''">
            <option value="">+ link deadline…</option>
            <option v-for="d in deadlineOptions" :key="d.id" :value="d.id">{{ d.id }} {{ d.title.slice(0, 32) }}</option>
          </select>
        </div>
        <label class="field"><span>Notes (markdown)</span><textarea v-model="t.notes" rows="7" class="textarea mono"></textarea></label>
        <div class="audit mono small">
          <div><span class="muted">CREATED</span><span>{{ fmt(t.createdAt) }}</span></div>
          <div><span class="muted">MODIFIED</span><span>{{ fmt(t.updatedAt) }}</span></div>
          <div><span class="muted">LINK TYPES</span><span>{{ [...new Set(t.links.map(linkType))].join(' · ') || '—' }}</span></div>
        </div>
      </div>
      <footer class="df">
        <button class="btn primary grow" @click="toggleTodo(t.id)"><span class="icon sm">done_all</span>{{ t.done ? 'Reopen' : 'Mark completed' }} <span class="kbd">X</span></button>
        <button class="btn danger-ghost" title="Delete" @click="remove"><span class="icon sm">delete</span></button>
      </footer>
    </aside>
  </transition>
</template>

<style scoped>
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 480px; max-width: 100vw; background: var(--surface); border-left: 1px solid var(--border); z-index: 40; display: flex; flex-direction: column; box-shadow: -1px 0 0 var(--border); }
.dh { display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 16px; border-bottom: 1px solid var(--border); }
.id { font-size: 16px; font-weight: 700; }
.db { flex: 1; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.input.big { height: 36px; font-size: 15px; font-weight: 600; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.lbl { font: 600 10px/12px 'JetBrains Mono', monospace; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 4px; }
.seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.seg button { border: 1px solid var(--border); background: transparent; border-radius: 2px; padding: 6px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; color: var(--muted); }
.seg button b { font-size: 11px; }
.seg button small { font-size: 10px; }
.seg button.on { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.wrap { flex-wrap: wrap; }
.select.sm { height: 22px; font-size: 11px; padding: 0 4px; }
.parts { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 2px; margin-bottom: 6px; }
.prt { padding: 5px 8px; cursor: pointer; border-bottom: 1px solid var(--border); }
.prt:last-child { border-bottom: 0; }
.prt:hover { background: var(--surface-2); }
.prt.cur { box-shadow: inset 2px 0 0 var(--info); }
.prt.done .grow { text-decoration: line-through; color: var(--muted); }
.audit { border: 1px solid var(--border); border-radius: 2px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.audit div { display: flex; justify-content: space-between; }
.df { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
.df .btn { height: 34px; justify-content: center; }
.slide-enter-active, .slide-leave-active { transition: transform 0.15s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
</style>
