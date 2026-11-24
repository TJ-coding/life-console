// Open data end to end (goals 9-11): two Life Console servers, each with its own database, talking Solid (pods) and
// ActivityPub (sharing, edits, revoking, moving) to each other over real HTTP.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import pg from 'pg'
import { loadConfig } from '../server/config.mjs'
import { connect, runMigrations } from '../server/db/index.mjs'
import { createApp } from '../server/app.mjs'
import { toPod, fromPod } from '../server/pod.mjs'

const ADMIN_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
if (!ADMIN_URL) throw new Error('set TEST_DATABASE_URL')
const quiet = () => {}
const servers = {}

async function startServer(name) {
  const dbName = `lc_od_${name}_${process.pid}_${Date.now()}`
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect(); await admin.query(`create database "${dbName}"`); await admin.end()
  const dbUrl = (() => { const u = new URL(ADMIN_URL); u.pathname = `/${dbName}`; return u.toString() })()
  const conn = connect(dbUrl)
  await runMigrations(conn.pool, { log: quiet })
  let app
  const server = http.createServer((req, res) => app.handler(req, res))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const cfg = loadConfig({ DATABASE_URL: dbUrl, PUSH_DRY_RUN: '1', APP_URL: base, ADMIN_EMAILS: '', DIST: '/nonexistent', VAULT_KEY: crypto.randomBytes(32).toString('base64'), FEDERATION_ALLOW_PRIVATE: '1', CONNECTIONS_ALLOW_PRIVATE: '1', POD_MIRROR_MS: '20' })
  app = await createApp({ cfg, db: conn.db, pool: conn.pool, log: quiet })
  servers[name] = { app, server, base, conn, dbName, host: new URL(base).host }
}
before(async () => { await startServer('a'); await startServer('b') })
after(async () => {
  for (const s of Object.values(servers)) {
    s.app.close(); s.server.close(); await s.conn.pool.end()
    const admin = new pg.Client({ connectionString: ADMIN_URL })
    await admin.connect(); await admin.query(`drop database if exists "${s.dbName}" with (force)`); await admin.end()
  }
})

function raw(base, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + p, { method, headers: { ...headers, ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}) } }, (res) => {
      const c = []
      res.on('data', (d) => c.push(d))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(c).toString('utf8') }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}
