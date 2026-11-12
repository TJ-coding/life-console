// Sign-ups: SIGNUPS parsing (a mistake must close them, not leave them open), the first account on an empty
// server (always allowed, so a server can start closed), ADMIN_EMAILS, and the admins' switch in Settings.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import pg from 'pg'
import { loadConfig } from '../server/config.mjs'
import { connect, runMigrations } from '../server/db/index.mjs'
import { createApp } from '../server/app.mjs'
import { createAuth } from '../server/auth.mjs'
import { createSignups } from '../server/signups.mjs'

const ADMIN_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
if (!ADMIN_URL) throw new Error('set TEST_DATABASE_URL (a Postgres server where the user can create databases)')
const DB_NAME = `lc_signups_${process.pid}_${Date.now()}`
const dbUrl = (() => { const u = new URL(ADMIN_URL); u.pathname = `/${DB_NAME}`; return u.toString() })()
const quiet = () => {}
const PW = 'correct horse battery staple'

let conn
const servers = []
const cfgWith = (env) => loadConfig({ DATABASE_URL: dbUrl, PUSH_DRY_RUN: '1', APP_URL: 'http://lc.test', ADMIN_EMAILS: '', DIST: '/nonexistent', ...env })
async function start(env, logs = []) {
  const app = await createApp({ cfg: cfgWith(env), db: conn.db, pool: conn.pool, log: (...a) => logs.push(a.join(' ')) })
  const s = http.createServer(app.handler)
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  servers.push([app, s])
  return `http://127.0.0.1:${s.address().port}`
}
function client(base) {
  let cookie = ''
  return async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
    return { status: res.status, body: await res.json().catch(() => null) }
  }
}
const signUp = (c, email) => c('POST', '/api/auth/signup', { email, password: PW, name: email.split('@')[0] })

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`create database "${DB_NAME}"`)
  await admin.end()
  conn = connect(dbUrl)
  await runMigrations(conn.pool, { log: quiet })
})
// every test starts from an empty server with no admin choice saved
beforeEach(async () => { await conn.pool.query(`truncate users cascade; delete from app_kv where key = 'signups'`) })
after(async () => {
  for (const [app, s] of servers) { app.close(); s.close() }
  await conn.pool.end()
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`drop database if exists "${DB_NAME}" with (force)`)
  await admin.end()
})

test('SIGNUPS: open and closed in their usual spellings; anything else closes sign-ups and is reported', () => {
  for (const v of [undefined, '', 'open', 'OPEN', ' on ', 'true', 'yes', '1']) assert.equal(cfgWith({ SIGNUPS: v }).signups, 'open', `SIGNUPS=${v}`)
  for (const v of ['closed', 'Closed', 'off', 'false', 'no', '0']) {
    const c = cfgWith({ SIGNUPS: v })
    assert.equal(c.signups, 'closed', `SIGNUPS=${v}`)
    assert.equal(c.signupsUnknown, '')
  }
  const typo = cfgWith({ SIGNUPS: 'clsoed' })
  assert.equal(typo.signups, 'closed')
  assert.equal(typo.signupsUnknown, 'clsoed')
})

test('an unrecognised SIGNUPS value logs a warning at start', async () => {
  const logs = []
  await start({ SIGNUPS: 'nope' }, logs)
  assert.ok(logs.some((l) => l.includes('SIGNUPS="nope"') && l.includes('closed')), logs.join('\n'))
})

test('closed: the first account on an empty server is still allowed (and is the admin); then nobody else', async () => {
  const base = await start({ SIGNUPS: 'closed' })
  assert.equal((await client(base)('GET', '/api/health')).body.auth.signups, 'open') // the owner's sign-up
  const owner = await signUp(client(base), 'owner@lc.test')
  assert.equal(owner.status, 201)
  assert.equal(owner.body.user.role, 'admin')
  assert.equal((await client(base)('GET', '/api/health')).body.auth.signups, 'closed')
  const late = await signUp(client(base), 'stranger@lc.test')
  assert.equal(late.status, 403)
})

