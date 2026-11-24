// The plugin platform's pure parts: the shared vocabulary (goal 5) and the data door (goal 4).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTaxonomy, toJsonLd, isRepeat } from '../src/sdk/vocabulary.js'
import { createDataDoor, DataError } from '../src/sdk/data.js'

const habits = {
  id: 'alice/habits', ns: 'habits',
  types: [{ type: 'habits.Habit', kindOf: 'common.Habit', traits: ['titled', 'recurring', 'progress'], fields: { cadence: { enum: ['daily', 'weekdays', 'weekly'], required: true }, target: { type: 'number' } } }],
  events: ['habits.streak'],
}
const strava = {
  id: 'bob/strava', ns: 'strava',
  types: [{ type: 'strava.Run', kindOf: 'common.Workout', traits: ['titled', 'happened', 'about'] }],
  tags: [{ id: 'strava.trail', label: 'Trail run', parent: 'common.activities.run' }],
  links: [{ id: 'strava.segmentOf', kindOf: 'partOf' }],
  sameAs: [{ from: 'strava.runTag', to: 'common.activities.run' }],
}

test('vocabulary: kind of, traits, tags, sameAs and plugin extensions', () => {
  const tax = buildTaxonomy([habits, strava], { tags: { 'me.phd': { label: 'PhD', parent: 'core.areas' } } })
  assert.deepEqual(tax.problems, [])
  assert.ok(tax.isKindOf('habits.Habit', 'core.Routine'), 'habits.Habit → common.Habit → core.Routine')
  assert.ok(tax.isKindOf('strava.Run', 'core.LogEntry'))
  assert.ok(!tax.isKindOf('strava.Run', 'core.Todo'))
  assert.ok(tax.traitsOf('habits.Habit').includes('recurring'))
  assert.equal(tax.storeOf('core.Todo'), 'todos')
  assert.equal(tax.storeOf('habits.Habit'), 'entities')
  assert.ok(tax.isUnder('strava.trail', 'common.activities'), 'a plugin tag sits under the shared tree')
  assert.ok(tax.isUnder('strava.runTag', 'common.activities.run'), 'sameAs joins two terms')
  assert.ok(tax.isUnder('me.phd', 'core.areas'), 'the person extends it too')
  assert.equal(tax.linkBase('strava.segmentOf'), 'partOf')
  assert.ok(tax.events.has('habits.streak'))
  assert.deepEqual(tax.validate('habits.Habit', { title: 'Run' }), ['cadence is required'])
  assert.deepEqual(tax.validate('habits.Habit', { title: 'Run', cadence: 'hourly' }), ['cadence must be one of daily, weekdays, weekly'])
  assert.deepEqual(tax.validate('habits.Habit', { title: 'Run', cadence: 'daily', progress: 2 }), ['progress must be between 0 and 1'])
  assert.ok(isRepeat('weekly:mon,thu') && isRepeat('every:3') && !isRepeat('weekly:funday'))
})

test('vocabulary: a plugin can only define terms in its own namespace, never throws', () => {
  const thief = { id: 'eve/x', ns: 'habits', types: [{ type: 'habits.Habit' }] }
  const sloppy = { id: 'carol/y', ns: 'y', types: [{ type: 'core.Todo' }, { type: 'y.Thing', kindOf: 'nope.Type', traits: ['madeUp'] }], links: [{ id: 'y.likes', kindOf: 'loves' }] }
  const reserved = { id: 'mallory/core', ns: 'core', types: [] }
  const tax = buildTaxonomy([habits, thief, sloppy, reserved])
  assert.equal(tax.types['habits.Habit'].plugin, 'alice/habits', 'the first owner keeps its namespace')
  assert.equal(tax.types['core.Todo'].owner, 'core', "a plugin can't redefine core types")
  assert.ok(!tax.types['y.Thing'].kindOf, 'unknown parent dropped')
  assert.ok(!tax.links['y.likes'], 'a link must specialise a standard one')
  assert.ok(tax.problems.length >= 5)
})

