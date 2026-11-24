// The data door (goal 4, platform/plugins-sdk.md "The data door"): every plugin, ours included, reads and writes
// planner data through these calls, never the document directly. Pure JS: it works on a plain document object,
// so Node tests drive it; src/sdk/lc.js binds it to the reactive `state` (which syncs, merges and undoes).
//
// Where records live (all inside the synced planner document, so they work offline and merge per record):
//   core types with a store       → their existing arrays (todos, timeBlocks, deadlines, plans, reviews, reminders)
//   every other type (plugins')   → state.entities: { id, type, by, createdAt, updatedAt, ...fields }
//   links                         → state.relations: { id, s, p, o, by, at }
// Refs are '<type>/<id>'. A core record that something links to gets a random `uid` (gap G10: core ids are
// "highest + 1" and a merge clash renumbers one, which would re-point links), and links use '<type>/~<uid>'.
//
// Rules: a plugin may create core records (anything with a time belongs on the planner) and its own records;
// on core records it may only change its own fields, under x.<namespace>; it may only delete what it created.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const randomId = (n = 10) => {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  const buf = (globalThis.crypto?.getRandomValues?.(new Uint8Array(n))) ?? Array.from({ length: n }, () => Math.floor(Math.random() * 256))
  for (const b of buf) s += a[b % a.length]
  return s
}
export const LIMITS = { reminders: 50, xBytes: 4096, activity: 500, listMax: 2000 }
export class DataError extends Error { constructor(msg, code = 'invalid') { super(msg); this.code = code } }

/** Defaults for core records a plugin creates, matching store.js (addTodo, addDeadline…). */
const CORE_DEFAULTS = {
  todos: (s, f, now) => ({ title: 'Untitled', vital: '', timeMin: 30, done: false, lsd: 'S', priority: 3, due: null, scheduled: null, links: [], notes: '', createdAt: now, updatedAt: now, order: Math.max(0, ...s.todos.map((x) => x.order ?? 0)) + 1000, ...f }),
  timeBlocks: (s, f) => ({ title: 'Untitled', category: 'experiment', link: null, ...f }),
  deadlines: (s, f) => ({ title: 'Untitled', vital: '', due: f.due, source: '', done: false, priority: 2, ...f }),
  reminders: (s, f, now) => ({ title: f.title ?? f.text ?? 'Reminder', createdAt: now, ...f }),
  reviews: (s, f, now) => ({ at: now, ...f }),
  plans: (s, f) => ({ title: 'Untitled plan', status: 'active', health: 'On-track', psgs: [], sigs: [], ...f }),
}
const PREFIX = { todos: 'T', deadlines: 'DL', timeBlocks: 'B', reminders: 'RM', reviews: 'RV', plans: 'SP' }
function nextId(arr, store) {
  if (store === 'todos') return `T-${Math.max(100, ...arr.map((t) => Number(String(t.id).split('-')[1]) || 0)) + 1}`
  if (store === 'deadlines' || store === 'plans') return `${PREFIX[store]}-${Math.max(0, ...arr.map((t) => Number(String(t.id).split('-')[1]) || 0)) + 1}`
  return `${PREFIX[store] ?? 'R'}-${randomId(8)}`
}

/**
 * Make a data door over a planner document.
 *   getState(): the document (a plain object, or the reactive state)
 *   taxonomy: from vocabulary.js buildTaxonomy()
 *   now(): ISO time; emit(event, payload): event sink; nsOf(pluginId): the plugin's vocabulary namespace
 */
