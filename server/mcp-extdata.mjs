// An extension's own records for Claude over MCP (server/mcp.mjs): read and change what one installed extension
// keeps in the planner (state.entities of its types, '<ns>.Thing'), the way the extension itself would through
// lc.data (src/sdk/data.js). Same permission as the planner tools (the 'planner' scope): it is planner data.
// Pure functions on the planner document; edits run inside planner.save's lock, so devices pick them up.
// Rules, as for the extension: only that extension's types; id, type, by and createdAt never change; a record is
// deleted only if that extension made it. Core records (tasks, deadlines…) stay with the planner tools.
import { randomBytes } from 'node:crypto'

const bad = (msg) => Object.assign(new Error(msg), { status: 400 })
const LOCKED = new Set(['id', 'type', 'by', 'createdAt', 'updatedAt', 'ref'])
const MAX_FIELDS_BYTES = 64 * 1024
const MAX_CHANGES = 100
const randomId = (n = 12) => { const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; return [...randomBytes(n)].map((b) => a[b % a.length]).join('') }
const clone = (v) => JSON.parse(JSON.stringify(v))

/** The namespace of an extension's types: 'tj-coding/nisa' → 'nisa' (as src/sdk/manifest.js nsOfPkg). */
export const nsOfPkg = (pkg) => String(pkg).split('/').pop().toLowerCase().replace(/[^a-z0-9-]/g, '-')
const mine = (ns) => (r) => typeof r?.type === 'string' && r.type.startsWith(`${ns}.`)
const show = (r) => { const { by, createdAt, updatedAt, id, type, ...f } = r; return `${type}/${id} ${JSON.stringify(f)}` }

/** The extension's records, one per line: `<type>/<id> {fields}`; `type` narrows to one ('Package' or 'nisa.Package'). */
export function listData(state, { pkg, type, limit = 200 } = {}) {
  const ns = nsOfPkg(pkg)
  const want = type ? (String(type).includes('.') ? String(type) : `${ns}.${type}`) : null
  if (want && !want.startsWith(`${ns}.`)) throw bad(`${pkg} keeps only ${ns}.* types`)
  const rows = (state?.entities ?? []).filter(mine(ns)).filter((r) => !want || r.type === want)
  if (!rows.length) return want ? `No ${want} records.` : `${pkg} has no records in this planner yet.`
  const n = Math.min(Math.max(Number(limit) || 200, 1), 1000)
  const counts = {}
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1
  return [
    `${rows.length} record${rows.length === 1 ? '' : 's'} (${Object.entries(counts).map(([t, c]) => `${t} ${c}`).join(', ')})${rows.length > n ? `, first ${n}` : ''}:`,
    ...rows.slice(0, n).map(show),
  ].join('\n')
}

const fieldsOf = (f) => {
  if (f == null) return {}
  if (typeof f !== 'object' || Array.isArray(f)) throw bad('fields must be an object')
  if (JSON.stringify(f).length > MAX_FIELDS_BYTES) throw bad(`fields are larger than ${MAX_FIELDS_BYTES / 1024} KB`)
  const out = {}
  for (const [k, v] of Object.entries(f)) if (!LOCKED.has(k)) out[k] = clone(v)
  return out
}

/**
 * Apply changes to the extension's records, all or none. Mutates `state`; returns one line per change.
 * Each change: { op: 'create', type, fields } · { op: 'update', ref, fields } (merged; a null value removes the field)
 * · { op: 'delete', ref }.
 */
export function changeData(state, { pkg, changes }, now = new Date().toISOString()) {
  const ns = nsOfPkg(pkg)
  if (!Array.isArray(changes) || !changes.length) throw bad('changes must be a non-empty list')
  if (changes.length > MAX_CHANGES) throw bad(`at most ${MAX_CHANGES} changes at once`)
  const work = clone(state.entities ?? [])
  const lines = []
  const find = (ref) => {
    const m = /^([a-z0-9-]+\.[A-Za-z0-9_]+)\/([A-Za-z0-9_-]+)$/.exec(String(ref ?? ''))
    if (!m) throw bad(`ref must look like ${ns}.Thing/<id>, got ${ref}`)
    if (!m[1].startsWith(`${ns}.`)) throw bad(`${ref} isn't one of ${pkg}'s records`)
    const i = work.findIndex((r) => r.type === m[1] && String(r.id) === m[2])
    if (i < 0) throw bad(`There's no record ${ref}.`)
    return i
  }
  for (const c of changes) {
    const op = c?.op
    if (op === 'create') {
      const type = String(c.type ?? '').includes('.') ? String(c.type) : `${ns}.${c.type ?? ''}`
      if (!/^[a-z0-9-]+\.[A-Za-z0-9_]+$/.test(type) || !type.startsWith(`${ns}.`)) throw bad(`${pkg} can only create ${ns}.* records, not ${c.type}`)
      const rec = { ...fieldsOf(c.fields), id: randomId(), type, by: pkg, createdAt: now, updatedAt: now }
      work.push(rec)
      lines.push(`Created ${show(rec)}`)
    } else if (op === 'update') {
      const i = find(c.ref)
      const f = fieldsOf(c.fields)
      if (!Object.keys(f).length) throw bad(`Give at least one field to change on ${c.ref}.`)
      const rec = work[i]
      for (const [k, v] of Object.entries(f)) { if (v === null) delete rec[k]; else rec[k] = v }
      rec.updatedAt = now
      lines.push(`Changed ${show(rec)}`)
    } else if (op === 'delete') {
      const i = find(c.ref)
      if (work[i].by !== pkg) throw bad(`${c.ref} was made by ${work[i].by}, not ${pkg}: it can't be deleted from here`)
      work.splice(i, 1)
      lines.push(`Deleted ${c.ref}`)
    } else throw bad(`op must be create, update or delete, got ${op}`)
  }
  // deleted records' links go with them, as lc.data.delete does
  const gone = new Set((state.entities ?? []).filter((r) => mine(ns)(r) && !work.some((w) => w.id === r.id && w.type === r.type)).map((r) => `${r.type}/${r.id}`))
  state.entities = work
  if (gone.size && Array.isArray(state.relations)) state.relations = state.relations.filter((l) => !gone.has(l.s) && !gone.has(l.o))
  return lines.join('\n')
}
