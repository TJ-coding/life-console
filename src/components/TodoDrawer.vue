<script setup>
// Right 480px side drawer for editing a todo (spec §2.4 "Side drawer").
import { computed, ref } from 'vue'
import { ui, state, findTodo, deleteTodoUndo, unscheduleTodo, todayISO, toggleTodo, updateTodo, linkType, linkLabel, splitSiblings, partLabel, mergeParts, wd, fmtSlash, toast, childrenOf, isContainer, budgetLeft, subCount, ancestorsOf, addSubtask, parseQuick, pomo } from '../store'
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
  set: (v) => {
    if (!t.value.scheduled) return
    // ISS-25: a first start time follows the pomodoro rhythm, as on the timeline
    if (v && !t.value.scheduled.start && t.value.pomo === undefined && pomo().on) t.value.pomo = true
    t.value.scheduled.start = v || null
  },
})
const goalOptions = computed(() => state.plans.filter((p) => p.status !== 'archived').flatMap((p) => [...p.psgs.map((g) => g.no), ...p.sigs.map((s) => s.no)]))
const deadlineOptions = computed(() => state.deadlines.filter((d) => !d.done && !t.value?.links.includes(d.id)).sort((a, b) => a.due.localeCompare(b.due)))
function addLink(id) {
  if (id && !t.value.links.includes(id)) t.value.links.push(id)
}
/** ISS-18: links can now also be removed with the ✕ on their chip. */
function removeLink(id) {
  t.value.links = t.value.links.filter((l) => l !== id)
  touch()
}
/** ISS-19: the goal names in the dropdown, so SIG-01.2 means something. */
const goalName = (no) => linkLabel(no)
const fmt = (s) => new Date(s).toLocaleString()
const parts = computed(() => splitSiblings(t.value))
function merge() {
  const k = mergeParts(t.value.id)
  if (k) { ui.drawerId = k.id; toast(`Merged into ${k.id} (${k.timeMin}m)`) }
}
/* subtasks: the estimate of a task with subtasks is a budget they use up (owner's mental model) */
const kids = computed(() => (t.value ? childrenOf(t.value.id) : []))
const box = computed(() => kids.value.length > 0)
const left = computed(() => (t.value ? budgetLeft(t.value) : 0))
const counts = computed(() => (t.value ? subCount(t.value) : { done: 0, total: 0 }))
const crumbs = computed(() => (t.value ? ancestorsOf(t.value).reverse() : []))
const subDraft = ref('')
const subParsed = computed(() => parseQuick(subDraft.value))
function addSub() {
  const p = subParsed.value
  if (!p.title) return
  const extra = { title: p.title }
  if (p.timeMin) extra.timeMin = p.timeMin
  if (p.priority) extra.priority = p.priority
  if (p.due) extra.due = p.due
  if (p.lsd) extra.lsd = p.lsd
  if (p.links.length) extra.links = [...new Set([...t.value.links, ...p.links])]
  const r = addSubtask(t.value.id, extra)
  subDraft.value = '' // keep focus for the next one
  if (r?.unscheduled) toast(`${t.value.id} has subtasks now: it left ${wd(r.unscheduled.date)}'s plan; schedule its subtasks instead`)
}
const fmtLeft = (m) => (Math.abs(m) >= 60 ? `${Math.floor(Math.abs(m) / 60)}h${Math.abs(m) % 60 ? String(Math.abs(m) % 60).padStart(2, '0') : ''}` : `${Math.abs(m)}m`)
const whenOf = (k) => (k.scheduled ? `${wd(k.scheduled.date)}${k.scheduled.start ? ' ' + k.scheduled.start : ''}` : isContainer(k) ? `${subCount(k).done}/${subCount(k).total}` : '—')
/** Delete with an undo toast instead of a confirm() (DESIGN.md §2.8). */
const remove = () => deleteTodoUndo(t.value.id)
/** "today" / "Wed 11/5" for the schedule actions. */
const dayName = computed(() => {
  const d = t.value?.scheduled?.date
  return !d ? '' : d === todayISO() ? 'today' : `${wd(d)} ${fmtSlash(d)}`
})
</script>

