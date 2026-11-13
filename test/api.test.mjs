// End-to-end API tests against a real PostgreSQL (a scratch database is created and dropped).
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
// The URL must point at a server where that user may CREATE DATABASE.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { loadConfig } from '../server/config.mjs'
import { connect, runMigrations } from '../server/db/index.mjs'
import { createApp } from '../server/app.mjs'

const ADMIN_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
if (!ADMIN_URL) throw new Error('set TEST_DATABASE_URL (a Postgres server where the user can create databases)')
const DB_NAME = `lc_test_${process.pid}_${Date.now()}`
const dbUrl = (() => { const u = new URL(ADMIN_URL); u.pathname = `/${DB_NAME}`; return u.toString() })()
const outbox = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-test-')), 'outbox.jsonl')
const quiet = () => {}

let conn, appA, appB, serverA, serverB, baseA, baseB
const cfgFor = () => loadConfig({ DATABASE_URL: dbUrl, PUSH_DRY_RUN: '1', PUSH_OUTBOX: outbox, APP_URL: 'http://lc.test', ADMIN_EMAILS: '', REVISION_EVERY_MIN: '60', DIST: '/nonexistent' })
async function listen(app) {
  const s = http.createServer(app.handler)
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  return [s, `http://127.0.0.1:${s.address().port}`]
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`create database "${DB_NAME}"`)
  await admin.end()
  conn = connect(dbUrl)
  await runMigrations(conn.pool, { log: quiet })
  // two app instances on one database = a rolling deploy / two replicas
  appA = await createApp({ cfg: cfgFor(), db: conn.db, pool: conn.pool, log: quiet });
  [serverA, baseA] = await listen(appA)
  appB = await createApp({ cfg: cfgFor(), db: conn.db, pool: conn.pool, log: quiet });
  [serverB, baseB] = await listen(appB)
})
after(async () => {
  appA?.close(); appB?.close()
  serverA?.close(); serverB?.close()
  await conn?.pool.end()
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`drop database if exists "${DB_NAME}" with (force)`)
  await admin.end()
})

/** A tiny client with a cookie jar. */
function client(base = baseA) {
  let cookie = ''
  const c = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, {
      method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, body: json, text }
  }
  c.on = (b) => { const d = client(b); d.cookie = cookie; return d }
  Object.defineProperty(c, 'cookie', { get: () => cookie, set: (v) => { cookie = v } })
  return c
}
const doc = (extra = {}) => ({ schemaVersion: 2, todos: [], ...extra })

let alice, bob
test('health answers without an account', async () => {
  const r = await client()('GET', '/api/health')
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.auth.signups, 'open')
})

test('everything else needs an account', async () => {
  const c = client()
  for (const [m, p] of [['GET', '/api/state'], ['GET', '/api/issues'], ['GET', '/api/push/devices'], ['GET', '/api/auth/me']]) {
    assert.equal((await c(m, p)).status, 401, `${m} ${p}`)
  }
  assert.equal((await c('PUT', '/api/state', { state: doc(), baseVersion: 0 })).status, 401)
})

test('sign up: first account is admin, then normal users; bad input refused', async () => {
  alice = client()
  const a = await alice('POST', '/api/auth/signup', { email: ' Alice@Example.com ', password: 'correct horse', name: 'Alice' })
  assert.equal(a.status, 201)
  assert.equal(a.body.user.email, 'alice@example.com')
  assert.equal(a.body.user.role, 'admin')
  assert.ok(alice.cookie.startsWith('lc_session='))
  bob = client()
  const b = await bob('POST', '/api/auth/signup', { email: 'bob@example.com', password: 'another pass' })
  assert.equal(b.body.user.role, 'user')
  assert.equal((await client()('POST', '/api/auth/signup', { email: 'ALICE@example.com', password: 'whatever123' })).status, 409)
  assert.equal((await client()('POST', '/api/auth/signup', { email: 'x@example.com', password: 'short' })).status, 400)
  assert.equal((await client()('POST', '/api/auth/signup', { email: 'not-an-email', password: 'longenough' })).status, 400)
})

