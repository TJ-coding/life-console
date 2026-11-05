// Three-way merge of planner documents.
//
// base   = the last version this device synced
// local  = this device's current copy
// remote = the server's current copy
//
// Changes made on only one side are kept. Arrays of records (todos, deadlines, blocks, goals…)
// merge per record id, so adding/editing different items on two devices never loses either.
// Only when both sides changed the same value differently does the local (newest) edit win.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)

function idKeyOf(...lists) {
  for (const l of lists) {
    const first = l?.find?.((x) => isObj(x))
    if (first && 'id' in first) return 'id'
    if (first && 'no' in first) return 'no' // PSG / SIG rows
  }
  return null
}

function mergeById(base, local, remote, key) {
  const B = new Map((base || []).filter(isObj).map((x) => [x[key], x]))
  const R = new Map(remote.filter(isObj).map((x) => [x[key], x]))
  const out = []
  const seen = new Set()
  const clashes = [] // same new id created independently on both devices (e.g. both made "T-120")
  for (const l of local) {
    if (!isObj(l)) continue
    const id = l[key]
    seen.add(id)
    const b = B.get(id)
    const r = R.get(id)
    if (r && !b && key === 'id' && !same(l, r)) { out.push(r); clashes.push(l) }
    else if (r) out.push(merge3(b, l, r))
    else if (!b || !same(l, b)) out.push(l) // added here, or edited here after the other side deleted it
    // else: deleted on the other side and untouched here → drop
  }
  for (const r of remote) {
    if (!isObj(r) || seen.has(r[key])) continue
    const b = B.get(r[key])
    if (!b || !same(r, b)) out.push(r) // added there (or edited there after we deleted it)
    // else: deleted here, untouched there → stay deleted
  }
  // keep both clashing records: the local one gets the next free number with the same prefix
  for (const l of clashes) {
    const m = String(l.id).match(/^(.*?)(\d+)$/)
    let id = `${l.id}-2`
    if (m) {
      const max = Math.max(...out.map((x) => String(x.id)).filter((x) => x.startsWith(m[1])).map((x) => Number(x.slice(m[1].length)) || 0))
      id = `${m[1]}${max + 1}`
    }
    out.push({ ...l, id })
  }
  return out
}

export function merge3(base, local, remote) {
  if (same(local, remote)) return local
  if (same(local, base)) return remote
  if (same(remote, base)) return local
  if (Array.isArray(local) && Array.isArray(remote)) {
    const key = idKeyOf(local, remote, base)
    return key ? mergeById(base, local, remote, key) : local
  }
  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : {}
    const out = {}
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const inL = k in local
      const inR = k in remote
      if (inL && inR) out[k] = merge3(b[k], local[k], remote[k])
      else if (inL) { if (!(k in b) || !same(local[k], b[k])) out[k] = local[k] } // removed there unless changed here
      else if (!(k in b) || !same(remote[k], b[k])) out[k] = remote[k] // removed here unless changed there
    }
    return out
  }
  return local // scalar conflict: the newest edit (this device) wins
}
