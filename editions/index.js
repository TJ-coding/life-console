// Every edition, by hand. Pure JS (no Vue): the app and the server (landing paths) import it.
// An edition changes what is SHOWN, never what is stored (the platform plan, §2): which modules appear, view
// switches, its name, tour, landing page, and starting values for a NEW account. Data and settings stay the account's.
import base from './base.js'
import minimalist from './minimalist.js'

export const EDITION_LIST = [base, minimalist]
export const EDITIONS = Object.fromEntries(EDITION_LIST.map((e) => [e.id, e]))
export const DEFAULT_EDITION = 'base'
/** Landing paths on the main domain: { '/minimalist': 'minimalist' }. */
export const EDITION_LANDINGS = Object.fromEntries(EDITION_LIST.filter((e) => e.landing).map((e) => [e.landing, e.id]))

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
function deepMerge(into, from) {
  for (const [k, v] of Object.entries(from)) into[k] = isObj(v) ? deepMerge(isObj(into[k]) ? into[k] : {}, v) : v
  return into
}
/**
 * The demo document a new account starts with in this edition: the edition's demo data and starting settings,
 * and its id as the account's home edition. Base gets the base demo unchanged.
 */
export function editionSeed(doc, id) {
  const e = EDITIONS[id]
  if (!e || e.id === DEFAULT_EDITION) return doc
  const out = e.seed ? e.seed(doc) : doc
  out.settings = deepMerge(isObj(out.settings) ? out.settings : {}, structuredClone(e.newAccount?.settings ?? {}))
  out.settings.edition = e.id
  return out
}

/** Module ids shown in an edition: its own, plus the add-ons switched on for it (settings.addOns[edition][id] = true). */
export function enabledModules(id, settings) {
  const e = EDITIONS[id] ?? EDITIONS[DEFAULT_EDITION]
  const on = new Set(e.modules)
  const add = settings?.addOns?.[e.id]
  if (isObj(add)) for (const [m, v] of Object.entries(add)) if (v === true) on.add(m) // false = removed again (kept as a key so two devices merge)
  return on
}

/** Throws if an edition names a module that doesn't exist, or two editions share an id or landing path. */
export function checkEditions(moduleIds, list = EDITION_LIST) {
  const ids = new Set(), paths = new Set()
  for (const e of list) {
    if (ids.has(e.id)) throw new Error(`edition id "${e.id}" is used twice`)
    ids.add(e.id)
    if (e.landing) {
      if (!/^\/[a-z0-9-]+$/.test(e.landing)) throw new Error(`${e.id}: landing path "${e.landing}"`)
      if (paths.has(e.landing)) throw new Error(`landing path ${e.landing} is used twice`)
      paths.add(e.landing)
    }
    for (const m of e.modules) if (!moduleIds.includes(m)) throw new Error(`edition ${e.id} names unknown module "${m}"`)
  }
  if (!ids.has(DEFAULT_EDITION)) throw new Error('the base edition is missing')
  return true
}
