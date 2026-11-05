// Life Console server: serves the built app, stores the planner document (sync between
// devices), and sends scheduled Web Push notifications. Single user, no framework.
//
// Env: PORT (80) · DATA_DIR (/data) · DIST (../dist) · VAPID_SUBJECT · PUSH_DRY_RUN=1 · TICK_MS (30000)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore } from './store.mjs'
import { createPush } from './push.mjs'
import { computeEvents } from './schedule.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 80
const DATA_DIR = process.env.DATA_DIR || '/data'
const DIST = process.env.DIST || path.join(here, '..', 'dist')
const TICK_MS = Number(process.env.TICK_MS) || 30000
const log = (...a) => console.log(new Date().toISOString(), ...a)

const store = createStore(DATA_DIR)
const push = createPush(store, {
  subject: process.env.VAPID_SUBJECT || 'https://life-console.tj-coding.uk',
  dryRun: process.env.PUSH_DRY_RUN === '1',
  log,
})

/** Identifies the deployed front-end build: the content-hashed entry script in dist/index.html. */
let BUILD = 'dev'
try { BUILD = (fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').match(/assets\/(index-[\w-]+\.js)/) || [])[1] || 'dev' } catch { /* no dist yet */ }

/* ── planner document ── */
const EMPTY = { version: 0, updatedAt: null, device: null, state: null }
let doc = store.read('state.json', EMPTY)
function saveDoc(state, device) {
  doc = { version: doc.version + 1, updatedAt: new Date().toISOString(), device, state }
  store.write('state.json', doc)
  return doc
}

/* ── issue log: things to fix, reported from inside the app (screen-tagged) ── */
// Kept apart from the planner document: no schema migration, never synced to devices, and agents
// read it with `npm run issues` (scripts/issues.mjs) to pick up work. See CLAUDE.md "Issues".
const ISSUE_KINDS = ['bug', 'ux', 'idea']
const ISSUE_SEVERITY = ['low', 'medium', 'high']
const ISSUE_STATUS = ['open', 'in-progress', 'fixed', 'wontfix']
const ISSUE_PLATFORMS = ['mobile', 'web'] // mobile = phone/tablet (installed app or mobile browser), web = desktop browser
/** Fallback when the client didn't say (tabs still running older code, reports from scripts). */
const platformFromUA = (ua = '') => (/iPhone|iPad|iPod|Android|Mobile/i.test(ua) ? 'mobile' : 'web')
let issues = store.read('issues.json', [])
const saveIssues = () => store.write('issues.json', issues)
if (issues.some((i) => !i.platform)) { // backfill issues filed before `platform` existed
  for (const i of issues) i.platform ||= platformFromUA(i.context?.userAgent)
  saveIssues()
}
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt)
function createIssue(b, reqUA) {
  const title = str(b.title, 200)
  if (!title) throw Object.assign(new Error('title required'), { status: 400 })
  const n = Math.max(0, ...issues.map((i) => Number(i.id.split('-')[1]) || 0)) + 1
  const now = new Date().toISOString()
  const issue = {
    id: `ISS-${n}`,
    title,
    details: str(b.details, 5000),
    kind: pick(b.kind, ISSUE_KINDS, 'bug'),
    severity: pick(b.severity, ISSUE_SEVERITY, 'medium'),
    status: 'open',
    screen: str(b.screen, 20), // spec screen ID, e.g. S-10
    screenTitle: str(b.screenTitle, 80),
    route: str(b.route, 300), // full hash route, e.g. /week?mode=days
    platform: pick(b.platform, ISSUE_PLATFORMS, platformFromUA(b.context?.userAgent || reqUA)),
    context: Object.fromEntries(['device', 'app', 'viewport', 'theme', 'build', 'selectedId', 'userAgent'] // what was on screen when reported
      .map((k) => [k, str(b.context?.[k], 300)]).filter(([, v]) => v)),
    createdAt: str(b.createdAt, 40) || now, // queued offline reports keep their original time
    updatedAt: now,
    resolution: '',
    commit: '',
    resolvedAt: null,
  }
  issues.push(issue)
  saveIssues()
  return issue
}
function updateIssue(id, b) {
  const i = issues.find((x) => x.id === id)
  if (!i) return null
  for (const k of ['title', 'details', 'screen', 'screenTitle', 'route', 'resolution', 'commit']) if (typeof b[k] === 'string') i[k] = str(b[k], k === 'details' || k === 'resolution' ? 5000 : 300)
  if (b.kind) i.kind = pick(b.kind, ISSUE_KINDS, i.kind)
  if (b.severity) i.severity = pick(b.severity, ISSUE_SEVERITY, i.severity)
  if (b.status && ISSUE_STATUS.includes(b.status) && b.status !== i.status) {
    i.status = b.status
    i.resolvedAt = ['fixed', 'wontfix'].includes(b.status) ? new Date().toISOString() : null
    if (!i.resolvedAt && typeof b.resolution !== 'string') { i.resolution = ''; i.commit = '' } // reopened: the old fix didn't hold
  }
  i.updatedAt = new Date().toISOString()
  saveIssues()
  return i
}

/* ── http helpers ── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body)
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(isJson ? JSON.stringify(body) : body)
}
function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname)
  if (rel === '/' || !path.extname(rel)) rel = '/index.html' // SPA fallback (routes use #, but be safe)
  const file = path.normalize(path.join(DIST, rel))
  if (!file.startsWith(DIST)) return send(res, 403, 'forbidden')
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found')
    const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache, 'Content-Length': st.size }
    if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/'
    res.writeHead(200, headers)
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(file).pipe(res)
  })
}

/* ── API ── */
async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`
  const issueId = url.pathname.match(/^\/api\/issues\/(ISS-\d+)$/)?.[1]
  if (issueId && req.method === 'PATCH') {
    const i = updateIssue(issueId, await readBody(req))
    return i ? send(res, 200, i) : send(res, 404, { error: 'issue not found' })
  }
  if (issueId && req.method === 'DELETE') {
    const before = issues.length
    issues = issues.filter((x) => x.id !== issueId)
    if (issues.length === before) return send(res, 404, { error: 'issue not found' })
    saveIssues()
    return send(res, 200, { ok: true })
  }
  if (issueId && req.method === 'GET') {
    const i = issues.find((x) => x.id === issueId)
    return i ? send(res, 200, i) : send(res, 404, { error: 'issue not found' })
  }
  switch (route) {
    case 'GET /api/issues': { // ?status=open|in-progress|fixed|wontfix|active (open + in-progress) · ?screen=S-10 · ?platform=mobile|web
      const st = url.searchParams.get('status')
      const sc = url.searchParams.get('screen')
      const pf = url.searchParams.get('platform')
      return send(res, 200, issues.filter((i) => (!st || (st === 'active' ? ['open', 'in-progress'].includes(i.status) : i.status === st)) && (!sc || i.screen === sc) && (!pf || i.platform === pf)))
    }
    case 'POST /api/issues': {
      const i = createIssue(await readBody(req, 64 * 1024), req.headers['user-agent'])
      log(`[issues] ${i.id} ${i.screen || '-'} ${i.title}`)
      return send(res, 201, i)
    }

    case 'GET /api/health':
      return send(res, 200, { ok: true, version: doc.version, build: BUILD, time: new Date().toISOString() })

    case 'GET /api/state': {
      const since = Number(url.searchParams.get('since'))
      if (url.searchParams.has('since') && since === doc.version) return send(res, 200, { changed: false, version: doc.version })
      return send(res, 200, { changed: true, ...doc })
    }
    case 'PUT /api/state': {
      const b = await readBody(req)
      if (!b.state || typeof b.state !== 'object') return send(res, 400, { error: 'state required' })
      if (!b.force && doc.version > 0 && b.baseVersion !== doc.version) return send(res, 409, { error: 'conflict', ...doc })
      if (b.force && doc.version > 0 && b.baseVersion !== doc.version) store.backup(doc) // keep what we overwrite
      const saved = saveDoc(b.state, String(b.device || '').slice(0, 60))
      return send(res, 200, { version: saved.version, updatedAt: saved.updatedAt })
    }

    case 'GET /api/push/key':
      return send(res, 200, { publicKey: push.publicKey })
    case 'GET /api/push/devices':
      return send(res, 200, push.devices())
    case 'POST /api/push/subscribe': {
      const b = await readBody(req)
      push.subscribe(b.subscription, b.label, req.headers['user-agent'])
      log(`[push] subscribed ${b.label || '(unnamed)'}`)
      return send(res, 200, { ok: true })
    }
    case 'POST /api/push/unsubscribe': {
      const b = await readBody(req)
      push.unsubscribe(b.endpoint)
      return send(res, 200, { ok: true })
    }
    case 'POST /api/push/test': {
      const b = await readBody(req)
      const payload = { title: 'Life Console · test', body: 'Notifications are working on this device ✓', url: '/#/settings', tag: 'test' }
      const n = b.endpoint ? Number(await push.sendTo(b.endpoint, payload)) : await push.sendAll(payload)
      return send(res, 200, { sent: n })
    }

    case 'POST /api/todo/done': { // used by the "Mark done" notification action
      const b = await readBody(req)
      const t = doc.state?.todos?.find((x) => x.id === b.id)
      if (!t) return send(res, 404, { error: 'todo not found' })
      t.done = true
      t.updatedAt = new Date().toISOString()
      saveDoc(doc.state, 'notification')
      return send(res, 200, { ok: true, version: doc.version })
    }
  }
  return send(res, 404, { error: 'no such endpoint' })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url)
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')
    return serveStatic(req, res, url.pathname)
  } catch (err) {
    log('[http]', route(req), err.message)
    if (!res.headersSent) send(res, err.status || 500, { error: err.message })
  }
})
const route = (req) => `${req.method} ${req.url}`

/* ── notification scheduler ── */
const sent = new Map(Object.entries(store.read('sent.json', {}))) // key → epoch ms sent
let lastTick = Date.now() // never back-fill notifications missed while the server was down
async function tick() {
  const now = Date.now()
  const events = computeEvents(doc.state, lastTick, now).filter((e) => !sent.has(e.key))
  lastTick = now
  for (const e of events) {
    sent.set(e.key, now)
    const n = await push.sendAll({ title: e.title, body: e.body, url: e.url, tag: e.tag, data: e.data, actions: e.actions })
    log(`[notify] ${e.key} → ${n} device(s)`)
  }
  if (events.length) {
    for (const [k, t] of sent) if (now - t > 4 * 86400000) sent.delete(k)
    store.write('sent.json', Object.fromEntries(sent))
  }
}
setInterval(() => tick().catch((e) => log('[notify] tick failed', e.message)), TICK_MS)

server.listen(PORT, () => log(`life-console listening on :${PORT} · data ${DATA_DIR} · dist ${DIST}${process.env.PUSH_DRY_RUN === '1' ? ' · PUSH DRY RUN' : ''}`))
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { log(`${sig} — shutting down`); server.close(() => process.exit(0)) })
