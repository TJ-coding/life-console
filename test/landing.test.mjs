// Landing page routing (LANDING=on), robots.txt / sitemap.xml / llms.txt, and byte-range static serving.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
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
const DB_NAME = `lc_landing_${process.pid}_${Date.now()}`
const dbUrl = (() => { const u = new URL(ADMIN_URL); u.pathname = `/${DB_NAME}`; return u.toString() })()
const quiet = () => {}

// a fake build: the app shell, the landing page and one "video"
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-dist-'))
fs.writeFileSync(path.join(dist, 'index.html'), '<title>APP</title>')
fs.writeFileSync(path.join(dist, 'landing.html'), '<head><title>LANDING</title></head>')
fs.writeFileSync(path.join(dist, 'landing-b.html'), '<head><title>LANDING-B</title></head><b class="stars"><!--stars--></b>')
fs.writeFileSync(path.join(dist, 'llms.txt'), '# Life Console')
fs.mkdirSync(path.join(dist, 'media'))
const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))
fs.writeFileSync(path.join(dist, 'media', 'clip.mp4'), VIDEO)

let conn
const servers = []
async function start(env) {
  const cfg = loadConfig({ DATABASE_URL: dbUrl, PUSH_DRY_RUN: '1', APP_URL: 'https://lc.test', ADMIN_EMAILS: '', DIST: dist, GITHUB_REPO: '', ...env })
  const app = await createApp({ cfg, db: conn.db, pool: conn.pool, log: quiet })
  const s = http.createServer(app.handler)
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  servers.push([app, s])
  return `http://127.0.0.1:${s.address().port}`
}
let on, off, tracked, heat, framed, ab

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`create database "${DB_NAME}"`)
  await admin.end()
  conn = connect(dbUrl)
  await runMigrations(conn.pool, { log: quiet })
  on = await start({ LANDING: 'on' })
  off = await start({})
  tracked = await start({ LANDING: 'on', ANALYTICS_SCRIPT: '/stats/lc.js', ANALYTICS_SITE_ID: 'abc-123' })
  heat = await start({ LANDING: 'on', ANALYTICS_SCRIPT: '/stats/lc.js', ANALYTICS_SITE_ID: 'abc-123', ANALYTICS_RECORDER: '/stats/recorder.js' })
  framed = await start({ LANDING: 'on', ANALYTICS_SCRIPT: '/stats/lc.js', ANALYTICS_SITE_ID: 'abc-123', ANALYTICS_DASHBOARD: 'http://umami.lan:3100/websites' })
  ab = await start({ LANDING: 'on', LANDING_AB: 'on', ANALYTICS_SCRIPT: '/stats/lc.js', ANALYTICS_SITE_ID: 'abc-123' })
})
after(async () => {
  for (const [app, s] of servers) { app.close(); s.close() }
  await conn?.pool.end()
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`drop database if exists "${DB_NAME}" with (force)`)
  await admin.end()
  fs.rmSync(dist, { recursive: true, force: true })
})

const get = async (base, p, headers = {}) => {
  const r = await fetch(base + p, { headers })
  return { status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) }
}

test('LANDING=on: / is the landing page without a session, the app with one; /app is always the app', async () => {
  const visitor = await get(on, '/')
  assert.equal(visitor.status, 200)
  assert.match(visitor.body.toString(), /LANDING/)
  assert.equal(visitor.headers.get('vary'), 'Cookie')
  assert.equal(visitor.headers.get('x-lc-page'), 'landing') // the service worker must not cache it as the app shell
  const member = await get(on, '/', { Cookie: 'lc_session=abc' })
  assert.match(member.body.toString(), /APP/)
  assert.equal(member.headers.get('x-lc-page'), null)
  assert.match((await get(on, '/app')).body.toString(), /APP/)
})

test('LANDING off (self-hosted default): / is the app, the landing page and sitemap are hidden, robots blocks crawlers', async () => {
  assert.match((await get(off, '/')).body.toString(), /APP/)
  assert.equal((await get(off, '/landing.html')).status, 404)
  assert.equal((await get(off, '/sitemap.xml')).status, 404)
  assert.equal((await get(off, '/llms.txt')).status, 404)
  const robots = (await get(off, '/robots.txt')).body.toString()
  assert.match(robots, /Disallow: \/\n/)
  assert.doesNotMatch(robots, /Sitemap/)
})

