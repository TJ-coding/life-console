// Every module's pure data contract (modules/<id>/data.js), by hand. No Vue: store.js, the server and Node tests
// import this. A module with a data.js must be listed here AND in modules/index.js (test/registry.test.mjs checks).
//
// A data contract:
//   export default {
//     id: 'study',
//     linkTypes: [{ kind: 'lecture', prefix: 'LEC-' }],   // plain upper-case prefix; check live goal names first (check-docs --prefix)
//     // only for a module that stores its own data, in state.modules.study (src/sdk/state.js):
//     schemaVersion: 1,
//     defaults: () => ({ courses: [] }),                   // collections = arrays of records with an `id`
//     migrations: { /* 2: (ns, doc) => { … } */ },         // idempotent; never edit a shipped step; prefer optional fields
import deadlines from './deadlines/data.js'
import strategy from './strategy/data.js'
import intelligence from './intelligence/data.js'
import study from './study/data.js'

/** The shell's own link types: kaizen items, and `T-` (todo ids) kept out of goal names. */
const core = {
  id: 'core',
  linkTypes: [{ kind: 'kaizen', prefix: 'KZ-' }],
  reservedPrefixes: ['T-'],
}

export const MODULE_DATA = [core, deadlines, strategy, intelligence, study]

/** Link types with a prefix (plain upper-case, ending in "-"), checked in this order after the person's goal names. */
export const LINK_TYPES = MODULE_DATA.flatMap((m) => (m.linkTypes ?? []).filter((t) => t.prefix))
/** What a link that matches nothing is. */
export const FALLBACK_LINK = MODULE_DATA.flatMap((m) => m.linkTypes ?? []).find((t) => t.fallback)?.kind ?? 'course'
/** Prefixes a goal can't be renamed to (they'd read as another link type). Goals' own PSG-/SIG- are allowed. */
export const RESERVED_PREFIXES = [...LINK_TYPES.filter((t) => t.kind !== 'goal').map((t) => t.prefix), ...MODULE_DATA.flatMap((m) => m.reservedPrefixes ?? [])]

/** Throws if two modules claim the same id or prefix, or a prefix isn't plain upper-case + "-". */
export function checkModuleData(list = MODULE_DATA) {
  const ids = new Set(), prefixes = new Map()
  let fallbacks = 0
  for (const m of list) {
    if (ids.has(m.id)) throw new Error(`module id "${m.id}" is used twice`)
    ids.add(m.id)
    for (const t of m.linkTypes ?? []) if (t.fallback) fallbacks++
    // a namespace (state.modules[id]) needs defaults, a version, and a migration step for every version after 1
    if (m.defaults || m.schemaVersion || m.migrations) {
      if (typeof m.defaults !== 'function' || !Number.isInteger(m.schemaVersion) || m.schemaVersion < 1) throw new Error(`${m.id}: a data namespace needs defaults() and an integer schemaVersion >= 1`)
      for (let v = 2; v <= m.schemaVersion; v++) if (typeof m.migrations?.[v] !== 'function') throw new Error(`${m.id}: migrations[${v}] is missing`)
    }
    for (const p of [...(m.linkTypes ?? []).filter((t) => t.prefix).map((t) => t.prefix), ...(m.reservedPrefixes ?? [])]) {
      if (!/^[A-Z][A-Z0-9]*-$/.test(p)) throw new Error(`${m.id}: link prefix "${p}" must be upper-case letters/digits ending in "-"`)
      if (prefixes.has(p)) throw new Error(`link prefix "${p}" is claimed by both ${prefixes.get(p)} and ${m.id}`)
      prefixes.set(p, m.id)
    }
  }
  if (fallbacks > 1) throw new Error('only one module may own the fallback link type')
  return true
}
checkModuleData()
