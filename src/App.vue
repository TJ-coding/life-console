<script setup>
import { computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ui, state, todayISO, wd, isoWeek, pad, stampNext, toggleTodo, updateTodo, addDays, toast, toggleTheme, STAMPS, moveSelected, isOverdue } from './store'
import { NAV } from './nav'
import CommandPalette from './components/CommandPalette.vue'
import TodoDrawer from './components/TodoDrawer.vue'
import SplitDialog from './components/SplitDialog.vue'
import DeadlineDialog from './components/DeadlineDialog.vue'
import { useNow } from './now'
import { sync, chooseSync } from './sync'

const SYNC_TEXT = { choose: 'CHOOSE', starting: '…', local: 'LOCAL', syncing: 'SAVING', synced: 'SYNCED', offline: 'OFFLINE', 'signed-out': 'SIGNED OUT', error: 'ERROR' }
const SYNC_ICON = { choose: 'sync_problem', starting: 'sync', local: 'save', syncing: 'sync', synced: 'cloud_done', offline: 'cloud_off', 'signed-out': 'lock', error: 'error' }
const TABS = [
  { to: '/', icon: 'radar', label: 'Today', key: 'today' },
  { to: '/week', icon: 'calendar_month', label: 'Plan', key: 'week' },
  { to: '/todos', icon: 'checklist', label: 'Todos', key: 'todos' },
  { to: '/deadlines', icon: 'alarm', label: 'Deadlines', key: 'deadlines' },
  { to: '/settings', icon: 'settings', label: 'Settings', key: 'settings' },
]

// "What now" — shown in the top bar on every screen and in the browser tab title.
const now = useNow()
const headline = now.headline
watch(() => `${headline.value.state === 'busy' ? '▶ ' : ''}${headline.value.text} · ${headline.value.meta}`, (s) => {
  document.title = `${s} — Life Console`
}, { immediate: true })

const route = useRoute()
const router = useRouter()

const clock = computed(() => {
  const n = ui.now
  return `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`
})
const T = computed(() => todayISO())
const reload = () => window.location.reload()
const openCount = computed(() => state.todos.filter((t) => !t.done).length)
const overdueCount = computed(() => { void ui.now.getMinutes(); return state.deadlines.filter(isOverdue).length })
const activeKey = computed(() => (route.name === 'module' ? route.params.module : route.name === 'day' ? 'today' : route.name))

function openPalette(mode) {
  ui.paletteMode = mode
  ui.palette = true
}

