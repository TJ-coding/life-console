// The module registry: the real module list builds, and the rules (global names, frozen routes) are enforced.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as nodeModule from 'node:module'

// manifests import .vue screens; Node can't, and these tests don't render anything: stub them
const stub = (url) => ({ format: 'module', source: `export default { name: ${JSON.stringify(url.split('/').pop())} }`, shortCircuit: true })
if (nodeModule.registerHooks) nodeModule.registerHooks({ load: (url, context, next) => (url.endsWith('.vue') ? stub(url) : next(url, context)) })
else nodeModule.register('data:text/javascript,' + encodeURIComponent(`export async function load(url, context, next) {
  if (url.endsWith('.vue')) return { format: 'module', source: 'export default {}', shortCircuit: true }
  return next(url, context)
}`))
const { buildRegistry, defineModule, FROZEN_PATHS } = await import('../src/sdk/registry.js')
const { default: MODULES } = await import('../modules/index.js')
const { default: core } = await import('../src/sdk/core.js')
const { normalizeDoc } = await import('../server/schema.mjs')
const { MODULE_DATA, LINK_TYPES, RESERVED_PREFIXES, FALLBACK_LINK, checkModuleData } = await import('../modules/data.js')

const reg = buildRegistry([...MODULES, core])

test('the real module list builds and keeps today’s sidebar, tab bar, chords and routes', () => {
  assert.deepEqual(reg.nav.map((n) => [n.label, n.to, n.key1 ?? null, n.soon]), [
    ['Command Center', '/', 'T', false], ['Plan week', '/week', 'W', false], ['Todos', '/todos', 'G I', false],
    ['Deadlines', '/deadlines', 'G D', false], ['Strategy', '/strategy', 'G S', false],
    ['Intelligence', '/m/intelligence', null, true], ['Research', '/m/research', null, true], ['Study', '/m/study', null, true],
    ['Wellbeing', '/m/wellbeing', null, true], ['Standards', '/m/standards', null, true], ['Extensions', '/m/extensions', 'G E', false],
    ['Issues', '/issues', 'G B', false], ['Settings', '/settings', null, false],
  ])
  assert.deepEqual(reg.tabs.map((t) => [t.tab, t.to]), [['Today', '/'], ['Plan', '/week'], ['Todos', '/todos'], ['Deadlines', '/deadlines'], ['Settings', '/settings']])
  assert.deepEqual(reg.chords, { s: '/strategy', i: '/todos', t: '/', w: '/week', c: '/', l: '/week?mode=days', d: '/deadlines', b: '/issues', e: '/m/extensions' })
  assert.deepEqual(reg.routes.map((r) => r.path).sort(), [...FROZEN_PATHS, '/m/extensions', '/m/extensions/workshop', '/m/extensions/sharing'].sort(), 'every existing route is still there, plus the extension platform\'s own screens')
  assert.deepEqual(reg.commands.map((c) => c.label), ['Briefing (morning review)', 'Debrief (evening review)', 'Extensions', 'Make an extension (workshop)', 'Sharing and your data'])
  assert.deepEqual(reg.byId.study.planned.length, 4)
})

test('every module with a data contract is listed in modules/data.js, and the other way round', () => {
  const withData = MODULES.filter((m) => m.data).map((m) => m.id).sort()
  assert.deepEqual(MODULE_DATA.filter((d) => d.id !== 'core').map((d) => d.id).sort(), withData)
  for (const m of MODULES.filter((x) => x.data)) assert.equal(MODULE_DATA.find((d) => d.id === m.id), m.data)
  assert.equal(checkModuleData(), true)
})

test('link types keep today’s prefixes, fallback and reserved list', () => {
  assert.deepEqual(LINK_TYPES.map((t) => [t.prefix, t.kind]).sort(), [['DL-', 'deadline'], ['IPB-', 'ipb'], ['KZ-', 'kaizen'], ['PSG-', 'goal'], ['R-', 'risk'], ['SIG-', 'goal'], ['SP-', 'plan']])
  assert.equal(FALLBACK_LINK, 'course')
  assert.deepEqual([...RESERVED_PREFIXES].sort(), ['DL-', 'IPB-', 'KZ-', 'R-', 'SP-', 'T-'])
})

