// The live workshop: one room per account, in memory. The workshop page listens (server-sent events) and sends its
// draft and preview results; the AI connection (server/mcp.mjs) changes drafts and waits for the preview.
// A room holds several drafts, one per extension name (slug), so two AI sessions (or the person and an AI) working
// on different extensions never overwrite each other; `current` is the one the workshop page shows. The drafts are
// also saved in the database (workshop_drafts, one row per account) with the live test and which draft each MCP
// session works on, so a restart or a deploy loses none of them; call ensure(uid) before reading a room. Preview
// results are only in memory.
import { eq } from 'drizzle-orm'
import { draftKey } from '../src/sdk/live.js'
import { ENTRY, filesOf, canonical } from '../src/sdk/files.js'
import { workshopDrafts } from './db/schema.js'

const MAX_CODE = 700 * 1024
export const MAX_DRAFTS = 12
const MAX_SESSIONS = 40 // MCP sessions remembered per account (which draft each works on)
/** A draft's name: lowercase a-z 0-9 -, or 'draft'. */
export const slugName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

/** A saved draft (database row or old single-draft row) back to its in-memory form. */
function revive(d) {
  const files = filesOf(d.files ?? d.code)
  return { ...d, slug: slugName(d.slug) || 'draft', files, code: files[ENTRY] ?? '', key: draftKey(canonical(files)) }
}
const stored = (d) => ({ files: d.files, slug: d.slug, forkOf: d.forkOf, editing: d.editing, from: d.from, at: d.at, seen: d.seen })

