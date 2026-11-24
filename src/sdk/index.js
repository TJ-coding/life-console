// The app's registry: every Core module (modules/index.js) plus the shell's own entries, checked once at startup,
// and the Public plugins installed for this account, added once they load (src/sdk/loader.js). It's shallow-reactive:
// installing or removing a plugin rebuilds it, and the sidebar, tab bar, chords, palette and routes follow.
import { shallowReactive } from 'vue'
import MODULES from '../../modules/index.js'
import core from './core.js'
import { buildRegistry } from './registry.js'
import { publicIds } from './publicIds.js'

export { defineModule } from './registry.js'
export { useModuleState, ensureModuleState } from './state.js'
export const registry = shallowReactive(buildRegistry([...MODULES, core]))
const CORE_ROUTES = registry.routes

let router = null
let added = [] // route names added for Public plugins, removed on the next rebuild
/** main.js hands over the router so plugin routes can be added and removed later. */
export function attachRouter(r) { router = r }

/** Rebuild with these Public plugin manifests (already converted by loader.js). [] = safe mode / none. */
export function setPublicPlugins(manifests) {
  const next = buildRegistry([...MODULES, core], { plugins: manifests })
  Object.assign(registry, next)
  publicIds.clear()
  for (const m of manifests) if (next.byId[m.id] && !next.conflicts.some((c) => c.startsWith(`${m.id}: module id`))) publicIds.add(m.id)
  if (router) {
    // 1. take out the previous plugins' routes, 2. put back any Core route a removed plugin had replaced,
    // 3. add this set's plugin routes (a replacement takes the Core route's name and path)
    for (const name of added) if (router.hasRoute(name)) router.removeRoute(name)
    added = []
    for (const r of CORE_ROUTES) if (r.name && !router.hasRoute(r.name)) router.addRoute(r)
    for (const r of next.routes) {
      if (!publicIds.has(r.meta?.module)) continue
      const name = r.name ?? `plugin:${r.path}`
      if (router.hasRoute(name)) router.removeRoute(name)
      router.addRoute({ ...r, name })
      added.push(name)
    }
    const cur = router.currentRoute.value
    if (cur?.fullPath) router.replace(cur.fullPath).catch(() => {})
  }
  return next
}
