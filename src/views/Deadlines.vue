<script setup>
// S-21 · Deadlines — hard due dates, as a grouped list or a month calendar.
import { computed, ref } from 'vue'
import { state, ui, todayISO, addDays, mondayOf, wd, fmtSlash, fmtMD, relDay, isOverdue, parseISO, pad, MONTHS } from '../store'
import DeadlineQuickAdd from '../components/DeadlineQuickAdd.vue'
import Chip from '../components/Chip.vue'
import Prio from '../components/Prio.vue'

const T = computed(() => { void ui.now; return todayISO() })
const view = ref('list')
const showDone = ref(false)
const source = ref('')
const addingDay = ref(null) // month view: the day whose cell shows an inline add box
const sources = computed(() => [...new Set(state.deadlines.map((d) => d.source).filter(Boolean))].sort())
const visible = computed(() => state.deadlines.filter((d) => !source.value || d.source === source.value))

/* ── list groups ── */
const groups = computed(() => {
  const sun = addDays(mondayOf(T.value), 6)
  const nextSun = addDays(sun, 7)
  const open = visible.value.filter((d) => !d.done).sort((a, b) => a.due.localeCompare(b.due))
  const day = (d) => d.due.slice(0, 10)
  const g = [
    { key: 'overdue', label: 'Overdue', icon: 'warning', cls: 'danger', items: open.filter(isOverdue) },
    { key: 'today', label: 'Today', icon: 'today', cls: 'warn', items: open.filter((d) => !isOverdue(d) && day(d) === T.value) },
    { key: 'week', label: 'This week', icon: 'date_range', cls: '', items: open.filter((d) => !isOverdue(d) && day(d) > T.value && day(d) <= sun) },
    { key: 'next', label: 'Next week', icon: 'event_upcoming', cls: '', items: open.filter((d) => day(d) > sun && day(d) <= nextSun) },
    { key: 'later', label: 'Later', icon: 'schedule', cls: '', items: open.filter((d) => day(d) > nextSun) },
  ]
  if (showDone.value) g.push({ key: 'done', label: 'Done', icon: 'task_alt', cls: 'muted', items: visible.value.filter((d) => d.done).sort((a, b) => b.due.localeCompare(a.due)) })
  return g
})
const counts = computed(() => ({ open: visible.value.filter((d) => !d.done).length, overdue: visible.value.filter(isOverdue).length }))

