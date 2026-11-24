// The plugin registry (goal 6, platform/whitepaper.md §7): anyone publishes under their handle, public or private;
// every version is fixed and named by the SHA-256 of its code; automated checks run on every version; people report;
// an admin can pull a version, which disables it in every console that has it. Installs happen only through the
// trusted page (server/consent.mjs), never from an /api call a plugin could make.
//
// The server never runs plugin code. The manifest fields it stores (title, version, sdk, says, replaces) come with
// the upload; the checks compare what the code does with what it says.
import crypto from 'node:crypto'
import { and, eq, desc, inArray, or, sql } from 'drizzle-orm'
import { pluginPackages, pluginVersions, pluginInstalls, pluginReports, users } from './db/schema.js'
import { httpError } from './auth.mjs'

export const MAX_CODE = 512 * 1024
const NAME = /^[a-z0-9][a-z0-9-]{1,29}\/[a-z0-9][a-z0-9-]{1,39}$/
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[a-z0-9.]{1,20})?$/
export const HANDLE = /^[a-z0-9][a-z0-9-]{1,29}$/
const RESERVED_HANDLES = new Set(['life-console', 'lifeconsole', 'core', 'common', 'admin', 'official', 'support', 'me', 'x', 'schema'])
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
/** A version's id: the SHA-256 of its plugin's name and its code, so the same code under two names is two versions. */
export const versionHash = (name, code) => sha256(`${name}\n${code}`)
const clip = (v, n) => String(v ?? '').slice(0, n)

/**
 * The automated checks (whitepaper §7). Static, on the code text: honest about what they can't see.
 * Returns { blocked: [...], warnings: [...], passed: [...] } with { id, msg }. A blocked version isn't published.
 */
