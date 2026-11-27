// The live workshop: one room per account, in memory. The workshop page listens (server-sent events) and sends its
// draft and preview results; the AI connection (server/mcp.mjs) changes the draft and waits for the preview.
// The draft (its files) is also saved in the database (workshop_drafts), so a restart or a deploy doesn't lose it;
// call ensure(uid) before reading a room. Preview results and the live test are only in memory.
import { eq } from 'drizzle-orm'
import { draftKey } from '../src/sdk/live.js'
import { ENTRY, filesOf, canonical } from '../src/sdk/files.js'
import { workshopDrafts } from './db/schema.js'

const MAX_CODE = 700 * 1024

export function createWorkshopLive({ db = null, log = () => {} } = {}) {
  const rooms = new Map()
  const room = (uid) => {
    let r = rooms.get(uid)
    if (!r) rooms.set(uid, (r = { draft: null, results: new Map(), clients: new Set(), watchers: new Set(), waiters: new Set(), aiAt: 0, loaded: !db }))
    return r
  }
  /** Load this account's saved draft into its room (once per server start). */
  async function ensure(uid) {
    const r = room(uid)
    if (r.loaded) return r
    r.loading ??= db.select().from(workshopDrafts).where(eq(workshopDrafts.userId, uid)).then(([row]) => {
      if (row && !r.draft) { const d = row.draft; const files = filesOf(d.files ?? d.code); r.draft = { ...d, files, code: files[ENTRY] ?? '', key: draftKey(canonical(files)) } }
      r.loaded = true
    }).catch((e) => { log(`[workshop] loading a draft failed: ${e.message}`); r.loaded = true })
    await r.loading
    return r
  }
  /** Save the draft (in the background: a failed save only means it won't survive a restart). */
  function persist(uid, d) {
    if (!db) return
    const draft = { files: d.files, slug: d.slug, forkOf: d.forkOf, editing: d.editing, from: d.from, at: d.at, seen: d.seen }
    db.insert(workshopDrafts).values({ userId: uid, draft, updatedAt: new Date() })
      .onConflictDoUpdate({ target: workshopDrafts.userId, set: { draft, updatedAt: new Date() } })
      .catch((e) => log(`[workshop] saving a draft failed: ${e.message}`))
  }
  const write = (res, msg) => { try { res.write(`data: ${JSON.stringify(msg)}\n\n`) } catch { /* gone */ } }
  const broadcast = (uid, msg) => { for (const res of room(uid).clients) write(res, msg) }
  const wake = (r) => { for (const w of [...r.waiters]) w.check() }
  /** The live test, if it's on and hasn't run out (it's never stored: a restart ends it). */
  const devOf = (r) => { if (r.dev && r.dev.until <= Date.now()) r.dev = null; return r.dev }

  /** The workshop page listens: GET /api/workshop/live. */
  function subscribe(uid, req, res, headers = {}) {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    const r = room(uid)
    r.clients.add(res)
    // a draft the AI wrote while no workshop was open loads when one opens
    write(res, { type: 'hello', draft: r.draft?.from === 'ai' && !r.draft.seen ? r.draft : null, aiAt: r.aiAt })
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

  /** A new draft, from the workshop page ('you') or the AI ('ai', sent on to the page): `files` or one `code`. */
  function setDraft(uid, d, from) {
    const files = filesOf(d.files && typeof d.files === 'object' ? d.files : String(d.code ?? ''))
    if (canonical(files).length > MAX_CODE) throw Object.assign(new Error('the extension is too big (700 KB at most)'), { status: 413 })
    const r = room(uid)
    const draft = {
      files, code: files[ENTRY] ?? '', key: draftKey(canonical(files)), from, at: Date.now(), seen: from !== 'ai',
      slug: String(d.slug ?? r.draft?.slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40),
      forkOf: d.forkOf === undefined ? r.draft?.forkOf ?? null : d.forkOf || null,
      editing: d.editing === undefined ? r.draft?.editing ?? null : d.editing || null,
    }
    r.draft = draft
    persist(uid, draft)
    if (from === 'ai') { r.aiAt = draft.at; broadcast(uid, { type: 'draft', draft }) }
    // a live test is on: every console page loads the new version
    if (devOf(r)) for (const res of r.watchers) write(res, { type: 'dev', key: draft.key })
    wake(r)
    return draft
  }

  /** The workshop's preview ran a draft: POST /api/workshop/live/result. `byServer`: the server's previewer ran it
   *  (server/previewer.mjs), so no workshop page has shown it yet: it still loads when one opens. */
  function report(uid, key, result, { byServer = false } = {}) {
    const r = room(uid)
    r.results.set(String(key), { ...result, at: Date.now() })
    if (r.results.size > 20) r.results.delete(r.results.keys().next().value)
    if (r.draft?.key === key && !byServer && !r.draft.seen) { r.draft.seen = true; persist(uid, r.draft) }
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
    ensure, subscribe, watch, setDraft,
    /** Tell every open console page: { type: 'ask', … } (confirm something) or { type: 'changed', … }. */
    notify: (uid, msg) => { const r = room(uid); r.aiAt = Date.now(); for (const res of r.watchers) write(res, msg); return r.watchers.size },
    report, until, resultFor,
    /** Live test (consented on the trusted page): the draft runs in their console on their real planner, for `ms`. */
    startDev(uid, { checkpoint = null, ms = 60 * 60000 } = {}) {
      const r = room(uid)
      r.dev = { since: Date.now(), until: Date.now() + ms, checkpoint }
      for (const res of r.watchers) write(res, { type: 'dev', key: r.draft?.key ?? null })
      return r.dev
    },
    dev: (uid) => devOf(room(uid)),
    stopDev(uid) {
      const r = room(uid)
      const was = r.dev
      r.dev = null
      if (was) for (const res of r.watchers) write(res, { type: 'dev-off' })
      return was
    },
    draft: (uid) => room(uid).draft,
    result: (uid, key) => room(uid).results.get(key) ?? null,
    open: (uid) => room(uid).clients.size,
    /** Ask the workshop page to do something: { type: 'open', pkg } or { type: 'use' }. */
    tell: (uid, msg) => { room(uid).aiAt = Date.now(); broadcast(uid, msg) },
    close() { for (const r of rooms.values()) for (const res of [...r.clients, ...r.watchers]) try { res.end() } catch { /* gone */ } rooms.clear() },
  }
}