test('LANDING=on: robots.txt allows the site and points at a sitemap with images and videos', async () => {
  const robots = (await get(on, '/robots.txt')).body.toString()
  assert.match(robots, /Allow: \//)
  assert.match(robots, /Disallow: \/api\//)
  assert.match(robots, /Sitemap: https:\/\/lc\.test\/sitemap\.xml/)
  const sm = await get(on, '/sitemap.xml')
  assert.equal(sm.status, 200)
  assert.match(sm.headers.get('content-type'), /xml/)
  const xml = sm.body.toString()
  assert.match(xml, /<loc>https:\/\/lc\.test\/<\/loc>/)
  assert.match(xml, /<image:loc>/)
  assert.match(xml, /<video:content_loc>https:\/\/lc\.test\/media\/tour\.mp4/)
  assert.equal((await get(on, '/llms.txt')).status, 200)
})

test('static files support byte ranges (Safari needs them for <video>)', async () => {
  const full = await get(on, '/media/clip.mp4')
  assert.equal(full.status, 200)
  assert.equal(full.headers.get('accept-ranges'), 'bytes')
  assert.equal(full.headers.get('content-type'), 'video/mp4')
  assert.deepEqual(full.body, VIDEO)
  const part = await get(on, '/media/clip.mp4', { Range: 'bytes=10-19' })
  assert.equal(part.status, 206)
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000')
  assert.deepEqual(part.body, VIDEO.subarray(10, 20))
  const open = await get(on, '/media/clip.mp4', { Range: 'bytes=990-' })
  assert.deepEqual(open.body, VIDEO.subarray(990))
  const suffix = await get(on, '/media/clip.mp4', { Range: 'bytes=-5' })
  assert.equal(suffix.headers.get('content-range'), 'bytes 995-999/1000')
  assert.equal((await get(on, '/media/clip.mp4', { Range: 'bytes=5000-' })).status, 416)
})

test('ANALYTICS_SCRIPT + ANALYTICS_SITE_ID: the landing page gets the tracker tag, the app and a plain landing page never do', async () => {
  const tag = '<script defer src="/stats/lc.js" data-website-id="abc-123" data-tag="landing-a"></script>'
  const visitor = await get(tracked, '/')
  assert.equal(visitor.status, 200)
  assert.equal(visitor.headers.get('x-lc-page'), 'landing')
  assert.ok(visitor.body.toString().includes(tag + '\n</head>'))
  assert.equal(Number(visitor.headers.get('content-length')), visitor.body.length)
  assert.doesNotMatch((await get(tracked, '/', { Cookie: 'lc_session=abc' })).body.toString(), /data-website-id/)
  assert.doesNotMatch((await get(tracked, '/app')).body.toString(), /data-website-id/)
  assert.doesNotMatch((await get(on, '/')).body.toString(), /data-website-id/)
  assert.doesNotMatch(visitor.body.toString(), /recorder/)
})

test('ANALYTICS_RECORDER: the heatmap recorder goes on the landing page only, never the app or /api/health', async () => {
  const rec = '<script defer src="/stats/recorder.js" data-website-id="abc-123"></script>'
  const visitor = (await get(heat, '/')).body.toString()
  assert.ok(visitor.includes('data-tag="landing-a"></script>\n' + rec + '\n</head>'), 'tracker first, then the recorder')
  assert.doesNotMatch((await get(heat, '/', { Cookie: 'lc_session=abc' })).body.toString(), /recorder/)
  assert.doesNotMatch((await get(heat, '/app')).body.toString(), /recorder/)
  assert.doesNotMatch((await get(heat, '/api/health')).body.toString(), /recorder/)
})

test('ANALYTICS_DASHBOARD: only that origin may frame the landing page (heatmap background); the app stays unframeable', async () => {
  for (const base of [on, tracked]) { // without it, the landing page refuses every frame
    const r = await get(base, '/')
    assert.equal(r.headers.get('x-frame-options'), 'DENY')
    assert.equal(r.headers.get('content-security-policy'), null)
  }
  const landing = await get(framed, '/')
  assert.match(landing.body.toString(), /LANDING/)
  assert.equal(landing.headers.get('x-frame-options'), null)
  assert.equal(landing.headers.get('content-security-policy'), "frame-ancestors 'self' http://umami.lan:3100")
  for (const [p, h] of [['/', { Cookie: 'lc_session=abc' }], ['/app', {}], ['/privacy', {}], ['/api/health', {}]]) {
    const r = await get(framed, p, h)
    assert.equal(r.headers.get('x-frame-options'), 'DENY', p)
    assert.equal(r.headers.get('content-security-policy'), null, p)
  }
  assert.throws(() => loadConfig({ DATABASE_URL: dbUrl, ANALYTICS_DASHBOARD: 'umami.lan' }), /ANALYTICS_DASHBOARD/)
})

test('LANDING_AB=on: a visitor gets A or B at random, keeps it via lc_lp, and Umami is tagged with the variant', async () => {
  const seen = new Set()
  for (let i = 0; i < 40 && seen.size < 2; i++) {
    const r = await get(ab, '/')
    const lp = /^lc_lp=([ab]); Path=\/; Max-Age=7776000; SameSite=Lax(; Secure)?$/.exec(r.headers.get('set-cookie'))?.[1]
    assert.ok(lp, r.headers.get('set-cookie'))
    assert.match(r.body.toString(), lp === 'b' ? /LANDING-B/ : /<title>LANDING<\/title>/)
    assert.ok(r.body.toString().includes(`data-tag="landing-${lp}"`))
    assert.equal(r.headers.get('x-lc-page'), 'landing')
    assert.equal(r.headers.get('vary'), 'Cookie')
    seen.add(lp)
  }
  assert.equal(seen.size, 2, 'both variants are served')
  for (const v of ['a', 'b']) {
    for (let i = 0; i < 5; i++) assert.ok((await get(ab, '/', { Cookie: `lc_lp=${v}` })).body.toString().includes(`data-tag="landing-${v}"`))
  }
  assert.ok((await get(ab, '/?lp=b', { Cookie: 'lc_lp=a' })).body.toString().includes('LANDING-B'), '?lp= wins over the cookie')
  const app = await get(ab, '/', { Cookie: 'lc_session=abc; lc_lp=b' })
  assert.match(app.body.toString(), /APP/)
  assert.equal(app.headers.get('set-cookie'), null)
})

test('LANDING_AB off: everyone gets A without a cookie; ?lp=b previews B; no landing pages when LANDING is off', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await get(on, '/', { Cookie: 'lc_lp=b' })
    assert.match(r.body.toString(), /<title>LANDING<\/title>/)
    assert.equal(r.headers.get('set-cookie'), null)
  }
  const preview = await get(on, '/?lp=b')
  assert.match(preview.body.toString(), /LANDING-B/)
  assert.match(preview.headers.get('set-cookie'), /^lc_lp=b;/)
  assert.match((await get(on, '/?lp=zzz')).body.toString(), /<title>LANDING<\/title>/)
  assert.equal((await get(off, '/landing-b.html')).status, 404)
  assert.match((await get(off, '/?lp=b')).body.toString(), /APP/)
})

