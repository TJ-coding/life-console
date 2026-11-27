// src/sdk/files.js: an extension in several files, its imports and what's allowed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkFiles, canonical, resolve, rewriteImports, order, filesOf, importsOf } from '../src/sdk/files.js'

const ENTRY = "import { layout } from './lib/layout.js'\nimport * as d3 from 'lc:d3'\nexport default { sdk: 1, title: 'G' }\n"

test('own files and curated libraries are allowed; the graph says who imports whom', () => {
  const f = { 'index.js': ENTRY, 'lib/layout.js': "import { k } from '../k.js'\nexport const layout = () => k\n", 'k.js': 'export const k = 1\n' }
  const r = checkFiles(f)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.graph['index.js'], ['lib/layout.js'])
  assert.deepEqual(r.graph['lib/layout.js'], ['k.js'])
  assert.deepEqual(order(r.graph).slice(0, 2), ['k.js', 'lib/layout.js'], 'dependencies first (blob URLs in the preview)')
})

test('anything outside its files and the curated libraries is refused', () => {
  const bad = (files) => checkFiles(files).errors.join(' | ')
  assert.match(bad({ 'index.js': "import x from 'https://evil.test/x.js'\nexport default {}" }), /only its own files/)
  assert.match(bad({ 'index.js': "import 'lodash'\nexport default {}" }), /only its own files/)
  assert.match(bad({ 'index.js': "import './missing.js'\nexport default {}" }), /isn't one of its files/)
  assert.match(bad({ 'index.js': "import '../../outside.js'\nexport default {}" }), /isn't one of its files/)
  assert.match(bad({ 'index.js': 'const m = "x"; import(m)\nexport default {}' }), /fixed path/)
  assert.match(bad({ 'index.js': 'export default {', }), /syntax/)
  assert.match(bad({ 'a.js': 'export const a = 1' }), /no index\.js/)
  assert.match(bad({ 'index.js': "import './a.js'\nexport default {}", 'a.js': "import './index.js'" }), /circle/)
  assert.match(bad({ 'index.js': 'export default {}', 'Bad Name.js': '' }), /file name/)
})

test('one file hashes as before; several in a stable order', () => {
  assert.equal(canonical({ 'index.js': 'x' }), 'x')
  assert.equal(canonical({ 'b.js': '2', 'index.js': '1' }), canonical({ 'index.js': '1', 'b.js': '2' }))
  assert.deepEqual(filesOf('code'), { 'index.js': 'code' })
})

test('paths resolve inside the extension and imports rewrite in place', () => {
  assert.equal(resolve('lib/a.js', '../b.js'), 'b.js')
  assert.equal(resolve('a.js', '../b.js'), null)
  const out = rewriteImports(ENTRY, 'index.js', (spec) => (spec === 'lc:d3' ? '/vendor/d3.js' : null))
  assert.match(out, /from "\/vendor\/d3\.js"/)
  assert.match(out, /from '\.\/lib\/layout\.js'/)
  assert.equal(importsOf(out).length, 2)
})
