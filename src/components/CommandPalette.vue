<script setup>
// ⌘K command palette (S-80). Also handles quick-add (`N` or a leading "+").
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { allPsgs, allSigs, planOfGoal, ui, state, addTodo, parseQuick, stampNext, todayISO, addDays, toggleTheme, resetDemo, toast, STAMPS } from '../store'
import { NAV } from '../nav'
import Chip from './Chip.vue'
import { openIssueDialog } from '../issues'

const router = useRouter()
const route = useRoute()
const q = ref('')
const idx = ref(0)
const input = ref(null)

watch(() => ui.palette, async (v) => {
  if (!v) return
  q.value = ''
  idx.value = 0
  await nextTick()
  input.value?.focus()
})
watch(q, () => { idx.value = 0 })

const isAdd = computed(() => ui.paletteMode === 'add' || q.value.startsWith('+'))
const parsed = computed(() => parseQuick(q.value.replace(/^\+\s*/, '')))

// "New item in current context": Today → today, Week → day in viewed week, Inbox → unscheduled.
const contextDate = computed(() => {
  const T = todayISO()
  if (route.name === 'today') return T
  return null
})

const commands = computed(() => [
  ...NAV.map((n) => ({ label: `Go to ${n.label}`, icon: n.icon, hint: n.key1, run: () => router.push(n.to) })),
  { label: 'Briefing (morning review)', icon: 'wb_sunny', run: () => router.push('/briefing') },
  { label: 'Debrief (evening review)', icon: 'bedtime', run: () => router.push('/debrief') },
  { label: 'New todo…', icon: 'add', hint: 'N', run: () => { ui.paletteMode = 'add'; q.value = ''; return false } },
  { label: 'Stamp next sign-off (today)', icon: 'approval', hint: 'S', run: () => { const i = stampNext(todayISO()); toast(i < 0 ? 'Today is fully stamped 完' : `Stamped ${STAMPS[i]}`) } },
  { label: 'Report an issue on this screen…', icon: 'bug_report', hint: 'I', run: () => openIssueDialog(route) },
  { label: 'Take the tour', icon: 'auto_awesome', run: () => { ui.tourOpen = true } },
  { label: 'Toggle light / dark theme', icon: 'contrast', run: toggleTheme },
  { label: 'Print current sheet', icon: 'print', run: () => setTimeout(() => window.print(), 50) },
  { label: 'Reset demo data', icon: 'restart_alt', run: () => { if (confirm('Reset all data to the demo seed?')) resetDemo() } },
])

const results = computed(() => {
  if (isAdd.value) return []
  const s = q.value.trim().toLowerCase()
  const has = (txt) => txt.toLowerCase().includes(s)
  const out = commands.value.filter((c) => !s || has(c.label)).map((c) => ({ ...c, group: 'Commands' }))
  if (s) {
    out.push(...state.todos.filter((t) => has(`${t.id} ${t.title} ${t.links.join(' ')}`)).slice(0, 8)
      .map((t) => ({ label: t.title, icon: t.done ? 'check_box' : 'check_box_outline_blank', hint: t.id, group: 'Todos', run: () => { ui.selectedId = t.id; ui.drawerId = t.id } })))
    out.push(...state.plans.filter((p) => has(`${p.planNo} ${p.title}`))
      .map((p) => ({ label: `${p.planNo} · ${p.title}`, icon: 'target', group: 'Plans', run: () => router.push(`/strategy/${p.id}`) })))
    out.push(...[...allPsgs(), ...allSigs()].filter((g) => has(`${g.no} ${g.name}`))
      .map((g) => ({ label: `${g.no} · ${g.name}`, icon: 'flag', group: 'Goals', hint: planOfGoal(g.no)?.planNo, run: () => router.push(`/strategy/${planOfGoal(g.no)?.id ?? ''}`) })))
  }
  return out
})

