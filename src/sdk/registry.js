// The module registry: every screen group is a module manifest (modules/<id>/index.js), and the shell reads
// routes, the sidebar, the phone tab bar, palette commands and G-chords from here instead of hard-coded lists.
// Pure JS (no Vue), so a Node test can build it and check the rules below.
//
// A manifest:
//   defineModule({
//     id: 'study',                         // or `data` (modules/<id>/data.js), whose id is used
//     data,                                // the pure data contract: link types now; namespace and migrations later
//     title: 'Study', icon: 'menu_book',
//     routes: [{ path: '/m/study', name: 'study', component, meta: { title, screen, nav? } }],
//     nav: [{ key, label, icon, to, chord?: 'U', hint?: 'T', tab?: 'Study' }],   // G then U; `tab` = phone tab bar label
//     chords: [{ key: 'c', to: '/' }],     // extra G-chords that aren't a sidebar entry
//     commands: [{ label, icon, hint?, run: ({ router, route }) => … }],          // command palette
//     planned: ['S-55 Courses Index', …],  // spec screens not built yet: /m/<id> shows them
//   })
//
// Rules (buildRegistry throws when one is broken; test/registry.test.mjs builds the real list):
//   - names are global: module ids, route paths and names, nav keys and chords are unique across ALL modules
//   - routes that exist today are frozen (notifications, bookmarks and the Mac app point at them); a new
//     module's routes live under /m/<id>
//   - modules get G-chords and palette commands only; single-key shortcuts stay with the shell (App.vue)

/** Routes that existed before the registry. Only these may live outside /m/<id>. */
export const FROZEN_PATHS = ['/', '/day/:date', '/focus', '/briefing', '/debrief', '/week', '/workload', '/todos', '/deadlines', '/strategy', '/strategy/:planId', '/settings', '/issues', '/m/:module']

const ID = /^[a-z][a-z0-9-]*$/

export function defineModule(m) {
  const id = m.id ?? m.data?.id
  if (!id || !ID.test(id)) throw new Error(`module id "${id}" must be lower-case letters, digits and -`)
  if (m.data && m.id && m.data.id !== m.id) throw new Error(`module ${m.id}: data.id is "${m.data.id}"`)
  return { routes: [], nav: [], chords: [], commands: [], ...m, id }
}

function chordOk(key, owner) {
  if (!/^[a-z0-9]$/i.test(key)) throw new Error(`module ${owner}: chord "${key}" must be one letter or digit`)
}
function claim(seen, kind, name, owner) {
  const k = String(name).toLowerCase()
  if (seen.has(k)) throw new Error(`${kind} "${name}" is claimed by both ${seen.get(k)} and ${owner}`)
  seen.set(k, owner)
}

/** Check a list of manifests and flatten it into what the shell renders. The list's order is the sidebar's order. */
export function buildRegistry(list) {
  const ids = new Map(), paths = new Map(), names = new Map(), navKeys = new Map(), chordKeys = new Map()
  const routes = [], nav = [], chords = {}, commands = []
  for (const m of list) {
    claim(ids, 'module id', m.id, m.id)
    for (const r of m.routes) {
      claim(paths, 'route path', r.path, m.id)
      if (r.name) claim(names, 'route name', r.name, m.id)
      if (!FROZEN_PATHS.includes(r.path) && r.path !== `/m/${m.id}` && !r.path.startsWith(`/m/${m.id}/`)) {
        throw new Error(`module ${m.id}: new routes live under /m/${m.id} (got ${r.path})`)
      }
      routes.push(r)
    }
    for (const n of m.nav) {
      claim(navKeys, 'nav key', n.key, m.id)
      if (n.chord) { chordOk(n.chord, m.id); claim(chordKeys, 'G-chord', n.chord, m.id); chords[n.chord.toLowerCase()] = n.to }
      // a module that only lists planned screens is shown as "soon"
      nav.push({ ...n, key1: n.hint ?? (n.chord ? `G ${n.chord.toUpperCase()}` : undefined), soon: !m.routes.length && !!m.planned })
    }
    for (const c of m.chords) {
      chordOk(c.key, m.id)
      claim(chordKeys, 'G-chord', c.key, m.id)
      chords[c.key.toLowerCase()] = c.to
    }
    commands.push(...m.commands)
  }
  return {
    modules: list,
    byId: Object.fromEntries(list.map((m) => [m.id, m])),
    routes,
    nav,
    tabs: nav.filter((n) => n.tab),
    chords,
    commands,
  }
}