<template>
  <transition name="slide">
    <aside v-if="t" class="drawer" @change="touch" @input="touch">
      <header class="dh">
        <span class="mono id">{{ t.id }}</span>
        <span v-if="partLabel(t)" class="chip">part {{ partLabel(t) }}</span>
        <span class="prio" :class="'p' + t.priority">P{{ t.priority }}</span>
        <span class="status" :class="t.done ? 'done' : t.scheduled || box ? 'doing' : ''">{{ t.done ? 'DONE ✓' : box ? `${counts.done}/${counts.total} SUBTASKS` : t.scheduled ? 'SCHEDULED' : 'INBOX' }}</span>
        <span class="spacer"></span>
        <button class="btn icon-only" title="Close (Esc)" @click="ui.drawerId = null"><span class="icon">close</span></button>
      </header>
      <div class="db">
        <nav v-if="crumbs.length" class="crumbs small">
          <span class="icon sm muted">subdirectory_arrow_right</span>
          <template v-for="(a, i) in crumbs" :key="a.id"><span v-if="i" class="muted">›</span><button class="crumb" :title="`Open ${a.id}`" @click="ui.drawerId = a.id"><span class="mono muted">{{ a.id }}</span> {{ a.title }}</button></template>
        </nav>
        <label class="field"><span>Task title</span><input v-model="t.title" class="input big" /></label>
        <label class="field"><span>Vital points</span><input v-model="t.vital" class="input" placeholder="Key notes shown under the title" /></label>
        <div class="grid2">
          <label class="field"><span>{{ box ? 'Budget, min (for its subtasks)' : 'Est. min (takt)' }}</span><input v-model.number="t.timeMin" type="number" min="0" step="5" class="input mono" /></label>
          <label class="field"><span>Due</span><input v-model="t.due" type="date" class="input mono" /></label>
          <template v-if="!box">
            <label class="field"><span>Scheduled day</span><input v-model="schedDate" type="date" class="input mono" /></label>
            <label class="field"><span>Start time</span><input v-model="schedStart" type="time" step="900" class="input mono" :disabled="!t.scheduled" /></label>
          </template>
        </div>

        <!-- subtasks: break the task into steps; each is a real todo you can schedule -->
        <div class="field">
          <div class="row sub-h">
            <span class="lbl">Subtasks</span>
            <span v-if="box" class="mono small muted">{{ counts.done }}/{{ counts.total }} done</span>
            <span class="spacer"></span>
            <span v-if="box" class="mono small" :class="left < 0 ? 'warn' : left === 0 ? 'ok' : 'muted'">
              {{ left < 0 ? `over budget by ${fmtLeft(left)}` : left === 0 ? 'budget fully assigned' : `${fmtLeft(left)} left to assign` }}
            </span>
          </div>
          <div v-if="box" class="subs">
            <div v-for="k in kids" :key="k.id" class="sub row" :class="{ done: k.done }" @click="ui.drawerId = k.id">
              <input type="checkbox" :checked="k.done" title="Done" @click.stop @change="toggleTodo(k.id)" />
              <span class="grow ellipsis">{{ k.title }}</span>
              <input :value="k.timeMin" type="number" min="0" step="5" class="input mono sub-min" title="Estimate (min)" @click.stop @change="updateTodo(k.id, { timeMin: Math.max(0, Number($event.target.value) || 0) })" />
              <span class="mono small sub-when" :class="k.scheduled ? 'ok' : 'muted'">{{ whenOf(k) }}</span>
              <span class="icon sm muted">chevron_right</span>
            </div>
          </div>
          <form v-if="!t.done && parts.length < 2" class="row sub-add" @submit.prevent="addSub">
            <span class="icon sm muted">add</span>
            <input v-model="subDraft" class="input grow" :placeholder="box ? 'Next subtask… e.g. Write intro 20m' : 'Break into subtasks… e.g. Collect papers 30m'" @input.stop @change.stop />
            <button class="btn sm" type="submit" :disabled="!subParsed.title">Add</button>
          </form>
          <small v-else-if="parts.length > 1" class="tiny muted">Split over days: merge the parts first to break it into subtasks.</small>
        </div>

        <div v-if="t.scheduled && !box" class="unsched">
          <button v-if="t.scheduled.start" class="btn sm" title="Clear the start time: off the timeline, still on that day's list (undo in the toast)" @click="unscheduleTodo(t.id, 'time')">
            <span class="icon sm">event_busy</span>Remove from schedule
          </button>
          <button class="btn sm" title="Back to the backlog — no day, no time (undo in the toast)" @click="unscheduleTodo(t.id, 'day')">
            <span class="icon sm">move_to_inbox</span>Unschedule from {{ dayName }}
          </button>
        </div>
        <label v-if="t.scheduled?.start && !box" class="pomo-sw row small" title="Lay this sitting out as pomodoros: the work time is cut into pomodoros with breaks between them, so the block on the schedule includes the breaks">
          <input type="checkbox" :checked="!!t.pomo" @change="updateTodo(t.id, { pomo: $event.target.checked || undefined })" />
          <span>Pomodoro sitting</span><span class="mono muted">{{ pomo().work }}/{{ pomo().short }}m · breaks on the schedule</span>
        </label>
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
        <div v-if="!box" class="field">
          <span class="lbl">Days &amp; times</span>
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
            <button class="btn sm" :disabled="t.done" @click="ui.splitId = t.id"><span class="icon sm">call_split</span>{{ parts.length > 1 ? 'Edit plan…' : 'Plan over days / times…' }}</button>
            <button v-if="parts.filter((p) => !p.done).length > 1" class="btn sm" @click="merge"><span class="icon sm">merge</span>Merge open parts</button>
          </div>
        </div>
        <label class="field">
          <span>Linked records</span>
          <input v-model.lazy="linksText" class="input mono" placeholder="BASE, RUN" />
          <small class="tiny muted">Remove: ✕ on a chip, or delete the number here</small>
        </label>
        <div class="row wrap">
          <Chip v-for="l in t.links" :key="l" :id="l" removable @remove="removeLink" />
          <select class="select sm" @change="addLink($event.target.value); $event.target.value = ''">
            <option value="">+ link goal…</option>
            <option v-for="g in goalOptions" :key="g" :value="g">{{ g }}{{ goalName(g) ? ' · ' + goalName(g) : '' }}</option>
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
        <button class="btn danger-ghost" title="Delete this task (undo in the toast)" @click="remove"><span class="icon sm">delete</span>Delete</button>
      </footer>
    </aside>
  </transition>
