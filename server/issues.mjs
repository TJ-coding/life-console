// Issue log (ISS-n): feedback about the app itself, filed with key I on any screen.
// Anyone signed in can report; they see their own reports. Admins see and manage all of them
// (the in-app S-95 list and `npm run issues`).
import { and, asc, eq, inArray } from 'drizzle-orm'
import { issues, users } from './db/schema.js'
import { httpError } from './auth.mjs'

export const ISSUE_KINDS = ['bug', 'ux', 'idea']
export const ISSUE_SEVERITY = ['low', 'medium', 'high']
export const ISSUE_STATUS = ['open', 'in-progress', 'fixed', 'wontfix']
const ISSUE_PLATFORMS = ['mobile', 'web']
const CONTEXT_KEYS = ['device', 'app', 'viewport', 'theme', 'build', 'selectedId', 'userAgent']
export const platformFromUA = (ua = '') => (/iPhone|iPad|iPod|Android|Mobile/i.test(ua) ? 'mobile' : 'web')
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt)
const iso = (d) => (d ? new Date(d).toISOString() : null)
export const issueNo = (id) => Number(/^ISS-(\d+)$/.exec(id || '')?.[1]) || null

export function createIssues(db) {
  const out = (r, admin) => ({
    id: `ISS-${r.i.number}`, title: r.i.title, details: r.i.details, kind: r.i.kind, severity: r.i.severity, status: r.i.status,
    screen: r.i.screen, screenTitle: r.i.screenTitle, route: r.i.route, platform: r.i.platform, context: r.i.context,
    createdAt: iso(r.i.createdAt), updatedAt: iso(r.i.updatedAt), resolution: r.i.resolution, commit: r.i.commit, resolvedAt: iso(r.i.resolvedAt),
    ...(admin ? { reporter: r.email ?? '' } : {}),
  })
  const base = () => db.select({ i: issues, email: users.email }).from(issues).leftJoin(users, eq(users.id, issues.reporterId))
  const isAdmin = (user) => user.role === 'admin'
  const scope = (user) => (isAdmin(user) ? undefined : eq(issues.reporterId, user.id))

  async function list(user, { status, screen, platform } = {}) {
    const w = [scope(user)]
    if (status) w.push(status === 'active' ? inArray(issues.status, ['open', 'in-progress']) : eq(issues.status, status))
    if (screen) w.push(eq(issues.screen, screen))
    if (platform) w.push(eq(issues.platform, platform))
    return (await base().where(and(...w.filter(Boolean))).orderBy(asc(issues.number))).map((r) => out(r, isAdmin(user)))
  }
  async function one(user, id) {
    const n = issueNo(id)
    const [r] = n ? await base().where(and(eq(issues.number, n), scope(user))) : []
    return r ? out(r, isAdmin(user)) : null
  }
  async function create(user, b, reqUA) {
    const title = str(b.title, 200)
    if (!title) throw httpError(400, 'title required')
    const ctx = Object.fromEntries(CONTEXT_KEYS.map((k) => [k, str(b.context?.[k], 300)]).filter(([, v]) => v))
    const created = Date.parse(b.createdAt)
    const [i] = await db.insert(issues).values({
      reporterId: user.id, title, details: str(b.details, 5000),
      kind: pick(b.kind, ISSUE_KINDS, 'bug'), severity: pick(b.severity, ISSUE_SEVERITY, 'medium'),
      screen: str(b.screen, 20), screenTitle: str(b.screenTitle, 80), route: str(b.route, 300),
      platform: pick(b.platform, ISSUE_PLATFORMS, platformFromUA(b.context?.userAgent || reqUA)), context: ctx,
      // queued offline reports keep their original time (but not one from the future)
      createdAt: Number.isFinite(created) && created <= Date.now() ? new Date(created) : new Date(),
    }).returning()
    return out({ i, email: user.email }, isAdmin(user))
  }
  async function update(user, id, b) {
    if (!isAdmin(user)) throw httpError(403, 'Only admins can change issues')
    const n = issueNo(id)
    const [cur] = n ? await db.select().from(issues).where(eq(issues.number, n)) : []
    if (!cur) return null
    const set = { updatedAt: new Date() }
    for (const k of ['title', 'details', 'screen', 'screenTitle', 'route', 'resolution', 'commit']) if (typeof b[k] === 'string') set[k] = str(b[k], k === 'details' || k === 'resolution' ? 5000 : 300)
    if (b.kind) set.kind = pick(b.kind, ISSUE_KINDS, cur.kind)
    if (b.severity) set.severity = pick(b.severity, ISSUE_SEVERITY, cur.severity)
    if (b.status && ISSUE_STATUS.includes(b.status) && b.status !== cur.status) {
      set.status = b.status
      set.resolvedAt = ['fixed', 'wontfix'].includes(b.status) ? new Date() : null
      if (!set.resolvedAt && typeof b.resolution !== 'string') { set.resolution = ''; set.commit = '' } // reopened: the old fix didn't hold
    }
    await db.update(issues).set(set).where(eq(issues.number, n))
    return one(user, id)
  }
  async function remove(user, id) {
    if (!isAdmin(user)) throw httpError(403, 'Only admins can delete issues')
    const n = issueNo(id)
    const r = n ? await db.delete(issues).where(eq(issues.number, n)).returning({ n: issues.number }) : []
    return r.length > 0
  }
  return { list, one, create, update, remove }
}
