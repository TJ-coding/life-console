// The planner document's pure code: migrations, normalising and the three-way merge.
// The rule these lock in: a key this release doesn't know (written by a newer release) survives every path.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEMA_VERSION, migrateDoc, normalizeDoc } from '../server/schema.mjs'
import { merge3 } from '../server/merge.mjs'

const clone = (v) => structuredClone(v)
const doc = (extra = {}) => ({
  schemaVersion: 2,
  todos: [{ id: 'T-1', title: 'one', links: [], order: 1000 }, { id: 'T-2', title: 'two', links: ['DL-1'], order: 2000 }],
  deadlines: [{ id: 'DL-1', title: 'due', due: '2026-11-20T17:00', internal: '' }],
  plans: [{ id: 'SP-01', planNo: 'SP-01', title: 'Plan', status: 'active', health: 'On-track', psgs: [{ no: 'PSG-01' }], sigs: [{ no: 'SIG-01.1', psg: 'PSG-01', deps: [] }] }],
  signOffs: {}, notes: {}, sleep: {}, caffeine: {},
  ...extra,
})
// what a newer release might add (the plan's namespaces, edition settings, and an unknown top-level key)
const FUTURE = {
  modules: { study: { courses: [{ id: 'C-1', code: 'CS101' }] }, xyz: { anything: [1, 2, 3] } },
  moduleVersions: { study: 1, xyz: 4 },
  someNewKey: { deep: { value: true } },
}
const withFuture = (d) => ({ ...d, ...clone(FUTURE), settings: { ...(d.settings ?? {}), edition: 'academic', addOns: { academic: { runway: true } } } })

test('migrateDoc: v1 single plan becomes plans[], idempotent, and a stale `plan` is folded back in', () => {
  const v1 = { todos: [], plan: { planNo: 'SP-02', title: 'Old', status: 'Active · On-track' } }
  const once = migrateDoc(clone(v1))
  assert.equal(once.schemaVersion, SCHEMA_VERSION)
  assert.equal(once.plan, undefined)
  assert.deepEqual(once.plans.map((p) => [p.id, p.status, p.health]), [['SP-02', 'active', 'On-track']])
  assert.deepEqual(migrateDoc(clone(once)), once, 'running again changes nothing')
  const stale = migrateDoc({ ...clone(once), plan: { planNo: 'SP-02', title: 'Old again' } })
  assert.equal(stale.plans.length, 1, 'an old device syncing `plan` back does not duplicate it')
  assert.equal(stale.plan, undefined)
})

test('normalizeDoc: defaults optional fields and is idempotent', () => {
  const d = normalizeDoc({ schemaVersion: 2, todos: [{ id: 'T-1' }, { id: 'T-2', order: 5 }], deadlines: [{ id: 'DL-1', clickUp: 'x' }], plans: [{ id: 'SP-01', sigs: [{ no: 'S' }], psgs: [] }] })
  assert.deepEqual(d.todos.map((t) => t.order), [1000, 5])
  assert.equal(d.deadlines[0].internal, '')
  assert.equal('clickUp' in d.deadlines[0], false)
  assert.deepEqual(d.plans[0].sigs[0].deps, [])
  assert.equal(d.settings.notify.blocks, true)
  assert.equal(typeof d.settings.pomodoro.work, 'number')
  assert.equal(d.settings.timezone, undefined, 'the timezone is the device’s business (store.js)')
  assert.deepEqual(normalizeDoc(clone(d)), d)
})

test('normalizeDoc keeps settings the person changed', () => {
  const d = normalizeDoc(doc({ settings: { notify: { daily: false }, pomodoro: { work: 50 }, briefingTime: '06:00', timezone: 'Asia/Tokyo' } }))
  assert.equal(d.settings.notify.daily, false)
  assert.equal(d.settings.notify.blocks, true)
  assert.equal(d.settings.pomodoro.work, 50)
  assert.equal(d.settings.briefingTime, '06:00')
  assert.equal(d.settings.timezone, 'Asia/Tokyo')
})

