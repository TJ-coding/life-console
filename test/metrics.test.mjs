// Usage metrics: activity recording, the DAU/WAU/MAU/churn maths, and the daily Umami report.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import pg from 'pg'
import { loadConfig } from '../server/config.mjs'
import { connect, runMigrations } from '../server/db/index.mjs'
import { createApp } from '../server/app.mjs'
import { computeMetrics, addDays, utcDay } from '../server/metrics.mjs'

const ADMIN_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
if (!ADMIN_URL) throw new Error('set TEST_DATABASE_URL')
const name = `lc_metrics_${process.pid}_${Date.now()}`
const dbUrl = (() => { const u = new URL(ADMIN_URL); u.pathname = `/${name}`; return u.toString() })()
const sys = async (q) => { const c = new pg.Client({ connectionString: ADMIN_URL }); await c.connect(); await c.query(q); await c.end() }

const s = { got: [], fail: false }
before(async () => {
  // a fake Umami: records what it receives
  s.umami = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => { b += c })
    req.on('end', () => {
      if (s.fail) { res.writeHead(500); return res.end() }
      if (s.boop) { res.writeHead(200); return res.end('{"beep":"boop"}') } // Umami's reply to a suspected bot
      s.got.push({ path: req.url, ua: req.headers['user-agent'], body: JSON.parse(b) })
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}')
    })
  })
  await new Promise((r) => s.umami.listen(0, '127.0.0.1', r))
  await sys(`create database "${name}"`)
  s.conn = connect(dbUrl)
  await runMigrations(s.conn.pool, { log: () => {} })
  s.app = await createApp({
    cfg: loadConfig({ DATABASE_URL: dbUrl, PUSH_DRY_RUN: '1', DIST: '/nonexistent', APP_URL: 'https://lc.test', UMAMI_URL: `http://127.0.0.1:${s.umami.address().port}/`, UMAMI_WEBSITE_ID: 'site-1' }),
    db: s.conn.db, pool: s.conn.pool, log: () => {},
  })
  s.server = http.createServer(s.app.handler)
  await new Promise((r) => s.server.listen(0, '127.0.0.1', r))
  s.base = `http://127.0.0.1:${s.server.address().port}`
})
after(async () => {
  s.app?.close(); s.server?.close(); s.umami?.close(); await s.conn?.pool.end()
  await sys(`drop database if exists "${name}" with (force)`)
})

const q = (text, args) => s.conn.pool.query(text, args)
async function signup(email) {
  const r = await fetch(`${s.base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'long enough 1' }) })
  assert.equal(r.status, 201)
  return { cookie: r.headers.get('set-cookie').split(';')[0], id: (await r.json()).user?.id }
}

test('signed-in requests record one activity row per account per day', async () => {
  const a = await signup('active@example.com')
  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${s.base}/api/state`, { headers: { Cookie: a.cookie } })).status, 200)
  const { rows } = await q(`select a.day::text from user_activity a join users u on u.id = a.user_id where u.email = 'active@example.com'`)
  assert.deepEqual(rows.map((r) => r.day), [utcDay()])
  await q('delete from user_activity; delete from users')
})

test('DAU/WAU/MAU, churn and resurrection for a known history', async () => {
  const D = '2026-06-30'
  const mk = async (email, created, days, disabled = false) => {
    const { rows: [u] } = await q(`insert into users (email, password_hash, created_at, disabled) values ($1, '', $2, $3) returning id`, [email, `${created}T12:00:00Z`, disabled])
    for (const d of days) await q('insert into user_activity (user_id, day) values ($1, $2)', [u.id, d])
  }
  await mk('daily@x', '2026-01-01', [D, addDays(D, -1), addDays(D, -40)]) // active today + previous period: retained
  await mk('weekly@x', '2026-01-01', [addDays(D, -5), addDays(D, -45)]) // retained, in WAU not DAU
  await mk('monthly@x', '2026-01-01', [addDays(D, -20), addDays(D, -35)]) // retained, MAU only
  await mk('churned@x', '2026-01-01', [addDays(D, -31), addDays(D, -50)]) // active only in the previous period
  await mk('churned2@x', '2026-01-01', [addDays(D, -59)]) // edge of the previous period
  await mk('back@x', '2026-01-01', [addDays(D, -2), addDays(D, -100)]) // resurrected
  await mk('new@x', D, [D]) // signed up today
  await mk('future@x', addDays(D, 1), []) // not counted: created after D
  await mk('gone@x', '2026-01-01', [], true) // disabled
  const m = await computeMetrics(s.conn.pool, D)
  assert.deepEqual(m, {
    day: D, users: 7, new_users: 1, dau: 2, wau: 4, mau: 5, prev_mau: 5, churned: 2, resurrected: 1,
    stickiness: 40, retained: 3, churn_rate: 40,
  })
})

test('the daily report goes to Umami once per day, and retries after a failure', async () => {
  const now = new Date('2026-07-01T05:00:00Z') // reports 2026-06-30
  s.fail = true
  assert.equal(await s.app.metrics.report(now), null)
  assert.equal(s.got.length, 0)
  s.fail = false
  s.boop = true
  assert.equal(await s.app.metrics.report(now), null, 'a silent bot drop counts as a failure')
  s.boop = false
  const m = await s.app.metrics.report(now)
  assert.equal(m.day, '2026-06-30')
  assert.equal(await s.app.metrics.report(now), null, 'already sent today')
  assert.equal(s.got.length, 1)
  const { path, ua, body } = s.got[0]
  assert.equal(path, '/api/send')
  const { isbot } = await import('isbot').catch(() => ({}))
  assert.match(ua, /Chrome\/\d/, 'Umami drops bot-like user agents')
  if (isbot) assert.equal(isbot(ua), false)
  assert.equal(body.type, 'event')
  assert.equal(body.payload.website, 'site-1')
  assert.equal(body.payload.hostname, 'lc.test')
  assert.equal(body.payload.name, 'daily-metrics')
  assert.equal(body.payload.data.mau, 5)
  assert.ok(!JSON.stringify(body).includes('@x'), 'no emails or ids, only counts')
  // next day: sent again
  assert.equal((await s.app.metrics.report(new Date('2026-07-02T05:00:00Z'))).day, '2026-07-01')
  assert.equal(s.got.length, 2)
})

test('off without UMAMI_URL and a website id; the website defaults to ANALYTICS_SITE_ID', () => {
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://x/y' }).umami, false)
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://x/y', UMAMI_URL: 'https://u.test' }).umami, false)
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://x/y', UMAMI_URL: 'https://u.test', ANALYTICS_SITE_ID: 's' }).umamiWebsiteId, 's')
})
