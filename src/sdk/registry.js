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
//     plugin: { desc },                    // a plugin: no screen, just parts of other screens (isEnabled(id)); listed
//                                          // in Settings → Console so an account can switch it on (off unless an edition lists it)
//     slots: { 'today.card': Component | { mount(el, lc), shadow? } },   // parts of other screens (goal 2)
//     settings: Component | { mount(el, lc) },   // its section in Settings → Plugins
//     styles: 'css…',                      // its CSS; global when it replaces core/theme
//     replaces: ['today', 'core/sidebar'], // modules or shell parts it takes over (Public plugins: shown at install)
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

/** Parts of the shell itself that a plugin may replace (goal 2): `replaces: ['core/sidebar']`. */
export const SHELL_PARTS = ['core/sidebar', 'core/theme', 'core/shortcuts']

/**
 * Check a list of manifests and flatten it into what the shell renders. The list's order is the sidebar's order.
 * `list`: our own (Core) modules: a broken rule throws, because it's our bug and tests catch it first.
 * `plugins`: Public plugins (installed from the registry, consented): never throw. A clash with something already
 * claimed is lost by the plugin and reported in `conflicts`; a declared `replaces` takes over the replaced module's
 * routes, sidebar entry and chords (the person consented to that at install), and safe mode simply leaves them out.
 */
export function buildRegistry(list, { plugins = [] } = {}) {
  const ids = new Map(), paths = new Map(), names = new Map(), navKeys = new Map(), chordKeys = new Map()
  const routes = [], nav = [], chords = {}, chordModule = {}, commands = [], conflicts = []
  const slots = {}, settings = [], styles = [], shell = {}
  const known = new Set([...list.map((m) => m.id), ...SHELL_PARTS])
  // who replaces what: the last plugin to declare it wins; Core modules can't be replaced by each other
  const replaced = {}
  for (const m of plugins) for (const r of m.replaces ?? []) {
    const target = String(r).replace(/^core\/(?!sidebar|theme|shortcuts)/, '')
    if (known.has(target)) replaced[target] = m.id
    else conflicts.push(`${m.id}: replaces unknown "${r}"`)
  }
  const replacedPaths = {}
  for (const m of list) if (replaced[m.id]) for (const r of m.routes) replacedPaths[r.path] = replaced[m.id]

  function add(m, strict) {
    const guard = (fn) => { try { fn() } catch (e) { if (strict) throw e; conflicts.push(`${m.id}: ${e.message}`) } }
    try { claim(ids, 'module id', m.id, m.id) } catch (e) { if (strict) throw e; conflicts.push(`${m.id}: ${e.message}`); return }
    const takenOver = !!replaced[m.id]
    for (const r of takenOver ? [] : m.routes) guard(() => {
      claim(paths, 'route path', r.path, m.id)
      const ok = FROZEN_PATHS.includes(r.path) ? (strict || replacedPaths[r.path] === m.id) : (r.path === `/m/${m.id}` || r.path.startsWith(`/m/${m.id}/`))
      if (!ok) { paths.delete(r.path.toLowerCase()); throw new Error(`module ${m.id}: new routes live under /m/${m.id} (got ${r.path})`) }
      if (r.name) claim(names, 'route name', r.name, m.id)
      routes.push({ ...r, meta: { ...(r.meta ?? {}), module: m.id } })
    })
    for (const n of takenOver ? [] : m.nav) guard(() => {
      claim(navKeys, 'nav key', n.key, m.id)
      if (n.chord) { chordOk(n.chord, m.id); claim(chordKeys, 'G-chord', n.chord, m.id); chords[n.chord.toLowerCase()] = n.to; chordModule[n.chord.toLowerCase()] = m.id }
      // a module that only lists planned screens is shown as "soon"
      nav.push({ ...n, module: m.id, key1: n.hint ?? (n.chord ? `G ${n.chord.toUpperCase()}` : undefined), soon: !m.routes.length && !!m.planned })
    })
    for (const c of takenOver ? [] : m.chords) guard(() => {
      chordOk(c.key, m.id)
      claim(chordKeys, 'G-chord', c.key, m.id)
      chords[c.key.toLowerCase()] = c.to
      chordModule[c.key.toLowerCase()] = m.id
    })
    if (!takenOver) commands.push(...m.commands.map((c) => ({ ...c, module: m.id })))
    for (const [name, part] of Object.entries(m.slots ?? {})) {
      if (name.startsWith('shell.')) { if (replaced[`core/${name.slice(6)}`] === m.id) shell[name.slice(6)] = { module: m.id, part }; continue }
      ;(slots[name] ??= []).push({ module: m.id, part })
    }
    if (m.settings) settings.push({ module: m.id, title: m.title, part: m.settings })
    if (m.styles) styles.push({ module: m.id, css: String(m.styles), global: replaced['core/theme'] === m.id })
  }
  for (const m of list) add(m, true)
  for (const m of plugins) add(m, false)
  const all = [...list, ...plugins]
  return {
    modules: all,
    plugins: all.filter((m) => m.plugin).map((m) => ({ module: m.id, label: m.title, icon: m.icon, desc: m.plugin.desc ?? '' })),
    byId: Object.fromEntries(all.map((m) => [m.id, m])),
    routes,
    nav,
    tabs: nav.filter((n) => n.tab),
    chords,
    chordModule, // which module each G-chord belongs to (an edition shows only its modules' chords)
    commands,
    slots, // name → [{ module, part }]: parts of other screens (today.card, todo.panel, week.strip, settings.section…)
    settings, // plugins' settings sections
    styles, // plugins' CSS (a theme plugin's is global)
    shell, // shell parts a plugin replaced: sidebar, theme, shortcuts
    replaced, // module or shell part → the plugin that replaced it
    conflicts, // what Public plugins lost (shown in Settings → Plugins), never thrown
  }
}