test('vocabulary: exports JSON-LD on demand', () => {
  const ld = toJsonLd(buildTaxonomy([habits]))
  const habit = ld['@graph'].find((n) => n['@id'].endsWith('habits#Habit'))
  assert.equal(habit['rdfs:subClassOf']['@id'], 'https://life-console.dev/ns/common#Habit')
  assert.ok(ld['@graph'].some((n) => n['skos:broader']))
})

function setup() {
  const state = { todos: [{ id: 'T-101', title: 'Write intro', done: false, links: [] }], timeBlocks: [], deadlines: [], plans: [], reviews: [] }
  const events = []
  const door = createDataDoor({ getState: () => state, taxonomy: buildTaxonomy([habits, strava]), now: () => '2026-11-24T09:00:00Z', emit: (e, p) => events.push([e, p]) })
  return { state, events, door }
}

test('data door: plugins create their own records and core records, checked against the vocabulary', () => {
  const { state, events, door } = setup()
  const h = door.as('alice/habits')
  const run = h.create('habits.Habit', { title: 'Run 5k', cadence: 'weekdays', target: 3 })
  assert.equal(run.type, 'habits.Habit')
  assert.equal(state.entities.length, 1)
  assert.equal(state.entities[0].by, 'alice/habits')
  assert.throws(() => h.create('habits.Habit', { title: 'No cadence' }), /cadence is required/)
  const todo = h.create('core.Todo', { title: 'Run 5k', scheduled: { date: '2026-11-25', start: '07:00' } })
  assert.match(todo.id, /^T-\d+$/)
  assert.ok(state.todos.at(-1).uid, 'core records a plugin creates get a stable uid')
  assert.equal(state.todos.at(-1).by, 'alice/habits')
  assert.throws(() => door.as('bob/strava').create('habits.Habit', { title: 'x', cadence: 'daily' }), (e) => e instanceof DataError && e.code === 'forbidden')
  assert.ok(events.some(([e]) => e === 'record.changed'))
  assert.equal(door.activity.at(-1).by, 'alice/habits')
})

test('data door: on core records a plugin only changes its own x.<ns> fields; done fires todo.done', () => {
  const { state, events, door } = setup()
  const h = door.as('alice/habits')
  h.update('core.Todo/T-101', { x: { habits: { streak: 4 } } })
  assert.deepEqual(state.todos[0].x, { habits: { streak: 4 } })
  assert.throws(() => h.update('core.Todo/T-101', { title: 'hijacked' }), /may only change x.habits/)
  assert.throws(() => h.update('core.Todo/T-101', { x: { strava: {} } }), /may only change x.habits/)
  assert.throws(() => h.update('core.Todo/T-101', { x: { habits: { blob: 'x'.repeat(5000) } } }), /larger than/)
  door.as('core').update('core.Todo/T-101', { done: true })
  assert.ok(events.some(([e, p]) => e === 'todo.done' && p.id === 'T-101'))
})

test('data door: links use stable refs (G10), survive renumbering, and power linkedTo; upsert dedupes', () => {
  const { state, door } = setup()
  const h = door.as('alice/habits')
  const habit = h.create('habits.Habit', { title: 'Run 5k', cadence: 'daily' })
  h.relate('core.Todo/T-101', 'serves', habit.ref)
  const link = state.relations[0]
  assert.match(link.s, /^core\.Todo\/~[a-z0-9]{12}$/, 'a core record is linked by its uid, not its number')
  state.todos[0].id = 'T-205' // a merge clash renumbered it
  assert.equal(h.list('core.Todo', { linkedTo: habit.ref })[0].id, 'T-205', 'the link still finds it')
  assert.throws(() => h.relate('core.Todo/T-205', 'likes', habit.ref), /unknown link/)
  const s = door.as('bob/strava')
  s.upsert('strava.Run', { source: 'strava', externalId: 42 }, { title: 'Morning run', at: '2026-11-24T06:30:00Z' })
  s.upsert('strava.Run', { source: 'strava', externalId: 42 }, { title: 'Morning run (edited)', at: '2026-11-24T06:30:00Z' })
  const runs = h.list('core.LogEntry')
  assert.equal(runs.length, 1, 'syncing twice makes one record')
  assert.equal(runs[0].title, 'Morning run (edited)')
  assert.equal(runs[0].type, 'strava.Run', 'a habits plugin sees Strava runs as log entries without knowing Strava')
})