test('log in / wrong password / log out', async () => {
  const c = client()
  assert.equal((await c('POST', '/api/auth/login', { email: 'alice@example.com', password: 'nope nope' })).status, 401)
  assert.equal((await c('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'nope nope' })).status, 401)
  const ok = await c('POST', '/api/auth/login', { email: 'ALICE@example.com', password: 'correct horse' })
  assert.equal(ok.status, 200)
  assert.equal((await c('GET', '/api/auth/me')).body.user.email, 'alice@example.com')
  const stolen = c.cookie
  await c('POST', '/api/auth/logout', {})
  const replay = client(); replay.cookie = stolen
  assert.equal((await replay('GET', '/api/auth/me')).status, 401, 'session is gone server-side after logout')
})

test('CSRF: cross-site or non-JSON writes are refused', async () => {
  assert.equal((await alice('POST', '/api/auth/logout', 'x', { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await alice('PUT', '/api/state', { state: doc(), baseVersion: 0 }, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await alice('PUT', '/api/state', { state: doc(), baseVersion: 0 }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  // same-origin requests pass on any host the app is served on (public domain, private-network URL)
  assert.notEqual((await alice('GET', '/api/state', undefined, { Origin: baseA })).status, 403)
  assert.equal((await alice('POST', '/api/issues', { title: 'same origin ok' }, { Origin: baseA })).status, 201)
})

test('planner: save, read, versioning and conflicts', async () => {
  assert.deepEqual((await alice('GET', '/api/state')).body, { changed: true, version: 0, updatedAt: null, device: null, state: null })
  const s1 = await alice('PUT', '/api/state', { state: doc({ todos: [{ id: 'T-1', title: 'one' }] }), baseVersion: 0, device: 'Mac' })
  assert.equal(s1.status, 200)
  assert.equal(s1.body.version, 1)
  assert.deepEqual((await alice('GET', '/api/state?since=1')).body, { changed: false, version: 1 })
  const g = await alice('GET', '/api/state?since=0')
  assert.equal(g.body.state.todos[0].title, 'one')
  assert.equal(g.body.device, 'Mac')
  // another device still on v0 → conflict carrying the server copy (the client merges and retries)
  const c = await alice('PUT', '/api/state', { state: doc({ todos: [] }), baseVersion: 0 })
  assert.equal(c.status, 409)
  assert.equal(c.body.version, 1)
  assert.equal(c.body.state.todos[0].id, 'T-1')
  // the second instance sees the same data (rolling deploy)
  const viaB = alice.on(baseB)
  assert.equal((await viaB('PUT', '/api/state', { state: doc({ todos: [{ id: 'T-1', title: 'two' }] }), baseVersion: 1 })).body.version, 2)
})

test('users are isolated from each other', async () => {
  const b = await bob('GET', '/api/state')
  assert.equal(b.body.version, 0)
  assert.equal(b.body.state, null)
  assert.equal((await bob('PUT', '/api/state', { state: doc({ todos: [{ id: 'T-1', title: 'bob' }] }), baseVersion: 0 })).body.version, 1)
  assert.equal((await alice('GET', '/api/state')).body.state.todos[0].title, 'two')
  // bob can't mark alice's todo done (it acts on his own planner only)
  assert.equal((await bob('POST', '/api/todo/done', { id: 'T-404' })).status, 404)
})

test('schema guard: an older app version can never overwrite newer data, even forced', async () => {
  const cur = (await alice('GET', '/api/state')).body
  assert.equal((await alice('PUT', '/api/state', { state: { ...cur.state, schemaVersion: 3 }, baseVersion: cur.version })).status, 200)
  const v = (await alice('GET', '/api/state')).body.version
  const old = await alice('PUT', '/api/state', { state: { schemaVersion: 2, todos: [] }, baseVersion: v })
  assert.equal(old.status, 409)
  assert.equal(old.body.error, 'outdated')
  assert.equal(old.body.state.schemaVersion, 3, 'response carries the newer doc so the old tab shows "reload"')
  assert.equal((await alice('PUT', '/api/state', { state: { schemaVersion: 2, todos: [] }, baseVersion: 0, force: true })).status, 409)
  const missing = await alice('PUT', '/api/state', { state: { todos: [] }, baseVersion: v }) // no schemaVersion = v1
  assert.equal(missing.status, 409)
})

test('forced overwrite keeps a revision, and it can be restored', async () => {
  const before = (await alice('GET', '/api/state')).body
  const f = await alice('PUT', '/api/state', { state: { schemaVersion: 3, todos: [{ id: 'T-9', title: 'forced' }] }, baseVersion: 0, force: true })
  assert.equal(f.status, 200)
  const revs = (await alice('GET', '/api/state/revisions')).body
  const forced = revs.find((r) => r.reason === 'force')
  assert.ok(forced, 'a "force" revision exists')
  assert.equal(forced.version, before.version)
  const r = await alice('POST', `/api/state/revisions/${forced.id}/restore`, {})
  assert.equal(r.status, 200)
  const now = (await alice('GET', '/api/state')).body
  assert.equal(now.state.todos[0].title, 'two')
  assert.ok(now.version > f.body.version)
  // bob can't restore alice's revisions
  assert.equal((await bob('POST', `/api/state/revisions/${forced.id}/restore`, {})).status, 404)
})

test('NUL characters (not storable in jsonb) are stripped instead of failing the save', async () => {
  const v = (await bob('GET', '/api/state')).body.version
  const r = await bob('PUT', '/api/state', { state: doc({ todos: [{ id: 'T-1', title: 'a\u0000b', notes: 'keep \\u0000 literal' }] }), baseVersion: v })
  assert.equal(r.status, 200)
  const t = (await bob('GET', '/api/state')).body.state.todos[0]
  assert.equal(t.title, 'ab')
  assert.equal(t.notes, 'keep \\u0000 literal')
})

test('notification "Mark done" edits only the caller\'s planner and bumps the version', async () => {
  const v = (await bob('GET', '/api/state')).body.version
  const r = await bob('POST', '/api/todo/done', { id: 'T-1' })
  assert.equal(r.status, 200)
  assert.equal(r.body.version, v + 1)
  assert.equal((await bob('GET', '/api/state')).body.state.todos[0].done, true)
  assert.notEqual((await alice('GET', '/api/state')).body.state.todos[0].done, true)
})

test('issues: anyone reports, reporters see their own, only admins manage', async () => {
  const a = await alice('POST', '/api/issues', { title: 'alice bug', screen: 'S-10', severity: 'high' })
  assert.equal(a.status, 201)
  assert.match(a.body.id, /^ISS-\d+$/)
  const b = await bob('POST', '/api/issues', { title: 'bob idea', kind: 'idea' })
  assert.equal(b.status, 201)
  assert.deepEqual((await bob('GET', '/api/issues')).body.map((i) => i.title), ['bob idea'])
  assert.equal((await bob('GET', `/api/issues/${a.body.id}`)).status, 404)
  assert.equal((await bob('PATCH', `/api/issues/${b.body.id}`, { status: 'fixed' })).status, 403)
  const all = (await alice('GET', '/api/issues?status=active')).body
  assert.equal(all.length, 3)
  assert.equal(all.find((i) => i.title === 'bob idea').reporter, 'bob@example.com')
  const fixed = await alice('PATCH', `/api/issues/${b.body.id}`, { status: 'fixed', resolution: 'done', commit: 'abc123' })
  assert.equal(fixed.body.status, 'fixed')
  assert.ok(fixed.body.resolvedAt)
  assert.equal((await alice('GET', '/api/issues?status=active')).body.length, 2)
})

test('API tokens work for scripts (npm run issues)', async () => {
  const me = (await alice('GET', '/api/auth/me')).body.user
  const token = await appA.auth.createApiToken(me.id, 'test')
  const r = await fetch(`${baseA}/api/issues`, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).length, 3)
  const bad = await fetch(`${baseA}/api/issues`, { headers: { Authorization: 'Bearer lct_wrong' } })
  assert.equal(bad.status, 401)
})

test('scheduler: two instances never send the same notification twice', async () => {
  const sub = { endpoint: 'https://push.example.com/send/abc', keys: { p256dh: 'BPk', auth: 'xyz' } }
  assert.equal((await alice('POST', '/api/push/subscribe', { subscription: sub, label: 'Phone' })).status, 200)
  assert.equal((await alice('GET', '/api/push/devices')).body.length, 1)
  assert.equal((await bob('GET', '/api/push/devices')).body.length, 0)
  const soon = new Date(Date.now() + 60000)
  const hhmm = `${String(soon.getUTCHours()).padStart(2, '0')}:${String(soon.getUTCMinutes()).padStart(2, '0')}`
  const cur = (await alice('GET', '/api/state')).body
  const state = { ...cur.state, settings: { timezone: 'UTC', briefingTime: hhmm, notify: { blocks: false, deadlines: false, daily: true, wellbeing: false, pomodoro: false } } }
  assert.equal((await alice('PUT', '/api/state', { state, baseVersion: cur.version })).status, 200)
  const later = Date.now() + 3 * 60000
  await Promise.all([appA.scheduler.tick(later), appB.scheduler.tick(later)])
  const sent = fs.readFileSync(outbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(sent.length, 1, `exactly one push, got ${sent.length}`)
  assert.equal(sent[0].to, 'Phone')
})

test('change password signs other devices out; delete account removes everything', async () => {
  const other = client()
  await other('POST', '/api/auth/login', { email: 'bob@example.com', password: 'another pass' })
  assert.equal((await bob('POST', '/api/auth/password', { current: 'wrong', password: 'new password 1' })).status, 401)
  assert.equal((await bob('POST', '/api/auth/password', { current: 'another pass', password: 'new password 1' })).status, 200)
  assert.equal((await bob('GET', '/api/auth/me')).status, 200, 'this device stays signed in')
  assert.equal((await other('GET', '/api/auth/me')).status, 401, 'other devices are signed out')
  assert.equal((await bob('DELETE', '/api/auth/me', { password: 'another pass' })).status, 401)
  assert.equal((await bob('DELETE', '/api/auth/me', { password: 'new password 1' })).status, 200)
  assert.equal((await bob('GET', '/api/auth/me')).status, 401)
  const left = await conn.pool.query(`select (select count(*) from planner_docs d join users u on u.id = d.user_id where u.email = 'bob@example.com')::int as docs, (select count(*) from users where email = 'bob@example.com')::int as users`)
  assert.deepEqual(left.rows[0], { docs: 0, users: 0 })
  assert.equal((await alice('GET', '/api/issues')).body.find((i) => i.title === 'bob idea').reporter, '', 'issues outlive their reporter')
})

test('server updates: admins only', async () => {
  const carol = client()
  assert.equal((await carol('POST', '/api/auth/signup', { email: 'carol@example.com', password: 'carol password' })).status, 201)
  assert.equal((await carol('GET', '/api/admin/update')).status, 403)
  assert.equal((await carol('POST', '/api/admin/update/apply', {})).status, 403)
  assert.equal((await carol('PATCH', '/api/admin/update', { autoUpdate: false })).status, 403)
  assert.equal((await alice('PATCH', '/api/admin/update', { autoUpdate: 'no' })).status, 400)
  const r = await alice('GET', '/api/admin/update')
  assert.equal(r.status, 200)
  assert.equal(r.body.reason, 'unknown-build', 'a build without LC_BUILD_SHA never checks')
  assert.equal((await alice('POST', '/api/admin/update/apply', {})).status, 409, 'no updater on this server')
})

test('login is rate limited', async () => {
  const c = client()
  let last
  for (let i = 0; i < 11; i++) last = await c('POST', '/api/auth/login', { email: 'alice@example.com', password: 'guess ' + i })
  assert.equal(last.status, 429)
})

test('migrations are idempotent and safe to run concurrently', async () => {
  const [a, b] = await Promise.all([runMigrations(conn.pool, { log: quiet }), runMigrations(conn.pool, { log: quiet })])
  assert.equal(a + b, 0)
})

test('API tokens for a device ("Connect Mac app"): only from a browser session; connecting again replaces the old token', async () => {
  const carol = client()
  assert.equal((await carol('POST', '/api/auth/signup', { email: 'carol-mac@example.com', password: 'carol password' })).status, 201)
  await carol('PUT', '/api/state', { state: doc({ todos: [{ id: 'T-1', title: 'carol only' }] }), baseVersion: 0 })
  const bearer = (t) => ({ Authorization: `Bearer ${t}` })

  const t1 = await carol('POST', '/api/auth/tokens', { name: 'Mac app' })
  assert.equal(t1.status, 201)
  assert.match(t1.body.token, /^lct_/)
  const app = client()
  const s1 = await app('GET', '/api/state', undefined, bearer(t1.body.token))
  assert.equal(s1.status, 200)
  assert.equal(s1.body.state.todos[0].title, 'carol only', "the token reads its owner's planner")

  assert.equal((await app('POST', '/api/auth/tokens', { name: 'Mac app' }, bearer(t1.body.token))).status, 403, "a token can't mint tokens")
  assert.equal((await client()('POST', '/api/auth/tokens', { name: 'Mac app' })).status, 401)
  assert.equal((await carol('POST', '/api/auth/tokens', { name: '' })).status, 400)
  assert.equal((await carol('POST', '/api/auth/tokens', { name: '<script>' })).status, 400)

  const t2 = await carol('POST', '/api/auth/tokens', { name: 'Mac app' })
  assert.equal((await app('GET', '/api/state', undefined, bearer(t1.body.token))).status, 401, 'the previous Mac token stops working')
  assert.equal((await app('GET', '/api/state', undefined, bearer(t2.body.token))).status, 200)
  const other = await carol('POST', '/api/auth/tokens', { name: 'Other Mac' })
  assert.equal((await app('GET', '/api/state', undefined, bearer(t2.body.token))).status, 200, 'other device names keep their tokens')
  assert.equal((await app('GET', '/api/state', undefined, bearer(other.body.token))).status, 200)
})