test('"off" closes sign-ups too (the value the first app-store packages used)', async () => {
  const base = await start({ SIGNUPS: 'off' })
  assert.equal((await signUp(client(base), 'owner@lc.test')).status, 201)
  assert.equal((await signUp(client(base), 'stranger@lc.test')).status, 403)
})

test('closed + ADMIN_EMAILS: only a listed email gets the first-account exception', async () => {
  const base = await start({ SIGNUPS: 'closed', ADMIN_EMAILS: 'owner@lc.test' })
  assert.equal((await signUp(client(base), 'stranger@lc.test')).status, 403)
  const owner = await signUp(client(base), 'owner@lc.test')
  assert.equal(owner.status, 201)
  assert.equal(owner.body.user.role, 'admin')
})

test('Google sign-in follows the same rules', async () => {
  const cfg = cfgWith({ SIGNUPS: 'closed' })
  const signups = createSignups(conn.db, cfg)
  const auth = createAuth(conn.db, cfg, signups)
  const first = await auth.googleSignIn({ sub: 'g-owner', email: 'owner@lc.test', name: 'Owner' })
  assert.equal(first.role, 'admin')
  await assert.rejects(auth.googleSignIn({ sub: 'g-stranger', email: 'stranger@lc.test', name: 'S' }), /Sign-ups are closed/)
  await signups.set('open', first.id)
  const second = await auth.googleSignIn({ sub: 'g-friend', email: 'friend@lc.test', name: 'F' })
  assert.equal(second.role, 'user')
})

test('admins open and close sign-ups in Settings; the choice beats SIGNUPS until reset; others are refused', async () => {
  const base = await start({ SIGNUPS: 'closed' })
  const owner = client(base)
  await signUp(owner, 'owner@lc.test')

  let r = await owner('GET', '/api/admin/signups')
  assert.equal(r.status, 200)
  assert.deepEqual({ mode: r.body.mode, source: r.body.source, defaultMode: r.body.defaultMode }, { mode: 'closed', source: 'default', defaultMode: 'closed' })

  r = await owner('PATCH', '/api/admin/signups', { mode: 'open' })
  assert.equal(r.status, 200)
  assert.equal(r.body.mode, 'open')
  assert.equal(r.body.source, 'admin')
  assert.equal((await client(base)('GET', '/api/health')).body.auth.signups, 'open')
  const friend = client(base)
  assert.equal((await signUp(friend, 'friend@lc.test')).status, 201)

  // a normal user can't see or change it
  assert.equal((await friend('GET', '/api/admin/signups')).status, 403)
  assert.equal((await friend('PATCH', '/api/admin/signups', { mode: 'closed' })).status, 403)
  // nor can anyone signed out
  assert.equal((await client(base)('PATCH', '/api/admin/signups', { mode: 'open' })).status, 401)
  // only open, closed or null
  assert.equal((await owner('PATCH', '/api/admin/signups', { mode: 'off' })).status, 400)

  r = await owner('PATCH', '/api/admin/signups', { mode: 'closed' })
  assert.equal(r.body.mode, 'closed')
  assert.equal((await signUp(client(base), 'late@lc.test')).status, 403)

  // reset: back to the SIGNUPS default (closed here)
  r = await owner('PATCH', '/api/admin/signups', { mode: null })
  assert.deepEqual({ mode: r.body.mode, source: r.body.source }, { mode: 'closed', source: 'default' })
})

test('an admin choice is shared by every replica', async () => {
  const a = await start({ SIGNUPS: 'closed' })
  const owner = client(a)
  await signUp(owner, 'owner@lc.test')
  await owner('PATCH', '/api/admin/signups', { mode: 'open' })
  // another replica (its own cache) reads the choice from the database
  const c = await start({ SIGNUPS: 'closed' })
  assert.equal((await signUp(client(c), 'friend@lc.test')).status, 201)
})
