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

/* ── planner document ── */
const EMPTY = { version: 0, updatedAt: null, device: null, state: null }
let doc = store.read('state.json', EMPTY)
function saveDoc(state, device) {
  doc = { version: doc.version + 1, updatedAt: new Date().toISOString(), device, state }
  store.write('state.json', doc)
  return doc
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
  switch (route) {
    case 'GET /api/health':
      return send(res, 200, { ok: true, version: doc.version, time: new Date().toISOString() })

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
