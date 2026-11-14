// Read-only health check of stored planner documents (`npm run admin -- check-docs`).
// Runs the shared schema code (migrate, normalise, merge) over each document on a copy and reports only
// counts, error types and sizes: never ids, emails or any content, so the output is safe to paste anywhere.
import { normalizeDoc } from './schema.mjs'
import { merge3 } from './merge.mjs'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
/** Keys a normalise step is allowed to remove (a v1 `plan` becomes `plans[]`). */
const MAY_DROP = new Set(['plan'])

/** Check one document. Returns a list of problem labels (empty = fine). */
export function checkDoc(state) {
  if (!isObj(state)) return ['not-an-object']
  const problems = []
  let n
  try {
    n = normalizeDoc(structuredClone(state))
  } catch (e) {
    return [`normalize-throws:${e?.name || 'Error'}`]
  }
  for (const k of Object.keys(state)) if (!(k in n) && !MAY_DROP.has(k)) problems.push('key-lost')
  if (!same(normalizeDoc(structuredClone(n)), n)) problems.push('normalize-not-idempotent')
  if (!same(JSON.parse(JSON.stringify(n)), n)) problems.push('json-round-trip')
  try {
    if (!same(merge3(structuredClone(n), structuredClone(n), structuredClone(n)), n)) problems.push('merge-identity')
    // two devices: one edits the first todo, the other adds a todo; both changes and everything else survive
    if (Array.isArray(n.todos) && n.todos.length && isObj(n.todos[0])) {
      const local = structuredClone(n)
      local.todos[0] = { ...local.todos[0], title: `${local.todos[0].title ?? ''} (check)` }
      const remote = structuredClone(n)
      remote.todos.push({ id: '__check__', title: 'check' })
      const m = merge3(structuredClone(n), local, remote)
      const expect = structuredClone(local)
      expect.todos.push({ id: '__check__', title: 'check' })
      if (!same(m, expect)) problems.push('merge-two-devices')
    }
  } catch (e) {
    problems.push(`merge-throws:${e?.name || 'Error'}`)
  }
  return [...new Set(problems)]
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0)

/** Aggregate a list of documents into a report of totals. `prefixes`: count goal numbers that start with each. */
export function checkDocs(states, { prefixes = [] } = {}) {
  const sizes = []
  const keyBytes = {}
  const problems = {}
  const schemas = {}
  const namespaces = {}
  const prefixHits = Object.fromEntries(prefixes.map((p) => [p, { docs: 0, goals: 0 }]))
  let bad = 0
  for (const s of states) {
    const found = checkDoc(s)
    if (found.length) bad++
    for (const p of found) problems[p] = (problems[p] ?? 0) + 1
    if (!isObj(s)) continue
    sizes.push(Buffer.byteLength(JSON.stringify(s)))
    const v = String(Number(s.schemaVersion) || 1)
    schemas[v] = (schemas[v] ?? 0) + 1
    for (const [k, val] of Object.entries(s)) keyBytes[k] = (keyBytes[k] ?? 0) + Buffer.byteLength(JSON.stringify(val) ?? '')
    if (isObj(s.modules)) {
      for (const id of Object.keys(s.modules)) {
        const v = String(Number(s.moduleVersions?.[id]) || 1)
        namespaces[id] ??= {}
        namespaces[id][`v${v}`] = (namespaces[id][`v${v}`] ?? 0) + 1
      }
    }
    for (const p of prefixes) {
      const goals = (Array.isArray(s.plans) ? s.plans : []).flatMap((pl) => [...(pl?.psgs ?? []), ...(pl?.sigs ?? [])])
      const hits = goals.filter((g) => String(g?.no ?? '').toUpperCase().startsWith(p.toUpperCase())).length
      if (hits) { prefixHits[p].docs++; prefixHits[p].goals += hits }
    }
  }
  sizes.sort((a, b) => a - b)
  const top = Object.entries(keyBytes).sort((a, b) => b[1] - a[1]).slice(0, 12)
  return {
    documents: states.length,
    ok: states.length - bad,
    failed: bad,
    problems,
    schemaVersions: schemas,
    moduleNamespaces: namespaces,
    bytes: { total: sizes.reduce((a, b) => a + b, 0), median: pct(sizes, 0.5), p95: pct(sizes, 0.95), max: sizes[sizes.length - 1] ?? 0 },
    largestKeys: Object.fromEntries(top),
    ...(prefixes.length ? { goalPrefixes: prefixHits } : {}),
  }
}
