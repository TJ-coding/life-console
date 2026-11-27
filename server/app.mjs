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
import { createMetricsReporter } from './metrics.mjs'
import { createUpdates } from './updates.mjs'
import { createMacApp } from './macapp.mjs'
import { createMailer } from './mail.mjs'
import { createGoogle } from './google.mjs'
import { createSignups } from './signups.mjs'
import { createRegistry } from './registry.mjs'
import { createVault } from './vault.mjs'
import { createConsent, TRUST_HEADERS, CLAUDE_TOKEN } from './consent.mjs'
import { createWorkshopLive } from './workshop-live.mjs'
import { createMcp, staticCheck } from './mcp.mjs'
import { createPreviewer } from './previewer.mjs'
import { createPods, podClient } from './pod.mjs'
import { createFederation } from './federation.mjs'
import { settingsOf } from './schedule.mjs'
import { EDITION_LANDINGS } from '../editions/index.js'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf', // printable templates in /media/templates/
}
const LEGAL = new Set(['/privacy', '/terms'])
const DOCS = new Set(['/docs/guide', '/docs/self-hosting']) // built from docs/*.md by scripts/docs-pages.mjs
/** Pages built by scripts/compare-pages.mjs (its PATH_RE): comparisons, templates and the platform pages. */
const PAGE_PATH = /^\/(?:(?:vs|alternatives|templates|blog|plugins)\/[a-z0-9-]+|goals|manifesto|roadmap|whitepaper|plugins)$/
const DOCS_DATE = '2026-11-23' // sitemap <lastmod> for the docs pages: bump when they change
const LANDING_DATE = '2026-11-24' // sitemap <lastmod> for the landing page: bump when it changes
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' }

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body)
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers })
  res.end(isJson ? JSON.stringify(body) : body)
}
/** A raw (form) body as text, up to `limit` bytes. */
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(httpError(413, 'payload too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
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

  // comparison pages (/alternatives, /vs/…, /alternatives/…) and templates (/templates/…): built by scripts/compare-pages.mjs, public site only
  // and the platform pages (/manifesto, /roadmap, /whitepaper, /blog, /plugins…); a draft is served but left out of the sitemap
  let COMPARE = new Map()
  const DRAFTS = new Set()
  try {
    const pages = JSON.parse(fs.readFileSync(path.join(dist, 'compare-pages.json'), 'utf8'))
      .filter((p) => ['/alternatives', '/blog'].includes(p.path) || PAGE_PATH.test(p.path))
    COMPARE = new Map(pages.map((p) => [p.path, p.updated]))
    for (const p of pages) if (p.draft) DRAFTS.add(p.path)
  } catch { /* not built yet */ }

  const signups = createSignups(db, cfg)
  const auth = createAuth(db, cfg, signups)
  if (cfg.signupsUnknown) log(`[config] SIGNUPS=${JSON.stringify(cfg.signupsUnknown)} isn't open or closed: sign-ups are closed (an admin can open them in Settings)`)
  const planner = createPlanner(db, cfg)
  const push = await createPush(db, cfg, log)
  const issues = createIssues(db)
  const registry = createRegistry(db, { log, upstream: cfg.registryUpstream })
  const vault = createVault(db, cfg)
  const siteOf = (req) => cfg.appUrl || `http://${req?.headers?.host ?? 'localhost'}`
  const pods = createPods(db, { log, siteFor: siteOf })
  const fed = createFederation(db, { planner, cfg, log, siteOf, onSharesChanged: (user, req) => mirrorSoon(user, req) })
  /** The account's pod as a Solid client: its own Solid server (token from the vault), or null for the built-in one. */
  async function podFor(user) {
    if (!user.podUrl) return null
    const secret = (await vault.secretFor(user.id, 'pod')) ?? ''
    // Solid-OIDC app credentials are saved as JSON; anything else is a bearer token
    let oidc = null
    try { const j = JSON.parse(secret); if (j?.clientId) oidc = j } catch { /* a plain token */ }
    return podClient(user.podUrl, oidc ? { oidc } : { token: secret })
  }
  // write the planner to the pod after each save, at most every few seconds per account (goal 9)
  const mirrorTimers = new Map()
  function mirrorSoon(user, req) {
    clearTimeout(mirrorTimers.get(user.id))
    mirrorTimers.set(user.id, setTimeout(async () => {
      mirrorTimers.delete(user.id)
      try {
        if (!user.handle && !user.podUrl) return // the built-in pod lives at /pods/<handle>/: no handle, nowhere to put it
        const doc = await planner.get(user.id)
        if (!doc.state) return
        const remote = await podFor(user)
        // who this account shares with moves with it too (whitepaper §13): sharing/shares.json
        const mine = await fed.myShares(user)
        const extra = { 'sharing/shares.json': { shares: mine.map((s) => ({ recordType: s.recordType, recordId: s.recordId, actor: s.actor, access: s.access })) } }
        await pods.mirror(user, doc.state, { base: remote ? remote.base : `${siteOf(req)}/pods/${user.handle}/`, remote, extra })
      } catch (e) { log(`[pod] mirror for ${user.id.slice(0, 8)} failed: ${e.message}`) }
    }, cfg.podMirrorMs ?? 3000))
  }
  const mailer = cfg.passwordAuth ? createMailer(cfg, log) : null
  const google = cfg.google ? createGoogle(cfg) : null
  const limit = createLimiter()
  const metrics = createMetricsReporter({ db, pool, cfg, log })
  const updates = createUpdates({ cfg, log })
  const macApp = createMacApp({ cfg, log })
  const scheduler = createScheduler({ db, planner, push, tickMs: cfg.tickMs, log })
  const appOrigin = cfg.appUrl ? new URL(cfg.appUrl).origin : null
  const appHost = cfg.appUrl ? new URL(cfg.appUrl).host : null
  /** Secure cookies on the public https address; plain ones on other hosts (e.g. a private-network http URL). */
  const secureFor = (req) => cfg.cookieSecure && (!appHost || req.headers.host === appHost)

  const live = createWorkshopLive()
  const consent = createConsent({ db, auth, registry, vault, log, secureFor: (req) => secureFor(req), providers: cfg.oauthProviders ?? {}, appUrl: cfg.appUrl, planner, pods, podClient, siteOf, fed, live, checkDraft: staticCheck })
  const mcp = createMcp({ auth, registry, live, limit, log, build: BUILD, siteOf, planner, onPlannerSaved: (user, req) => mirrorSoon(user, req), previewer: createPreviewer({ url: cfg.previewerUrl, dist: cfg.dist, log }) })
  /** Account actions a plugin could abuse need the trusted page once Public plugins are on (goal 3). */
  const viaTrust = (user, action) => { if (user.publicPlugins) throw Object.assign(httpError(403, 'Confirm this on the trusted page'), { trust: `/trust?do=${action}` }) }

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

  const adminOnly = (user) => { if (user.role !== 'admin') throw httpError(403, 'admins only') }
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
        const signupMode = dbOk ? await signups.publicMode().catch(() => cfg.signups) : cfg.signups
        return send(res, dbOk ? 200 : 503, { ok: dbOk, build: BUILD, time: new Date().toISOString(), auth: { signups: signupMode, passwordReset: !!mailer, password: cfg.passwordAuth, google: !!google }, upstreamIssues: cfg.upstreamIssues && !!cfg.githubRepo, ...(cfg.analyticsScript && cfg.analyticsSiteId ? { analytics: { script: cfg.analyticsScript, siteId: cfg.analyticsSiteId } } : {}) })
      }
      case 'GET /api/mac/latest': // the Mac menu-bar app's update check (server/macapp.mjs)
        limit(`maclatest:${ip(req)}`, 120, 3600000)
        return send(res, 200, await macApp.latest(), { 'Cache-Control': 'public, max-age=600' })
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
        const b = await body(req)
        if (!(await signups.allows(normEmail(b.email)))) throw httpError(403, 'Sign-ups are closed on this server')
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
    // the reporter (or an admin) answers an issue, optionally reopening it: POST /api/issues/ISS-n/reply { text, reopen }
    const replyId = url.pathname.match(/^\/api\/issues\/(ISS-\d+)\/reply$/)?.[1]
    if (replyId && req.method === 'POST') { const i = await issues.reply(user, replyId, await body(req)); return i ? send(res, 200, i) : send(res, 404, { error: 'issue not found' }) }
    const issueId = url.pathname.match(/^\/api\/issues\/(ISS-\d+)$/)?.[1]
    if (issueId) {
      if (req.method === 'GET') { const i = await issues.one(user, issueId); return i ? send(res, 200, i) : send(res, 404, { error: 'issue not found' }) }
      if (req.method === 'PATCH') { const i = await issues.update(user, issueId, await body(req)); return i ? send(res, 200, i) : send(res, 404, { error: 'issue not found' }) }
      if (req.method === 'DELETE') return (await issues.remove(user, issueId)) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'issue not found' })
    }
    const revRestore = url.pathname.match(/^\/api\/state\/revisions\/(\d+)\/restore$/)?.[1]
    if (revRestore && req.method === 'POST') return send(res, 200, await planner.restore(uid, Number(revRestore)))

    const inboxId = url.pathname.match(/^\/api\/federation\/inbox\/(\d+)$/)?.[1]
    if (inboxId && req.method === 'POST') return send(res, 200, await fed.setInbox(user, inboxId, (await body(req)).status))
    const sharedId = url.pathname.match(/^\/api\/federation\/shared\/(\d+)(\/update)?$/)
    if (sharedId && req.method === 'GET' && !sharedId[2]) return send(res, 200, await fed.readShared(user, req, sharedId[1]))
    if (sharedId && req.method === 'POST' && sharedId[2]) return send(res, 200, await fed.editShared(user, req, sharedId[1], (await body(req)).patch ?? {}))
    const regOne = url.pathname.match(/^\/api\/registry\/plugins\/([a-z0-9-]+\/[a-z0-9-]+)$/)?.[1]
    const regLike = url.pathname.match(/^\/api\/registry\/plugins\/([a-z0-9-]+\/[a-z0-9-]+)\/like$/)?.[1]
    if (regLike && (req.method === 'PUT' || req.method === 'DELETE')) return send(res, 200, await registry.like(user, regLike, req.method === 'PUT'))
    if (regOne && req.method === 'GET') { const p = await registry.one(user, regOne); return p ? send(res, 200, p) : send(res, 404, { error: 'no such plugin' }) }
    // the owner edits the listing (title, description, icon, who can see it); anyone who can see it likes it
    if (regOne && req.method === 'PATCH') return send(res, 200, await registry.details(user, regOne, await body(req)))
    // forks and suggestions (pull requests): anyone who forked an extension suggests a version; its author reviews it
    const regSuggest = url.pathname.match(/^\/api\/registry\/plugins\/([a-z0-9-]+\/[a-z0-9-]+)\/suggest$/)?.[1]
    if (regSuggest && req.method === 'POST') return send(res, 201, await registry.propose(user, regSuggest, await body(req)))
    if (req.method === 'GET' && url.pathname === '/api/registry/suggestions') return send(res, 200, await registry.proposals(user))
    const regDecline = url.pathname.match(/^\/api\/registry\/suggestions\/(\d+)\/decline$/)?.[1]
    if (regDecline && req.method === 'POST') return send(res, 200, await registry.decline(user, regDecline))

    switch (route) {
      /* ── the live workshop: an AI app changes the draft over /mcp (server/mcp.mjs), this page shows it ── */
      case 'GET /api/live':
        return live.watch(uid, req, res, SECURITY_HEADERS)
      case 'GET /api/workshop/live':
        return live.subscribe(uid, req, res, SECURITY_HEADERS)
      /* ── live test: the draft runs in this person's console on their real planner (consented on /trust?do=dev-test) ── */
      case 'GET /api/workshop/dev': {
        const dev = live.dev(uid)
        const d = live.draft(uid)
        if (!dev || !d) return send(res, 200, { on: false }, { 'Cache-Control': 'no-store' })
        return send(res, 200, { on: true, pkg: d.editing ?? `${user.handle || 'you'}/${d.slug || 'draft'}`, key: d.key, until: dev.until, undo: !!dev.checkpoint }, { 'Cache-Control': 'no-store' })
      }
      case 'POST /api/workshop/dev/stop': {
        const b = await body(req)
        const was = live.stopDev(uid)
        if (b.undo && was?.checkpoint) { await planner.restore(uid, was.checkpoint); mirrorSoon(user, req) }
        log(`[workshop] live test off for ${uid.slice(0, 8)}${b.undo && was?.checkpoint ? ', planner restored' : ''}`)
        return send(res, 200, { ok: true, restored: !!(b.undo && was?.checkpoint) })
      }
      case 'POST /api/workshop/live/draft': {
        const b = await body(req, 800 * 1024)
        const d = live.setDraft(uid, { code: b.code, slug: b.slug, forkOf: b.forkOf ?? null, editing: b.editing ?? null }, 'you')
        return send(res, 200, { key: d.key })
      }
      case 'POST /api/workshop/live/result': {
        const b = await body(req, 128 * 1024)
        const r = b.result ?? {}
        const list = (x, n = 20) => (Array.isArray(x) ? x.slice(0, n).map((y) => String(y).slice(0, 500)) : [])
        live.report(uid, String(b.key ?? ''), {
          ok: !!r.ok, errors: list(r.errors), problems: list(r.problems), manifest: r.manifest && typeof r.manifest === 'object' ? r.manifest : null,
          parts: Array.isArray(r.parts) ? r.parts.slice(0, 12).map((x) => ({ label: String(x?.label ?? '').slice(0, 80), text: String(x?.text ?? '').slice(0, 800) })) : [],
        })
        return send(res, 200, { ok: true })
      }
      /* ── the plugin platform (docs/PLATFORM.md) ── */
      case 'GET /api/plugins/installed':
        return send(res, 200, { publicPlugins: !!user.publicPlugins, plugins: user.publicPlugins ? await registry.installed(uid) : [] })
      case 'GET /api/registry/plugins':
        return send(res, 200, { plugins: await registry.list(user, url.searchParams.get('q') ?? '') })
      case 'POST /api/registry/handle':
        return send(res, 200, { handle: await registry.setHandle(user, (await body(req)).handle) })
      case 'POST /api/registry/publish': {
        limit(`publish:${uid}`, 30, 3600000)
        return send(res, 201, await registry.publish(user, await body(req, 700 * 1024)))
      }
      case 'POST /api/registry/report': {
        limit(`report:${uid}`, 20, 3600000)
        return send(res, 200, await registry.report(user, await body(req)))
      }
      case 'POST /api/admin/registry/pull': {
        adminOnly(user)
        const b = await body(req)
        return send(res, 200, await registry.pull(b.hash, b.reason ?? ''))
      }
      case 'GET /api/federation/shares':
        return send(res, 200, { address: user.handle ? `@${user.handle}@${new URL(siteOf(req)).host}` : null, movedTo: user.movedTo ?? null, shares: await fed.myShares(user) })
      case 'GET /api/federation/inbox':
        return send(res, 200, { items: await fed.inboxFor(user) })
      case 'GET /api/federation/mailbox':
        return send(res, 200, { messages: await fed.mailbox(user, { since: url.searchParams.get('since') ?? 0 }) })
      case 'POST /api/federation/mailbox/pull':
        return send(res, 200, await fed.pullMailbox(user, await body(req)))
      case 'GET /api/pod':
        return send(res, 200, { own: !!user.podUrl, base: user.podUrl ?? (user.handle ? `${siteOf(req)}/pods/${user.handle}/` : null), needsHandle: !user.podUrl && !user.handle })
      case 'POST /api/pod/mirror': { // write it now (Settings → Your data)
        mirrorSoon(user, req)
        return send(res, 202, { ok: true })
      }
      case 'GET /api/connections':
        return send(res, 200, { on: vault.on, connections: await vault.list(uid), providers: Object.values(cfg.oauthProviders ?? {}).map((p) => ({ name: p.name, title: p.title, site: p.site })) })
      case 'POST /api/connections/request': {
        limit(`conn:${uid}`, 120, 60000)
        return send(res, 200, await vault.request(uid, await body(req, 128 * 1024)))
      }
      case 'GET /api/claude': { // Settings → Claude: is Claude connected, and may it see the planner (changed only on the trusted page)
        const planner = await auth.hasTokenScope(uid, CLAUDE_TOKEN, 'planner')
        return send(res, 200, { connected: planner !== null, planner: !!planner })
      }
      case 'GET /api/auth/me':
        return send(res, 200, { user: publicUser(user) })
      case 'PATCH /api/auth/me': {
        const b = await body(req)
        if (typeof b.name === 'string') await db.update(users).set({ name: b.name.trim().slice(0, 80), updatedAt: new Date() }).where(eq(users.id, uid))
        const [u] = await db.select().from(users).where(eq(users.id, uid))
        return send(res, 200, { user: publicUser(u) })
      }
      case 'DELETE /api/auth/me': { // delete the account and everything in it
        viaTrust(user, 'delete-account')
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
      case 'POST /api/auth/tokens': { // "Connect Mac app" in Settings: an API token for one named device
        if (who.via !== 'session') throw httpError(403, 'Create tokens from a signed-in browser')
        viaTrust(user, 'token')
        const b = await body(req)
        const name = String(b.name || '').trim().slice(0, 60)
        if (!/^[\w .()-]{1,60}$/.test(name)) throw httpError(400, 'name (letters, digits, spaces) required')
        limit(`tokens:${uid}`, 20, 3600000)
        const token = await auth.replaceApiToken(uid, name)
        log(`[auth] api token "${name}" for ${uid.slice(0, 8)}`)
        return send(res, 201, { token, name }, { 'Cache-Control': 'no-store' })
      }
      case 'POST /api/auth/password': {
        noPasswords()
        viaTrust(user, 'password')
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
        mirrorSoon(user, req)
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

      case 'GET /api/admin/signups':
        adminOnly(user)
        return send(res, 200, await signups.status())
      case 'PATCH /api/admin/signups': {
        adminOnly(user)
        const b = await body(req)
        if (!['open', 'closed', null].includes(b.mode)) throw httpError(400, "mode must be 'open', 'closed', or null (back to the SIGNUPS default)")
        const st = await signups.set(b.mode, user.id)
        log(`[admin] sign-ups ${b.mode ?? `back to the default (${cfg.signups})`} by ${uid.slice(0, 8)}`)
        return send(res, 200, st)
      }

      case 'GET /api/admin/update':
        adminOnly(user)
        return send(res, 200, updates.status())
      case 'PATCH /api/admin/update': {
        adminOnly(user)
        const b = await body(req)
        if (typeof b.autoUpdate !== 'boolean') throw httpError(400, 'autoUpdate (true or false) required')
        return send(res, 200, updates.setAutoUpdate(b.autoUpdate))
      }
      case 'POST /api/admin/update/check':
        adminOnly(user)
        limit(`updatecheck:${uid}`, 20, 3600000)
        await updates.check()
        return send(res, 200, updates.status())
      case 'POST /api/admin/update/apply':
        adminOnly(user)
        limit(`updateapply:${uid}`, 10, 3600000)
        return send(res, 202, updates.apply())

      case 'GET /api/issues':
        return send(res, 200, await issues.list(user, { status: url.searchParams.get('status'), screen: url.searchParams.get('screen'), platform: url.searchParams.get('platform') }))
      case 'POST /api/issues/seen': // the "your issue is fixed" note was shown: { ids: ['ISS-3', …] }
        return send(res, 200, { ok: true, n: await issues.seen(user, (await body(req)).ids) })
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
    // the registry for other servers (REGISTRY_UPSTREAM elsewhere): public plugins only, no account
    if (req.method === 'GET' && url.pathname === '/api/registry/public') return send(res, 200, { plugins: await registry.list(null, url.searchParams.get('q') ?? '') })
    const pubVer = req.method === 'GET' && url.pathname.match(/^\/api\/registry\/public\/versions\/([0-9a-f]{64})$/)?.[1]
    if (pubVer) { const v = await registry.publicVersion(pubVer); return v ? send(res, 200, v) : send(res, 404, { error: 'not found' }) }
    // a plugin version's code, for the console to import: public versions for anyone, private ones for their owner
    const codeHash = req.method === 'GET' && url.pathname.match(/^\/api\/registry\/code\/([0-9a-f]{64})\.js$/)?.[1]
    if (codeHash) {
      // never as a service worker: a plugin could otherwise keep running after it's removed
      if (req.headers['service-worker'] === 'script' || req.headers['sec-fetch-dest'] === 'serviceworker') return send(res, 403, 'not a service worker')
      const who = await auth.identify(req)
      const v = await registry.version(who?.user ?? null, codeHash)
      if (!v) return send(res, 404, 'not found')
      return send(res, 200, v.code, { 'Content-Type': MIME['.js'], 'Cache-Control': v.pkg.visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, max-age=31536000, immutable' })
    }
    // the draft under a live test, for this person's console only: while the test is on, the current version only,
    // and only if it passes the checks a published version must pass (server/mcp.mjs staticCheck)
    const devKey = req.method === 'GET' && url.pathname.match(/^\/api\/workshop\/dev\/code\/([\w:-]{1,80})\.js$/)?.[1]
    if (devKey) {
      if (req.headers['service-worker'] === 'script' || req.headers['sec-fetch-dest'] === 'serviceworker') return send(res, 403, 'not a service worker')
      const who = await auth.identify(req)
      if (!who || who.via !== 'session') return send(res, 401, 'signed out')
      const d = live.draft(who.user.id)
      if (!live.dev(who.user.id) || !d || d.key !== devKey) return send(res, 404, 'not under a live test')
      const blocked = staticCheck(d.code).errors
      if (blocked.length) return send(res, 409, `// blocked: ${blocked.join('; ')}`, { 'Content-Type': MIME['.js'] })
      return send(res, 200, d.code, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' })
    }
    checkCsrf(req)
    if ((await publicRoute(req, res, route)) !== undefined || res.writableEnded) return
    const who = await auth.identify(req)
    if (!who) return send(res, 401, { error: 'signed out' })
    return userRoute(req, res, url, route, who)
  }

  const site = cfg.appUrl || ''
  const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  // the landing page may be framed by the Umami dashboard (heatmap background); X-Frame-Options can't name an origin
  const { 'X-Frame-Options': _deny, ...NO_XFO } = SECURITY_HEADERS
  const LANDING_HEADERS = cfg.analyticsDashboard
    ? { ...NO_XFO, 'Content-Security-Policy': `frame-ancestors 'self' ${cfg.analyticsDashboard}` }
    : SECURITY_HEADERS
  // data-tag="landing" sets the landing page apart in Umami (filter: Tag); the A/B test used landing-a / landing-b
  // (an edition's page: landing-<edition>)
  const analyticsTag = (edition) => cfg.landing && cfg.analyticsScript && cfg.analyticsSiteId
    ? `<script defer src="${attr(cfg.analyticsScript)}" data-website-id="${attr(cfg.analyticsSiteId)}" data-tag="landing${edition ? `-${edition}` : ''}"></script>` +
      // heatmap (click positions, scroll depth) and, if switched on in Umami's settings for the website, session replays of this page
      (cfg.analyticsRecorder ? `\n<script defer src="${attr(cfg.analyticsRecorder)}" data-website-id="${attr(cfg.analyticsSiteId)}"></script>` : '')
    : ''
  // the docs pages: page views only (tag "docs"), never the heatmap or replays
  // (the comparison pages the same way, tag "compare")
  const docsTag = (tag = 'docs') => cfg.landing && cfg.analyticsScript && cfg.analyticsSiteId
    ? `<script defer src="${attr(cfg.analyticsScript)}" data-website-id="${attr(cfg.analyticsSiteId)}" data-tag="${tag}"></script>`
    : ''
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
${img('goalflow@2x.webp', 'Goal flow: milestones feeding goals on a timeline')}
${img('todos@2x.webp', 'Todo inbox with quick-add')}
${img('focus@2x.webp', 'Focus mode')}
${img('palette@2x.webp', 'Command palette')}
${img('m-today.webp', 'Life Console on a phone')}
${vid('tour', 'Life Console keyboard tour', 'Every screen of Life Console, driven only by the keyboard.', 16)}
${vid('autobox', 'Auto time-box a week', 'Untimed tasks drop into free gaps by priority with one click.', 7)}
${vid('goalflow', 'Goal flow', 'Click a goal to trace the milestones it depends on.', 13)}
${vid('quickadd', 'Quick-add with the live parser', 'Estimate, priority, due date and goal link parsed as you type.', 8)}
${vid('palette', 'Command palette', 'Jump anywhere or add a task from anywhere with Command K.', 12)}
${vid('mobile', 'Life Console on a phone', 'The installable app on a phone.', 8)}
</url>
${Object.keys(EDITION_LANDINGS).map((p) => `<url><loc>${site}${p}</loc><lastmod>${LANDING_DATE}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`).join('\n')}
<url><loc>${site}/docs/self-hosting</loc><lastmod>${DOCS_DATE}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>
<url><loc>${site}/docs/guide</loc><lastmod>${DOCS_DATE}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>
${[...COMPARE].filter(([p]) => !DRAFTS.has(p)).map(([p, d]) => `<url><loc>${site}${p}</loc><lastmod>${d}</lastmod><changefreq>monthly</changefreq><priority>${p === '/alternatives' ? '0.7' : '0.8'}</priority></url>`).join('\n')}
<url><loc>${site}/privacy</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>
<url><loc>${site}/terms</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>
</urlset>
`
  }

  // the landing page; /landing-b.html is the A/B test's B page (now landing.html), kept only to redirect old links
  // editions' landing pages as paths on the main domain (/minimalist → landing-minimalist.html)
  const EDITION_FILES = Object.fromEntries(Object.values(EDITION_LANDINGS).map((id) => [`/landing-${id}.html`, id]))
  const LANDING_PAGES = new Set(['/landing.html', '/landing-b.html', ...Object.keys(EDITION_FILES)])

  // GitHub star count for the landing pages' Star button: fetched by the server at most hourly, never per visitor
  const stars = { n: null, at: 0 }
  async function refreshStars() {
    if (!cfg.landing || !cfg.githubRepo || Date.now() - stars.at < 3600e3) return
    stars.at = Date.now()
    try {
      const r = await fetch(`${cfg.githubApi}/repos/${cfg.githubRepo}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'life-console' }, signal: AbortSignal.timeout(5000) })
      const n = r.ok ? (await r.json()).stargazers_count : null
      if (Number.isInteger(n)) stars.n = n
    } catch { /* keep the last count; the button shows none until one arrives */ }
  }
  refreshStars()
  const starText = () => stars.n == null ? '' : stars.n >= 1000 ? `${(stars.n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(stars.n)

  /** 301 to the one URL search engines should index (Search Console: "Alternative page with proper canonical tag"). */
  const moved = (res, location) => { res.writeHead(301, { Location: location, 'Cache-Control': 'public, max-age=86400', ...SECURITY_HEADERS }); res.end() }
  /** Cloudflare tells us the visitor's scheme in CF-Visitor (X-Forwarded-Proto is rewritten by Traefik behind the tunnel). */
  const plainHttp = (req) => /"scheme"\s*:\s*"http"/.test(String(req.headers['cf-visitor'] || ''))

  /** A page with its own address on the public site (what the sitemap lists, plus legal pages). */
  const isPage = (p) => LEGAL.has(p) || DOCS.has(p) || COMPARE.has(p) || !!EDITION_LANDINGS[p]

  function serveStatic(req, res, pathname, query = new URLSearchParams()) {
    let rel
    try { rel = decodeURIComponent(pathname) } catch { return send(res, 400, 'bad path') }
    if (cfg.landing) {
      // duplicates of indexed pages: http://, the landing files by name, the .html of the plain URLs
      const search = query.size ? `?${query}` : ''
      if (plainHttp(req) && site.startsWith('https://') && req.headers.host === appHost) return moved(res, site + pathname + search)
      if (EDITION_FILES[rel]) return moved(res, `/${EDITION_FILES[rel]}${search}`)
      if (LANDING_PAGES.has(rel)) return moved(res, `/${search}`)
      // a trailing slash on a page's URL (/vs/sunsama/): the slash-less address is the canonical one
      if (rel.length > 1 && rel.endsWith('/') && isPage(rel.slice(0, -1))) return moved(res, rel.slice(0, -1) + search)
      if (rel.endsWith('.html') && (LEGAL.has(rel.slice(0, -5)) || DOCS.has(rel.slice(0, -5)))) return moved(res, rel.slice(0, -5) + search)
    }
    if (rel === '/robots.txt') return send(res, 200, robots(), { 'Cache-Control': 'public, max-age=3600' })
    if (rel === '/sitemap.xml' || rel === '/llms.txt') {
      if (!cfg.landing) return send(res, 404, 'not found')
      if (rel === '/sitemap.xml') return send(res, 200, sitemap(), { 'Content-Type': MIME['.xml'], 'Cache-Control': 'public, max-age=3600' })
    }
    let vary = false, notFound = false
    const extra = {}
    if (rel === '/' && cfg.landing) {
      // the landing page for visitors without a session (and crawlers); signed-in people get the app as before
      vary = true
      rel = parseCookies(req.headers.cookie)[COOKIE] ? '/index.html' : '/landing.html'
    } else if (EDITION_LANDINGS[rel]) {
      // an edition's page: visitors read about it; people already signed in, and servers without landing pages
      // (self-hosted), go straight into the app in that edition
      const id = EDITION_LANDINGS[rel]
      if (!cfg.landing || parseCookies(req.headers.cookie)[COOKIE]) {
        res.writeHead(302, { Location: `/app?edition=${id}`, 'Cache-Control': 'no-cache', Vary: 'Cookie', ...SECURITY_HEADERS })
        return res.end()
      }
      vary = true
      rel = `/landing-${id}.html`
    } else if (LANDING_PAGES.has(rel) && !cfg.landing) return send(res, 404, 'not found')
    else if (LEGAL.has(rel) || DOCS.has(rel) || (cfg.landing && COMPARE.has(rel))) rel += '.html' // /privacy, /terms, /docs/…: plain URLs for people, search engines and Google's consent screen
    else if (rel === '/' || !path.extname(rel)) {
      // SPA fallback (routes use #, but be safe); /app always opens the app. On the public site any other
      // unknown path still shows the app but answers 404, so search engines don't report a soft 404.
      if (cfg.landing && rel !== '/' && rel !== '/app' && rel !== '/index.html') notFound = true
      rel = '/index.html'
    }
    const file = path.normalize(path.join(dist, rel))
    if (!file.startsWith(dist)) return send(res, 403, 'forbidden')
    const landingPage = LANDING_PAGES.has(rel)
    if (landingPage) {
      // small file, read per request: the GitHub star count filled in, plus the tracker tag when analytics is configured
      refreshStars()
      return fs.readFile(file, 'utf8', (err, html) => {
        if (err) return send(res, 404, 'not found')
        const tag = analyticsTag(EDITION_FILES[rel]) // data-tag landing | landing-<edition>
        let body = html.replaceAll('<!--stars-->', starText())
        if (tag) body = body.replace('</head>', `${tag}\n</head>`)
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(body), Vary: 'Cookie', 'X-LC-Page': 'landing', ...LANDING_HEADERS, ...extra })
        res.end(req.method === 'HEAD' ? undefined : body)
      })
    }
    const pageTag = DOCS.has(rel.slice(0, -5)) ? 'docs' : COMPARE.has(rel.slice(0, -5)) ? (/^\/(goals|manifesto|roadmap|whitepaper|blog|plugins)(\/|$)/.test(rel) ? 'platform' : 'compare') : null
    if (pageTag && docsTag()) {
      return fs.readFile(file, 'utf8', (err, html) => {
        if (err) return send(res, 404, 'not found')
        const body = html.replace('</head>', `${docsTag(pageTag)}\n</head>`)
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(body), 'X-LC-Page': 'page', ...SECURITY_HEADERS })
        res.end(req.method === 'HEAD' ? undefined : body)
      })
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'not found')
      const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable'
        : rel.startsWith('/media/') ? 'public, max-age=86400' : 'no-cache'
      const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache, 'Accept-Ranges': 'bytes', ...(landingPage ? LANDING_HEADERS : SECURITY_HEADERS), ...extra }
      if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/'
      // the workshop's plugin preview (src/preview/main.js): framed only by the console, in a sandbox with a nameless
      // origin, so its module scripts are fetched with CORS (assets allow it) and it may not reach the network at all
      if (rel === '/preview.html') {
        const self = `${req.headers['x-forwarded-proto'] === 'https' || secureFor(req) ? 'https' : 'http'}://${req.headers.host}`
        delete headers['X-Frame-Options']
        headers['Content-Security-Policy'] = `default-src 'none'; script-src ${self} blob:; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: blob:; font-src ${self} https://fonts.gstatic.com; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`
      }
      if (rel.startsWith('/assets/')) headers['Access-Control-Allow-Origin'] = '*'
      if (vary) headers.Vary = 'Cookie'
      if (landingPage) headers['X-LC-Page'] = 'landing' // the service worker never caches it as the app shell
      else if (rel.endsWith('.html') && rel !== '/index.html') headers['X-LC-Page'] = 'page' // /privacy, /terms, /docs/…: not the app shell either
      // byte ranges: Safari won't play a <video> without them
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
      let start = 0, end = st.size - 1, status = notFound ? 404 : 200
      if (m && (m[1] || m[2]) && !notFound) {
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
      if (url.pathname === '/mcp') return await mcp.handle(req, res, { send, readBody })
      // the trusted page (server/consent.mjs): consent, keys and passwords, never inside the console
      // ActivityPub (server/federation.mjs): WebFinger, actors, inboxes and shared records
      if (url.pathname === '/.well-known/webfinger') {
        const j = await fed.webfinger(req, url)
        return j ? send(res, 200, j, { 'Content-Type': 'application/jrd+json', 'Access-Control-Allow-Origin': '*' }) : send(res, 404, { error: 'not found' })
      }
      const apm = url.pathname.match(/^\/u\/([a-z0-9][a-z0-9-]{1,29})(\/inbox|\/outbox|\/r\/([a-z]+)\/([^/]+))?$/)
      if (apm) {
        const AP = { 'Content-Type': 'application/activity+json' }
        if (!apm[2] && req.method === 'GET') { const a = await fed.actor(req, apm[1]); return a ? send(res, 200, a, AP) : send(res, 404, { error: 'not found' }) }
        if (apm[2] === '/outbox' && req.method === 'GET') return send(res, 200, { '@context': 'https://www.w3.org/ns/activitystreams', type: 'OrderedCollection', totalItems: 0, orderedItems: [] }, AP)
        if (apm[2] === '/inbox' && req.method === 'POST') { const out = await fed.inbox(req, apm[1], await readRaw(req, 256 * 1024)); return send(res, out.status, '') }
        if (apm[3] && req.method === 'GET') {
          const signer = await fed.verify(req, undefined)
          const out = await fed.record(req, apm[1], apm[3], decodeURIComponent(apm[4]), signer)
          if (out.status === 301) return send(res, 301, '', { Location: out.location })
          return out.status === 200 ? send(res, 200, out.body, AP) : send(res, out.status, { error: out.status === 403 ? 'not shared with you' : 'not found' })
        }
        return send(res, 405, 'method not allowed')
      }
      // the pod built into this server (server/pod.mjs): a small Solid server, for its owner only
      if (url.pathname.startsWith('/pods/')) {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.headers.authorization && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, { error: 'cross-site writes refused' })
        return await pods.serve(req, res, url, await auth.identify(req), send)
      }
      if (url.pathname === '/trust/oauth' && req.method === 'GET') {
        const out = await consent.oauthCallback(req, url)
        res.writeHead(out.status ?? 200, { ...TRUST_HEADERS, ...(out.headers ?? {}) })
        return res.end(out.html)
      }
      if (url.pathname === '/trust') {
        let out
        if (req.method === 'POST') out = await consent.post(req, res, await readRaw(req, 32 * 1024))
        else if (req.method === 'GET' || req.method === 'HEAD') out = await consent.get(req, res, url)
        else return send(res, 405, 'method not allowed')
        res.writeHead(out.status ?? 200, { ...TRUST_HEADERS, ...(out.headers ?? {}) })
        return res.end(req.method === 'HEAD' ? undefined : out.html)
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')
      // the Mac menu-bar app's latest release (landing page buttons, the Terminal install line)
      if (url.pathname === '/download/mac' || url.pathname === '/download/mac.zip') {
        return redirect(res, await macApp.downloadUrl(url.pathname.endsWith('.zip') ? 'zip' : 'dmg'))
      }
      return serveStatic(req, res, url.pathname, url.searchParams)
    } catch (err) {
      const status = err.status || 500
      if (status >= 500) log('[http]', req.method, url.pathname, err.stack || err.message)
      if (!res.headersSent) send(res, status, { error: status >= 500 ? 'server error' : err.message, ...(err.trust ? { trust: err.trust } : {}) }, err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : {})
    }
  }

  // housekeeping: expired sessions and reset tokens
  const sweep = setInterval(() => auth.purgeExpired().catch((e) => log('[auth] purge failed', e.message)), 6 * 3600000)
  sweep.unref()

  metrics.start()
  updates.start()
  return { handler, scheduler, auth, planner, push, issues, registry, vault, pods, metrics, updates, build: BUILD, close: () => { clearInterval(sweep); live.close(); for (const t of mirrorTimers.values()) clearTimeout(t); scheduler.stop(); metrics.stop(); updates.stop() } }
}
