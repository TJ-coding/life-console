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

test('goal dates: reminders the morning before and of, open the goal, skip done goals and ones a deadline marks', async () => {
  const { goalDates } = await import('../server/goaldates.mjs')
  const plan = {
    id: 'SP-01', planNo: 'SP-01', status: 'active',
    psgs: [{ no: 'RUN', name: 'Finish a half marathon', timeBound: '2027-01-23', status: 'doing' }],
    sigs: [
      { no: 'BASE', psg: 'RUN', name: 'Build the base', pct: 40, status: 'doing', timeBound: '2026-12-12' },
      { no: 'REG', psg: 'RUN', name: 'Sign up', pct: 0, status: 'open', timeBound: '2026-11-28' },
      { no: 'OLD', psg: 'RUN', name: 'Done one', pct: 100, status: 'done', timeBound: '2026-12-12' },
    ],
  }
  const state = {
    todos: [], timeBlocks: [], signOffs: {}, caffeine: {}, plans: [plan, { ...plan, id: 'SP-02', planNo: 'SP-02', status: 'archived' }],
    deadlines: [{ id: 'DL-1', title: 'Entries close', due: '2026-11-28T23:59', source: 'REG', done: false }],
    settings: { timezone: 'UTC', briefingTime: '07:30', notify: { blocks: false, deadlines: true, daily: false, wellbeing: false, pomodoro: false } },
  }
  const gs = goalDates(state)
  assert.deepEqual(gs.map((g) => g.no), ['BASE', 'RUN']) // REG is marked by its deadline, OLD is done, SP-02 archived
  assert.equal(gs.find((g) => g.no === 'RUN').pct, 47) // mean of its SIGs (40, 0, 100)
  const evs = computeEvents(state, Date.UTC(2026, 11, 11, 0, 0), Date.UTC(2026, 11, 12, 23, 59))
  const goal = evs.filter((e) => e.key.startsWith('goal:'))
  assert.deepEqual(goal.map((e) => e.title), ['Goal date tomorrow · Build the base', 'Goal date today · Build the base'])
  assert.equal(goal[0].url, '/#/strategy/SP-01?goal=BASE')
  assert.equal(goal[0].at, Date.UTC(2026, 11, 11, 7, 30))
})