export function createDataDoor({ getState, taxonomy, now = () => new Date().toISOString(), emit = () => {}, nsOf = (id) => String(id).split('/').pop() }) {
  const activity = []
  const log = (by, op, ref) => { activity.push({ at: now(), by, op, ref }); if (activity.length > LIMITS.activity) activity.shift() }
  const doc = () => {
    const s = getState()
    for (const k of ['entities', 'relations', 'reminders']) if (!Array.isArray(s[k])) s[k] = []
    return s
  }
  const isCore = (by) => by === 'core' || String(by).startsWith('core/') || String(by).startsWith('life-console/')

  function parseRef(ref) {
    const i = String(ref).lastIndexOf('/')
    if (i < 1) throw new DataError(`not a record reference: ${ref}`)
    return { type: ref.slice(0, i), id: ref.slice(i + 1) }
  }
  /** Find a record by ref: its array, index and the record itself. Core records match by id or ~uid. */
  function locate(ref) {
    const { type, id } = parseRef(ref)
    const s = doc()
    const store = taxonomy.storeOf(type)
    const arr = s[store]
    if (!Array.isArray(arr)) return null
    const byUid = id.startsWith('~') ? id.slice(1) : null
    const i = arr.findIndex((r) => (byUid ? r.uid === byUid : String(r.id) === id))
    if (i < 0) return null
    const rec = arr[i]
    if (store === 'entities' && !taxonomy.isKindOf(rec.type, type)) return null
    return { store, arr, i, rec, type: store === 'entities' ? rec.type : type }
  }
  const typeOfIn = (store, rec) => (store === 'entities' ? rec.type : Object.keys(taxonomy.types).find((t) => taxonomy.types[t].store === store))
  const out = (store, rec) => ({ ...clone(rec), type: typeOfIn(store, rec), ref: `${typeOfIn(store, rec)}/${rec.id}` })

  /** A stable reference for links: core records get a uid on first use (G10). */
  function stableRef(ref) {
    const hit = locate(ref)
    if (!hit) throw new DataError(`no record ${ref}`, 'not-found')
    if (hit.store === 'entities') return `${hit.type}/${hit.rec.id}`
    if (!hit.rec.uid) hit.rec.uid = randomId(12)
    return `${hit.type}/~${hit.rec.uid}`
  }

  function checkXSize(rec, ns) {
    const x = rec.x?.[ns]
    if (x !== undefined && JSON.stringify(x).length > LIMITS.xBytes) throw new DataError(`fields under x.${ns} are larger than ${LIMITS.xBytes} bytes: store bigger data as your own records`, 'too-big')
  }
  function validateOrThrow(type, rec) {
    const errs = taxonomy.validate(type, rec)
    if (errs.length) throw new DataError(`${type}: ${errs.join('; ')}`)
  }
  function matches(rec, where = {}) {
    for (const [k, v] of Object.entries(where)) {
      const got = k.split('.').reduce((o, p) => (o == null ? o : o[p]), rec)
      if (Array.isArray(v) ? !v.includes(got) : got !== v) return false
    }
    return true
  }

  /** The door as seen by one plugin (`by` labels every change). */
  function as(by) {
    const ns = nsOf(by)
    const core = isCore(by)

    function list(type, { where, linkedTo, from, to, limit = LIMITS.listMax } = {}) {
      const s = doc()
      const t = taxonomy.canonical(type)
      if (!taxonomy.types[t]) throw new DataError(`unknown type ${type}`)
      const store = taxonomy.storeOf(t)
      let rows = (s[store] ?? []).filter((r) => (store === 'entities' ? taxonomy.isKindOf(r.type, t) : true))
      if (where) rows = rows.filter((r) => matches(r, where))
      if (from || to) {
        const dateOf = (r) => String(r.due ?? r.at ?? r.date ?? r.scheduled?.date ?? '').slice(0, 10)
        rows = rows.filter((r) => { const d = dateOf(r); return d && (!from || d >= from) && (!to || d <= to) })
      }
      if (linkedTo) {
        const targets = new Set([linkedTo])
        try { targets.add(stableRefIfExists(linkedTo)) } catch { /* fine */ }
        const linked = new Set(s.relations.filter((l) => targets.has(l.o)).map((l) => l.s))
        rows = rows.filter((r) => linked.has(`${typeOfIn(store, r)}/${r.id}`) || (r.uid && linked.has(`${typeOfIn(store, r)}/~${r.uid}`)))
      }
      return rows.slice(0, limit).map((r) => out(store, r))
    }
    function stableRefIfExists(ref) { const h = locate(ref); return h && h.rec.uid ? `${h.type}/~${h.rec.uid}` : ref }

    function get(ref) { const h = locate(ref); return h ? out(h.store, h.rec) : null }

    function create(type, fields = {}) {
      const t = taxonomy.canonical(type)
      const def = taxonomy.types[t]
      if (!def) throw new DataError(`unknown type ${type}`)
      if (!core && def.owner !== 'core' && def.owner !== 'common' && def.owner !== ns) throw new DataError(`${by} can't create ${t}: it belongs to ${def.owner}`, 'forbidden')
      const s = doc()
      const store = taxonomy.storeOf(t)
      const at = now()
      let rec
      if (store === 'entities') {
        rec = { ...clone(fields), id: randomId(12), type: t, by, createdAt: at, updatedAt: at }
      } else {
        if (store === 'reminders' && !core && s.reminders.filter((r) => r.by === by).length >= LIMITS.reminders) throw new DataError(`${by} already has ${LIMITS.reminders} reminders`, 'limit')
        const base = (CORE_DEFAULTS[store] ?? ((st, f) => ({ ...f })))(s, clone(fields), at)
        rec = { ...base, id: nextId(s[store], store), uid: randomId(12), ...(core ? {} : { by }) }
        if (store !== 'entities' && t !== Object.keys(taxonomy.types).find((k) => taxonomy.types[k].store === store)) rec.kind = t // a subtype stored as a core record (G4)
      }
      checkXSize(rec, ns)
      validateOrThrow(t, rec)
      s[store].push(rec)
      log(by, 'create', `${t}/${rec.id}`)
      emit('record.changed', { op: 'create', type: t, id: rec.id, by })
      return out(store, rec)
    }

    function update(ref, patch = {}) {
      const h = locate(ref)
      if (!h) throw new DataError(`no record ${ref}`, 'not-found')
      const { store, rec, type } = h
      let next
      if (store !== 'entities' && !core) {
        const keys = Object.keys(patch)
        if (keys.some((k) => k !== 'x') || Object.keys(patch.x ?? {}).some((k) => k !== ns)) throw new DataError(`${by} may only change x.${ns} on ${type} records`, 'forbidden')
        next = { ...clone(rec), x: { ...(rec.x ?? {}), [ns]: clone(patch.x[ns]) } }
      } else {
        if (store === 'entities' && !core && rec.by !== by && taxonomy.types[rec.type]?.owner !== ns) throw new DataError(`${by} can't change a ${rec.type} it didn't create`, 'forbidden')
        const { id, type: _t, by: _b, createdAt, uid, ...rest } = patch
        next = { ...clone(rec), ...clone(rest) }
      }
      checkXSize(next, ns)
      validateOrThrow(type, next)
      const wasDone = rec.done === true
      next.updatedAt = now()
      if (store === 'todos' || store === 'entities') Object.assign(rec, next)
      else Object.assign(rec, next)
      log(by, 'update', ref)
      emit('record.changed', { op: 'update', type, id: rec.id, by })
      if (store === 'todos' && !wasDone && rec.done === true) emit('todo.done', { id: rec.id, by })
      return out(store, rec)
    }

    function upsert(type, { source, externalId }, fields = {}) {
      if (!source || !externalId) throw new DataError('upsert needs source and externalId')
      const hit = list(type, { where: { source, externalId: String(externalId) } })[0]
      return hit ? update(hit.ref, core || taxonomy.storeOf(type) === 'entities' ? fields : { x: { [ns]: fields } }) : create(type, { ...fields, source, externalId: String(externalId) })
    }

    function remove(ref) {
      const h = locate(ref)
      if (!h) return false
      const { store, arr, i, rec, type } = h
      if (!core && rec.by !== by) throw new DataError(`${by} can only delete records it created`, 'forbidden')
      arr.splice(i, 1)
      const s = doc()
      const refs = new Set([`${type}/${rec.id}`, rec.uid ? `${type}/~${rec.uid}` : null])
      s.relations = s.relations.filter((l) => !refs.has(l.s) && !refs.has(l.o))
      log(by, 'delete', ref)
      emit('record.changed', { op: 'delete', type, id: rec.id, by })
      return true
    }

    function relate(from, link, to) {
      if (!taxonomy.linkBase(link)) throw new DataError(`unknown link ${link}: use one of the standard links or a kind of one`)
      const s = doc()
      const sRef = stableRef(from)
      const oRef = /^me\.|^core\.|^common\./.test(to) && taxonomy.tags[to] ? to : stableRef(to)
      if (s.relations.some((l) => l.s === sRef && l.p === link && l.o === oRef)) return true
      s.relations.push({ id: randomId(12), s: sRef, p: link, o: oRef, by, at: now() })
      log(by, 'relate', `${sRef} ${link} ${oRef}`)
      emit('record.changed', { op: 'relate', type: 'link', id: sRef, by })
      return true
    }
    function unrelate(from, link, to) {
      const s = doc()
      const sRef = stableRef(from)
      let oRef = to
      try { oRef = taxonomy.tags[to] ? to : stableRef(to) } catch { /* a deleted target */ }
      const before = s.relations.length
      s.relations = s.relations.filter((l) => !(l.s === sRef && l.p === link && l.o === oRef && (core || l.by === by)))
      return s.relations.length < before
    }
    /** Links from or to a record. */
    function links(ref) {
      const s = doc()
      const refs = new Set([ref])
      try { refs.add(stableRef(ref)) } catch { /* fine */ }
      return s.relations.filter((l) => refs.has(l.s) || refs.has(l.o)).map(clone)
    }

    return { list, get, create, update, upsert, delete: remove, relate, unrelate, links }
  }

  /** Remove a plugin's data: its own records, its x.<ns> fields and its links (the "also delete its data" choice). */
  function forget(by) {
    const s = doc()
    const ns = nsOf(by)
    s.entities = s.entities.filter((r) => r.by !== by)
    s.relations = s.relations.filter((l) => l.by !== by)
    s.reminders = s.reminders.filter((r) => r.by !== by)
    for (const k of ['todos', 'timeBlocks', 'deadlines', 'plans']) for (const r of s[k] ?? []) if (r.x?.[ns] !== undefined) { delete r.x[ns]; if (!Object.keys(r.x).length) delete r.x }
  }

  return { as, activity, forget, LIMITS }
}