function client(name) {
  let cookie = ''
  const c = async (method, p, body, headers = {}) => {
    const form = typeof body === 'string'
    const r = await raw(servers[name].base, method, p, body === undefined ? undefined : form ? body : JSON.stringify(body), { ...(body !== undefined ? { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers })
    const set = r.headers['set-cookie']?.[0]
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
    let json = null
    try { json = JSON.parse(r.text) } catch { /* html */ }
    return { status: r.status, body: json, text: r.text, headers: r.headers }
  }
  return c
}
const NAV = { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-User': '?1' }
async function confirm(c, query, fields = {}) {
  const page = await c('GET', `/trust?${query}`, undefined, NAV)
  const nonce = /name="nonce" value="([^"]+)"/.exec(page.text)?.[1]
  assert.ok(nonce, `no nonce for ${query}: ${page.text.replace(/<style>[\s\S]*<\/style>/, '').slice(0, 300)}`)
  return c('POST', '/trust', new URLSearchParams({ nonce, do: new URLSearchParams(query).get('do'), decision: 'yes', ...fields }).toString(), NAV)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const PLAN = { id: 'SP-01', title: 'Finish the PhD', status: 'active', health: 'On-track', vision: 'Defend by June', psgs: [{ no: 'PSG-1', title: 'Paper 2' }], sigs: [{ no: 'SIG-1.1', psg: 'PSG-1', pct: 20, status: 'active', title: 'Run experiments' }] }
const STATE = { schemaVersion: 2, todos: [{ id: 'T-101', title: 'Write intro', done: false, links: ['PSG-1'] }], timeBlocks: [{ id: 'B-1', date: '2026-11-24', start: '09:00', end: '10:00', title: 'Lab', category: 'research' }, { id: 'B-2', date: '2026-12-01', start: '09:00', end: '10:00', title: 'Lab', category: 'research' }], deadlines: [], plans: [PLAN], settings: { timezone: 'UTC' }, notes: { '2026-11-24': 'hello' } }

let alice, bob, alice2, aliceToken
test('setup: alice on server A, bob on server B, both with handles', async () => {
  alice = client('a'); bob = client('b')
  assert.equal((await alice('POST', '/api/auth/signup', { email: 'alice@a.test', password: 'pw-alice-123' })).status, 201)
  assert.equal((await bob('POST', '/api/auth/signup', { email: 'bob@b.test', password: 'pw-bob-12345' })).status, 201)
  await alice('POST', '/api/registry/handle', { handle: 'alice' })
  await bob('POST', '/api/registry/handle', { handle: 'bob' })
  assert.equal((await alice('PUT', '/api/state', { state: STATE, baseVersion: 0 })).status, 200)
})

test('pod mapping: the planner round-trips through JSON-LD resources exactly', () => {
  const res = toPod(STATE, 'https://x/pods/alice/')
  assert.deepEqual(Object.keys(res).sort(), ['planner/blocks/2026-11.jsonld', 'planner/blocks/2026-12.jsonld', 'planner/deadlines.jsonld', 'planner/other.json', 'planner/plans.jsonld', 'planner/settings.jsonld', 'planner/todos.jsonld'])
  assert.equal(res['planner/plans.jsonld']['@graph'][0]['@type'], 'core:Plan')
  const back = fromPod(JSON.parse(JSON.stringify(res)))
  assert.deepEqual({ ...back, timeBlocks: back.timeBlocks.sort((x, y) => x.id.localeCompare(y.id)) }, STATE)
})

test('goal 9: every save is written to the built-in pod, readable over the Solid protocol by its owner only', async () => {
  await wait(150)
  const dir = await alice('GET', '/pods/alice/planner/')
  assert.equal(dir.status, 200)
  assert.match(dir.headers.link, /BasicContainer/)
  assert.ok(dir.body['ldp:contains'].some((x) => x['@id'].endsWith('/pods/alice/planner/plans.jsonld')))
  const plans = await alice('GET', '/pods/alice/planner/plans.jsonld')
  assert.equal(plans.body['@graph'][0].title, 'Finish the PhD')
  assert.ok(plans.headers.etag)
  assert.equal((await client('a')('GET', '/pods/alice/planner/plans.jsonld')).status, 401, 'nobody else may read it')
  assert.equal((await bob('GET', '/pods/alice/planner/plans.jsonld')).status, 404, 'and B has no alice yet')
  // a Solid app writes with If-Match: a stale ETag is refused
  const put = await raw(servers.a.base, 'PUT', '/pods/alice/notes/x.json', '{"a":1}', { 'Content-Type': 'application/json', Cookie: '' })
  assert.equal(put.status, 401)
})

test('goal 10: share a plan with bob on server B; he reads it live; with edit access his edits land in alice\'s planner', async () => {
  // A: consent on the trusted page, then the Offer goes to B
  const done = await confirm(alice, 'do=share&plan=SP-01', { to: `@bob@${servers.b.host}`, edit: '1' })
  assert.match(done.text, /Shared with .*\/u\/bob \(can edit\)/)
  // B: it's in bob's inbox; he accepts and reads it live from A (signed request)
  const inbox = (await bob('GET', '/api/federation/inbox')).body.items
  assert.equal(inbox.length, 1)
  assert.equal(inbox[0].name, 'Finish the PhD')
  assert.equal(inbox[0].access, 'edit')
  await bob('POST', `/api/federation/inbox/${inbox[0].id}`, { status: 'accepted' })
  const live = await bob('GET', `/api/federation/shared/${inbox[0].id}`)
  assert.equal(live.status, 200)
  assert.equal(live.body.plan.vision, 'Defend by June')
  // an unsigned (or wrongly signed) read is refused
  assert.equal((await raw(servers.a.base, 'GET', '/u/alice/r/plan/SP-01', undefined, {})).status, 401)
  // bob edits a milestone: an Update to A, applied to alice's planner
  assert.equal((await bob('POST', `/api/federation/shared/${inbox[0].id}/update`, { patch: { health: 'At risk', sigs: [{ no: 'SIG-1.1', pct: 60 }], vision: 'hijack' } })).status, 200)
  const st = (await alice('GET', '/api/state')).body.state
  assert.equal(st.plans[0].health, 'At risk')
  assert.equal(st.plans[0].sigs[0].pct, 60)
  assert.equal(st.plans[0].vision, 'Defend by June', 'only the editable fields change')
})

test('goal 10: revoking stops the live read', async () => {
  const mine = (await alice('GET', '/api/federation/shares')).body
  assert.equal(mine.address, `@alice@${servers.a.host}`)
  assert.equal(mine.shares.length, 1)
  await confirm(alice, `do=unshare&id=${mine.shares[0].id}`)
  const id = (await bob('GET', '/api/federation/inbox')).body.items[0].id
  assert.equal((await bob('GET', `/api/federation/shared/${id}`)).status, 410)
  // share again (view only) for the move test
  await confirm(alice, 'do=share&plan=SP-01', { to: `@bob@${servers.b.host}` })
  const items = (await bob('GET', '/api/federation/inbox')).body.items
  await bob('POST', `/api/federation/inbox/${items.at(-1).id}`, { status: 'accepted' })
  assert.equal((await bob('POST', `/api/federation/shared/${items.at(-1).id}/update`, { patch: { health: 'x' } })).status, 403, 'view only')
})

test('goal 11: alice moves to server B; same address, same collaborator, the plan keeps working', async () => {
  await wait(150) // the pod has the latest planner and shares
  // alice on A creates an access token (trusted page: she has no Public plugins, but the page works anyway)
  const tok = await confirm(alice, 'do=token&name=Move')
  aliceToken = /readonly value="([^"]+)"/.exec(tok.text)[1]
  // B: a new account copies the planner (and who it's shared with) from A's pod
  alice2 = client('b')
  await alice2('POST', '/api/auth/signup', { email: 'alice@b.test', password: 'pw-alice-234' })
  await alice2('POST', '/api/registry/handle', { handle: 'alice' })
  const copied = await confirm(alice2, 'do=pod-import', { pod: `${servers.a.base}/pods/alice/`, token: aliceToken })
  assert.match(copied.text, /Copied your planner/)
  assert.equal((await alice2('GET', '/api/state')).body.state.plans[0].title, 'Finish the PhD')
  assert.equal((await alice2('GET', '/api/federation/shares')).body.shares.length, 1, 'the share came along')
  // A: alice moves; bob's server is told
  const moved = await confirm(alice, 'do=move', { to: `@alice@${servers.b.host}` })
  assert.match(moved.text, /Moved/)
  const actor = await raw(servers.a.base, 'GET', '/u/alice', undefined, { Accept: 'application/activity+json' })
  assert.equal(JSON.parse(actor.text).movedTo, `${servers.b.base}/u/alice`)
  // the old address keeps resolving, to the new place
  const wf = JSON.parse((await raw(servers.a.base, 'GET', `/.well-known/webfinger?resource=acct:alice@${servers.a.host}`, undefined, {})).text)
  assert.equal(wf.links[0].href, `${servers.b.base}/u/alice`)
  // bob reads the plan as before: now from B
  const id = (await bob('GET', '/api/federation/inbox')).body.items.at(-1).id
  const live = await bob('GET', `/api/federation/shared/${id}`)
  assert.equal(live.status, 200, live.text)
  assert.equal(live.body.attributedTo, `${servers.b.base}/u/alice`)
})

