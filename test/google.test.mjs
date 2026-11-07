// Google sign-in (OIDC) with password sign-in turned off — the hosted configuration.
// A fake Google token endpoint checks PKCE and returns an ID token the test controls.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import pg from 'pg'
import { loadConfig } from '../server/config.mjs'
import { connect, runMigrations } from '../server/db/index.mjs'
import { createApp } from '../server/app.mjs'
import { users } from '../server/db/schema.js'
import { eq } from 'drizzle-orm'

const ADMIN_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
if (!ADMIN_URL) throw new Error('set TEST_DATABASE_URL')
const DB_NAME = `lc_gtest_${process.pid}_${Date.now()}`
const dbUrl = (() => { const u = new URL(ADMIN_URL); u.pathname = `/${DB_NAME}`; return u.toString() })()
const CLIENT_ID = 'test-client.apps.googleusercontent.com'
const quiet = () => {}

let conn, app, server, base, fake, fakeBase
let nextClaims = null // what the fake Google puts in the next ID token (gets nonce/aud/iss filled in)
const codes = new Map() // code → { challenge }

const jwt = (claims) => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect(); await admin.query(`create database "${DB_NAME}"`); await admin.end()
  // fake Google: /auth is never hit (the test reads the redirect itself); /token checks PKCE
  fake = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const p = new URLSearchParams(body)
      const c = codes.get(p.get('code'))
      const ok = c && p.get('client_secret') === 'test-secret' && p.get('redirect_uri') === 'https://lc.test/api/auth/google/callback' &&
        crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === c.challenge
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(ok ? { id_token: jwt({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600, nonce: c.nonce, ...nextClaims }) } : { error: 'invalid_grant' }))
    })
  })
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  fakeBase = `http://127.0.0.1:${fake.address().port}`
  conn = connect(dbUrl)
  await runMigrations(conn.pool, { log: quiet })
  const cfg = loadConfig({
    DATABASE_URL: dbUrl, APP_URL: 'https://lc.test', AUTH_PASSWORD: 'off', GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'test-secret',
    ADMIN_EMAILS: 'owner@gmail.com',
    GOOGLE_AUTH_URL: `${fakeBase}/auth`, GOOGLE_TOKEN_URL: `${fakeBase}/token`, PUSH_DRY_RUN: '1', DIST: '/nonexistent', COOKIE_SECURE: '0',
  })
  app = await createApp({ cfg, db: conn.db, pool: conn.pool, log: quiet })
  server = http.createServer(app.handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  app?.close(); server?.close(); fake?.close()
  await conn?.pool.end()
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect(); await admin.query(`drop database if exists "${DB_NAME}" with (force)`); await admin.end()
})

/** Run the whole browser round trip: start → (Google) → callback. Returns { location, session }. */
async function googleLogin(claims, { tamperState = false, tamperNonce = false } = {}) {
  const s = await fetch(`${base}/api/auth/google/start`, { redirect: 'manual' })
  assert.equal(s.status, 302)
  const loc = new URL(s.headers.get('location'))
  assert.equal(loc.origin + loc.pathname, `${fakeBase}/auth`)
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(loc.searchParams.get('scope'), 'openid email profile')
  const flowCookie = s.headers.get('set-cookie').split(';')[0]
  const code = crypto.randomBytes(8).toString('hex')
  codes.set(code, { challenge: loc.searchParams.get('code_challenge'), nonce: tamperNonce ? 'evil' : loc.searchParams.get('nonce') })
  nextClaims = claims
  const state = tamperState ? 'x'.repeat(loc.searchParams.get('state').length) : loc.searchParams.get('state')
  const cb = await fetch(`${base}/api/auth/google/callback?code=${code}&state=${state}`, { redirect: 'manual', headers: { Cookie: flowCookie } })
  assert.equal(cb.status, 302)
  const session = cb.headers.getSetCookie().find((c) => c.startsWith('lc_session=') && !c.startsWith('lc_session=;'))?.split(';')[0]
  return { location: cb.headers.get('location'), session }
}
const me = (session) => fetch(`${base}/api/auth/me`, { headers: { Cookie: session } }).then((r) => r.json())
const post = (p, body, session) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}) }, body: JSON.stringify(body) })

