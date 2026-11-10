<script setup>
// Step ① Backlog — unassigned tasks. Drag onto a day, or hover and click a day button
// (each shows that day's free hours). Drop a planned task here to send it back.
import { computed, ref, watch, nextTick } from 'vue'
import { state, ui, todayISO, addDays, wd, fmtSlash, byPriority, partLabel, freeHours, assignToDay, updateTodo, toast, parseQuick, addTodo, isHoverLinked, isLeaf, parentPath } from '../store'
import { TODO_MIME, startDrag, endDrag, overRow, leaveRow, dropOnRow, dropClass } from '../dnd'
import Prio from './Prio.vue'
import Chip from './Chip.vue'

defineProps({ focus: Boolean }) // ISS-16: backlog-only mode is on (header shows the way back)
defineEmits(['focus'])

const prio = ref(0)
const open = ref(true) // collapses the backlog to header + quick-add (handy on phones)
const list = computed(() => state.todos.filter((t) => !t.done && !t.scheduled && isLeaf(t) && (!prio.value || t.priority === prio.value)).sort(byPriority)) // a task with subtasks is planned through them
const total = computed(() => list.value.reduce((s, t) => s + t.timeMin / 60, 0))
const T = computed(() => todayISO())
const days = computed(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ui.weekStart, i)))
const free = computed(() => Object.fromEntries(days.value.map((d) => [d, freeHours(d)])))
const usable = (t, d) => d >= T.value && (!t.due || d <= t.due)

/* quick add */
const draft = ref('')
const input = ref(null)
const parsed = computed(() => parseQuick(draft.value))
function add() {
  const p = parsed.value
  if (!p.title) return
  const t = addTodo({ title: p.title, links: p.links, due: p.due, timeMin: p.timeMin ?? 30, priority: p.priority ?? 3, lsd: p.lsd ?? 'S' })
  prio.value = 0 // make sure the new task is visible
  ui.selectedId = t.id
  toast(`${t.id} added to backlog`)
  draft.value = '' // keep focus for rapid capture
}
watch(() => ui.backlogFocus, async () => { await nextTick(); input.value?.focus() })

const hot = ref(false)
function onDrop(e) {
  hot.value = false
  const id = e.dataTransfer.getData(TODO_MIME)
  if (id) { updateTodo(id, { scheduled: null }); toast(`${id} → backlog`) }
}
</script>

<template>
  <section class="backlog" :class="{ 'drop-hot': hot, only: focus }" @dragover.prevent="hot = true" @dragleave="hot = false" @drop.prevent="onDrop">
    <header class="bh">
      <button class="btn sm icon-only tog" :title="open ? 'Collapse backlog' : 'Expand backlog'" @click="open = !open">
        <span class="icon sm">{{ open ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }}</span>
      </button>
      <button class="hbtn grow" :title="focus ? 'Back to the week view' : 'Backlog only: hide the day columns and show the deadlines & goals this backlog serves (ISS-16)'" @click="$emit('focus')">
        <span class="stepn mono">1</span>
        <span class="tl">
          <span class="ttl">Backlog<template v-if="focus"> only</template></span>
          <span class="mono tiny muted">{{ list.length }} tasks · {{ total.toFixed(1) }}h</span>
        </span>
        <span class="icon sm" :class="{ info: focus }">{{ focus ? 'close_fullscreen' : 'open_in_full' }}</span>
      </button>
    </header>
    <form v-if="open" class="qa" @submit.prevent="add">
      <span class="icon sm plus">add</span>
      <input
        ref="input" v-model="draft" class="mono" placeholder="New task… 45m p2 due:fri #tag"
        title="Syntax: title 45m p1–p5 due:fri #course @CASE1 [L|S|D] · Enter to add · Esc to leave"
        @keydown.esc="draft = ''; $event.target.blur()"
      />
      <span class="kbd">N</span>
    </form>
    <div v-if="draft && open" class="preview">
      <span class="pc"><b>{{ parsed.title || '—' }}</b></span>
      <span class="pc mono">{{ parsed.timeMin ?? 30 }}m</span>
      <span class="pc mono">P{{ parsed.priority ?? 3 }}</span>
      <span v-if="parsed.due" class="pc mono">due {{ wd(parsed.due) }} {{ fmtSlash(parsed.due) }}</span>
      <Chip v-for="l in parsed.links" :key="l" :id="l" />
      <span class="small muted enter">↵ add</span>
    </div>
    <div v-if="open" class="pf">
      <button class="btn sm" :class="{ active: !prio }" @click="prio = 0">All</button>
      <button v-for="p in 5" :key="p" class="btn sm" :class="{ active: prio === p }" @click="prio = p">P{{ p }}</button>
    </div>

    <div v-if="open" class="list">
      <div
        v-for="t in list" :key="t.id" class="card" :class="[dropClass(t), { linked: isHoverLinked(t.id), sel: ui.selectedId === t.id }]" draggable="true"
        @dragstart="startDrag($event, t)" @dragend="endDrag" @dragover="overRow($event, t)" @dragleave="leaveRow($event, t)"
        @drop="dropOnRow($event, t, { unschedule: true })" @mouseenter="ui.hoverId = t.id" @mouseleave="ui.hoverId = null"
        @click="ui.selectedId = t.id" @dblclick="ui.drawerId = t.id"
      >
        <div v-if="t.parent && parentPath(t)" class="crumb small muted ellipsis" :title="parentPath(t)">↳ {{ parentPath(t) }}</div>
        <div class="row">
          <Prio :p="t.priority" />
          <span class="grow ellipsis"><span v-if="partLabel(t)" class="part mono">{{ partLabel(t) }}</span>{{ t.title }}</span>
          <span class="mono small muted">{{ t.timeMin }}m</span>
        </div>
        <div v-if="t.links.length || t.due" class="row small meta">
          <Chip v-for="l in t.links" :key="l" :id="l" />
          <span v-if="t.due" class="mono muted">due {{ wd(t.due) }} {{ fmtSlash(t.due) }}</span>
        </div>
        <!-- quick assign: one click puts it on a day -->
        <div class="quick">
          <button
            v-for="d in days" :key="d" class="qd mono" :disabled="!usable(t, d)"
            :class="{ fits: free[d] >= t.timeMin / 60, tight: free[d] < t.timeMin / 60 && free[d] > 0, full: free[d] <= 0, today: d === T }"
            :title="`${wd(d)} ${fmtSlash(d)} · ${free[d].toFixed(1)}h free${!usable(t, d) ? (d < T ? ' · past' : ' · after due date') : ''}`"
            @click.stop="assignToDay(t.id, d)"
          >
            <span>{{ wd(d)[0] }}{{ wd(d)[1].toLowerCase() }}</span><small>{{ Math.max(0, free[d]).toFixed(1) }}</small>
          </button>
          <button v-if="t.timeMin >= 30" class="qd split" title="Plan: spread over days and times" @click.stop="ui.splitId = t.id"><span class="icon">call_split</span></button>
        </div>
      </div>
      <div v-if="!list.length" class="empty">Backlog clear ✓<br />Type above to capture a task.</div>
    </div>
    <div v-if="open" class="foot small muted">Hover a task → click a day, or drag it onto a day. Drop here to unassign.</div>
  </section>
