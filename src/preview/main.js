// The workshop's preview (goal 7): runs a draft plugin against demo data, in a sandboxed frame with its own nameless
// origin (no cookies, no storage, no network: the server's Content Security Policy blocks connect-src). Drafts are
// full-power code, so they never run where the real planner is. The parent page sends { type: 'run', code, name }.
import { buildTaxonomy } from '../sdk/vocabulary.js'
import { createDataDoor } from '../sdk/data.js'
import { vocabOf, nsOfPkg, sdkOk } from '../sdk/manifest.js'

const out = document.getElementById('out')
const post = (msg) => parent.postMessage({ source: 'lc-preview', ...msg }, '*')
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function demo() {
  const T = day(0)
  return {
    todos: [
      { id: 'T-101', title: 'Draft the related-work section', done: false, timeMin: 90, priority: 2, scheduled: { date: T, start: '09:00' }, links: ['PSG-1'], uid: 'demo-t101' },
      { id: 'T-102', title: 'Run 5k', done: true, timeMin: 30, priority: 3, scheduled: { date: T, start: '07:00' }, links: [], uid: 'demo-t102' },
      { id: 'T-103', title: 'Email supervisor', done: false, timeMin: 15, priority: 1, scheduled: null, links: [], uid: 'demo-t103' },
    ],
    timeBlocks: [{ id: `B-${T}-13:00`, date: T, start: '13:00', end: '14:00', title: 'Lab meeting', category: 'research', uid: 'demo-b1' }],
    deadlines: [{ id: 'DL-1', title: 'Conference submission', due: `${day(9)}T23:59`, done: false, priority: 1, uid: 'demo-dl1' }],
    plans: [{ id: 'SP-01', title: 'Finish the PhD', status: 'active', psgs: [{ no: 'PSG-1', title: 'Publish paper 2' }], sigs: [] }],
    reviews: [], entities: [], relations: [], reminders: [],
  }
}

let cleanups = []
const listeners = new Map()
async function run({ code, name }) {
  for (const c of cleanups) try { c() } catch { /* ignore */ }
  cleanups = []
  listeners.clear()
  out.innerHTML = ''
  const errors = []
  const pkg = `preview/${nsOfPkg(name || 'draft')}`
  let manifest
  try {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    manifest = (await import(/* @vite-ignore */ url)).default
    URL.revokeObjectURL(url)
    if (!manifest || typeof manifest !== 'object') throw new Error('The file needs `export default { … }`')
    if (!sdkOk(manifest.sdk ?? 1)) throw new Error(`needs SDK ${manifest.sdk}; this console runs SDK 1`)
  } catch (e) {
    out.innerHTML = `<p class="err">${String(e.message ?? e).replace(/</g, '&lt;')}</p>`
    return post({ type: 'result', ok: false, errors: [String(e.message ?? e)] })
  }
  const state = demo()
  const taxonomy = buildTaxonomy([vocabOf(pkg, manifest)])
  const emit = (ev, p) => { for (const fn of [...(listeners.get(ev) ?? []), ...(listeners.get('*') ?? [])]) try { fn(p, ev) } catch (e) { errors.push(`${ev} handler: ${e.message}`) } }
  const door = createDataDoor({ getState: () => state, taxonomy, emit })
  const data = door.as(pkg)
  const lc = Object.freeze({
    sdk: 1, plugin: pkg, data,
    on: (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev)?.delete(fn) },
    emit: (ev, p) => { if (taxonomy.events.has(ev)) emit(ev, { ...p, by: pkg }) },
    vocabulary: () => taxonomy,
    ui: { toast: (m) => post({ type: 'toast', text: String(m).slice(0, 200) }), navigate: () => {}, theme: () => document.documentElement.dataset.theme || 'dark' },
    connections: { request: async () => { throw new Error('Connections are off in the preview (no network): it uses demo data') } },
  })
  const parts = [
    ...(manifest.pages ?? []).map((p, i) => [`Page ${i + 1}: ${p.title ?? manifest.title ?? ''}`, p, { params: {}, query: {} }]),
    ...Object.entries(manifest.slots ?? {}).map(([slot, p]) => [`Slot ${slot}`, p, { date: day(0), todo: 'T-101', plan: 'SP-01' }]),
    ...(manifest.settings ? [['Settings', manifest.settings, {}]] : []),
  ]
  if (typeof manifest.start === 'function') try { manifest.start(lc) } catch (e) { errors.push(`start: ${e.message}`) }
  for (const [label, part, props] of parts) {
    const h = document.createElement('h3'); h.textContent = label
    const box = document.createElement('div'); box.className = 'part'
    out.append(h, box)
    try {
      if (typeof part?.mount !== 'function') throw new Error('needs mount(el, lc)')
      const root = part.shadow === false ? box : box.attachShadow({ mode: 'open' })
      const el = document.createElement('div')
      root.appendChild(el)
      const c = part.mount(el, lc, props)
      if (typeof c === 'function') cleanups.push(c)
    } catch (e) { errors.push(`${label}: ${e.message}`); box.innerHTML = `<p class="err">${String(e.message).replace(/</g, '&lt;')}</p>` }
  }
  if (!parts.length) out.innerHTML = '<p style="color:var(--muted)">This extension has no pages, slots or settings to show.</p>'
  const summary = {
    title: manifest.title ?? '', description: manifest.description ?? '', icon: manifest.icon ?? 'extension', sdk: manifest.sdk ?? 1,
    says: { internet: manifest.says?.internet ?? [], connections: manifest.says?.connections ?? [] }, replaces: manifest.replaces ?? [],
    types: (manifest.types ?? []).map((t) => t.type), pages: (manifest.pages ?? []).length, slots: Object.keys(manifest.slots ?? {}),
  }
  setTimeout(() => post({ type: 'result', ok: !errors.length, errors, problems: taxonomy.problems, manifest: summary, activity: door.activity.slice(-20), height: document.body.scrollHeight }), 50)
}

window.addEventListener('message', (e) => {
  if (e.source !== parent || e.data?.type !== 'run') return
  if (e.data.theme) document.documentElement.dataset.theme = e.data.theme
  run(e.data).catch((err) => post({ type: 'result', ok: false, errors: [String(err.message ?? err)] }))
})
window.addEventListener('error', (e) => post({ type: 'error', text: String(e.message) }))
window.addEventListener('unhandledrejection', (e) => post({ type: 'error', text: String(e.reason?.message ?? e.reason) }))
post({ type: 'ready' })