let gPending = false
let gTimer
function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    ui.palette ? (ui.palette = false) : openPalette('cmd')
    return
  }
  if (e.key === 'Escape') {
    if (ui.deadlineId) ui.deadlineId = null
    else if (ui.splitId) ui.splitId = null
    else if (ui.palette) ui.palette = false
    else if (ui.drawerId) ui.drawerId = null
    else if (route.name === 'focus') router.push('/')
    else ui.selectedId = null
    return
  }
  const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]')
  if (typing || ui.palette || ui.splitId || ui.deadlineId) return
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && ui.selectedId) {
    e.preventDefault()
    const t = moveSelected(e.key === 'ArrowUp' ? -1 : 1)
    if (t) toast(`${t.id} · P${t.priority}`)
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const k = e.key.toLowerCase()

  if (gPending) {
    gPending = false
    clearTimeout(gTimer)
    const to = { s: '/strategy', i: '/todos', t: '/', w: '/week', c: '/', l: '/week?mode=days', d: '/deadlines' }[k]
    if (to) { router.push(to); e.preventDefault() }
    return
  }
  // list navigation over whatever the current view exposes in ui.visibleIds
  if (k === 'j' || k === 'arrowdown' || k === 'k' || k === 'arrowup') {
    const ids = ui.visibleIds
    if (!ids.length) return
    e.preventDefault()
    const cur = ids.indexOf(ui.selectedId)
    const dir = k === 'j' || k === 'arrowdown' ? 1 : -1
    ui.selectedId = ids[cur < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, cur + dir))]
    if (ui.drawerId) ui.drawerId = ui.selectedId
    return
  }
  switch (k) {
    case 'g': gPending = true; gTimer = setTimeout(() => { gPending = false }, 1000); break
    case 't': router.push('/'); break
    case 'w': router.push('/week'); break
    case 'n':
      e.preventDefault()
      if (route.name === 'week') ui.backlogFocus++ // Plan week: capture straight into the backlog panel
      else openPalette('add')
      break
    case '/': e.preventDefault(); openPalette('cmd'); break
    case 's': {
      const i = stampNext(T.value)
      toast(i < 0 ? 'Today is fully stamped 完' : `Stamped ${STAMPS[i]} for ${T.value}`)
      break
    }
    case 'f': router.push(route.name === 'focus' ? '/' : '/focus'); break
    case 'x': {
      // X = done on the selected todo, else on the todo you're currently doing
      const id = ui.selectedId ?? (now.current.value?.kind === 'todo' ? now.current.value.todoId : null)
      if (id) { toggleTodo(id); toast(`${id} toggled`) }
      break
    }
    case 'enter': if (ui.selectedId) ui.drawerId = ui.selectedId; break
    case '[':
    case ']': {
      const dir = k === '[' ? -1 : 1
      if (route.name === 'today' || route.name === 'day') {
        // day view: previous / next day
        const d = addDays(route.params.date || todayISO(), dir)
        router.push(d === todayISO() ? '/' : `/day/${d}`)
      } else {
        ui.weekStart = addDays(ui.weekStart, dir * 7)
        if (route.name !== 'week') router.push('/week')
      }
      break
    }
    default:
      if (route.name === 'focus' && /^[1-3]$/.test(k)) {
        const id = ui.focusIds[+k - 1]
        if (id) { toggleTodo(id); toast(`${id} done`) }
        return
      }
      if (/^[1-5]$/.test(k) && ui.selectedId) {
        updateTodo(ui.selectedId, { priority: +k })
        toast(`Priority P${k}`)
      }
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="app" :class="{ bare: route.meta.bare }">
    <aside v-if="!route.meta.bare" class="sidebar">
      <div class="brand">
        <span class="logo"><span class="icon">radar</span></span>
        <div>
          <div class="name">LIFE CONSOLE</div>
          <div class="mono tiny muted">OP-DECK // v0.1 prototype</div>
        </div>
      </div>
      <button class="exec" @click="openPalette('cmd')">
        <span class="icon sm">terminal</span><span class="mono">EXECUTE</span><span class="spacer"></span><span class="kbd">⌘K</span>
      </button>
      <nav>
        <router-link v-for="n in NAV" :key="n.key" :to="n.to" class="nav" :class="{ on: activeKey === n.key }">
          <span class="icon">{{ n.icon }}</span>
          <span class="grow">{{ n.label }}</span>
          <span v-if="n.key === 'todos'" class="mono tiny count">{{ openCount }}</span>
          <span v-else-if="n.key === 'deadlines' && overdueCount" class="mono tiny count over" title="Overdue">{{ overdueCount }}</span>
          <span v-else-if="n.to.startsWith('/m/')" class="mono tiny muted">soon</span>
        </router-link>
      </nav>
      <div class="spacer"></div>
      <div class="side-foot mono small">
        <div class="row"><span class="icon sm muted">cloud_sync</span><span class="muted grow">ClickUp sync</span><span class="ok">MOCK</span></div>
        <router-link to="/settings" class="row synclink" :title="sync.message || 'Sync status'">
          <span class="icon sm muted">{{ SYNC_ICON[sync.status] }}</span><span class="muted grow">Sync</span>
          <span :class="sync.status === 'synced' ? 'ok' : ['signed-out', 'error'].includes(sync.status) ? 'danger' : 'warn'">{{ SYNC_TEXT[sync.status] }}</span>
        </router-link>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumb mono">
          <span class="muted">{{ route.meta.screen ?? 'S-??' }}</span>
          <span class="muted">/</span>
          <span>{{ route.name === 'module' ? route.params.module : route.meta.title }}</span>
        </div>
        <span class="spacer"></span>
        <router-link v-if="route.name !== 'focus'" to="/focus" class="nowpill" :class="headline.state" :title="`${headline.text} — ${headline.meta} (F for focus mode)`">
          <span class="nowtag mono">{{ headline.state === 'busy' ? 'NOW' : headline.state === 'free' ? 'NEXT' : 'IDLE' }}</span>
          <span class="ellipsis">{{ headline.text }}</span>
          <span class="mono small muted">{{ headline.meta }}</span>
        </router-link>
        <span class="mono small pill"><span class="dot"></span>{{ T }} {{ wd(T) }} · W{{ isoWeek(T) }} · {{ clock }}</span>
        <button class="btn" @click="openPalette('add')"><span class="icon sm">add</span>New todo <span class="kbd">N</span></button>
        <button class="btn icon-only" :title="`Theme: ${ui.theme}`" @click="toggleTheme"><span class="icon sm">{{ ui.theme === 'dark' ? 'light_mode' : 'dark_mode' }}</span></button>
      </header>

      <main class="content">
        <div v-if="sync.status === 'signed-out'" class="banner">
          <span class="icon sm">lock</span>Your sign-in expired, so changes aren't syncing.
          <button class="btn sm" @click="reload">Reload to sign in</button>
        </div>
        <router-view />
      </main>

      <nav class="tabbar" aria-label="Main">
        <router-link v-for="t in TABS" :key="t.key" :to="t.to" class="tab" :class="{ on: activeKey === t.key }">
          <span class="icon">{{ t.icon }}</span><span>{{ t.label }}</span>
          <i v-if="t.key === 'deadlines' && overdueCount" class="tabbadge">{{ overdueCount }}</i>
        </router-link>
      </nav>

      <footer class="statusbar mono">
        <span><span class="kbd">⌘K</span> Command</span>
        <span><span class="kbd">N</span> New todo</span>
        <span><span class="kbd">S</span> Stamp</span>
        <span><span class="kbd">F</span> Focus</span>
        <span><span class="kbd">T</span> Today</span>
        <span><span class="kbd">W</span> Week</span>
        <span><span class="kbd">[</span><span class="kbd">]</span> Prev/next</span>
        <span><span class="kbd">G</span><span class="kbd">S</span> Strategy</span>
        <span><span class="kbd">J</span><span class="kbd">K</span> Move</span>
        <span><span class="kbd">X</span> Done</span>
        <span><span class="kbd">1–5</span> Priority</span>
        <span><span class="kbd">⌥↑↓</span> Reorder</span>
        <span class="spacer"></span>
        <span v-if="ui.selectedId" class="info">SELECTED {{ ui.selectedId }}</span>
      </footer>
    </div>

    <CommandPalette />
    <TodoDrawer />
    <SplitDialog />
    <div v-if="sync.status === 'choose'" class="choose-scrim">
      <div class="choose panel" role="dialog" aria-label="Choose which planner to keep">
        <div class="panel-h"><span class="icon sm">sync_problem</span><h2>Which planner should this device use?</h2></div>
        <div class="panel-b col">
          <p class="small">This device already has planner data, and the server has a planner from another device
            (saved {{ sync.pending?.updatedAt ? new Date(sync.pending.updatedAt).toLocaleString() : '' }}{{ sync.pending?.device ? ' on ' + sync.pending.device : '' }}).
            They'll stay in sync from now on.</p>
          <button class="btn primary big" @click="chooseSync('server')"><span class="icon sm">cloud_download</span>Use the server's planner<small>recommended for a new phone or browser — this device's copy is replaced</small></button>
          <button class="btn big" @click="chooseSync('device')"><span class="icon sm">cloud_upload</span>Use this device's planner<small>replaces the server copy everywhere (the server keeps a backup)</small></button>
          <p class="tiny muted">Unsure? Export this device's data first in Settings → Data.</p>
        </div>
      </div>
    </div>
    <DeadlineDialog />
    <transition name="fade">
      <div v-if="ui.toast" class="toast mono">
        {{ ui.toast }}
        <button v-if="ui.toastAction" class="btn sm toast-act" @click="ui.toastAction.run(); ui.toast = ''">{{ ui.toastAction.label }}</button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.app { display: grid; grid-template-columns: 232px 1fr; height: 100vh; }
.app.bare { grid-template-columns: 1fr; }
.nowpill { display: inline-flex; align-items: center; gap: 8px; height: 30px; max-width: 460px; min-width: 0; padding: 0 10px 0 4px; border: 1px solid var(--border); border-radius: 2px; color: var(--text); background: var(--surface-2); }
.nowpill:hover { border-color: var(--accent); }
.nowpill.busy { border-color: color-mix(in srgb, var(--stamp) 60%, var(--border)); }
.nowtag { padding: 2px 6px; border-radius: 2px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; background: var(--surface); color: var(--muted); border: 1px solid var(--border); }
.nowpill.busy .nowtag { background: var(--stamp); color: #fff; border-color: var(--stamp); }
.nowpill.free .nowtag { color: var(--accent); border-color: var(--accent); }
.sidebar { background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 14px 10px; gap: 12px; min-height: 0; }
.brand { display: flex; align-items: center; gap: 10px; padding: 2px 6px 10px; border-bottom: 1px solid var(--border); }
.logo { width: 34px; height: 34px; border: 1px solid var(--border); border-radius: 4px; display: flex; align-items: center; justify-content: center; color: var(--accent); background: var(--surface-2); }
.name { font-weight: 700; letter-spacing: 0.02em; }
.exec { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 2px; color: var(--accent); cursor: pointer; font-size: 12px; }
.exec:hover { border-color: var(--accent); }
nav { display: flex; flex-direction: column; gap: 2px; overflow: auto; }
.nav { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 10px; border-radius: 2px; color: var(--muted); }
.nav:hover { background: var(--surface-2); color: var(--text); }
.nav.on { background: var(--surface-2); color: var(--accent); box-shadow: inset 2px 0 0 var(--accent); }
.count.over { color: var(--danger); border-color: var(--danger); }
.count { border: 1px solid var(--border); border-radius: 2px; padding: 2px 5px; }
.side-foot { border-top: 1px solid var(--border); padding: 10px 6px 0; display: flex; flex-direction: column; gap: 8px; }
.main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.topbar { height: 48px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid var(--border); background: var(--surface); }
.crumb { display: flex; gap: 8px; text-transform: uppercase; font-size: 12px; letter-spacing: 0.04em; }
.pill { display: inline-flex; align-items: center; gap: 8px; height: 28px; padding: 0 10px; border: 1px solid var(--border); border-radius: 2px; background: var(--surface-2); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.content { flex: 1; overflow: auto; min-height: 0; }
.statusbar { height: 28px; flex: none; display: flex; align-items: center; gap: 16px; padding: 0 16px; border-top: 1px solid var(--border); background: var(--surface); font-size: 11px; color: var(--muted); overflow: hidden; white-space: nowrap; }
.statusbar .kbd { margin-right: 4px; }
.toast-act { margin-left: 10px; color: var(--text); }
.toast { display: flex; align-items: center; position: fixed; bottom: 44px; left: 50%; transform: translateX(-50%); background: var(--surface-2); border: 1px solid var(--accent); color: var(--accent); padding: 8px 14px; border-radius: 2px; z-index: 60; font-size: 12px; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@media (max-width: 900px) {
  .app { grid-template-columns: 56px 1fr; }
  .brand > div, .exec .mono, .exec .kbd, .nav .grow, .nav .tiny, .side-foot { display: none; }
  .nav, .exec { justify-content: center; padding: 0; }
  .statusbar span:nth-child(n + 5) { display: none; }
  .nowpill .muted { display: none; }
}
.choose-scrim { position: fixed; inset: 0; z-index: 70; background: var(--scrim); display: flex; align-items: center; justify-content: center; padding: 16px; }
.choose { max-width: 520px; width: 100%; }
.btn.big { height: auto; padding: 10px 12px; flex-direction: column; align-items: flex-start; gap: 3px; white-space: normal; text-align: left; }
.btn.big small { font: 400 11px/14px Inter, sans-serif; opacity: 0.85; }
.synclink { color: inherit; }
.synclink:hover .muted { color: var(--text); }
.banner { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: color-mix(in srgb, var(--danger) 12%, var(--surface)); border-bottom: 1px solid var(--danger); color: var(--text); font-size: 12px; }
.tabbar { display: none; }
/* phone: bottom tab bar instead of the sidebar; respect the notch / home indicator */
@media (max-width: 640px) {
  .app { grid-template-columns: 1fr; height: 100dvh; }
  .sidebar, .statusbar, .pill, .crumb { display: none !important; }
  .topbar { padding: env(safe-area-inset-top) 10px 0; height: calc(48px + env(safe-area-inset-top)); gap: 6px; }
  .topbar .kbd { display: none; }
  .topbar .btn:not(.icon-only) { font-size: 0; gap: 0; padding: 0 6px; }
  .topbar .btn .icon { font-size: 18px; }
  .nowpill { flex: 1; max-width: none; }
  .tabbar {
    display: flex; flex-direction: row; gap: 0; overflow: visible; flex: none; border-top: 1px solid var(--border); background: var(--surface);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .tab { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0 5px; color: var(--muted); font-size: 10px; }
  .tab.on { color: var(--accent); }
  .tabbadge { position: absolute; top: 2px; left: 55%; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px; background: var(--danger); color: #fff; font: 700 9px/15px 'JetBrains Mono', monospace; font-style: normal; }
  .toast { bottom: calc(64px + env(safe-area-inset-bottom)); max-width: calc(100vw - 24px); }
}
</style>
