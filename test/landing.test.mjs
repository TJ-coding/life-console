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
fs.writeFileSync(path.join(dist, 'landing.html'), '<head><title>LANDING</title></head><b class="stars"><!--stars--></b>')
fs.writeFileSync(path.join(dist, 'landing-minimalist.html'), '<head><title>MINIMALIST</title></head>')
fs.writeFileSync(path.join(dist, 'llms.txt'), '# Life Console')
fs.mkdirSync(path.join(dist, 'docs'))
fs.writeFileSync(path.join(dist, 'docs', 'guide.html'), '<head><title>GUIDE</title></head>')
fs.writeFileSync(path.join(dist, 'docs', 'self-hosting.html'), '<title>SELF-HOSTING</title>')
fs.mkdirSync(path.join(dist, 'vs'))
fs.writeFileSync(path.join(dist, 'vs', 'sunsama.html'), '<head><title>VS-SUNSAMA</title></head>')
fs.writeFileSync(path.join(dist, 'alternatives.html'), '<head><title>HUB</title></head>')
fs.mkdirSync(path.join(dist, 'templates'))
fs.writeFileSync(path.join(dist, 'templates', 'personal-strategic-plan.html'), '<head><title>TEMPLATE</title></head>')
fs.writeFileSync(path.join(dist, 'compare-pages.json'), JSON.stringify([{ path: '/alternatives', updated: '2026-11-18' }, { path: '/vs/sunsama', updated: '2026-11-17' }, { path: '/templates/personal-strategic-plan', updated: '2026-11-23' }, { path: '/../index', updated: 'x' }]))
fs.mkdirSync(path.join(dist, 'media'))
const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))
fs.writeFileSync(path.join(dist, 'media', 'clip.mp4'), VIDEO)
fs.mkdirSync(path.join(dist, 'media', 'templates'))
fs.writeFileSync(path.join(dist, 'media', 'templates', 'weekly.pdf'), '%PDF-1.4 test')

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
let on, off, tracked, heat, framed

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
  const tag = '<script defer src="/stats/lc.js" data-website-id="abc-123" data-tag="landing"></script>'
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
  assert.ok(visitor.includes('data-tag="landing"></script>\n' + rec + '\n</head>'), 'tracker first, then the recorder')
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

test('one landing page: no variant cookie, old A/B links still show it, none when LANDING is off', async () => {
  for (const p of ['/', '/?lp=a', '/?lp=b']) {
    const r = await get(on, p, { Cookie: 'lc_lp=b' })
    assert.match(r.body.toString(), /<title>LANDING<\/title>/, p)
    assert.equal(r.headers.get('set-cookie'), null, p)
  }
  assert.equal((await get(off, '/landing.html')).status, 404)
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
    for (let i = 0; i < 50 && !body.includes('1.2k'); i++) { body = (await get(base, '/')).body.toString(); await new Promise((r) => setTimeout(r, 20)) }
    assert.ok(body.includes('<b class="stars">1.2k</b>'), body)
    assert.equal(calls, 1, 'fetched once, not per visitor')
  } finally { gh.close() }
  assert.ok((await get(on, '/')).body.toString().includes('<b class="stars"></b>'), 'no repo: an empty count')
})

test('/api/health tells the app about analytics only when it is configured', async () => {
  const h = JSON.parse((await get(tracked, '/api/health')).body)
  assert.deepEqual(h.analytics, { script: '/stats/lc.js', siteId: 'abc-123' })
  assert.equal(JSON.parse((await get(on, '/api/health')).body).analytics, undefined)
})

test('/docs/guide and /docs/self-hosting: served on every server, listed in the sitemap, never cached as the app shell', async () => {
  for (const base of [on, off]) {
    for (const [p, title] of [['/docs/guide', 'GUIDE'], ['/docs/self-hosting', 'SELF-HOSTING']]) {
      const r = await get(base, p)
      assert.equal(r.status, 200, p)
      assert.match(r.body.toString(), new RegExp(`<title>${title}</title>`))
      assert.equal(r.headers.get('x-lc-page'), 'page')
      assert.equal(r.headers.get('x-frame-options'), 'DENY')
    }
  }
  assert.equal((await get(on, '/docs/nope')).status, 404, 'unknown paths show the app but answer 404 (no soft 404)')
  assert.match((await get(on, '/docs/nope')).body.toString(), /APP/)
  assert.equal((await get(on, '/app')).headers.get('x-lc-page'), null, 'the app shell stays cacheable')
  const map = (await get(on, '/sitemap.xml')).body.toString()
  for (const p of ['/docs/guide', '/docs/self-hosting']) assert.ok(map.includes(`<loc>https://lc.test${p}</loc>`), p)
})

