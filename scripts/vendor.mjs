// The curated libraries extensions may import ('lc:d3', src/sdk/files.js LIBS): bundled once per build into
// public/vendor/ (served at /vendor/, same origin), pinned to the versions in package.json. Run by `npm run build`.
import { build } from 'esbuild'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const LIBS = { d3: 'd3' } // /vendor/<file>.js ← npm package

for (const [file, pkg] of Object.entries(LIBS)) {
  await build({ stdin: { contents: `export * from '${pkg}'`, resolveDir: root }, bundle: true, format: 'esm', minify: true, legalComments: 'inline', target: 'es2022', outfile: path.join(root, 'public/vendor', `${file}.js`), logLevel: 'warning' })
  console.log(`vendor: /vendor/${file}.js`)
}