</template>

<style scoped>
.pomo-sw { gap: 8px; align-items: center; cursor: pointer; }
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
.unsched { display: flex; flex-wrap: wrap; gap: 6px; margin-top: -6px; }
.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: -6px; }
.crumb { border: 0; background: transparent; color: var(--text); cursor: pointer; padding: 0; font: inherit; }
.crumb:hover { color: var(--accent); }
.sub-h { gap: 8px; margin-bottom: 4px; }
.sub-h .lbl { margin-bottom: 0; }
.subs { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 2px; margin-bottom: 6px; }
.sub { gap: 8px; padding: 0 8px; min-height: 34px; cursor: pointer; border-bottom: 1px solid var(--border); font-size: 14px; }
.sub:last-child { border-bottom: 0; }
.sub:hover { background: var(--surface-2); }
.sub.done .grow { text-decoration: line-through; color: var(--muted); }
.sub-min { width: 56px; height: 24px; font-size: 12px; text-align: right; }
.sub-when { width: 64px; text-align: right; }
.sub-add { gap: 6px; }
.sub-add .input { height: 30px; }
.audit { border: 1px solid var(--border); border-radius: 2px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.audit div { display: flex; justify-content: space-between; }
.df { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
.df .btn { height: 34px; justify-content: center; }
.slide-enter-active, .slide-leave-active { transition: transform 0.15s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
</style>
