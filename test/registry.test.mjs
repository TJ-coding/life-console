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
const { MODULE_DATA, LINK_TYPES, RESERVED_PREFIXES, FALLBACK_LINK, checkModuleData } = await import('../modules/data.js')

const reg = buildRegistry([...MODULES, core])

test('the real module list builds and keeps today’s sidebar, tab bar, chords and routes', () => {
  assert.deepEqual(reg.nav.map((n) => [n.label, n.to, n.key1 ?? null, n.soon]), [
    ['Command Center', '/', 'T', false], ['Plan week', '/week', 'W', false], ['Todos', '/todos', 'G I', false],
    ['Deadlines', '/deadlines', 'G D', false], ['Strategy', '/strategy', 'G S', false],
    ['Intelligence', '/m/intelligence', null, true], ['Research', '/m/research', null, true], ['Study', '/m/study', null, true],
    ['Wellbeing', '/m/wellbeing', null, true], ['Standards', '/m/standards', null, true],
    ['Issues', '/issues', 'G B', false], ['Settings', '/settings', null, false],
  ])
  assert.deepEqual(reg.tabs.map((t) => [t.tab, t.to]), [['Today', '/'], ['Plan', '/week'], ['Todos', '/todos'], ['Deadlines', '/deadlines'], ['Settings', '/settings']])
  assert.deepEqual(reg.chords, { s: '/strategy', i: '/todos', t: '/', w: '/week', c: '/', l: '/week?mode=days', d: '/deadlines', b: '/issues' })
  assert.deepEqual(reg.routes.map((r) => r.path).sort(), [...FROZEN_PATHS].sort(), 'every existing route is still there, and no other')
  assert.deepEqual(reg.commands.map((c) => c.label), ['Briefing (morning review)', 'Debrief (evening review)'])
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
