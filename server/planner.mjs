// The planner document, one per user, with optimistic concurrency and automatic snapshots.
//
// Safety rails for a live service that ships often:
//   - version check: a write must name the version it was based on (409 otherwise; the client merges);
//   - schema guard: a write with an older `schemaVersion` than the stored one, or an older version of a module
//     namespace both copies have (`moduleVersions`), is refused, so a stale tab or a rolled-back front end can
//     never overwrite data that newer code has upgraded;
//   - snapshots: before a forced overwrite, and at most every REVISION_EVERY_MIN while the planner
//     changes, the previous copy goes to planner_revisions (restore with `npm run admin -- restore`).
import { and, desc, eq, sql, inArray } from 'drizzle-orm'
import { plannerDocs, plannerRevisions } from './db/schema.js'
import { httpError } from './auth.mjs'
import { olderThanStored } from './schema.mjs'

const EMPTY = { version: 0, updatedAt: null, device: null, state: null }
const schemaOf = (state) => Number(state?.schemaVersion) || 1
/** Postgres jsonb can't hold the NUL character; drop it (only \u0000 escapes not preceded by a backslash escape). */
const NUL = /(?<!\\)((?:\\\\)*)\\u0000/g

export function createPlanner(db, cfg) {
  const toDoc = (r) => (r && r.version > 0 ? { version: r.version, updatedAt: r.updatedAt, device: r.device, state: r.state } : { ...EMPTY })

  async function get(userId) {
    const [r] = await db.select().from(plannerDocs).where(eq(plannerDocs.userId, userId)).limit(1)
    return toDoc(r)
  }
  async function version(userId) {
    const [r] = await db.select({ v: plannerDocs.version }).from(plannerDocs).where(eq(plannerDocs.userId, userId)).limit(1)
    return r?.v ?? 0
  }

  function clean(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw httpError(400, 'state must be an object')
    let s = JSON.stringify(state)
    if (Buffer.byteLength(s) > cfg.maxStateBytes) throw httpError(413, `Planner is larger than ${Math.round(cfg.maxStateBytes / 1048576)} MB`)
    if (s.includes('\\u0000')) { s = s.replace(NUL, '$1'); state = JSON.parse(s) }
    return state
  }

  async function snapshot(tx, row, reason) {
    if (!row || row.version === 0) return
    await tx.insert(plannerRevisions).values({ userId: row.userId, version: row.version, schemaVersion: row.schemaVersion, state: row.state, device: row.device, reason })
    // keep the newest N per user
    const old = await tx.select({ id: plannerRevisions.id }).from(plannerRevisions).where(eq(plannerRevisions.userId, row.userId))
      .orderBy(desc(plannerRevisions.id)).offset(cfg.revisionsKeep)
    if (old.length) await tx.delete(plannerRevisions).where(inArray(plannerRevisions.id, old.map((o) => o.id)))
  }

  /**
   * Save a new planner. Returns { ok: true, version, updatedAt } or { ok: false, conflict: doc }.
   * `mutate(state)` (instead of `state`) edits the stored copy in place inside the lock (server-side edits).
   */
  async function save(userId, { state, baseVersion, force = false, device = '', reason = '', mutate }) {
    if (!mutate) state = clean(state)
    return db.transaction(async (tx) => {
      await tx.insert(plannerDocs).values({ userId, version: 0, state: {} }).onConflictDoNothing()
      const [row] = await tx.select().from(plannerDocs).where(eq(plannerDocs.userId, userId)).for('update')
      if (mutate) {
        if (row.version === 0) return { ok: false, notFound: true }
        state = structuredClone(row.state)
        if (mutate(state) === false) return { ok: false, notFound: true }
      } else {
        if (row.version > 0 && olderThanStored(state, { ...row.state, schemaVersion: row.schemaVersion })) return { ok: false, conflict: toDoc(row), outdated: true }
        if (!force && row.version > 0 && baseVersion !== row.version) return { ok: false, conflict: toDoc(row) }
      }
      const now = new Date()
      const forced = force && row.version > 0 && baseVersion !== row.version
      const due = !row.lastRevisionAt || now - row.lastRevisionAt >= cfg.revisionEveryMin * 60000
      const snap = forced || (row.version > 0 && due)
      if (snap) await snapshot(tx, row, forced ? 'force' : reason || 'periodic')
      const [saved] = await tx.update(plannerDocs).set({
        version: row.version + 1, schemaVersion: schemaOf(state), state, device: String(device).slice(0, 60), updatedAt: now,
        ...(snap ? { lastRevisionAt: now } : {}),
      }).where(eq(plannerDocs.userId, userId)).returning({ version: plannerDocs.version, updatedAt: plannerDocs.updatedAt })
      return { ok: true, ...saved }
    })
  }

  async function revisions(userId, limit = 50) {
    return db.select({ id: plannerRevisions.id, version: plannerRevisions.version, schemaVersion: plannerRevisions.schemaVersion, device: plannerRevisions.device, reason: plannerRevisions.reason, createdAt: plannerRevisions.createdAt, bytes: sql`octet_length(${plannerRevisions.state}::text)::int` })
      .from(plannerRevisions).where(eq(plannerRevisions.userId, userId)).orderBy(desc(plannerRevisions.id)).limit(limit)
  }
  async function restore(userId, revisionId) {
    const [rev] = await db.select().from(plannerRevisions).where(and(eq(plannerRevisions.userId, userId), eq(plannerRevisions.id, revisionId))).limit(1)
    if (!rev) throw httpError(404, 'revision not found')
    // a restore may legitimately go back to an older schema; clients migrate it forward on load
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(plannerDocs).where(eq(plannerDocs.userId, userId)).for('update')
      if (row) await snapshot(tx, row, 'before-restore')
      const now = new Date()
      const [saved] = await tx.update(plannerDocs).set({ version: (row?.version ?? 0) + 1, schemaVersion: rev.schemaVersion, state: rev.state, device: 'restore', updatedAt: now, lastRevisionAt: now })
        .where(eq(plannerDocs.userId, userId)).returning({ version: plannerDocs.version })
      return saved
    })
  }

  /** (userId, version) for every user with push devices; the scheduler reloads only changed docs. */
  async function versionsWithDevices() {
    const r = await db.execute(sql`select d.user_id as "userId", d.version from planner_docs d where d.version > 0 and exists (select 1 from push_subscriptions s where s.user_id = d.user_id)`)
    return r.rows
  }

  return { get, version, save, revisions, restore, versionsWithDevices, EMPTY }
}