test('unknown keys survive a round trip through migrate, normalise, merge and JSON', () => {
  const d = withFuture(doc())
  const n = normalizeDoc(clone(d))
  assert.deepEqual(n.modules, FUTURE.modules)
  assert.deepEqual(n.moduleVersions, FUTURE.moduleVersions)
  assert.deepEqual(n.someNewKey, FUTURE.someNewKey)
  assert.equal(n.settings.edition, 'academic')
  assert.deepEqual(n.settings.addOns, { academic: { runway: true } })
  // a v1 document carrying them too
  const v1 = migrateDoc({ ...clone(FUTURE), todos: [], plan: { planNo: 'SP-01' } })
  assert.deepEqual(v1.modules, FUTURE.modules)

  const base = clone(n)
  // only this device edited a core todo: the unknown keys come through untouched
  const local = clone(n); local.todos[0].title = 'edited here'
  const m1 = merge3(base, local, clone(n))
  assert.equal(m1.todos[0].title, 'edited here')
  assert.deepEqual(m1.modules, FUTURE.modules)
  assert.deepEqual(m1.someNewKey, FUTURE.someNewKey)
  // the other device (a newer release) changed module data while this one changed a todo: both kept
  const remote = clone(n); remote.modules.study.courses.push({ id: 'C-2', code: 'CS102' }); remote.moduleVersions.xyz = 5
  const m2 = merge3(base, local, remote)
  assert.equal(m2.todos[0].title, 'edited here')
  assert.deepEqual(m2.modules.study.courses.map((c) => c.id), ['C-1', 'C-2'])
  assert.equal(m2.moduleVersions.xyz, 5)
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeDoc(m2))), normalizeDoc(clone(m2)))
  // an old client whose copy predates the namespaces (base and local without them): remote's are kept
  const oldBase = clone(doc()); const oldLocal = clone(doc()); oldLocal.todos[1].title = 'old device'
  const m3 = merge3(oldBase, oldLocal, clone(n))
  assert.deepEqual(m3.modules, FUTURE.modules)
  assert.equal(m3.todos[1].title, 'old device')
})

test('merge3: per-record merge, deletions, clashing new ids, scalar conflicts', () => {
  const base = doc()
  const local = clone(base); local.todos.push({ id: 'T-3', title: 'local new' }); local.todos[0].title = 'L'
  const remote = clone(base); remote.todos.push({ id: 'T-3', title: 'remote new' }); remote.todos.splice(1, 1); remote.notes = { '2026-11-16': 'note' }
  const m = merge3(base, local, remote)
  assert.deepEqual(m.todos.map((t) => [t.id, t.title]), [['T-1', 'L'], ['T-3', 'remote new'], ['T-4', 'local new']], 'T-2 deleted remotely; both T-3s kept')
  assert.deepEqual(m.notes, { '2026-11-16': 'note' })
  const a = clone(base); a.caffeineLimit = 200
  const b = clone(base); b.caffeineLimit = 400
  assert.equal(merge3(base, a, b).caffeineLimit, 200, 'same scalar changed on both sides: local wins')
  // goals merge by `no`
  const gl = clone(base); gl.plans[0].psgs.push({ no: 'PSG-02' })
  const gr = clone(base); gr.plans[0].psgs.push({ no: 'PSG-03' })
  assert.deepEqual(merge3(base, gl, gr).plans[0].psgs.map((g) => g.no), ['PSG-01', 'PSG-02', 'PSG-03'])
})

test('check-docs: reports totals and problem types only', async () => {
  const { checkDocs } = await import('../server/checkdocs.mjs')
  const r = checkDocs([doc(), withFuture(doc()), { todos: [], plan: { planNo: 'SP-01' } }, { schemaVersion: 2, plans: 5 }, 'junk'], { prefixes: ['PSG-', 'LEC-'] })
  assert.equal(r.documents, 5)
  assert.equal(r.failed, 2)
  assert.deepEqual(r.problems, { 'normalize-throws:TypeError': 1, 'not-an-object': 1 })
  assert.deepEqual(r.schemaVersions, { 1: 1, 2: 3 })
  assert.deepEqual(r.moduleNamespaces, { study: { v1: 1 }, xyz: { v4: 1 } })
  assert.deepEqual(r.goalPrefixes, { 'PSG-': { docs: 2, goals: 2 }, 'LEC-': { docs: 0, goals: 0 } })
  assert.ok(r.bytes.max > 0 && r.bytes.total >= r.bytes.max)
  assert.ok(!JSON.stringify(r).includes('CS101'), 'no document content in the report')
})

/* ───────────── module namespaces (platform phase 2) ───────────── */
const { migrateModules, tooNewForThisBuild, olderThanStored, moduleVersionsOf } = await import('../server/schema.mjs')
const { checkModuleData } = await import('../modules/data.js')
// a made-up module at version 3: v2 renames a field, v3 adds a default
const books = {
  id: 'books', schemaVersion: 3, defaults: () => ({ items: [] }),
  migrations: {
    2: (ns) => { for (const b of ns.items) if ('name' in b) { b.title ??= b.name; delete b.name } },
    3: (ns) => { for (const b of ns.items) b.read ??= false },
  },
}
const flat = { id: 'flat', schemaVersion: 1, defaults: () => ({ items: [] }) }
const LIST = [books, flat]