test('health advertises Google only', async () => {
  const h = await fetch(`${base}/api/health`).then((r) => r.json())
  assert.deepEqual({ password: h.auth.password, google: h.auth.google }, { password: false, google: true })
})

test('password endpoints are off', async () => {
  for (const p of ['/api/auth/signup', '/api/auth/login', '/api/auth/forgot', '/api/auth/reset']) {
    assert.equal((await post(p, { email: 'a@b.co', password: 'longenough1' })).status, 403, p)
  }
})

test('with ADMIN_EMAILS set, a stranger signing in first does not become admin', async () => {
  const r = await googleLogin({ sub: 'g-0', email: 'stranger@example.com', email_verified: true })
  assert.equal((await me(r.session)).user.role, 'user')
})

test('the ADMIN_EMAILS account is admin, with no password stored', async () => {
  const r = await googleLogin({ sub: 'g-1', email: 'Owner@Gmail.com', email_verified: true, name: 'Owner' })
  assert.equal(r.location, '/#/')
  assert.ok(r.session)
  const u = (await me(r.session)).user
  assert.equal(u.email, 'owner@gmail.com')
  assert.equal(u.role, 'admin')
  assert.equal(u.hasPassword, false)
  assert.equal(u.google, true)
  // signing in again finds the same account by Google id
  const again = await googleLogin({ sub: 'g-1', email: 'owner@gmail.com', email_verified: true })
  assert.equal((await me(again.session)).user.id, u.id)
  assert.equal((await post('/api/auth/password', { current: 'x', password: 'whatever12' }, again.session)).status, 403)
})

test('an existing password account is linked by email and its password hash is deleted', async () => {
  const pre = await app.auth.createUser({ email: 'legacy@example.com', password: 'old password 1' })
  assert.ok(pre.passwordHash)
  const r = await googleLogin({ sub: 'g-2', email: 'legacy@example.com', email_verified: true })
  assert.equal((await me(r.session)).user.id, pre.id)
  const [row] = await conn.db.select().from(users).where(eq(users.id, pre.id))
  assert.equal(row.passwordHash, '')
  assert.equal(row.googleSub, 'g-2')
  // a different Google account claiming the same email is refused
  const other = await googleLogin({ sub: 'g-evil', email: 'legacy@example.com', email_verified: true })
  assert.match(decodeURIComponent(other.location), /auth_error=This email is linked to a different Google account/)
  assert.equal(other.session, undefined)
})

test('bad callbacks never sign anyone in', async () => {
  const cases = [
    [{ sub: 'g-3', email: 'new@example.com', email_verified: false }, {}, /not verified/],
    [{ sub: 'g-3', email: 'new@example.com', email_verified: true }, { tamperState: true }, /expired|another browser/],
    [{ sub: 'g-3', email: 'new@example.com', email_verified: true }, { tamperNonce: true }, /failed validation/],
    [{ sub: 'g-3', email: 'new@example.com', email_verified: true, aud: 'someone-else' }, {}, /failed validation/],
    [{ sub: 'g-3', email: 'new@example.com', email_verified: true, iss: 'https://evil.example' }, {}, /failed validation/],
    [{ sub: 'g-3', email: 'new@example.com', email_verified: true, exp: 1 }, {}, /failed validation/],
  ]
  for (const [claims, opts, msg] of cases) {
    const r = await googleLogin(claims, opts)
    assert.equal(r.session, undefined, JSON.stringify(claims))
    assert.match(decodeURIComponent(r.location), msg)
  }
  const cancelled = await fetch(`${base}/api/auth/google/callback?error=access_denied`, { redirect: 'manual' })
  assert.match(decodeURIComponent(cancelled.headers.get('location')), /cancelled/)
})

test('Google-only accounts delete themselves by typing their email', async () => {
  const r = await googleLogin({ sub: 'g-4', email: 'leaver@example.com', email_verified: true })
  const del = (confirm) => fetch(`${base}/api/auth/me`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Cookie: r.session }, body: JSON.stringify({ confirm }) })
  assert.equal((await del('wrong@example.com')).status, 401)
  assert.equal((await del('Leaver@example.com')).status, 200)
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: r.session } })).status, 401)
})

test('config refuses to start with no way to sign in', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: dbUrl, AUTH_PASSWORD: 'off' }), /needs Google/)
})
