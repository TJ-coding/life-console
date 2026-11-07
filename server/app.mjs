// HTTP layer: static app + JSON API. Built as a factory so tests can run it against a scratch DB.
import fs from 'node:fs'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { users } from './db/schema.js'
import { createAuth, createLimiter, publicUser, normEmail, verifyPassword, burnPasswordCheck, httpError } from './auth.mjs'
import { createPlanner } from './planner.mjs'
import { createPush } from './push.mjs'
import { createIssues } from './issues.mjs'
import { createScheduler } from './scheduler.mjs'
import { createMailer } from './mail.mjs'
import { settingsOf } from './schedule.mjs'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' }

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body)
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers })
  res.end(isJson ? JSON.stringify(body) : body)
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(httpError(413, 'payload too large')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { reject(httpError(400, 'invalid JSON')) }
    })
    req.on('error', reject)
  })
}

export async function createApp({ cfg, db, pool, log = console.log }) {
  const dist = cfg.dist
  let BUILD = 'dev' // the content-hashed entry script names the deployed front-end build
  try { BUILD = (fs.readFileSync(path.join(dist, 'index.html'), 'utf8').match(/assets\/(index-[\w-]+\.js)/) || [])[1] || 'dev' } catch { /* no dist yet */ }

  const auth = createAuth(db, cfg)
  const planner = createPlanner(db, cfg)
  const push = await createPush(db, cfg, log)
  const issues = createIssues(db)
  const mailer = createMailer(cfg, log)
  const limit = createLimiter()
  const scheduler = createScheduler({ db, planner, push, tickMs: cfg.tickMs, log })
  const appOrigin = cfg.appUrl ? new URL(cfg.appUrl).origin : null

  const ip = (req) => (cfg.trustProxy && (req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())) || req.socket.remoteAddress || '?'
  const body = (req, max = 64 * 1024) => readBody(req, max)

  /** Mutating requests from a browser session must be same-origin JSON (CSRF protection on top of SameSite=Lax). */
  function checkCsrf(req) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
    if (req.headers.authorization) return // bearer tokens aren't sent automatically by browsers
    if (req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, 'cross-site request refused')
    const origin = req.headers.origin
    if (origin && appOrigin && origin !== appOrigin) throw httpError(403, 'origin not allowed')
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw httpError(415, 'send application/json')
  }

  async function signedIn(res, user, req, status = 200) {
    const { cookie } = await auth.startSession(user.id, req.headers['user-agent'])
    return send(res, status, { user: publicUser(user) }, { 'Set-Cookie': cookie })
  }

  /* ── routes that work without an account ── */
  async function publicRoute(req, res, route) {
    switch (route) {
      case 'GET /api/health': {
        let dbOk = true
        try { await db.execute(sql`select 1`) } catch { dbOk = false }
        return send(res, dbOk ? 200 : 503, { ok: dbOk, build: BUILD, time: new Date().toISOString(), auth: { signups: cfg.signups, passwordReset: !!mailer } })
      }
      case 'POST /api/auth/signup': {
        limit(`signup:${ip(req)}`, 10, 3600000)
        if (cfg.signups === 'closed') throw httpError(403, 'Sign-ups are closed on this server')
        const b = await body(req)
        const u = await auth.createUser({ email: b.email, password: b.password, name: b.name })
        log(`[auth] new account ${u.role === 'admin' ? '(admin) ' : ''}${u.id.slice(0, 8)}`)
        return signedIn(res, u, req, 201)
      }
      case 'POST /api/auth/login': {
        const b = await body(req)
        const email = normEmail(b.email)
        limit(`login:${ip(req)}`, 30, 900000)
        limit(`login:${email}`, 10, 900000)
        const u = await auth.findUserByEmail(email)
        if (!u) { await burnPasswordCheck(String(b.password || '')); throw httpError(401, 'Wrong email or password') }
        if (!(await verifyPassword(String(b.password || ''), u.passwordHash)) || u.disabled) throw httpError(401, 'Wrong email or password')
        if (cfg.adminEmails.includes(u.email) && u.role !== 'admin') { await db.update(users).set({ role: 'admin' }).where(eq(users.id, u.id)); u.role = 'admin' }
        return signedIn(res, u, req)
      }
      case 'POST /api/auth/forgot': {
        if (!mailer) throw httpError(501, 'Password reset by email is not set up on this server — ask its admin')
        const b = await body(req)
        const email = normEmail(b.email)
        limit(`forgot:${ip(req)}`, 5, 3600000)
        limit(`forgot:${email}`, 3, 3600000)
        const u = await auth.findUserByEmail(email)
        if (u && !u.disabled) {
          const token = await auth.createResetToken(u.id)
          const base = cfg.appUrl || `http://${req.headers.host}`
          mailer.send({ to: u.email, subject: 'Reset your Life Console password', text: `Open this link within an hour to choose a new password:\n\n${base}/#/reset/${token}\n\nIf you didn't ask for this, ignore this email.` })
            .catch((e) => log('[mail] failed', e.message))
        }
        return send(res, 200, { ok: true }) // same answer either way: don't reveal which emails have accounts
      }
      case 'POST /api/auth/reset': {
        limit(`reset:${ip(req)}`, 10, 3600000)
        const b = await body(req)
        const userId = await auth.useResetToken(b.token, b.password)
        const [u] = await db.select().from(users).where(eq(users.id, userId))
        return signedIn(res, u, req)
      }
      case 'POST /api/auth/logout': {
        const b = await body(req)
        const who = await auth.identify(req)
        if (who && b.endpoint) await push.unsubscribe(who.user.id, b.endpoint) // this device stops getting their notifications
        if (who?.tokenHash) await auth.endSession(who.tokenHash)
        return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() })
      }
    }
    return undefined
  }

  /* ── routes for a signed-in user ── */
  async function userRoute(req, res, url, route, who) {
    const user = who.user
    const uid = user.id
    const issueId = url.pathname.match(/^\/api\/issues\/(ISS-\d+)$/)?.[1]
    if (issueId) {
      if (req.method === 'GET') { const i = await issues.one(user, issueId); return i ? send(res, 200, i) : send(res, 404, { error: 'issue not found' }) }
      if (req.method === 'PATCH') { const i = await issues.update(user, issueId, await body(req)); return i ? send(res, 200, i) : send(res, 404, { error: 'issue not found' }) }
      if (req.method === 'DELETE') return (await issues.remove(user, issueId)) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'issue not found' })
    }
    const revRestore = url.pathname.match(/^\/api\/state\/revisions\/(\d+)\/restore$/)?.[1]
    if (revRestore && req.method === 'POST') return send(res, 200, await planner.restore(uid, Number(revRestore)))

    switch (route) {
      case 'GET /api/auth/me':
        return send(res, 200, { user: publicUser(user) })
      case 'PATCH /api/auth/me': {
        const b = await body(req)
        if (typeof b.name === 'string') await db.update(users).set({ name: b.name.trim().slice(0, 80), updatedAt: new Date() }).where(eq(users.id, uid))
        const [u] = await db.select().from(users).where(eq(users.id, uid))
        return send(res, 200, { user: publicUser(u) })
      }
      case 'DELETE /api/auth/me': { // delete the account and everything in it
        const b = await body(req)
        limit(`delete:${uid}`, 5, 3600000)
        if (!(await verifyPassword(String(b.password || ''), user.passwordHash))) throw httpError(401, 'Wrong password')
        await db.delete(users).where(eq(users.id, uid))
        log(`[auth] deleted account ${uid.slice(0, 8)}`)
        return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() })
      }
      case 'POST /api/auth/password': {
        const b = await body(req)
        limit(`password:${uid}`, 10, 3600000)
        if (!(await verifyPassword(String(b.current || ''), user.passwordHash))) throw httpError(401, 'Current password is wrong')
        await auth.setPassword(uid, b.password)
        await auth.endOtherSessions(uid, who.tokenHash) // other devices must sign in again
        return send(res, 200, { ok: true })
      }

      case 'GET /api/state': {
        const since = url.searchParams.get('since')
        if (since !== null && Number(since) === (await planner.version(uid))) return send(res, 200, { changed: false, version: Number(since) })
        return send(res, 200, { changed: true, ...(await planner.get(uid)) })
      }
      case 'PUT /api/state': {
        const b = await body(req, cfg.maxStateBytes + 64 * 1024)
        if (!b.state || typeof b.state !== 'object') return send(res, 400, { error: 'state required' })
        const r = await planner.save(uid, { state: b.state, baseVersion: b.baseVersion, force: !!b.force, device: b.device })
        if (!r.ok) return send(res, 409, { error: r.outdated ? 'outdated' : 'conflict', ...r.conflict })
        return send(res, 200, { version: r.version, updatedAt: r.updatedAt })
      }
      case 'GET /api/state/revisions':
        return send(res, 200, await planner.revisions(uid))

      case 'GET /api/push/key':
        return send(res, 200, { publicKey: push.publicKey })
      case 'GET /api/push/devices':
        return send(res, 200, await push.devices(uid))
      case 'POST /api/push/subscribe': {
        const b = await body(req)
        await push.subscribe(uid, b.subscription, b.label, req.headers['user-agent'])
        return send(res, 200, { ok: true })
      }
      case 'POST /api/push/unsubscribe': {
        const b = await body(req)
        await push.unsubscribe(uid, b.endpoint)
        return send(res, 200, { ok: true })
      }
      case 'POST /api/push/test': {
        const b = await body(req)
        limit(`pushtest:${uid}`, 20, 3600000)
        const doc = await planner.get(uid)
        const payload = { title: 'Life Console · test', body: 'Notifications are working on this device ✓', url: '/#/settings', tag: 'test', vibrate: settingsOf(doc.state)?.notify?.vibrate !== false }
        const n = b.endpoint ? Number(await push.sendTo(uid, b.endpoint, payload)) : await push.sendToUser(uid, payload)
        return send(res, 200, { sent: n })
      }
      case 'POST /api/todo/done': { // the "Mark done" notification action
        const b = await body(req)
        const r = await planner.save(uid, {
          device: 'notification', reason: 'notification',
          mutate: (state) => {
            const t = state?.todos?.find((x) => x.id === b.id)
            if (!t) return false
            t.done = true
            t.updatedAt = new Date().toISOString()
          },
        })
        return r.ok ? send(res, 200, { ok: true, version: r.version }) : send(res, 404, { error: 'todo not found' })
      }

      case 'GET /api/issues':
        return send(res, 200, await issues.list(user, { status: url.searchParams.get('status'), screen: url.searchParams.get('screen'), platform: url.searchParams.get('platform') }))
      case 'POST /api/issues': {
        limit(`issue:${uid}`, 60, 3600000)
        const i = await issues.create(user, await body(req), req.headers['user-agent'])
        log(`[issues] ${i.id} ${i.screen || '-'} ${i.title}`)
        return send(res, 201, i)
      }
    }
    return send(res, 404, { error: 'no such endpoint' })
  }

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`
    checkCsrf(req)
    if ((await publicRoute(req, res, route)) !== undefined || res.writableEnded) return
    const who = await auth.identify(req)
    if (!who) return send(res, 401, { error: 'signed out' })
    return userRoute(req, res, url, route, who)
  }

  function serveStatic(req, res, pathname) {
    let rel
    try { rel = decodeURIComponent(pathname) } catch { return send(res, 400, 'bad path') }
    if (rel === '/' || !path.extname(rel)) rel = '/index.html' // SPA fallback (routes use #, but be safe)
    const file = path.normalize(path.join(dist, rel))
    if (!file.startsWith(dist)) return send(res, 403, 'forbidden')
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'not found')
      const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
      const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache, 'Content-Length': st.size, ...SECURITY_HEADERS }
      if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/'
      res.writeHead(200, headers)
      if (req.method === 'HEAD') return res.end()
      fs.createReadStream(file).pipe(res)
    })
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost')
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url)
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')
      return serveStatic(req, res, url.pathname)
    } catch (err) {
      const status = err.status || 500
      if (status >= 500) log('[http]', req.method, url.pathname, err.stack || err.message)
      if (!res.headersSent) send(res, status, { error: status >= 500 ? 'server error' : err.message }, err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : {})
    }
  }

  // housekeeping: expired sessions and reset tokens
  const sweep = setInterval(() => auth.purgeExpired().catch((e) => log('[auth] purge failed', e.message)), 6 * 3600000)
  sweep.unref()

  return { handler, scheduler, auth, planner, push, issues, build: BUILD, close: () => { clearInterval(sweep); scheduler.stop() } }
}