export function createWorkshopLive({ db = null, log = () => {} } = {}) {
  const rooms = new Map()
  const room = (uid) => {
    let r = rooms.get(uid)
    if (!r) {
      r = { drafts: new Map(), current: null, sessions: new Map(), results: new Map(), clients: new Set(), watchers: new Set(), waiters: new Set(), aiAt: 0, loaded: !db }
      // the draft the workshop shows (most code only needs that one)
      Object.defineProperty(r, 'draft', { get() { return (this.current && this.drafts.get(this.current)) || null } })
      rooms.set(uid, r)
    }
    return r
  }
  /** Load this account's saved drafts into its room (once per server start). */
  async function ensure(uid) {
    const r = room(uid)
    if (r.loaded) return r
    r.loading ??= db.select().from(workshopDrafts).where(eq(workshopDrafts.userId, uid)).then(([row]) => {
      const saved = row?.draft
      if (saved && !r.drafts.size) {
        // v2: { current, drafts: { slug: draft } }; before: the one draft itself
        const list = saved.drafts ? Object.values(saved.drafts) : [saved]
        for (const d of list) { const x = revive(d); r.drafts.set(x.slug, x) }
        r.current = slugName(saved.current) || [...r.drafts.keys()][0] || null
        if (!r.drafts.has(r.current)) r.current = [...r.drafts.keys()][0] ?? null
        for (const [sid, v] of Object.entries(saved.sessions ?? {})) if (v?.slug) r.sessions.set(sid, { slug: slugName(v.slug), at: Number(v.at) || 0 })
        // a live test carries on through a restart, until the end the person agreed to (never longer)
        const dev = saved.dev
        if (dev && Number(dev.until) > Date.now()) r.dev = { since: Number(dev.since) || Date.now(), until: Number(dev.until), checkpoint: dev.checkpoint ?? null, slugs: (dev.slugs ?? []).map(slugName).filter((x) => r.drafts.has(x)) }
        if (r.dev && !r.dev.slugs.length) r.dev = null
      }
      r.loaded = true
    }).catch((e) => { log(`[workshop] loading drafts failed: ${e.message}`); r.loaded = true })
    await r.loading
    return r
  }
  /** Save the room's drafts (in the background: a failed save only means they won't survive a restart). The current
   *  draft's fields also sit at the top level, where a previous release reads its one draft during a rollback. */
  function persist(uid) {
    if (!db) return
    const r = room(uid)
    const dev = devOf(r)
    const draft = {
      ...(r.draft ? stored(r.draft) : {}), v: 2, current: r.current, drafts: Object.fromEntries([...r.drafts].map(([k, d]) => [k, stored(d)])),
      sessions: Object.fromEntries(r.sessions), dev: dev ? { since: dev.since, until: dev.until, checkpoint: dev.checkpoint, slugs: dev.slugs } : null,
    }
    db.insert(workshopDrafts).values({ userId: uid, draft, updatedAt: new Date() })
      .onConflictDoUpdate({ target: workshopDrafts.userId, set: { draft, updatedAt: new Date() } })
      .catch((e) => log(`[workshop] saving drafts failed: ${e.message}`))
  }
  const write = (res, msg) => { try { res.write(`data: ${JSON.stringify(msg)}\n\n`) } catch { /* gone */ } }
  const broadcast = (uid, msg) => { for (const res of room(uid).clients) write(res, msg) }
  const wake = (r) => { for (const w of [...r.waiters]) w.check() }
  /** The live test, if it's on and hasn't run out (it's never stored: a restart ends it). */
  const devOf = (r) => { if (r.dev && r.dev.until <= Date.now()) r.dev = null; return r.dev }
  const inDev = (r, slug) => !!devOf(r)?.slugs.includes(slug)
  /** The drafts, newest first: what the workshop's switcher and the AI's tools list. */
  const listOf = (r) => [...r.drafts.values()].sort((a, b) => b.at - a.at).map((d) => ({ slug: d.slug, at: d.at, from: d.from, editing: d.editing ?? null, forkOf: d.forkOf ?? null }))

  /** The workshop page listens: GET /api/workshop/live. */
  function subscribe(uid, req, res, headers = {}) {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    const r = room(uid)
    r.clients.add(res)
    // a draft the AI wrote while no workshop was open loads when one opens
    write(res, { type: 'hello', draft: r.draft?.from === 'ai' && !r.draft.seen ? r.draft : null, current: r.current, drafts: listOf(r), aiAt: r.aiAt })
    const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* gone */ } }, 25000)
    req.on('close', () => { clearInterval(ping); r.clients.delete(res); wake(r) })
  }

  /** Any page of the console listens too (GET /api/live): Claude's requests to confirm, and what it changed. */
  function watch(uid, req, res, headers = {}) {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    const r = room(uid)
    r.watchers.add(res)
    write(res, { type: 'hello' })
    const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* gone */ } }, 25000)
    req.on('close', () => { clearInterval(ping); r.watchers.delete(res) })
  }

  /** Keep at most MAX_DRAFTS: the oldest go, never the one shown or the one under a live test. */
  function trim(r) {
    const keep = new Set([r.current, ...(devOf(r)?.slugs ?? [])].filter(Boolean))
    for (const d of [...r.drafts.values()].sort((a, b) => a.at - b.at)) {
      if (r.drafts.size <= MAX_DRAFTS) break
      if (!keep.has(d.slug)) r.drafts.delete(d.slug)
    }
  }

  /**
   * A new version of one draft, from the workshop page ('you') or the AI ('ai', sent on to the page): `files` or one
   * `code`, for the draft named `slug` (default: the current one). `was`: the page renamed its draft from this name.
   * The draft written becomes the current one.
   */
  function setDraft(uid, d, from) {
    const files = filesOf(d.files && typeof d.files === 'object' ? d.files : String(d.code ?? ''))
    if (canonical(files).length > MAX_CODE) throw Object.assign(new Error('the extension is too big (700 KB at most)'), { status: 413 })
    const r = room(uid)
    const slug = slugName(d.slug) || r.current || 'draft'
    const was = slugName(d.was)
    const prev = r.drafts.get(slug) ?? (was && was !== slug ? r.drafts.get(was) : null) ?? null
    const draft = {
      files, code: files[ENTRY] ?? '', key: draftKey(canonical(files)), from, at: Date.now(), seen: from !== 'ai', slug,
      forkOf: d.forkOf === undefined ? prev?.forkOf ?? null : d.forkOf || null,
      editing: d.editing === undefined ? prev?.editing ?? null : d.editing || null,
    }
    if (from === 'you' && was && was !== slug && r.drafts.has(was) && !inDev(r, was)) r.drafts.delete(was) // renamed in the workshop
    r.drafts.set(slug, draft)
    r.current = slug
    trim(r)
    persist(uid)
    if (from === 'ai') { r.aiAt = draft.at; broadcast(uid, { type: 'draft', draft, drafts: listOf(r) }) }
    else broadcast(uid, { type: 'drafts', current: r.current, drafts: listOf(r) })
    // a live test is on for this draft: every console page loads the new version
    if (inDev(r, slug)) for (const res of r.watchers) write(res, { type: 'dev', key: draft.key })
    wake(r)
    return draft
  }

  /** The workshop page switches to another draft: it becomes the current one. */
  function select(uid, slug) {
    const r = room(uid)
    const d = r.drafts.get(slugName(slug))
    if (!d) return null
    r.current = d.slug
    persist(uid)
    return d
  }
  /** Throw a draft away (not the one under a live test). The newest other one becomes current. */
  function discard(uid, slug) {
    const r = room(uid)
    const s = slugName(slug)
    if (!r.drafts.has(s) || inDev(r, s)) return false
    r.drafts.delete(s)
    if (r.current === s) r.current = listOf(r)[0]?.slug ?? null
    persist(uid)
    broadcast(uid, { type: 'drafts', current: r.current, drafts: listOf(r) })
    return true
  }

  /** The workshop's preview ran a draft: POST /api/workshop/live/result. `byServer`: the server's previewer ran it
   *  (server/previewer.mjs), so no workshop page has shown it yet: it still loads when one opens. */
  function report(uid, key, result, { byServer = false } = {}) {
    const r = room(uid)
    r.results.set(String(key), { ...result, at: Date.now() })
    if (r.results.size > 40) r.results.delete(r.results.keys().next().value)
    if (!byServer) for (const d of r.drafts.values()) if (d.key === key && !d.seen) { d.seen = true; persist(uid) }
    wake(r)
  }

  /** Wait until `test(room)` gives something (or `ms` pass, or every workshop page closes): that, or null. */
  function until(uid, test, ms) {
    const r = room(uid)
    return new Promise((resolve) => {
      const w = {
        check() {
          const v = test(r)
          if (v || !r.clients.size) { clearTimeout(timer); r.waiters.delete(w); resolve(v || null) }
        },
      }
      const timer = setTimeout(() => { r.waiters.delete(w); resolve(test(r) || null) }, ms)
      r.waiters.add(w)
      w.check()
    })
  }
  const resultFor = (uid, key, ms = 8000) => until(uid, (r) => r.results.get(key), ms)

  return {
    ensure, subscribe, watch, setDraft, select, discard,
    /** Tell every open console page: { type: 'ask', … } (confirm something) or { type: 'changed', … }. */
    notify: (uid, msg) => { const r = room(uid); r.aiAt = Date.now(); for (const res of r.watchers) write(res, msg); return r.watchers.size },
    report, until, resultFor,
    /**
     * Live test (consented on the trusted page): drafts run in their console on their real planner, for `ms`. One
     * test at a time, but it can hold several drafts (two sessions on two extensions): a draft added later shares the
     * test's end and its undo snapshot (`checkpoint` only counts when it starts).
     */
    startDev(uid, { checkpoint = null, ms = 60 * 60000, slug } = {}) {
      const r = room(uid)
      const s = slugName(slug) || r.current
      const dev = devOf(r)
      if (dev) { if (!dev.slugs.includes(s)) dev.slugs.push(s) } else r.dev = { since: Date.now(), until: Date.now() + ms, checkpoint, slugs: [s] }
      persist(uid)
      for (const res of r.watchers) write(res, { type: 'dev', key: r.drafts.get(s)?.key ?? null })
      return r.dev
    },
    dev: (uid) => devOf(room(uid)),
    /** The drafts under the live test (they stay those even when the workshop switches to another). */
    devDrafts: (uid) => { const r = room(uid); return (devOf(r)?.slugs ?? []).map((x) => r.drafts.get(x)).filter(Boolean) },
    /** Stop the live test, or with `slug` take only that draft out of it (the test ends with its last draft). */
    stopDev(uid, slug) {
      const r = room(uid)
      const was = devOf(r)
      if (!was) return null
      const s = slugName(slug)
      if (s && was.slugs.includes(s) && was.slugs.length > 1) {
        was.slugs = was.slugs.filter((x) => x !== s)
        persist(uid)
        for (const res of r.watchers) write(res, { type: 'dev-off' })
        return { ...was, slugs: [s], partial: true }
      }
      if (s && !was.slugs.includes(s)) return null
      r.dev = null
      persist(uid)
      for (const res of r.watchers) write(res, { type: 'dev-off' })
      return was
    },
    /** Which draft an MCP session works on (saved with the drafts, so a restart doesn't lose it). */
    sessionSlug(uid, sid, slug) {
      const r = room(uid)
      if (slug === undefined) return r.sessions.get(sid)?.slug ?? null
      r.sessions.delete(sid)
      r.sessions.set(sid, { slug: slugName(slug), at: Date.now() })
      while (r.sessions.size > MAX_SESSIONS) r.sessions.delete(r.sessions.keys().next().value)
      persist(uid)
      return slug
    },
    /** A draft by name, or the current one. */
    draft: (uid, slug) => { const r = room(uid); return slug ? r.drafts.get(slugName(slug)) ?? null : r.draft },
    drafts: (uid) => listOf(room(uid)),
    current: (uid) => room(uid).current,
    result: (uid, key) => room(uid).results.get(key) ?? null,
    open: (uid) => room(uid).clients.size,
    /** A publisher renamed their handle (server/registry.mjs setHandle): drafts that edit or copy their extensions follow. */
    renamed(from, to) {
      const fix = (n) => (typeof n === 'string' && n.startsWith(`${from}/`) ? `${to}/${n.slice(from.length + 1)}` : n)
      for (const [uid, r] of rooms) {
        let changed = false
        for (const d of r.drafts.values()) {
          const e = fix(d.editing), f = fix(d.forkOf)
          if (e !== d.editing || f !== d.forkOf) { d.editing = e; d.forkOf = f; changed = true }
        }
        if (changed && r.loaded) persist(uid)
      }
    },
    /** Ask the workshop page to do something: { type: 'open', pkg } or { type: 'use' }. */
    tell: (uid, msg) => { room(uid).aiAt = Date.now(); broadcast(uid, msg) },
    close() { for (const r of rooms.values()) for (const res of [...r.clients, ...r.watchers]) try { res.end() } catch { /* gone */ } rooms.clear() },
  }
}