/* ── month calendar ── */
const month = ref(T.value.slice(0, 7)) // YYYY-MM
const monthLabel = computed(() => { const d = parseISO(`${month.value}-01`); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}` })
function shiftMonth(n) {
  const d = parseISO(`${month.value}-01`)
  d.setMonth(d.getMonth() + n)
  month.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const cells = computed(() => {
  const first = `${month.value}-01`
  const start = mondayOf(first)
  const out = []
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i)
    if (i >= 35 && d.slice(0, 7) !== month.value) break
    out.push({ d, inMonth: d.slice(0, 7) === month.value, items: visible.value.filter((x) => x.due.slice(0, 10) === d && (showDone.value || !x.done)).sort((a, b) => a.due.localeCompare(b.due)) })
  }
  return out
})
const pick = (d) => { addingDay.value = d }
/** Close the inline box when focus leaves the cell (but not when moving within it). */
function onCellFocusOut(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) addingDay.value = null
}
const open = (d) => { ui.deadlineId = d.id }
</script>

<template>
  <div class="dl-page">
    <div class="toolbar">
      <div class="seg">
        <button class="btn sm" :class="{ active: view === 'list' }" @click="view = 'list'"><span class="icon sm">list</span>List</button>
        <button class="btn sm" :class="{ active: view === 'month' }" @click="view = 'month'"><span class="icon sm">calendar_view_month</span>Month</button>
      </div>
      <span class="mono small"><b>{{ counts.open }}</b> <span class="muted">open</span></span>
      <span v-if="counts.overdue" class="mono small danger row"><span class="icon sm">warning</span>{{ counts.overdue }} overdue</span>
      <span class="spacer"></span>
      <div class="row">
        <span class="tiny upper muted">Source</span>
        <select v-model="source" class="select mono small"><option value="">All</option><option v-for="s in sources" :key="s" :value="s">{{ s }}</option></select>
      </div>
      <label class="row small"><input v-model="showDone" type="checkbox" /> Show done</label>
    </div>

    <div class="adder">
      <DeadlineQuickAdd :date="T" class="grow" />
    </div>

    <!-- list -->
    <div v-if="view === 'list'" class="list">
      <section v-for="g in groups" :key="g.key" class="grp">
        <div class="gh row" :class="g.cls"><span class="icon sm">{{ g.icon }}</span><b>{{ g.label }}</b><span class="mono small muted">{{ g.items.length }}</span></div>
        <div v-for="d in g.items" :key="d.id" class="item" :class="{ over: isOverdue(d), done: d.done }" @click="open(d)">
          <input v-model="d.done" type="checkbox" title="Done" @click.stop />
          <Prio :p="d.priority" />
          <div class="grow main">
            <div class="ttl">{{ d.title }}</div>
            <div v-if="d.vital" class="small muted ellipsis">{{ d.vital }}</div>
          </div>
          <Chip v-if="d.source" :id="d.source" />
          <span class="mono small due" :class="isOverdue(d) ? 'danger' : d.due.slice(0, 10) === T ? 'warn' : ''">
            {{ wd(d.due) }} {{ fmtSlash(d.due) }} {{ d.due.slice(11) }}
            <span class="muted">· {{ relDay(d.due, T) }}</span>
          </span>
          <span class="small" :class="d.clickUp ? 'ok' : 'muted'" :title="d.clickUp ? 'Synced with ClickUp' : 'Not synced'">{{ d.clickUp ? '● ClickUp' : '○' }}</span>
          <span class="icon sm muted edit">edit</span>
        </div>
        <div v-if="!g.items.length" class="none small muted">—</div>
      </section>
    </div>

    <!-- month -->
    <div v-else class="month">
      <div class="mh row">
        <button class="btn icon-only" @click="shiftMonth(-1)"><span class="icon sm">chevron_left</span></button>
        <b class="mono">{{ monthLabel }}</b>
        <button class="btn icon-only" @click="shiftMonth(1)"><span class="icon sm">chevron_right</span></button>
        <button class="btn sm" @click="month = T.slice(0, 7)">This month</button>
        <span class="spacer"></span>
        <span class="small muted">Click a day (or its +) to add a deadline there · Enter adds, Esc closes · click a deadline to edit</span>
      </div>
      <div class="cal">
        <div v-for="w in ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']" :key="w" class="wh mono tiny muted">{{ w }}</div>
        <div
          v-for="c in cells" :key="c.d" class="cell" :class="{ out: !c.inMonth, today: c.d === T, picked: c.d === addingDay }"
          :title="`Click to add a deadline on ${wd(c.d)} ${fmtMD(c.d)}`" @click="pick(c.d)"
        >
          <div class="ch">
            <span class="dn mono">{{ parseISO(c.d).getDate() }}</span>
            <span class="spacer"></span>
            <button class="plus" :title="`Add a deadline on ${wd(c.d)} ${fmtMD(c.d)}`" @click.stop="pick(c.d)"><span class="icon">add</span></button>
          </div>
          <button
            v-for="d in c.items" :key="d.id" class="ev" :class="{ over: isOverdue(d), done: d.done }"
            :title="`${d.title} · ${d.due.slice(11)}${d.vital ? ' · ' + d.vital : ''}`" @click.stop="open(d)"
          >
            <span class="mono">{{ d.due.slice(11) }}</span> {{ d.title }}
          </button>
          <div v-if="addingDay === c.d" class="inline-add" @click.stop @focusout="onCellFocusOut">
            <DeadlineQuickAdd :date="c.d" compact autofocus :placeholder="`Title 17:00 p1…`" @cancel="addingDay = null" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dl-page { display: flex; flex-direction: column; min-height: 100%; }
.toolbar { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.seg { display: flex; gap: 4px; }
.select.small { height: 24px; font-size: 11px; }
.adder { display: flex; align-items: flex-start; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
.list { padding: 12px 16px 24px; display: flex; flex-direction: column; gap: 14px; max-width: 1100px; }
.gh { gap: 6px; padding-bottom: 6px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.item { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 4px 10px; border: 1px solid transparent; border-radius: 2px; cursor: pointer; }
.item:hover { background: var(--surface-2); border-color: var(--border); }
.item.over { background: color-mix(in srgb, var(--danger) 6%, transparent); }
.item.done .ttl { text-decoration: line-through; color: var(--muted); }
.ttl { font-weight: 500; }
.main { min-width: 0; }
.due { white-space: nowrap; }
.edit { opacity: 0; }
.item:hover .edit { opacity: 1; }
.none { padding: 4px 10px; }
.month { padding: 12px 16px 24px; display: flex; flex-direction: column; gap: 10px; }
.mh { gap: 8px; }
.cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.wh { padding: 2px 6px; }
.cell { min-height: 96px; border: 1px solid var(--border); border-radius: 2px; background: var(--surface); padding: 4px; display: flex; flex-direction: column; gap: 3px; cursor: pointer; min-width: 0; }
.cell:hover { border-color: var(--muted); }
.cell.out { opacity: 0.45; }
.cell.today { border-color: var(--accent); }
.cell.picked { box-shadow: inset 0 0 0 1px var(--info); background: color-mix(in srgb, var(--info) 6%, var(--surface)); }
.ch { display: flex; align-items: center; }
.dn { font-size: 11px; color: var(--muted); }
.plus { border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 2px; width: 18px; height: 18px; padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; }
.plus .icon { font-size: 14px; }
.cell:hover .plus, .cell.picked .plus { opacity: 1; }
.plus:hover { border-color: var(--warn); color: var(--warn); }
.inline-add { margin-top: 2px; cursor: default; }
.today .dn { color: var(--accent); font-weight: 700; }
.ev { text-align: left; border: 1px solid color-mix(in srgb, var(--warn) 50%, var(--border)); border-left: 3px solid var(--warn); background: var(--surface-2); color: var(--text); border-radius: 2px; padding: 1px 4px; font-size: 11px; line-height: 14px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ev .mono { color: var(--muted); font-size: 10px; }
.ev.over { border-color: var(--danger); border-left-color: var(--danger); }
.ev.done { opacity: 0.5; text-decoration: line-through; border-left-color: var(--muted); }
</style>