test('scripts/docs-pages.mjs: markdown links become site links or GitHub links', async () => {
  const { renderDoc } = await import('../scripts/docs-pages.mjs')
  const html = renderDoc('guide', '# Guide\n\nSee [self-hosting](SELF_HOSTING.md#2-put-it-on-the-internet-https), the [README](../README.md), [compose](../docker-compose.yml) and [Umami](https://umami.is).\n')
  assert.match(html, /<link rel="canonical" href="https:\/\/life-console.dev\/docs\/guide" \/>/)
  assert.match(html, /<h1 id="guide">Guide<\/h1>/)
  assert.ok(html.includes('href="/docs/self-hosting#2-put-it-on-the-internet-https"'))
  assert.ok(html.includes('href="/"'))
  assert.ok(html.includes('href="https://github.com/TJ-coding/life-console/blob/main/docker-compose.yml"'))
  assert.ok(html.includes('href="https://umami.is"'))
})

test('docs pages carry the Umami tag (tag "docs") where analytics is on, and never the recorder', async () => {
  const r = await get(heat, '/docs/guide')
  const html = r.body.toString()
  assert.match(html, /<title>GUIDE<\/title>/)
  assert.ok(html.includes('<script defer src="/stats/lc.js" data-website-id="abc-123" data-tag="docs"></script>'))
  assert.doesNotMatch(html, /recorder/)
  assert.equal(r.headers.get('x-lc-page'), 'page')
  assert.equal(r.headers.get('x-frame-options'), 'DENY')
  assert.doesNotMatch((await get(on, '/docs/guide')).body.toString(), /script/, 'no analytics configured: no tag')
  assert.doesNotMatch((await get(off, '/docs/guide')).body.toString(), /script/, 'LANDING off: no tag')
})

test('edition landing paths: /minimalist is its page for visitors; signed-in people and servers without landing pages go into the app in that edition', async () => {
  const page = await get(tracked, '/minimalist')
  assert.equal(page.status, 200)
  assert.match(page.body.toString(), /MINIMALIST/)
  assert.equal(page.headers.get('x-lc-page'), 'landing')
  assert.match(page.body.toString(), /data-tag="landing-minimalist"/, 'Umami can split the funnel by edition')
  const noFollow = { redirect: 'manual' }
  const signedIn = await fetch(on + '/minimalist', { ...noFollow, headers: { Cookie: 'lc_session=whatever' } })
  assert.equal(signedIn.status, 302)
  assert.equal(signedIn.headers.get('location'), '/app?edition=minimalist')
  const selfHosted = await fetch(off + '/minimalist', noFollow)
  assert.equal(selfHosted.status, 302)
  assert.equal(selfHosted.headers.get('location'), '/app?edition=minimalist')
  assert.equal((await get(off, '/landing-minimalist.html')).status, 404)
  const byName = await fetch(on + '/landing-minimalist.html', noFollow)
  assert.equal(byName.status, 301, 'the edition page by file name: moved to its own address')
  assert.equal(byName.headers.get('location'), '/minimalist')
  assert.match((await get(on, '/sitemap.xml')).body.toString(), /<loc>https:\/\/lc.test\/minimalist<\/loc>/)
})

test('printable templates: PDFs are served as application/pdf, cached like other media', async () => {
  const r = await get(on, '/media/templates/weekly.pdf')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'application/pdf')
  assert.equal(r.headers.get('cache-control'), 'public, max-age=86400')
  assert.equal(r.body.toString(), '%PDF-1.4 test')
})

test('comparison pages: served and listed in the sitemap on the public site only, tagged "compare"', async () => {
  for (const [p, title] of [['/vs/sunsama', 'VS-SUNSAMA'], ['/alternatives', 'HUB'], ['/templates/personal-strategic-plan', 'TEMPLATE']]) {
    const r = await get(on, p)
    assert.equal(r.status, 200, p)
    assert.match(r.body.toString(), new RegExp(`<title>${title}</title>`))
    assert.equal(r.headers.get('x-lc-page'), 'page')
    assert.match((await get(off, p)).body.toString(), /APP/, 'LANDING off: the app, not a marketing page')
  }
  const unknown = await get(on, '/vs/zoom')
  assert.match(unknown.body.toString(), /APP/, 'unknown pages fall back to the app')
  assert.equal(unknown.status, 404, 'but answer 404, not a soft 404')
  assert.equal((await get(on, '/app')).status, 200)
  assert.equal((await get(off, '/vs/zoom')).status, 200, 'a private server: the app, as before')
  const map = (await get(on, '/sitemap.xml')).body.toString()
  assert.ok(map.includes('<url><loc>https://lc.test/vs/sunsama</loc><lastmod>2026-11-17</lastmod>'))
  assert.ok(map.includes('<loc>https://lc.test/alternatives</loc>'))
  assert.ok(map.includes('<loc>https://lc.test/templates/personal-strategic-plan</loc>'))
  assert.ok(!map.includes('index'), 'paths outside /vs/, /alternatives/ and /templates/ are ignored')
  const html = (await get(heat, '/vs/sunsama')).body.toString()
  assert.ok(html.includes('data-tag="compare"></script>'))
  assert.doesNotMatch(html, /recorder/)
})

