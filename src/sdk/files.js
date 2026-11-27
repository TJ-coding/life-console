// An extension's files (platform/plugins-sdk.md): `index.js` is the entry (its default export is the manifest), and
// files import each other with relative paths ('./layout.js'). Besides its own files an extension may import only
// the curated libraries the app serves itself ('lc:d3'): never anything from the internet, so a version's hash still
// means exactly what runs. Pure JS: the server (checks, serving), the preview and the console use it.
import { parse } from 'acorn'

export const ENTRY = 'index.js'
export const MAX_FILES = 30
/** The curated libraries: specifier → file the app serves (scripts/vendor.mjs builds them into /vendor/). */
export const LIBS = { 'lc:d3': '/vendor/d3.js' }
const PATH = /^(?:[a-z0-9_-]+\/){0,3}[a-z0-9_-]+\.js$/i

/** Normalise what a draft or publish sent: { 'index.js': code, … } or a single `code` string. */
export function filesOf(x) {
  if (typeof x === 'string') return { [ENTRY]: x }
  const out = {}
  for (const [k, v] of Object.entries(x ?? {})) out[String(k).replace(/^\.\//, '')] = String(v ?? '')
  return out
}

/** A stable text form of the files (for the version hash): one file is just its code, as before. */
export function canonical(files) {
  const names = Object.keys(files).sort()
  if (names.length === 1 && names[0] === ENTRY) return files[ENTRY]
  return JSON.stringify(names.map((n) => [n, files[n]]))
}

/** Resolve a relative import from `from` ('lib/a.js' + '../b.js' → 'b.js'); null if it leaves the extension. */
export function resolve(from, spec) {
  const parts = from.split('/').slice(0, -1)
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') { if (!parts.length) return null; parts.pop() } else parts.push(seg)
  }
  return parts.join('/')
}

/** Every import in one file: [{ spec, start, end }] (start/end: the string literal, quotes included). */
export function importsOf(code) {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
  const out = []
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) out.push({ spec: node.source.value, start: node.source.start, end: node.source.end })
    if (node.type === 'ImportExpression') {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') out.push({ spec: node.source.value, start: node.source.start, end: node.source.end })
      else out.push({ spec: null, start: node.source.start, end: node.source.end }) // import(someVariable): can't be checked
    }
    for (const k in node) { const v = node[k]; if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object' && k !== 'loc') visit(v) }
  }
  visit(ast)
  return out
}

/**
 * Check a set of files: names, the entry, syntax, and that every import is one of its own files or a curated
 * library. Returns { errors: [...], graph: { file: [deps] } } (deps: own files only).
 */
export function checkFiles(files) {
  const errors = [], graph = {}
  const names = Object.keys(files)
  if (!names.length) return { errors: ['no files'], graph }
  if (names.length > MAX_FILES) errors.push(`at most ${MAX_FILES} files`)
  if (!(ENTRY in files)) errors.push(`no ${ENTRY}: the entry file holds the manifest (export default { … })`)
  for (const n of names) {
    if (!PATH.test(n)) { errors.push(`${n}: a file name is letters, digits, - or _, ending in .js (folders allowed)`); continue }
    let imps
    try { imps = importsOf(files[n]) } catch (e) { errors.push(`${n}: syntax: ${e.message}`); continue }
    graph[n] = []
    for (const i of imps) {
      if (i.spec === null) { errors.push(`${n}: import() needs a fixed path`); continue }
      if (LIBS[i.spec]) continue
      if (!/^\.{1,2}\//.test(i.spec)) { errors.push(`${n}: imports "${i.spec}": only its own files ('./x.js') or ${Object.keys(LIBS).join(', ')}`); continue }
      const to = resolve(n, i.spec)
      if (!to || !(to in files)) { errors.push(`${n}: imports "${i.spec}", which isn't one of its files`); continue }
      graph[n].push(to)
    }
  }
  if (!errors.length && files[ENTRY] !== undefined && !/export\s+default\b/.test(files[ENTRY])) errors.push(`${ENTRY} needs \`export default { … }\` (its manifest)`)
  if (!errors.length) try { order(graph) } catch (e) { errors.push(e.message) }
  return { errors, graph }
}

/** Replace each import's string literal using `map(spec, file)` (return a new specifier, or null to keep it). */
export function rewriteImports(code, file, map) {
  const imps = importsOf(code).filter((i) => i.spec !== null).sort((a, b) => b.start - a.start)
  let out = code
  for (const i of imps) {
    const to = map(i.spec, file)
    if (to != null) out = out.slice(0, i.start) + JSON.stringify(to) + out.slice(i.end)
  }
  return out
}

/** Files in an order where each comes after what it imports (for blob URLs in the preview); throws on a cycle. */
export function order(graph) {
  const seen = new Set(), doing = new Set(), out = []
  const go = (n, path) => {
    if (seen.has(n)) return
    if (doing.has(n)) throw new Error(`files import each other in a circle: ${[...path, n].join(' → ')}`)
    doing.add(n)
    for (const d of graph[n] ?? []) go(d, [...path, n])
    doing.delete(n); seen.add(n); out.push(n)
  }
  for (const n of Object.keys(graph)) go(n, [])
  return out
}