test('the registry refuses duplicate names and new routes outside /m/<id>', () => {
  const a = defineModule({ id: 'a', routes: [{ path: '/m/a', name: 'a' }], nav: [{ key: 'a', to: '/m/a', chord: 'Q' }] })
  assert.ok(buildRegistry([a]))
  const dup = (m, re) => assert.throws(() => buildRegistry([a, defineModule(m)]), re)
  dup({ id: 'a' }, /module id "a"/)
  dup({ id: 'b', routes: [{ path: '/m/a' }] }, /route path/)
  dup({ id: 'b', routes: [{ path: '/m/b', name: 'a' }] }, /route name/)
  dup({ id: 'b', nav: [{ key: 'a', to: '/m/b' }] }, /nav key/)
  dup({ id: 'b', nav: [{ key: 'b', to: '/m/b', chord: 'q' }] }, /G-chord "q" is claimed by both a and b/)
  dup({ id: 'b', chords: [{ key: 'Q', to: '/m/b' }] }, /G-chord/)
  dup({ id: 'b', routes: [{ path: '/books' }] }, /new routes live under \/m\/b/)
  dup({ id: 'b', chords: [{ key: 'ab', to: '/' }] }, /one letter or digit/)
  assert.ok(buildRegistry([a, defineModule({ id: 'b', routes: [{ path: '/m/b' }, { path: '/m/b/:x' }] })]))
  // the real list plus a module that steals a chord
  assert.throws(() => buildRegistry([...MODULES, core, defineModule({ id: 'x', chords: [{ key: 'd', to: '/m/x' }] })]), /claimed by both deadlines and x/)
  assert.throws(() => defineModule({ id: 'Bad id' }), /module id/)
})

test('module data: duplicate ids and prefixes are refused', () => {
  assert.throws(() => checkModuleData([...MODULE_DATA, { id: 'x', linkTypes: [{ kind: 'x', prefix: 'DL-' }] }]), /"DL-" is claimed by both deadlines and x/)
  assert.throws(() => checkModuleData([...MODULE_DATA, { id: 'study' }]), /used twice/)
  assert.throws(() => checkModuleData([{ id: 'x', linkTypes: [{ kind: 'x', prefix: 'lec' }] }]), /upper-case/)
  assert.throws(() => checkModuleData([...MODULE_DATA, { id: 'x', linkTypes: [{ kind: 'x', fallback: true }] }]), /fallback/)
})

/* ───────────── editions (platform phase 3) ───────────── */
const { EDITIONS, EDITION_LIST, EDITION_LANDINGS, editionSeed, enabledModules, checkEditions } = await import('../editions/index.js')

test('editions name only real modules, and base shows every module but the plugins (off by default)', () => {
  const ids = MODULES.map((m) => m.id)
  assert.equal(checkEditions(ids), true)
  assert.deepEqual([...EDITIONS.base.modules].sort(), MODULES.filter((m) => !m.plugin).map((m) => m.id).sort())
  assert.deepEqual(EDITION_LANDINGS, { '/minimalist': 'minimalist' })
  assert.throws(() => checkEditions(ids, [...EDITION_LIST, { id: 'x', modules: ['nope'] }]), /unknown module "nope"/)
  assert.throws(() => checkEditions(ids, [...EDITION_LIST, { id: 'minimalist', modules: [] }]), /used twice/)
})

test('enabled modules: the edition’s own plus the account’s add-ons for that edition only', () => {
  assert.deepEqual([...enabledModules('minimalist', {})].sort(), ['focus', 'today', 'todos'])
  const settings = { addOns: { minimalist: { deadlines: true, study: false }, base: { anything: true } } }
  assert.deepEqual([...enabledModules('minimalist', settings)].sort(), ['deadlines', 'focus', 'today', 'todos'])
  assert.ok(enabledModules('minimalist', { addOns: { minimalist: { today: false } } }).has('today'), 'add-ons never take an edition’s own module away')
  assert.equal(enabledModules('unknown', {}).size, EDITIONS.base.modules.length, 'an unknown edition falls back to base')
})