function close() { ui.palette = false }
function run(r) {
  if (!r) return
  if (r.run() !== false) close()
}
function create() {
  const p = parsed.value
  if (!p.title) return
  const t = addTodo({
    title: p.title, links: p.links, due: p.due, timeMin: p.timeMin ?? 30, priority: p.priority ?? 3, lsd: p.lsd ?? 'S',
    scheduled: contextDate.value ? { date: contextDate.value, start: null } : null,
  })
  ui.selectedId = t.id
  toast(`Created ${t.id}${t.scheduled ? ' · ' + t.scheduled.date : ' · inbox'}`)
  close()
}
function onKey(e) {
  if (e.key === 'ArrowDown') { idx.value = Math.min(results.value.length - 1, idx.value + 1); e.preventDefault() }
  else if (e.key === 'ArrowUp') { idx.value = Math.max(0, idx.value - 1); e.preventDefault() }
  else if (e.key === 'Enter') { e.preventDefault(); isAdd.value ? create() : run(results.value[idx.value]) }
  else if (e.key === 'Escape') { e.preventDefault(); close() }
  else if (e.key === 'Backspace' && !q.value && ui.paletteMode === 'add') ui.paletteMode = 'cmd'
}
</script>

<template>
  <div v-if="ui.palette" class="scrim" @mousedown.self="close">
    <div class="pal">
      <div class="in">
        <span class="mono prompt">{{ isAdd ? '+' : '>' }}</span>
        <input ref="input" v-model="q" class="mono" :placeholder="isAdd ? 'Read chapter 3 #RUN 30m due:fri p2 @BASE' : 'Type a command or search…'" @keydown="onKey" />
        <span class="kbd">ESC</span>
      </div>
      <div v-if="isAdd" class="add">
        <div class="tiny upper muted">Live parser</div>
        <div class="parsed">
          <span class="pc"><b>Title</b> {{ parsed.title || '—' }}</span>
          <span class="pc mono"><b>Est</b> {{ parsed.timeMin ?? 30 }}m</span>
          <span class="pc mono"><b>Due</b> {{ parsed.due ?? '—' }}</span>
          <span class="pc mono"><b>Prio</b> P{{ parsed.priority ?? 3 }}</span>
          <span class="pc mono"><b>Day</b> {{ contextDate ?? 'inbox' }}</span>
          <Chip v-for="l in parsed.links" :key="l" :id="l" />
        </div>
        <div class="small muted">Syntax: <span class="mono">#course @BASE 30m due:fri p1 [L]</span> · Enter to create</div>
      </div>
      <div v-else class="list">
        <template v-for="(r, i) in results" :key="r.group + r.label">
          <div v-if="i === 0 || results[i - 1].group !== r.group" class="grp tiny upper muted">{{ r.group }}</div>
          <div class="item" :class="{ act: i === idx }" @mouseenter="idx = i" @click="run(r)">
            <span class="icon sm muted">{{ r.icon }}</span>
            <span class="grow ellipsis">{{ r.label }}</span>
            <span v-if="r.hint" class="kbd">{{ r.hint }}</span>
          </div>
        </template>
        <div v-if="!results.length" class="empty">No match. Start with “+” to create a todo.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--scrim); z-index: 50; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; }
.pal { width: 640px; max-width: calc(100vw - 32px); background: var(--surface); border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border)); border-radius: 4px; box-shadow: 0 0 0 1px var(--border); overflow: hidden; }
.in { display: flex; align-items: center; gap: 10px; padding: 0 14px; height: 48px; border-bottom: 1px solid var(--border); }
.prompt { color: var(--accent); font-size: 16px; font-weight: 700; }
.in input { flex: 1; background: transparent; border: 0; outline: none; font-size: 14px; }
.list { max-height: 50vh; overflow: auto; padding: 4px 0 8px; }
.grp { padding: 10px 14px 4px; }
.item { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 14px; cursor: pointer; }
.item.act { background: var(--surface-2); box-shadow: inset 2px 0 0 var(--accent); }
.add { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.parsed { display: flex; flex-wrap: wrap; gap: 6px; }
.pc { border: 1px solid var(--border); border-radius: 2px; padding: 3px 8px; font-size: 12px; }
.pc b { font: 600 10px 'JetBrains Mono', monospace; color: var(--muted); text-transform: uppercase; margin-right: 4px; }
</style>
