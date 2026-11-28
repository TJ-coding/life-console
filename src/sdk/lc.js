// What a plugin is handed (platform/plugins-sdk.md): `lc`, with the data door, events, the vocabulary, a few UI
// helpers and connections. One `lc` per plugin, so every write is labelled with the plugin that made it.
import { watch } from 'vue'
import { state, toast } from '../store'
import { buildTaxonomy } from './vocabulary.js'
import { createDataDoor } from './data.js'

/* ── events ── */
const listeners = new Map()
export const bus = {
  emit(event, payload) {
    for (const fn of [...(listeners.get(event) ?? []), ...(listeners.get('*') ?? [])]) {
      try { fn(payload, event) } catch (e) { console.warn(`[plugin] ${event} handler failed`, e) }
    }
  },
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(fn)
    return () => listeners.get(event)?.delete(fn)
  },
}

/* ── the account's vocabulary: core + common + installed plugins + the person's own tags ── */
let pluginVocab = []
let taxonomy = buildTaxonomy([], { tags: state.settings?.tags })
export const getTaxonomy = () => taxonomy
export function setVocabulary(list) {
  pluginVocab = list
  taxonomy = buildTaxonomy(pluginVocab, { tags: state.settings?.tags })
  return taxonomy
}
const nsOf = (id) => (id === 'core' ? 'core' : (pluginVocab.find((p) => p.id === id)?.ns ?? String(id).split('/').pop()))

/* ── one data door over the reactive planner (writes sync, merge and undo like any edit) ── */
// extensions' records changed by something other than the door (another device, or Claude over MCP:
// server/mcp-extdata.mjs) arrive by sync: tell the extensions, so open pages redraw. The door's own writes
// update the signature first, so they aren't announced twice.
const entitiesSig = () => (state.entities ?? []).map((r) => `${r.id}:${r.updatedAt ?? ''}`).join(',')
let lastEntitiesSig = entitiesSig()
export const door = createDataDoor({
  getState: () => state, taxonomy: () => taxonomy, nsOf,
  emit: (e, p) => { if (e === 'record.changed') lastEntitiesSig = entitiesSig(); bus.emit(e, p) },
})
watch(entitiesSig, (sig) => { if (sig === lastEntitiesSig) return; lastEntitiesSig = sig; bus.emit('record.changed', { op: 'sync', type: null, id: null, by: 'core' }) })

// core events for changes made anywhere (screens edit the store directly): a todo ticked off
let doneBefore = new Set((state.todos ?? []).filter((t) => t.done).map((t) => t.id))
watch(() => (state.todos ?? []).filter((t) => t.done).map((t) => t.id).join(','), () => {
  const now = new Set((state.todos ?? []).filter((t) => t.done).map((t) => t.id))
  for (const id of now) if (!doneBefore.has(id)) bus.emit('todo.done', { id, by: 'core' })
  doneBefore = now
})

let routerRef = null
export const setLcRouter = (r) => { routerRef = r }

/** The `lc` a plugin gets. */
export function makeLc(pluginId) {
  const call = (m) => (...args) => door.as(pluginId)[m](...args)
  return Object.freeze({
    sdk: 1,
    plugin: pluginId,
    data: Object.freeze({ list: call('list'), get: call('get'), create: call('create'), update: call('update'), upsert: call('upsert'), delete: call('delete'), relate: call('relate'), unrelate: call('unrelate'), links: call('links') }),
    on: (event, fn) => bus.on(event, fn),
    emit: (event, payload) => { if (taxonomy.events.has(event)) bus.emit(event, { ...payload, by: pluginId }) },
    vocabulary: () => taxonomy,
    ui: Object.freeze({
      toast: (msg) => toast(String(msg).slice(0, 200)),
      navigate: (path) => routerRef?.push(path),
      theme: () => document.documentElement.dataset.theme,
    }),
    connections: Object.freeze({
      /** Use a saved connection (the vault): the server adds the key, only for the site it was saved for. */
      async request(name, { method = 'GET', url, body } = {}) {
        const r = await fetch('/api/connections/request', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, method, url, body, plugin: pluginId }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || `connection request failed (${r.status})`)
        return j
      },
    }),
  })
}
