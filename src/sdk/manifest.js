// A Public plugin's file → what the registry and the vocabulary need. Pure JS (Node tests use it).
//
// A plugin is one ES module whose default export is its manifest (platform/plugins-sdk.md):
//   export default {
//     sdk: 1, title: 'Habits', icon: 'repeat',
//     types: [...], tags: [...], links: [...], traits: [...], events: [...], sameAs: [...],   // vocabulary additions
//     pages: [{ title, icon?, nav?: true, mount(el, lc, { params, query }) }],              // its screen(s), /m/<name>[/<sub>]
//     slots: { 'today.card': { mount(el, lc, data), shadow? } },
//     commands: [{ label, icon?, run(lc) }], chords: [{ key: 'h' }],                      // a chord opens its first page
//     settings: { mount(el, lc) }, styles: 'css', replaces: ['today' | 'core/sidebar' | 'core/theme'],
//     says: { internet: ['www.strava.com'], connections: ['strava'], replaces: [...] },    // shown at install
//   }
// `pkg` is its registry name ('alice/habits'); its namespace (vocabulary prefix, module id, /m/<name>) is the name part.
import { defineModule } from './registry.js'

export const SDK_VERSIONS = [1]
/** Does this build run a plugin that needs `range`? '1', '>=1', '>=1 <3', or an array of versions. */
export function sdkOk(range = 1) {
  if (Array.isArray(range)) return range.some((v) => SDK_VERSIONS.includes(Number(v)))
  const str = String(range).trim()
  if (/^\d+$/.test(str)) return SDK_VERSIONS.includes(Number(str))
  const lo = /^>=\s*(\d+)/.exec(str), hi = /<\s*(\d+)/.exec(str)
  return SDK_VERSIONS.some((v) => (!lo || v >= Number(lo[1])) && (!hi || v < Number(hi[1])))
}

export const nsOfPkg = (pkg) => String(pkg).split('/').pop().toLowerCase().replace(/[^a-z0-9-]/g, '-')

/** The vocabulary part: what buildTaxonomy needs. */
export function vocabOf(pkg, m) {
  return { id: pkg, ns: nsOfPkg(pkg), types: m.types ?? [], tags: m.tags ?? [], links: m.links ?? [], traits: m.traits ?? [], events: m.events ?? [], sameAs: m.sameAs ?? [] }
}

/** The registry part: a module manifest. PageComponent renders a page's `mount` (src/views/PluginPage.vue). */
export function toModule(pkg, m, { PageComponent = {}, replacedPaths = {} } = {}) {
  const id = nsOfPkg(pkg)
  const replaces = (m.replaces ?? []).map(String)
  const pages = (m.pages ?? []).slice(0, 10)
  const routes = pages.map((p, i) => {
    // a page that replaces a Core module takes that module's main path (and route name), otherwise /m/<id>[/n]
    const over = replaces.find((r) => replacedPaths[r])
    const path = i === 0 && over ? replacedPaths[over].path : `/m/${id}${i ? `/${i}` : ''}`
    const name = i === 0 && over ? replacedPaths[over].name : `${id}${i ? `-${i}` : ''}`
    return { path, name, component: PageComponent, meta: { title: p.title ?? m.title ?? id, part: p } }
  })
  const first = routes[0]
  const nav = first && pages[0]?.nav !== false ? [{ key: replaces.find((r) => replacedPaths[r]?.navKey) ? replacedPaths[replaces.find((r) => replacedPaths[r]?.navKey)].navKey : id, label: pages[0].title ?? m.title ?? id, icon: pages[0].icon ?? m.icon ?? 'extension', to: first.path }] : []
  const chords = first ? (m.chords ?? []).slice(0, 3).map((c) => ({ key: String(c.key ?? c).slice(0, 1), to: first.path })) : []
  const commands = (m.commands ?? []).slice(0, 20).filter((c) => typeof c.run === 'function').map((c) => ({ label: String(c.label).slice(0, 80), icon: c.icon ?? m.icon ?? 'extension', run: c.run, plugin: pkg }))
  return {
    ...defineModule({ id, title: m.title ?? id, icon: m.icon ?? 'extension', routes, nav, chords, commands }),
    pkg, tier: 'public', slots: m.slots ?? {}, settings: m.settings ?? null, styles: typeof m.styles === 'string' ? m.styles : null, replaces,
    says: m.says ?? {},
  }
}