test('namespaces: migrated per module, idempotent; missing, unknown and too-new ones left alone', () => {
  const d = { schemaVersion: 2, modules: { books: { items: [{ id: 'B-1', name: 'Dune' }] }, other: { x: 1 }, flat: { items: [] } }, moduleVersions: { other: 9 } }
  migrateModules(d, LIST)
  assert.deepEqual(d.modules.books.items, [{ id: 'B-1', title: 'Dune', read: false }])
  assert.deepEqual(d.moduleVersions, { other: 9, books: 3, flat: 1 })
  assert.deepEqual(d.modules.other, { x: 1 }, 'a module this build doesn’t know is kept untouched')
  const again = migrateModules(clone(d), LIST)
  assert.deepEqual(again, d, 'idempotent')
  // a namespace from a NEWER build of a known module isn't migrated (the client stops syncing instead)
  const newer = { modules: { books: { items: [{ id: 'B-1', shape: 'v4' }] } }, moduleVersions: { books: 4 } }
  assert.deepEqual(migrateModules(clone(newer), LIST), newer)
  // no namespace: nothing is created (a missing namespace means defaults)
  const none = { schemaVersion: 2, todos: [] }
  assert.deepEqual(migrateModules(clone(none), LIST), none)
  assert.deepEqual(normalizeDoc(clone({ ...doc(), modules: {} })).moduleVersions, undefined)
  // a namespace without a recorded version counts as version 1
  const unversioned = migrateModules({ modules: { books: { items: [{ id: 'B-2', name: 'Emma' }] } } }, LIST)
  assert.deepEqual([unversioned.modules.books.items[0].title, unversioned.moduleVersions.books], ['Emma', 3])
  // a step may return a replacement namespace
  const repl = migrateModules({ modules: { r: { old: true } } }, [{ id: 'r', schemaVersion: 2, defaults: () => ({}), migrations: { 2: () => ({ items: [] }) } }])
  assert.deepEqual(repl.modules.r, { items: [] })
  // the real module list has no namespaces yet, so migrateDoc leaves module data alone
  assert.deepEqual(moduleVersionsOf(), {})
  assert.deepEqual(normalizeDoc(withFuture(doc())).modules, FUTURE.modules)
})

test('client guard: newer core schema or a newer known module = too new; an unknown module is not', () => {
  assert.equal(tooNewForThisBuild({ schemaVersion: SCHEMA_VERSION }, LIST), false)
  assert.equal(tooNewForThisBuild({ schemaVersion: SCHEMA_VERSION + 1 }, LIST), true)
  assert.equal(tooNewForThisBuild({ schemaVersion: SCHEMA_VERSION, moduleVersions: { books: 3 } }, LIST), false)
  assert.equal(tooNewForThisBuild({ schemaVersion: SCHEMA_VERSION, moduleVersions: { books: 4 } }, LIST), true)
  assert.equal(tooNewForThisBuild({ schemaVersion: SCHEMA_VERSION, moduleVersions: { runway: 7 } }, LIST), false, 'after a rollback: keep syncing, keep the data')
  assert.equal(tooNewForThisBuild(undefined, LIST), false)
})

test('server guard: older core schema, or an older module version present on both sides, is refused', () => {
  const stored = { schemaVersion: 2, moduleVersions: { books: 3, flat: 1 } }
  assert.equal(olderThanStored({ schemaVersion: 2, moduleVersions: { books: 3, flat: 1 } }, stored), false)
  assert.equal(olderThanStored({ schemaVersion: 1, moduleVersions: { books: 3 } }, stored), true)
  assert.equal(olderThanStored({ schemaVersion: 2, moduleVersions: { books: 2 } }, stored), true, 'a stale tab’s old namespace')
  assert.equal(olderThanStored({ schemaVersion: 2, moduleVersions: { books: 4 } }, stored), false, 'newer is fine')
  assert.equal(olderThanStored({ schemaVersion: 2 }, stored), false, 'namespaces removed on purpose (import, start empty)')
  assert.equal(olderThanStored({ schemaVersion: 2, moduleVersions: { runway: 1 } }, stored), false, 'only on one side')
  assert.equal(olderThanStored({ schemaVersion: 2, moduleVersions: { books: 1 } }, null), false, 'nothing stored yet')
  assert.equal(olderThanStored({ schemaVersion: 2, moduleVersions: { books: 1 } }, { schemaVersion: 2 }), false)
})

test('module data contracts: a namespace needs defaults, a version and every migration step', () => {
  assert.equal(checkModuleData(LIST), true)
  assert.throws(() => checkModuleData([{ id: 'x', schemaVersion: 1 }]), /defaults\(\)/)
  assert.throws(() => checkModuleData([{ id: 'x', defaults: () => ({}) }]), /schemaVersion/)
  assert.throws(() => checkModuleData([{ ...books, migrations: { 2: books.migrations[2] } }]), /migrations\[3\] is missing/)
})