test('a new account’s demo: base unchanged; Minimalist gets its demo, starting settings and home edition', () => {
  const doc = () => ({ todos: [{ id: 'T-101', title: 'a', links: ['REG', 'DL-1'] }, { id: 'T-106', title: 'b', links: [] }], timeBlocks: [{ id: 'B1', link: 'BASE' }], plans: [{ id: 'SP-01' }], deadlines: [{ id: 'DL-1' }], tour: 'pending' })
  assert.deepEqual(editionSeed(doc(), 'base'), doc())
  assert.deepEqual(editionSeed(doc(), null), doc())
  const m = editionSeed(doc(), 'minimalist')
  assert.deepEqual(m.todos, [{ id: 'T-101', title: 'a', links: [] }])
  assert.deepEqual([m.plans, m.deadlines, m.timeBlocks[0].link], [[], [], null])
  assert.deepEqual(m.settings, { notify: { daily: false, wellbeing: false, pomodoro: false }, edition: 'minimalist' })
  // and normalising keeps those choices while filling in the rest
  const n = normalizeDoc(m)
  assert.equal(n.settings.notify.daily, false)
  assert.equal(n.settings.notify.blocks, true)
  assert.equal(n.settings.edition, 'minimalist')
})

test('sleep, caffeine and routines are plugins: listed, no sidebar entry, off until switched on', async () => {
  const { EDITION_LIST, enabledModules } = await import('../editions/index.js')
  const reg = buildRegistry([core, ...MODULES])
  const ids = ['sleep', 'caffeine', 'routines']
  assert.deepEqual(reg.plugins.map((p) => p.module), ids)
  for (const p of reg.plugins) assert.ok(p.desc, `${p.module} has a description for Settings`)
  for (const id of ids) assert.ok(!reg.nav.some((n) => n.module === id), `${id} has no sidebar entry`)
  for (const e of EDITION_LIST) {
    for (const id of ids) assert.ok(!enabledModules(e.id, {}).has(id), `${id} is off by default in ${e.id}`)
    assert.ok(enabledModules(e.id, { addOns: { [e.id]: { caffeine: true } } }).has('caffeine'), `caffeine switches on in ${e.id}`)
    assert.ok(!enabledModules(e.id, { addOns: { [e.id]: { caffeine: false } } }).has('caffeine'))
  }
})

test('Public plugins never crash the registry: clashes are lost and reported; declared replacements take over (goal 2)', () => {
  const thief = defineModule({ id: 'thief', chords: [{ key: 'd', to: '/m/thief' }], routes: [{ path: '/week' }, { path: '/m/thief', name: 'thief' }] })
  const dupe = defineModule({ id: 'deadlines' })
  const today2 = defineModule({ id: 'today2', replaces: ['today'], routes: [{ path: '/', name: 'today', component: {} }], nav: [{ key: 'today', label: 'My Today', to: '/', hint: 'T', tab: 'Today' }], chords: [{ key: 't', to: '/' }] })
  const side = defineModule({ id: 'side', replaces: ['core/sidebar', 'core/theme'], slots: { 'shell.sidebar': {}, 'today.card': {} }, styles: ':root{--accent:red}' })
  const r = buildRegistry([...MODULES, core], { plugins: [thief, dupe, today2, side] })
  assert.equal(r.chords.d, '/deadlines', 'a Core chord stays')
  assert.ok(r.routes.some((x) => x.path === '/m/thief'), "the plugin keeps what didn't clash")
  assert.ok(!r.routes.some((x) => x.path === '/week' && x.meta.module === 'thief'))
  assert.ok(r.conflicts.some((c) => c.startsWith('thief:')) && r.conflicts.some((c) => c.startsWith('deadlines:')))
  assert.equal(r.routes.find((x) => x.path === '/').meta.module, 'today2', 'a declared replacement takes the route')
  assert.equal(r.nav.find((n) => n.key === 'today').label, 'My Today')
  assert.equal(r.replaced.today, 'today2')
  assert.equal(r.shell.sidebar.module, 'side')
  assert.ok(r.styles.find((x) => x.module === 'side').global, 'a theme plugin styles the whole app')
  assert.deepEqual(r.slots['today.card'].map((x) => x.module), ['side'])
  // without the plugins (safe mode) everything is ours again
  assert.equal(buildRegistry([...MODULES, core]).routes.find((x) => x.path === '/').meta.module, 'today')
})