</template>

<style scoped>
.backlog.only { border-right: 0; }
.crumb { font-size: 11px; margin-bottom: 2px; }
.backlog { display: flex; flex-direction: column; min-height: 0; background: var(--surface); border-right: 1px solid var(--border); }
.bh { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.hbtn { display: flex; align-items: center; gap: 10px; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; padding: 0; cursor: pointer; }
.hbtn:hover .ttl { color: var(--accent); }
.tl { display: flex; flex-direction: column; min-width: 0; }
.hbtn .icon { color: var(--muted); flex: none; }
.hbtn .icon.info { color: var(--info); }
.tog { padding: 0 2px; color: var(--muted); }
.stepn { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--muted); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: var(--muted); }
.ttl { font-weight: 600; }
.qa { display: flex; align-items: center; gap: 6px; margin: 8px 8px 0; padding: 0 6px; height: 32px; border: 1px solid var(--border); border-radius: 2px; background: var(--surface-2); }
.qa:focus-within { border-color: var(--info); }
.qa input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font-size: 12px; }
.plus { color: var(--accent); }
.preview { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 6px 8px 0; }
.pc { border: 1px solid var(--border); border-radius: 2px; padding: 1px 6px; font-size: 11px; color: var(--muted); }
.pc b { color: var(--text); font-weight: 500; }
.enter { margin-left: auto; }
.pf { display: flex; gap: 3px; padding: 8px 10px; flex-wrap: wrap; }
.list { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 6px; padding: 0 8px 8px; }
.card { border: 1px solid var(--border); border-radius: 2px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; cursor: grab; background: var(--bg); }
.card:hover, .card.linked { border-color: var(--info); }
.card.sel { box-shadow: inset 0 0 0 1px var(--info); }
.meta { flex-wrap: wrap; gap: 4px; }
.part { font-size: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 2px; padding: 0 3px; margin-right: 5px; }
.quick { display: none; gap: 2px; margin-top: 2px; }
.card:hover .quick, .card.sel .quick { display: flex; }
.qd { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; padding: 2px 0; border: 1px solid var(--border); border-radius: 2px; background: var(--surface); cursor: pointer; font-size: 10px; line-height: 11px; color: var(--text); }
.qd small { font-size: 9px; color: var(--muted); }
.qd:hover:not(:disabled) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.qd.fits small { color: var(--accent); }
.qd.tight small { color: var(--warn); }
.qd.full small { color: var(--danger); }
.qd.today { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
.qd:disabled { opacity: 0.3; cursor: not-allowed; }
.qd.split { flex: none; width: 26px; justify-content: center; }
.qd.split .icon { font-size: 14px; }
.foot { padding: 8px 12px; border-top: 1px solid var(--border); }
</style>
