// Loads the Public plugins installed for this account (the registry, consented on the trusted page) and adds them
// to the console. Safe mode starts without them: `?safe=1`, a link from the trusted page, or automatically when the
// last start crashed while plugins were loading. Core plugins don't go through here: they ship with the app.
import { reactive } from 'vue'
import { setPublicPlugins, registry } from './index.js'
import { setVocabulary, makeLc } from './lc.js'
import { toModule, vocabOf, sdkOk } from './manifest.js'
import PluginPage from '../views/PluginPage.vue'

const LOADING = 'life-console/plugins-loading'
export const plugins = reactive({ status: 'idle', safe: false, crashed: false, installed: [], failed: {}, conflicts: [], highlight: null, dev: null })
// start() runs once per loaded file: reloading for a live test must not start the other extensions twice
const started = new Set()

function wantsSafe() {
  try {
    if (new URLSearchParams(location.search).has('safe') || /[?&]safe=1/.test(location.hash)) return 'asked'
    if (sessionStorage.getItem('life-console/safe') === '1') return 'asked'
    if (localStorage.getItem(LOADING)) return 'crashed' // the last start never finished loading plugins
  } catch { /* storage off */ }
  return null
}
export function leaveSafeMode() {
  try { sessionStorage.removeItem('life-console/safe'); localStorage.removeItem(LOADING) } catch { /* ignore */ }
  location.href = location.pathname + location.hash.replace(/[?&]safe=1/, '')
}

let styleEls = []
function applyStyles(list) {
  for (const el of styleEls) el.remove()
  styleEls = list.map((s) => {
    const el = document.createElement('style')
    el.dataset.plugin = s.module
    // a theme plugin styles the whole app; anything else only its own parts, which render in a Shadow DOM anyway
    el.textContent = s.global ? s.css : `[data-plugin="${s.module}"]{}\n${s.css.replace(/(^|})\s*([^{}@]+)\{/g, (m, a, sel) => `${a}\n${sel.split(',').map((x) => `[data-plugin="${s.module}"] ${x.trim()}`).join(',')}{`)}`
    document.head.appendChild(el)
    return el
  })
}

/** Fetch the installed list and load each plugin. Never throws: a plugin that fails is skipped and listed. */
export async function loadPlugins() {
  const safe = wantsSafe()
  plugins.safe = !!safe
  plugins.crashed = safe === 'crashed'
  if (safe === 'asked') try { sessionStorage.setItem('life-console/safe', '1') } catch { /* ignore */ }
  let list = []
  try {
    const r = await fetch('/api/plugins/installed', { credentials: 'same-origin' })
    if (!r.ok) { plugins.status = r.status === 401 ? 'signed-out' : 'none'; return }
    list = (await r.json()).plugins ?? []
  } catch { plugins.status = 'offline'; return }
  plugins.installed = list
  // a live test (consented on the trusted page): the workshop's draft runs too, in place of the installed version
  // it edits. Never in safe mode. Its code comes from the server only while the test is on and passes the checks.
  plugins.dev = null
  if (!safe) {
    try {
      const r = await fetch('/api/workshop/dev', { credentials: 'same-origin' })
      const d = r.ok ? await r.json() : null
      if (d?.on && d.key) {
        plugins.dev = d
        delete plugins.failed[d.pkg]
        list = [...list.filter((p) => p.pkg !== d.pkg), { pkg: d.pkg, enabled: true, devKey: d.key }]
      }
    } catch { /* offline: no live test */ }
  }
  if (safe || !list.length) { plugins.status = safe ? 'safe' : 'none'; if (safe === 'crashed') try { localStorage.removeItem(LOADING) } catch { /* ignore */ } return }
  try { localStorage.setItem(LOADING, String(Date.now())) } catch { /* ignore */ }
  plugins.status = 'loading'
  const loaded = []
  // where Core modules live, for plugins that replace one
  const replacedPaths = {}
  for (const m of registry.modules) if (m.routes?.[0] && !m.tier) replacedPaths[m.id] = { path: m.routes[0].path, name: m.routes[0].name, navKey: m.nav?.[0]?.key }
  for (const p of list.filter((x) => x.enabled !== false)) {
    try {
      // its files sit side by side under one address, so its relative imports ('./layout.js') resolve
      const src = p.devKey ? `/api/workshop/dev/code/${p.devKey}/index.js` : `/api/registry/code/${p.hash}/index.js`
      const mod = await import(/* @vite-ignore */ src)
      const manifest = mod.default
      if (!manifest || typeof manifest !== 'object') throw new Error('the file has no default export')
      if (!sdkOk(manifest.sdk ?? 1)) throw new Error(`needs SDK ${manifest.sdk}; this server runs SDK 1`)
      loaded.push({ pkg: p.pkg, manifest, src })
    } catch (e) {
      plugins.failed[p.pkg] = String(e.message ?? e)
    }
  }
  const tax = setVocabulary(loaded.map(({ pkg, manifest }) => vocabOf(pkg, manifest)))
  const next = setPublicPlugins(loaded.map(({ pkg, manifest }) => toModule(pkg, manifest, { PageComponent: PluginPage, replacedPaths })))
  plugins.conflicts = [...next.conflicts, ...tax.problems]
  applyStyles(next.styles)
  for (const { pkg, manifest, src } of loaded) {
    if (started.has(src)) continue
    started.add(src)
    if (typeof manifest.start === 'function') try { manifest.start(makeLc(pkg)) } catch (e) { plugins.failed[pkg] = `start: ${e.message}` }
  }
  plugins.status = 'ready'
  // still alive a few seconds after loading: this start didn't crash
  setTimeout(() => { try { localStorage.removeItem(LOADING) } catch { /* ignore */ } }, 4000)
}