test('GITHUB_REPO: the landing page shows the star count, fetched by the server; none while it is unknown', async () => {
  let calls = 0
  const gh = http.createServer((req, res) => {
    calls++
    assert.equal(req.url, '/repos/me/repo')
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ stargazers_count: 1234 }))
  })
  await new Promise((r) => gh.listen(0, '127.0.0.1', r))
  try {
    const base = await start({ LANDING: 'on', GITHUB_REPO: 'me/repo', GITHUB_API: `http://127.0.0.1:${gh.address().port}` })
    let body = ''
    for (let i = 0; i < 50 && !body.includes('1.2k'); i++) { body = (await get(base, '/?lp=b')).body.toString(); await new Promise((r) => setTimeout(r, 20)) }
    assert.ok(body.includes('<b class="stars">1.2k</b>'), body)
    assert.equal(calls, 1, 'fetched once, not per visitor')
  } finally { gh.close() }
  assert.ok((await get(on, '/?lp=b')).body.toString().includes('<b class="stars"></b>'), 'no repo: an empty count')
})

test('/api/health tells the app about analytics only when it is configured', async () => {
  const h = JSON.parse((await get(tracked, '/api/health')).body)
  assert.deepEqual(h.analytics, { script: '/stats/lc.js', siteId: 'abc-123' })
  assert.equal(JSON.parse((await get(on, '/api/health')).body).analytics, undefined)
})