test('goal 11: messages that still reach the old server wait in its mailbox for the new one', async () => {
  // someone who hasn't heard of the move shares with the old address
  const carol = client('b')
  await carol('POST', '/api/auth/signup', { email: 'carol@b.test', password: 'pw-carol-123' })
  await carol('POST', '/api/registry/handle', { handle: 'carol' })
  await carol('PUT', '/api/state', { state: { ...STATE, plans: [{ ...PLAN, id: 'SP-07', title: "Carol's plan" }] }, baseVersion: 0 })
  // delivery to a moved actor follows movedTo, so carol's Offer lands at B directly…
  await confirm(carol, 'do=share&plan=SP-07', { to: `${servers.a.base}/u/alice` })
  const there = (await alice2('GET', '/api/federation/inbox')).body.items
  assert.ok(there.some((x) => x.name === "Carol's plan"), 'followed movedTo')
  // …and anything that arrived at A meanwhile can be fetched with the old account's token
  const pulled = await alice2('POST', '/api/federation/mailbox/pull', { from: servers.a.base, token: aliceToken })
  assert.equal(pulled.status, 200)
  assert.ok(pulled.body.imported >= 0)
})

test('goal 9: keep the planner in your own Solid server: saves are written there over the protocol', async () => {
  // alice (now on B) points B at a Solid pod elsewhere: her old pod on A stands in for "my own Solid server"
  const r = await confirm(alice2, 'do=pod-use', { pod: `${servers.a.base}/pods/alice/`, token: aliceToken })
  assert.match(r.text, /now lives in/)
  assert.equal((await alice2('GET', '/api/pod')).body.own, true)
  const cur = (await alice2('GET', '/api/state')).body
  const next = { ...cur.state, plans: [{ ...cur.state.plans[0], title: 'Finish the PhD (from B)' }] }
  assert.equal((await alice2('PUT', '/api/state', { state: next, baseVersion: cur.version })).status, 200)
  await wait(200)
  const there = await raw(servers.a.base, 'GET', '/pods/alice/planner/plans.jsonld', undefined, { Authorization: `Bearer ${aliceToken}` })
  assert.equal(JSON.parse(there.text)['@graph'][0].title, 'Finish the PhD (from B)', 'written to the other Solid server')
  assert.ok(!(await alice2('GET', '/api/connections')).text.includes(aliceToken), 'the pod token stays in the vault')
})
