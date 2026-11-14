// A module's own data: state.modules[id], versioned in state.moduleVersions[id] (server/schema.mjs migrates it).
// Rules (the platform plan, §4): core records (todos, blocks, deadlines…) stay shared at the top level, and anything
// that belongs on the calendar is a core record linked to the module's record. The namespace holds only the extra
// detail. Collections in it are arrays of records with an `id`, so two devices' edits merge per record.
import { computed, readonly } from 'vue'
import { state } from '../store.js'
import { MODULE_DATA } from '../../modules/data.js'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
function contract(id) {
  const d = MODULE_DATA.find((m) => m.id === id)
  if (!d?.defaults) throw new Error(`module ${id} has no data namespace (defaults() in modules/${id}/data.js)`)
  return d
}

/**
 * The module's namespace, created with its defaults (and current version) the first time the module stores
 * something. Call it before writing; reading through useModuleState() never creates one.
 */
export function ensureModuleState(id) {
  const d = contract(id)
  if (!isObj(state.modules)) state.modules = {}
  if (!isObj(state.moduleVersions)) state.moduleVersions = {}
  if (!isObj(state.modules[id])) {
    state.modules[id] = d.defaults()
    state.moduleVersions[id] = d.schemaVersion ?? 1
  }
  return state.modules[id]
}

/** Read-only reactive view: the namespace, or the defaults while there is none (a missing namespace means defaults). */
export function useModuleState(id) {
  const empty = readonly(contract(id).defaults())
  return computed(() => (isObj(state.modules?.[id]) ? state.modules[id] : empty))
}
