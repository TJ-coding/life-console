// The live workshop: one room per account, in memory. The workshop page listens (server-sent events) and sends its
// draft and preview results; the AI connection (server/mcp.mjs) changes the draft and waits for the preview.
// Nothing here is stored: a draft lives in the browser (localStorage) and in this room until the server restarts.
import { draftKey } from '../src/sdk/live.js'

const MAX_CODE = 700 * 1024

export function createWorkshopLive() {
  const rooms = new Map()
  const room = (uid) => {
    let r = rooms.get(uid)
    if (!r) rooms.set(uid, (r = { draft: null, results: new Map(), clients: new Set(), waiters: new Set(), aiAt: 0 }))
    return r
  }
  const write = (res, msg) => { try { res.write(`data: ${JSON.stringify(msg)}\n\n`) } catch { /* gone */ } }
  const broadcast = (uid, msg) => { for (const res of room(uid).clients) write(res, msg) }
  const wake = (r) => { for (const w of [...r.waiters]) w.check() }

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

  /** A new draft, from the workshop page ('you') or the AI ('ai', sent on to the page). */
  function setDraft(uid, d, from) {
    const code = String(d.code ?? '')
    if (code.length > MAX_CODE) throw Object.assign(new Error('the file is too big (700 KB at most)'), { status: 413 })
    const r = room(uid)
    const draft = {
      code, key: draftKey(code), from, at: Date.now(), seen: from !== 'ai',
      slug: String(d.slug ?? r.draft?.slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40),
      forkOf: d.forkOf === undefined ? r.draft?.forkOf ?? null : d.forkOf || null,
      editing: d.editing === undefined ? r.draft?.editing ?? null : d.editing || null,
    }
    r.draft = draft
    if (from === 'ai') { r.aiAt = draft.at; broadcast(uid, { type: 'draft', draft }) }
    wake(r)
    return draft
  }

  /** The workshop's preview ran a draft: POST /api/workshop/live/result. */
  function report(uid, key, result) {
    const r = room(uid)
    r.results.set(String(key), { ...result, at: Date.now() })
    if (r.results.size > 20) r.results.delete(r.results.keys().next().value)
    if (r.draft?.key === key) r.draft.seen = true
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
    subscribe, setDraft, report, until, resultFor,
    draft: (uid) => room(uid).draft,
    result: (uid, key) => room(uid).results.get(key) ?? null,
    open: (uid) => room(uid).clients.size,
    /** Ask the workshop page to do something: { type: 'open', pkg } or { type: 'use' }. */
    tell: (uid, msg) => { room(uid).aiAt = Date.now(); broadcast(uid, msg) },
    close() { for (const r of rooms.values()) for (const res of r.clients) try { res.end() } catch { /* gone */ } rooms.clear() },
  }
}