test('scripts/compare-pages.mjs: front matter is checked, pages link to each other and to the app with ?from=compare', async () => {
  const { parsePage, renderPage, renderHub } = await import('../scripts/compare-pages.mjs')
  const src = (path) => `---\npath: ${path}\ntitle: T <&>\ndescription: D\ncard: Card ${path}\nupdated: 2026-11-18\n---\n# Heading\n\n| a | b |\n|---|---|\n| 1 | 2 |\n`
  const a = parsePage(src('/vs/sunsama')), b = parsePage(src('/alternatives/sunsama'))
  const html = renderPage(a, [b])
  assert.ok(html.includes('<title>T &lt;&amp;&gt;</title>'))
  assert.ok(html.includes('<link rel="canonical" href="https://life-console.dev/vs/sunsama" />'))
  assert.ok(html.includes('<h1 id="heading">Heading</h1>') && html.includes('<table>'))
  assert.ok(html.includes('<td data-label="a">1</td>') && html.includes('<td data-label="b">2</td>'), 'cells carry their column header for phones')
  assert.ok(html.includes('href="/app?from=compare" data-umami-event="open-app" data-umami-event-place="/vs/sunsama"'))
  assert.ok(html.includes('<a href="/alternatives/sunsama">Card /alternatives/sunsama</a>'))
  assert.ok(html.includes('"@type":"SoftwareApplication"'))
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)[1])['@graph']
  assert.equal(ld[0]['@id'], 'https://life-console.dev/#app', 'the same app entity as the landing page')
  assert.equal(ld[1].dateModified, '2026-11-18')
  assert.deepEqual(ld[1].breadcrumb.itemListElement.map((c) => c.name), ['Life Console', 'Comparisons', 'T <&>'])
  const hub = renderHub([a, b])
  assert.ok(hub.includes('href="/vs/sunsama"') && hub.includes('href="/alternatives/sunsama"'))
  assert.throws(() => parsePage(src('/sunsama')), /path must/)
  // templates (/templates/…): allowed paths, no Comparisons crumb, left off the hub
  const t = parsePage(src('/templates/personal-strategic-plan'))
  const tHtml = renderPage(t, [])
  assert.ok(tHtml.includes('<link rel="canonical" href="https://life-console.dev/templates/personal-strategic-plan" />'))
  assert.ok(!tHtml.includes('href="/alternatives">Comparisons</a> /'), 'a template has no Comparisons crumb')
  assert.ok(tHtml.includes('data-umami-event-place="/templates/personal-strategic-plan"'))
  assert.ok(!renderHub([a, b]).includes('/templates/'))
  assert.throws(() => parsePage('---\npath: /vs/x\n---\n'), /needs "title"/)
  assert.throws(() => parsePage('# no front matter'), /no front matter/)
})

test('LANDING=on: duplicate URLs 301 to the canonical one (http://, landing files by name, .html of plain URLs)', async () => {
  // http.request, not fetch: fetch won't send a custom Host header
  const moved = (base, p, headers = {}) => new Promise((resolve, reject) => {
    http.get(base + p, { headers }, (r) => { r.resume(); resolve([r.statusCode, r.headers.location ?? null]) }).on('error', reject)
  })
  assert.deepEqual(await moved(on, '/landing.html'), [301, '/'])
  assert.deepEqual(await moved(on, '/landing-b.html?lp=b'), [301, '/?lp=b'])
  assert.deepEqual(await moved(on, '/privacy.html'), [301, '/privacy'])
  assert.deepEqual(await moved(on, '/docs/guide.html'), [301, '/docs/guide'])
  // a trailing slash on a page's address
  assert.deepEqual(await moved(on, '/vs/sunsama/?x=1'), [301, '/vs/sunsama?x=1'])
  assert.deepEqual(await moved(on, '/privacy/'), [301, '/privacy'])
  assert.deepEqual(await moved(on, '/minimalist/'), [301, '/minimalist'])
  // Cloudflare's CF-Visitor says the visitor came over plain http: send them to the https site
  assert.deepEqual(await moved(on, '/docs/guide?x=1', { Host: 'lc.test', 'CF-Visitor': '{"scheme":"http"}' }), [301, 'https://lc.test/docs/guide?x=1'])
  assert.deepEqual(await moved(on, '/', { Host: 'lc.test', 'CF-Visitor': '{"scheme":"https"}' }), [200, null])
  assert.deepEqual(await moved(on, '/', { 'CF-Visitor': '{"scheme":"http"}' }), [200, null]) // another host (e.g. a private address): no redirect
  // a private server keeps serving its files as before
  assert.match((await get(off, '/docs/guide.html')).body.toString(), /GUIDE/)
})