test('data door: deletes are limited to what a plugin created; forget removes a plugin\'s traces', () => {
  const { state, door } = setup()
  const h = door.as('alice/habits')
  h.update('core.Todo/T-101', { x: { habits: { streak: 1 } } })
  const habit = h.create('habits.Habit', { title: 'Run', cadence: 'daily' })
  h.relate(habit.ref, 'serves', 'core.Todo/T-101')
  assert.throws(() => h.delete('core.Todo/T-101'), /only delete records it created/)
  door.forget('alice/habits')
  assert.equal(state.entities.length, 0)
  assert.equal(state.relations.length, 0)
  assert.equal(state.todos[0].x, undefined)
  assert.equal(state.todos.length, 1, 'core records stay')
})

test('data door: a plugin can hold at most 50 reminders', () => {
  const { door } = setup()
  const h = door.as('alice/habits')
  for (let i = 0; i < 50; i++) h.create('core.Reminder', { title: `R${i}`, at: '2026-11-25T07:00', repeat: 'daily' })
  assert.throws(() => h.create('core.Reminder', { title: 'one too many', at: '2026-11-25T07:00' }), (e) => e.code === 'limit')
})

test('reminders are data: computeEvents sends plugin reminders with repeats, mutes and a daily cap (G2)', async () => {
  const { computeEvents, remindsOn, REMINDERS_PER_DAY } = await import('../server/schedule.mjs')
  assert.ok(remindsOn({ repeat: 'weekdays' }, '2026-11-23', '2026-11-27') && !remindsOn({ repeat: 'weekdays' }, '2026-11-23', '2026-11-28'))
  assert.ok(remindsOn({ repeat: 'every:3' }, '2026-11-20', '2026-11-26') && !remindsOn({ repeat: 'every:3' }, '2026-11-20', '2026-11-25'))
  assert.ok(remindsOn({ repeat: 'weekly:tue' }, '2026-11-01', '2026-11-24'))
  assert.ok(!remindsOn({}, '2026-11-24', '2026-11-25'))
  const state = { settings: { timezone: 'UTC' }, todos: [], timeBlocks: [], deadlines: [], plans: [],
    reminders: [{ id: 'RM-a', title: 'Run 5k', at: '2026-11-20T07:00', repeat: 'daily', by: 'alice/habits', open: '/#/m/habits' }] }
  const from = Date.parse('2026-11-24T06:00:00Z'), to = Date.parse('2026-11-24T08:00:00Z')
  const evs = computeEvents(state, from, to).filter((e) => e.key.startsWith('reminder:'))
  assert.equal(evs.length, 1)
  assert.equal(evs[0].title, 'Run 5k')
  assert.equal(evs[0].url, '/#/m/habits')
  assert.equal(computeEvents({ ...state, settings: { timezone: 'UTC', mutedPlugins: { 'alice/habits': true } } }, from, to).filter((e) => e.key.startsWith('reminder:')).length, 0, 'muted')
  const many = { ...state, reminders: Array.from({ length: 40 }, (_, i) => ({ id: `RM-${i}`, title: `R${i}`, at: '2026-11-24T07:00' })) }
  assert.equal(computeEvents(many, from, to).filter((e) => e.key.startsWith('reminder:')).length, REMINDERS_PER_DAY)
})
