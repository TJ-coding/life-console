<script setup>
import { computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ui, state, todayISO, wd, isoWeek, pad, stampNext, toggleTodo, updateTodo, addDays, toast, toggleTheme, STAMPS, moveSelected } from './store'
import { NAV } from './nav'
import CommandPalette from './components/CommandPalette.vue'
import TodoDrawer from './components/TodoDrawer.vue'
import SplitDialog from './components/SplitDialog.vue'
import { useNow } from './now'

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
const openCount = computed(() => state.todos.filter((t) => !t.done).length)
const activeKey = computed(() => (route.name === 'module' ? route.params.module : route.name))

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
    if (ui.splitId) ui.splitId = null
    else if (ui.palette) ui.palette = false
    else if (ui.drawerId) ui.drawerId = null
    else if (route.name === 'focus') router.push('/')
    else ui.selectedId = null
    return
  }
  const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]')
  if (typing || ui.palette || ui.splitId) return
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
    const to = { s: '/strategy', i: '/todos', t: '/', w: '/week', c: '/', l: '/week?mode=days' }[k]
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
    case 'n': e.preventDefault(); openPalette('add'); break
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
    case '[': ui.weekStart = addDays(ui.weekStart, -7); if (route.name !== 'week') router.push('/week'); break
    case ']': ui.weekStart = addDays(ui.weekStart, 7); if (route.name !== 'week') router.push('/week'); break
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
          <span v-else-if="n.to.startsWith('/m/')" class="mono tiny muted">soon</span>
        </router-link>
      </nav>
      <div class="spacer"></div>
      <div class="side-foot mono small">
        <div class="row"><span class="icon sm muted">cloud_sync</span><span class="muted grow">ClickUp sync</span><span class="ok">MOCK</span></div>
        <div class="row"><span class="icon sm muted">save</span><span class="muted grow">Storage</span><span class="ok">LOCAL</span></div>
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
        <router-view />
      </main>

      <footer class="statusbar mono">
        <span><span class="kbd">⌘K</span> Command</span>
        <span><span class="kbd">N</span> New todo</span>
        <span><span class="kbd">S</span> Stamp</span>
        <span><span class="kbd">F</span> Focus</span>
        <span><span class="kbd">T</span> Today</span>
        <span><span class="kbd">W</span> Week</span>
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
</style>
