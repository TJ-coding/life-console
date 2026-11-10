// computeEvents is pure: daily review notifications open the Briefing and Debrief screens.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeEvents } from '../server/schedule.mjs'

test('morning notification opens #/briefing, evening and wind-down open #/debrief', () => {
  const state = {
    todos: [{ id: 'T-1', title: 'Write', done: false, priority: 1, order: 0, timeMin: 30, links: [], scheduled: { date: '2026-11-12', start: null } }],
    timeBlocks: [], deadlines: [], signOffs: {}, caffeine: {},
    settings: { timezone: 'UTC', briefingTime: '07:30', eveningTime: '21:00', notify: { blocks: false, deadlines: false, daily: true, wellbeing: true, pomodoro: false } },
  }
  const from = Date.UTC(2026, 10, 11, 0, 0), to = Date.UTC(2026, 10, 11, 23, 59)
  const evs = computeEvents(state, from, to)
  const brief = evs.find((e) => e.key.startsWith('brief:'))
  const eve = evs.find((e) => e.key.startsWith('eve:'))
  assert.equal(brief.url, '/#/briefing')
  assert.match(brief.title, /^Briefing · /)
  assert.equal(eve.url, '/#/debrief')
  assert.equal(eve.title, 'Debrief')
  const wind = evs.find((e) => e.key.startsWith('wind'))
  if (wind) assert.equal(wind.url, '/#/debrief')
})