export function checkCode(code, says = {}) {
  const blocked = [], warnings = [], passed = []
  const hit = (re) => re.test(code)
  const flag = (list, id, msg) => list.push({ id, msg })
  // no remote code: the content hash must mean "this is what runs"
  if (hit(/\bimport\s*\(\s*['"`]https?:/) || hit(/\bimport\s+[^;]*from\s*['"`]https?:/) || hit(/importScripts\s*\(/)) flag(blocked, 'remote-code', 'loads code from the internet')
  else if (hit(/\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"`]/)) flag(blocked, 'remote-code', 'runs code from text (eval / new Function)')
  else flag(passed, 'remote-code', 'no code loaded from elsewhere')
  // hidden code
  const longest = Math.max(0, ...code.split('\n').map((l) => l.length))
  if (longest > 5000 || hit(/[A-Za-z0-9+/=]{3000,}/) || (code.match(/\\x[0-9a-f]{2}/gi)?.length ?? 0) > 200) flag(warnings, 'hidden-code', 'looks minified or obfuscated: hard to review')
  else flag(passed, 'hidden-code', 'readable code')
  // the data door: plugins read and write through lc.data, never the store or the planner's storage
  if (hit(/life-console\/v1|\/api\/state\b|__vue_app__|localStorage|indexedDB|\/src\/store/)) flag(warnings, 'data-door', 'reaches the planner without lc.data (local storage, /api/state or the app internals)')
  else flag(passed, 'data-door', 'uses only lc.data for planner data')
  // network: every site it talks to should be one it says
  const declared = new Set((says.internet ?? []).map((h) => String(h).toLowerCase()))
  const hosts = [...new Set([...code.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi)].map((m) => m[1].toLowerCase()))]
    .filter((h) => !['www.w3.org', 'schema.org', 'life-console.dev'].includes(h))
  const undeclared = hosts.filter((h) => !declared.has(h))
  const usesNet = hit(/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(|EventSource\s*\(|navigator\.sendBeacon|new\s+Image\s*\(/)
  if (undeclared.length) flag(warnings, 'undeclared-sites', `talks to sites it doesn't mention: ${undeclared.slice(0, 5).join(', ')}`)
  else if (usesNet && !declared.size) flag(warnings, 'undeclared-sites', "uses the network but doesn't say which sites")
  else flag(passed, 'undeclared-sites', declared.size ? `talks only to ${[...declared].join(', ')}` : 'no network use')
  // internals: anything outside the SDK may break on an update
  if (hit(/\/assets\/index-|document\.querySelector\(\s*['"`]\.(sidebar|topbar|cc|wp)\b|window\.__/)) flag(warnings, 'internal-api', 'uses Life Console internals: may break on an update')
  else flag(passed, 'internal-api', 'uses only the SDK')
  if (code.length > 200 * 1024) flag(warnings, 'size', `large: ${Math.round(code.length / 1024)} KB to load`)
  return { blocked, warnings, passed }
}

export function createRegistry(db, { log = () => {}, upstream = '', fetchImpl = fetch } = {}) {
  /* ── the upstream registry (REGISTRY_UPSTREAM, e.g. a self-hosted server installing from life-console.dev) ── */
  const upJson = async (p) => {
    if (!upstream) return null
    try { const r = await fetchImpl(`${upstream}${p}`, { headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : r.status === 404 ? { notFound: true } : null } catch { return null }
  }
  const upStatus = new Map() // hash → { pulled, at }: re-checked at most hourly
  async function upstreamVersion(hash) {
    const j = await upJson(`/api/registry/public/versions/${hash}`)
    return j && !j.notFound ? j : null
  }
  /** Copy an upstream version here (after checking its code really has that hash), so it loads like a local one. */
  async function mirrorUpstream(uid, name, hash) {
    const v = await upstreamVersion(hash)
    if (!v || v.packageName !== name || v.pulled) throw httpError(404, 'no such version')
    const r = await fetchImpl(`${upstream}/api/registry/code/${hash}.js`)
    const code = r.ok ? await r.text() : ''
    if (versionHash(name, code) !== hash) throw httpError(502, "the upstream registry's code doesn't match its hash")
    const checks = checkCode(code, v.manifest?.says ?? {}) // checked again here: never trust another server's results
    if (checks.blocked.length) throw httpError(422, `Not installed: ${checks.blocked.map((c) => c.msg).join('; ')}`)
    await db.insert(pluginPackages).values({ name, ownerId: uid, visibility: 'public', title: clip(v.manifest?.title, 80), description: clip(v.manifest?.description, 400), icon: clip(v.manifest?.icon || 'extension', 40), upstream }).onConflictDoNothing()
    await db.insert(pluginVersions).values({ hash, packageName: name, version: v.version, code, manifest: v.manifest ?? {}, checks, changelog: clip(v.changelog, 4000) }).onConflictDoNothing()
  }

  const pkgOf = (name) => db.select().from(pluginPackages).where(eq(pluginPackages.name, name)).then((r) => r[0] ?? null)
  const canSee = (p, user) => p && (p.visibility === 'public' || (user && p.ownerId === user.id))

  /** Claim a handle (once): the author part of every package name. */
  async function setHandle(user, handle) {
    handle = String(handle ?? '').toLowerCase().trim()
    if (!HANDLE.test(handle) || RESERVED_HANDLES.has(handle)) throw httpError(400, 'A handle is 2-30 lower-case letters, digits or dashes, and some names are reserved')
    if (user.handle && user.handle !== handle) throw httpError(409, `Your handle is already ${user.handle}`)
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle))
    if (taken && taken.id !== user.id) throw httpError(409, 'That handle is taken')
    await db.update(users).set({ handle, updatedAt: new Date() }).where(eq(users.id, user.id))
    return handle
  }

  /** Publish a version. b: { name, version, code, manifest: { title, description, icon, sdk, says, replaces }, visibility, changelog } */
  /** A publisher name for someone who hasn't chosen one: from their email, made unique. They can't change it later. */
  async function autoHandle(user) {
    let base = String(user.email ?? 'me').split('@')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
    if (base.length < 2 || RESERVED_HANDLES.has(base)) base = `user-${base}`.slice(0, 24)
    for (let i = 0; i < 50; i++) {
      const h = i ? `${base}-${i + 1}` : base
      const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.handle, h))
      if (!taken) { await db.update(users).set({ handle: h, updatedAt: new Date() }).where(eq(users.id, user.id)); user.handle = h; return h }
    }
    throw httpError(409, 'Choose a publisher name in Extensions first')
  }

  async function publish(user, b) {
    if (!user.handle) await autoHandle(user)
    // a bare name ("water") is published under your publisher name
    let name = String(b.name ?? '').toLowerCase()
    if (!name.includes('/')) name = `${user.handle}/${name}`
    if (!NAME.test(name)) throw httpError(400, 'An extension name looks like your-handle/extension-name')
    if (name.split('/')[0] !== user.handle) throw httpError(403, `You can only publish under ${user.handle}/`)
    const code = String(b.code ?? '')
    // no version given ("Use it" in the workshop): the same code reuses its version, new code gets the next one
    if (!b.version) {
      const [same] = await db.select().from(pluginVersions).where(and(eq(pluginVersions.packageName, name), eq(pluginVersions.hash, versionHash(name, code))))
      if (same) return { name, version: same.version, hash: same.hash, visibility: (await pkgOf(name))?.visibility ?? 'private', checks: same.checks, reused: true }
      const vs = await db.select({ v: pluginVersions.version }).from(pluginVersions).where(eq(pluginVersions.packageName, name))
      const top = vs.map((x) => x.v.split('-')[0].split('.').map(Number)).sort((a, c) => c[0] - a[0] || c[1] - a[1] || c[2] - a[2])[0]
      b = { ...b, version: top ? `${top[0]}.${top[1]}.${top[2] + 1}` : '0.1.0' }
    }
    if (!VERSION.test(String(b.version ?? ''))) throw httpError(400, 'version must look like 1.0.0')
    if (!code.trim()) throw httpError(400, 'code is empty')
    if (Buffer.byteLength(code) > MAX_CODE) throw httpError(413, `An extension is at most ${MAX_CODE / 1024} KB`)
    if (!/export\s+default\b/.test(code)) throw httpError(400, 'The extension file needs `export default { … }` (its manifest)')
    const m = b.manifest && typeof b.manifest === 'object' ? b.manifest : {}
    const manifest = {
      title: clip(m.title || name.split('/')[1], 80), description: clip(m.description, 400), icon: clip(m.icon || 'extension', 40), sdk: m.sdk ?? 1,
      says: { internet: (m.says?.internet ?? []).slice(0, 20).map((h) => clip(h, 100).toLowerCase()), connections: (m.says?.connections ?? []).slice(0, 10).map((c) => clip(c, 40)), replaces: (m.replaces ?? m.says?.replaces ?? []).slice(0, 10).map((r) => clip(r, 40)) },
    }
    const checks = checkCode(code, manifest.says)
    if (checks.blocked.length) throw httpError(422, `Not published: ${checks.blocked.map((c) => c.msg).join('; ')}`)
    const hash = versionHash(name, code)
    const visibility = b.visibility === 'public' ? 'public' : 'private'
    const existing = await pkgOf(name)
    if (existing?.upstream) throw httpError(403, `${name} comes from ${existing.upstream}: publish it there`)
    if (existing && existing.ownerId !== user.id) throw httpError(403, 'That extension belongs to someone else')
    const [dupe] = await db.select({ hash: pluginVersions.hash }).from(pluginVersions).where(and(eq(pluginVersions.packageName, name), eq(pluginVersions.version, b.version)))
    if (dupe) throw httpError(409, `Version ${b.version} is already published: versions are fixed, publish a new one`)
    await db.transaction(async (tx) => {
      if (existing) await tx.update(pluginPackages).set({ visibility, title: manifest.title, description: manifest.description, icon: manifest.icon, updatedAt: new Date() }).where(eq(pluginPackages.name, name))
      else await tx.insert(pluginPackages).values({ name, ownerId: user.id, visibility, title: manifest.title, description: manifest.description, icon: manifest.icon })
      await tx.insert(pluginVersions).values({ hash, packageName: name, version: b.version, code, manifest, checks, changelog: clip(b.changelog, 4000) }).onConflictDoNothing()
    })
    log(`[registry] ${user.handle} published ${name}@${b.version} (${visibility}) ${hash.slice(0, 12)}`)
    return { name, version: b.version, hash, visibility, checks }
  }

  async function latestVersions(names) {
    if (!names.length) return {}
    const rows = await db.select({ packageName: pluginVersions.packageName, hash: pluginVersions.hash, version: pluginVersions.version, manifest: pluginVersions.manifest, checks: pluginVersions.checks, changelog: pluginVersions.changelog, createdAt: pluginVersions.createdAt })
      .from(pluginVersions).where(and(inArray(pluginVersions.packageName, names), eq(pluginVersions.pulled, false))).orderBy(desc(pluginVersions.createdAt))
    const out = {}
    for (const r of rows) if (!out[r.packageName]) out[r.packageName] = r
    return out
  }
  const card = (p, v, reports = 0) => ({ name: p.name, title: p.title, description: p.description, icon: p.icon, visibility: p.visibility, downloads: p.downloads, reports,
    latest: v ? { version: v.version, hash: v.hash, sdk: v.manifest.sdk, says: v.manifest.says, checks: { warnings: v.checks.warnings, passed: v.checks.passed }, changelog: v.changelog, publishedAt: v.createdAt } : null,
    worksWithEverything: !!v && !v.checks.warnings.some((w) => ['data-door', 'internal-api'].includes(w.id)) })

  /** Public plugins (and your own private ones), newest first; q filters by name or title. */
  async function list(user, q = '') {
    const where = user ? or(eq(pluginPackages.visibility, 'public'), eq(pluginPackages.ownerId, user.id)) : eq(pluginPackages.visibility, 'public')
    let pkgs = await db.select().from(pluginPackages).where(where).orderBy(desc(pluginPackages.updatedAt)).limit(200)
    const needle = String(q).toLowerCase().trim()
    if (needle) pkgs = pkgs.filter((p) => p.name.includes(needle) || p.title.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle))
    const latest = await latestVersions(pkgs.map((p) => p.name))
    const counts = await reportCounts(pkgs.map((p) => p.name))
    const local = pkgs.filter((p) => latest[p.name] && !p.upstream).map((p) => card(p, latest[p.name], counts[p.name] ?? 0))
    if (!user || !upstream) return local
    // public plugins from the upstream registry, after this server's own (installing copies the exact version here)
    const up = await upJson(`/api/registry/public?q=${encodeURIComponent(q)}`)
    const names = new Set(local.map((p) => p.name))
    return [...local, ...(up?.plugins ?? []).filter((p) => !names.has(p.name)).map((p) => ({ ...p, source: upstream }))]
  }
  /** For other servers: public plugins only, no account needed. */
  async function publicVersion(hash) {
    const [v] = await db.select().from(pluginVersions).where(eq(pluginVersions.hash, String(hash)))
    const p = v && (await pkgOf(v.packageName))
    if (!v || p?.visibility !== 'public' || p.upstream) return null
    return { packageName: v.packageName, version: v.version, manifest: v.manifest, checks: v.checks, changelog: v.changelog, pulled: v.pulled, pulledReason: v.pulledReason }
  }
  async function reportCounts(names) {
    if (!names.length) return {}
    const rows = await db.select({ name: pluginReports.packageName, n: sql`count(*)::int` }).from(pluginReports).where(inArray(pluginReports.packageName, names)).groupBy(pluginReports.packageName)
    return Object.fromEntries(rows.map((r) => [r.name, r.n]))
  }

  /** One plugin with its versions (no code). */
  async function one(user, name) {
    const p = await pkgOf(name)
    if (!canSee(p, user)) return null
    const versions = await db.select({ hash: pluginVersions.hash, version: pluginVersions.version, manifest: pluginVersions.manifest, checks: pluginVersions.checks, changelog: pluginVersions.changelog, pulled: pluginVersions.pulled, pulledReason: pluginVersions.pulledReason, createdAt: pluginVersions.createdAt })
      .from(pluginVersions).where(eq(pluginVersions.packageName, name)).orderBy(desc(pluginVersions.createdAt))
    const latest = versions.find((v) => !v.pulled) ?? null
    return { ...card(p, latest, (await reportCounts([name]))[name] ?? 0), versions }
  }

  /** A version, if this person may see it: public and not pulled, or their own. */
  async function version(user, hash) {
    const [v] = await db.select().from(pluginVersions).where(eq(pluginVersions.hash, String(hash)))
    if (!v) {
      // not here: an upstream version can be shown on the trusted page before it's copied
      const u = user && (await upstreamVersion(hash))
      return u && !u.pulled ? { ...u, hash, code: null, pkg: { name: u.packageName, visibility: 'public', upstream } } : null
    }
    const p = await pkgOf(v.packageName)
    if (!canSee(p, user)) return null
    if (v.pulled && p.ownerId !== user?.id) return null
    return { ...v, pkg: p }
  }

  async function report(user, b) {
    const p = await pkgOf(String(b.name ?? ''))
    if (!canSee(p, user)) throw httpError(404, 'no such extension')
    const reason = clip(b.reason, 2000).trim()
    if (!reason) throw httpError(400, 'Say what is wrong')
    await db.insert(pluginReports).values({ packageName: p.name, hash: clip(b.hash, 64), reporterId: user.id, reason })
    log(`[registry] report on ${p.name}: ${reason.slice(0, 80)}`)
    return { ok: true }
  }

  /** Pull a version (admin): it stops loading in every console; installs fall back to the newest version still up. */
  async function pull(hash, reason) {
    const [v] = await db.update(pluginVersions).set({ pulled: true, pulledReason: clip(reason, 400) }).where(eq(pluginVersions.hash, String(hash))).returning()
    if (!v) throw httpError(404, 'no such version')
    log(`[registry] pulled ${v.packageName}@${v.version}: ${reason}`)
    return { ok: true, name: v.packageName, version: v.version }
  }

  /* ── installs (called only from the trusted page) ── */
  async function install(uid, name, hash) {
    const [local] = await db.select({ h: pluginVersions.hash }).from(pluginVersions).where(eq(pluginVersions.hash, String(hash)))
    if (!local && upstream) await mirrorUpstream(uid, name, hash)
    const v = await version({ id: uid }, hash)
    if (!v || v.packageName !== name || v.pulled) throw httpError(404, 'no such version')
    await db.insert(pluginInstalls).values({ userId: uid, packageName: name, hash, enabled: true })
      .onConflictDoUpdate({ target: [pluginInstalls.userId, pluginInstalls.packageName], set: { hash, enabled: true } })
    await db.update(pluginPackages).set({ downloads: sql`${pluginPackages.downloads} + 1` }).where(eq(pluginPackages.name, name))
    return { name, hash, version: v.version }
  }
  async function uninstall(uid, name) { await db.delete(pluginInstalls).where(and(eq(pluginInstalls.userId, uid), eq(pluginInstalls.packageName, name))) }
  async function setEnabled(uid, name, enabled) { await db.update(pluginInstalls).set({ enabled: !!enabled }).where(and(eq(pluginInstalls.userId, uid), eq(pluginInstalls.packageName, name))) }
  async function disableAll(uid) { await db.update(pluginInstalls).set({ enabled: false }).where(eq(pluginInstalls.userId, uid)) }

  /** What this account has installed, with update notes. A pulled version doesn't load. */
  async function installed(uid) {
    const rows = await db.select().from(pluginInstalls).where(eq(pluginInstalls.userId, uid))
    if (!rows.length) return []
    // a version pulled upstream is pulled here too (checked at most hourly per version)
    if (upstream) {
      const ups = await db.select({ name: pluginPackages.name }).from(pluginPackages).where(and(inArray(pluginPackages.name, rows.map((r) => r.packageName)), sql`${pluginPackages.upstream} is not null`))
      for (const r of rows.filter((x) => ups.some((u) => u.name === x.packageName))) {
        const c = upStatus.get(r.hash)
        if (c && Date.now() - c.at < 3600000) continue
        const u = await upJson(`/api/registry/public/versions/${r.hash}`)
        const pulled = !!u && (u.notFound || u.pulled)
        upStatus.set(r.hash, { pulled, at: Date.now() })
        if (pulled) await db.update(pluginVersions).set({ pulled: true, pulledReason: u.pulledReason || 'pulled from the upstream registry' }).where(eq(pluginVersions.hash, r.hash))
      }
    }
    const vers = await db.select({ hash: pluginVersions.hash, version: pluginVersions.version, pulled: pluginVersions.pulled, pulledReason: pluginVersions.pulledReason, manifest: pluginVersions.manifest, packageName: pluginVersions.packageName })
      .from(pluginVersions).where(inArray(pluginVersions.hash, rows.map((r) => r.hash)))
    const byHash = Object.fromEntries(vers.map((v) => [v.hash, v]))
    const latest = await latestVersions(rows.map((r) => r.packageName))
    const pkgs = await db.select().from(pluginPackages).where(inArray(pluginPackages.name, rows.map((r) => r.packageName)))
    const pkgBy = Object.fromEntries(pkgs.map((p) => [p.name, p]))
    return rows.map((r) => {
      const v = byHash[r.hash]
      const l = latest[r.packageName]
      return {
        pkg: r.packageName, hash: r.hash, version: v?.version ?? '?', title: pkgBy[r.packageName]?.title ?? r.packageName, icon: pkgBy[r.packageName]?.icon ?? 'extension',
        enabled: r.enabled && !!v && !v.pulled, pulled: !!v?.pulled, pulledReason: v?.pulledReason ?? '', says: v?.manifest?.says ?? {},
        update: l && l.hash !== r.hash ? { version: l.version, hash: l.hash, changelog: l.changelog } : null,
      }
    })
  }

  return { setHandle, publish, list, one, version, publicVersion, report, pull, install, uninstall, setEnabled, disableAll, installed }
}
