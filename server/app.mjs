// HTTP layer: static app + JSON API. Built as a factory so tests can run it against a scratch DB.
import fs from 'node:fs'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { users } from './db/schema.js'
import { COOKIE, parseCookies, createAuth, createLimiter, publicUser, normEmail, verifyPassword, burnPasswordCheck, httpError } from './auth.mjs'
import { createPlanner } from './planner.mjs'
import { createPush } from './push.mjs'
import { createIssues } from './issues.mjs'
import { createScheduler } from './scheduler.mjs'
import { createMailer } from './mail.mjs'
import { createGoogle } from './google.mjs'
import { settingsOf } from './schedule.mjs'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.xml': 'application/xml; charset=utf-8',
}
const LEGAL = new Set(['/privacy', '/terms'])
const LANDING_DATE = '2026-11-07' // sitemap <lastmod> for the landing page: bump when it changes
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
  const mailer = cfg.passwordAuth ? createMailer(cfg, log) : null
  const google = cfg.google ? createGoogle(cfg) : null
  const limit = createLimiter()
  const scheduler = createScheduler({ db, planner, push, tickMs: cfg.tickMs, log })
  const appOrigin = cfg.appUrl ? new URL(cfg.appUrl).origin : null
  const appHost = cfg.appUrl ? new URL(cfg.appUrl).host : null
  /** Secure cookies on the public https address; plain ones on other hosts (e.g. a private-network http URL). */
  const secureFor = (req) => cfg.cookieSecure && (!appHost || req.headers.host === appHost)

  const ip = (req) => (cfg.trustProxy && (req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())) || req.socket.remoteAddress || '?'
  const body = (req, max = 64 * 1024) => readBody(req, max)

  /** Mutating requests from a browser session must be same-origin JSON (CSRF protection on top of SameSite=Lax). */
  function checkCsrf(req) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
    if (req.headers.authorization) return // bearer tokens aren't sent automatically by browsers
    if (req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, 'cross-site request refused')
    // same-origin: the Origin must name the host the request came to (works for every domain the app is served on)
    const origin = req.headers.origin
    if (origin && origin !== 'null') {
      let host = ''
      try { host = new URL(origin).host } catch { /* malformed */ }
      if (host !== req.headers.host && origin !== appOrigin) throw httpError(403, 'origin not allowed')
    }
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw httpError(415, 'send application/json')
  }

  const noPasswords = () => { if (!cfg.passwordAuth) throw httpError(403, 'Password sign-in is turned off on this server — continue with Google') }
  const redirect = (res, location, cookies = []) => { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Set-Cookie': cookies, ...SECURITY_HEADERS }); res.end() }

  async function signedIn(res, user, req, status = 200) {
    const { cookie } = await auth.startSession(user.id, req.headers['user-agent'], secureFor(req))
    return send(res, status, { user: publicUser(user) }, { 'Set-Cookie': cookie })
  }

  /* ── routes that work without an account ── */
  async function publicRoute(req, res, route) {
    switch (route) {
      case 'GET /api/health': {
        let dbOk = true
        try { await db.execute(sql`select 1`) } catch { dbOk = false }
        return send(res, dbOk ? 200 : 503, { ok: dbOk, build: BUILD, time: new Date().toISOString(), auth: { signups: cfg.signups, passwordReset: !!mailer, password: cfg.passwordAuth, google: !!google } })
      }
      case 'GET /api/auth/google/start': {
        if (!google) throw httpError(404, 'Google sign-in is not set up on this server')
        limit(`google:${ip(req)}`, 60, 900000)
        const s = google.start()
        return redirect(res, s.location, [s.cookie])
      }
      case 'GET /api/auth/google/callback': {
        if (!google) throw httpError(404, 'Google sign-in is not set up on this server')
        try {
          const u = await auth.googleSignIn(await google.finish(req, new URL(req.url, 'http://x').searchParams))
          if (u.created) log(`[auth] new account via Google ${u.role === 'admin' ? '(admin) ' : ''}${u.id.slice(0, 8)}`)
          const { cookie } = await auth.startSession(u.id, req.headers['user-agent'], secureFor(req))
          return redirect(res, '/#/', [cookie, google.clearFlow()])
        } catch (e) {
          if (!e.status || e.status >= 500) log('[auth] google sign-in failed:', e.message)
          return redirect(res, `/#/?auth_error=${encodeURIComponent(e.status && e.status < 500 ? e.message : 'Google sign-in failed — try again')}`, [google.clearFlow()])
        }
      }
      case 'POST /api/auth/signup': {
        noPasswords()
        limit(`signup:${ip(req)}`, 10, 3600000)
        if (cfg.signups === 'closed') throw httpError(403, 'Sign-ups are closed on this server')
        const b = await body(req)
        const u = await auth.createUser({ email: b.email, password: b.password, name: b.name })
        log(`[auth] new account ${u.role === 'admin' ? '(admin) ' : ''}${u.id.slice(0, 8)}`)
        return signedIn(res, u, req, 201)
      }
      case 'POST /api/auth/login': {
        noPasswords()
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
        noPasswords()
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
        noPasswords()
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
        return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie(secureFor(req)) })
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
        // accounts with a password confirm with it; Google-only accounts type their email instead
        if (user.passwordHash ? !(await verifyPassword(String(b.password || ''), user.passwordHash)) : normEmail(b.confirm) !== user.email) {
          throw httpError(401, user.passwordHash ? 'Wrong password' : 'Type your email exactly to confirm')
        }
        await db.delete(users).where(eq(users.id, uid))
        log(`[auth] deleted account ${uid.slice(0, 8)}`)
        return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie(secureFor(req)) })
      }
      case 'POST /api/auth/password': {
        noPasswords()
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

  const site = cfg.appUrl || ''
  const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const analyticsTag = cfg.landing && cfg.analyticsScript && cfg.analyticsSiteId
    ? `<script defer src="${attr(cfg.analyticsScript)}" data-website-id="${attr(cfg.analyticsSiteId)}"></script>` : ''
  /** robots.txt: crawlers may index the landing page only where it's on; a private server asks them to stay out. */
  const robots = () => cfg.landing
    ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\n\nSitemap: ${site}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n'
  const sitemap = () => {
    const img = (f, title) => `<image:image><image:loc>${site}/media/${f}</image:loc><image:title>${title}</image:title></image:image>`
    const vid = (f, title, desc, secs) => `<video:video><video:thumbnail_loc>${site}/media/${f}-poster.webp</video:thumbnail_loc><video:title>${title}</video:title><video:description>${desc}</video:description><video:content_loc>${site}/media/${f}.mp4</video:content_loc><video:duration>${secs}</video:duration><video:family_friendly>yes</video:family_friendly></video:video>`
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
<url><loc>${site}/</loc><lastmod>${LANDING_DATE}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority>
${img('today@2x.webp', 'Life Console Command Center: what to do right now')}
${img('week@2x.webp', 'Plan week: backlog, workload buckets and timelines')}
${img('deadlines@2x.webp', 'Deadlines with live countdowns')}
${img('strategy@2x.webp', 'Strategy: goals and milestones')}
${img('plan@2x.webp', 'Strategic plan: vision, goals and milestones')}
${img('todos@2x.webp', 'Todo inbox with quick-add')}
${img('focus@2x.webp', 'Focus mode')}
${img('palette@2x.webp', 'Command palette')}
${img('m-today.webp', 'Life Console on a phone')}
${vid('tour', 'Life Console keyboard tour', 'Every screen of Life Console, driven only by the keyboard.', 16)}
${vid('autobox', 'Auto time-box a week', 'Untimed tasks drop into free gaps by priority with one click.', 7)}
${vid('quickadd', 'Quick-add with the live parser', 'Estimate, priority, due date and goal link parsed as you type.', 8)}
${vid('palette', 'Command palette', 'Jump anywhere or add a task from anywhere with Command K.', 12)}
${vid('mobile', 'Life Console on a phone', 'The installable app on a phone.', 8)}
</url>
<url><loc>${site}/privacy</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>
<url><loc>${site}/terms</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>
</urlset>
`
  }

  function serveStatic(req, res, pathname) {
    let rel
    try { rel = decodeURIComponent(pathname) } catch { return send(res, 400, 'bad path') }
    if (rel === '/robots.txt') return send(res, 200, robots(), { 'Cache-Control': 'public, max-age=3600' })
    if (rel === '/sitemap.xml' || rel === '/llms.txt') {
      if (!cfg.landing) return send(res, 404, 'not found')
      if (rel === '/sitemap.xml') return send(res, 200, sitemap(), { 'Content-Type': MIME['.xml'], 'Cache-Control': 'public, max-age=3600' })
    }
    let vary = false
    if (rel === '/' && cfg.landing) {
      // the landing page for visitors without a session (and crawlers); signed-in people get the app as before
      vary = true
      rel = parseCookies(req.headers.cookie)[COOKIE] ? '/index.html' : '/landing.html'
    } else if (rel === '/landing.html' && !cfg.landing) return send(res, 404, 'not found')
    else if (LEGAL.has(rel)) rel += '.html' // /privacy, /terms: plain URLs for people and Google's consent screen
    else if (rel === '/' || !path.extname(rel)) rel = '/index.html' // SPA fallback (routes use #, but be safe); /app always opens the app
    const file = path.normalize(path.join(dist, rel))
    if (!file.startsWith(dist)) return send(res, 403, 'forbidden')
    if (rel === '/landing.html' && analyticsTag) {
      // analytics configured: the landing page with the tracker tag added (small file, read per request)
      return fs.readFile(file, 'utf8', (err, html) => {
        if (err) return send(res, 404, 'not found')
        const body = html.replace('</head>', `${analyticsTag}\n</head>`)
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(body), Vary: 'Cookie', 'X-LC-Page': 'landing', ...SECURITY_HEADERS })
        res.end(req.method === 'HEAD' ? undefined : body)
      })
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'not found')
      const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable'
        : rel.startsWith('/media/') ? 'public, max-age=86400' : 'no-cache'
      const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache, 'Accept-Ranges': 'bytes', ...SECURITY_HEADERS }
      if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/'
      if (vary) headers.Vary = 'Cookie'
      if (rel === '/landing.html') headers['X-LC-Page'] = 'landing' // the service worker never caches it as the app shell
      // byte ranges: Safari won't play a <video> without them
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
      let start = 0, end = st.size - 1, status = 200
      if (m && (m[1] || m[2])) {
        if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end) } else start = Math.max(0, st.size - Number(m[2]))
        if (start > end || start >= st.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}`, ...SECURITY_HEADERS }); return res.end()
        }
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`
      }
      headers['Content-Length'] = end - start + 1
      res.writeHead(status, headers)
      if (req.method === 'HEAD') return res.end()
      fs.createReadStream(file, { start, end }).pipe(res)
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
