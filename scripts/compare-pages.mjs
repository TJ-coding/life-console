// Builds the comparison pages (life-console.dev/vs/<app>, /alternatives/<app> and the /alternatives hub) from
// compare/*.md. Runs after `vite build` and writes into dist/, plus dist/compare-pages.json, which the server reads
// to route the pages and list them in the sitemap.
//
// Each source file starts with a front-matter block:
//   ---
//   path: /vs/sunsama                  (or /alternatives/sunsama)
//   title: …                           (<title>, ~60 characters, the search phrase first)
//   description: …                     (meta description, ~155 characters)
//   card: …                            (one line for the hub)
//   updated: 2026-11-18                (sitemap <lastmod>: bump when the page changes)
//   ---
// The body is markdown. Write it by hand, check every fact about the other app, and say where they're better:
// these pages only work if they're honest (see docs/COMPARE.md).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = 'https://life-console.dev'
const REPO = 'https://github.com/TJ-coding/life-console'
export const PATH_RE = /^\/(vs|alternatives)\/[a-z0-9-]+$/

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Splits the front matter off a source file. Throws on a missing or invalid field, so a bad page fails the build. */
export function parsePage(src, name = 'page') {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(src)
  if (!m) throw new Error(`${name}: no front matter`)
  const meta = {}
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line)
    if (kv) meta[kv[1]] = kv[2].trim()
  }
  for (const k of ['path', 'title', 'description', 'card', 'updated']) if (!meta[k]) throw new Error(`${name}: front matter needs "${k}"`)
  if (!PATH_RE.test(meta.path)) throw new Error(`${name}: path must look like /vs/<app> or /alternatives/<app>`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.updated)) throw new Error(`${name}: updated must be YYYY-MM-DD`)
  return { ...meta, body: m[2] }
}

// the app as structured data, so search engines and AI answers can read price, licence and platforms
const appLd = JSON.stringify({
  '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Life Console', url: SITE,
  applicationCategory: 'ProductivityApplication', operatingSystem: 'Web, Android, iOS, macOS, Windows, Linux (installable web app); self-hosted with Docker',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  isAccessibleForFree: true, codeRepository: REPO,
})

const cta = (place) => `<aside class="closer"><div class="box"><div><p class="line">Try Life Console free</p><p class="sub">No account needed to try it. <a href="/docs/self-hosting">Or run it on your own server.</a></p></div><a class="btn primary big" href="/app?from=compare" data-umami-event="open-app" data-umami-event-place="${esc(place)}">Try it now</a></div></aside>`

// the landing page's header and footer, so these pages feel like part of the site
const header = (place) => `<header>
  <div class="wrap">
    <a class="brand" href="/" aria-label="Life Console home"><img src="/icons/brand-48.png" alt="" width="24" height="24" />LIFE CONSOLE</a>
    <nav aria-label="Site">
      <a class="opt" href="/alternatives"${place === '/alternatives' ? ' aria-current="page"' : ''}>Comparisons</a>
      <a class="opt" href="/docs/guide">Guide</a>
      <a class="opt" href="/docs/self-hosting">Self-host</a>
    </nav>
    <a class="btn primary" href="/app?from=compare" data-umami-event="open-app" data-umami-event-place="${esc(place)} header">Try it now</a>
  </div>
</header>`
const footer = `<footer>
  <div class="wrap">
    <span>Life Console · free software under AGPL-3.0</span>
    <nav aria-label="Footer"><a href="/">Home</a><a href="${REPO}" rel="noopener">GitHub</a><a href="/docs/self-hosting">Self-hosting</a><a href="/docs/guide">Guide</a><a href="/alternatives">Alternatives</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
  </div>
</footer>`

function shell({ title, description, canonical, body, place }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${SITE}${canonical}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Life Console" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${SITE}${canonical}" />
<meta property="og:image" content="${SITE}/media/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="preload" as="font" type="font/woff2" href="/media/fonts/inter-latin.woff2" crossorigin />
<link rel="stylesheet" href="/compare.css" />
<script type="application/ld+json">${appLd}</script>
</head>
<body>
${header(place)}
<main>
<article>
${place === '/alternatives' ? '' : '<p class="crumbs"><a href="/alternatives">Comparisons</a> /</p>\n'}${body}
</article>
${cta(place)}
</main>
${footer}
</body>
</html>
`
}

/** Gives each table cell its column's header as data-label, so phones can show the table as labelled cards. */
export function labelCells(html) {
  return html.replace(/<table>([\s\S]*?)<\/table>/g, (table, inner) => {
    const heads = [...(/<thead>([\s\S]*?)<\/thead>/.exec(inner)?.[1] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
      .map((m) => esc(m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()))
    const body = inner.replace(/<tr>([\s\S]*?)<\/tr>/g, (row, cells) => {
      let i = 0
      return `<tr>${cells.replace(/<td([^>]*)>/g, (m, a) => { const h = heads[i++]; return h ? `<td${a} data-label="${h}">` : m })}</tr>`
    })
    const lcCol = heads[1] === 'Life Console' ? ' class="lc-col"' : ''
    const rows = body.replace(/<tr>(\s*<td[^>]*>\s*(?:<strong>)?Life Console\b)/g, '<tr class="lc-row">$1')
    return `<div class="table"><table${lcCol}>${rows}</table></div>`
  })
}

/** Puts consecutive "Pick … if" sections (an h2 and its list) side by side as cards; Life Console's is marked. */
export function pickCards(html) {
  return html.replace(/(?:<h2 id="pick-[^"]*">[\s\S]*?<\/h2>\s*<ul>[\s\S]*?<\/ul>\s*){2}/g, (group) => {
    const cards = [...group.matchAll(/<h2 id="(pick-[^"]*)">([\s\S]*?)<\/h2>\s*(<ul>[\s\S]*?<\/ul>)/g)]
      .map(([, id, h, ul]) => `<section class="pick${id.includes('life-console') ? ' lc' : ''}"><h2 id="${id}">${h}</h2>${ul}</section>`)
    return `<div class="picks">${cards.join('')}</div>\n`
  })
}

const cards = (list) => `<nav class="cards">${list.map((o) => `<a href="${o.path}">${esc(o.card)}</a>`).join('')}</nav>`

/** One comparison page. `others`: the rest of the pages, linked at the bottom so each page leads to the next. */
export function renderPage(page, others = []) {
  const renderer = new marked.Renderer()
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens)
    return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`
  }
  renderer.image = ({ href, title, text }) => `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy"${title ? ` title="${esc(title)}"` : ''} />`
  const more = others.length
    ? `<h2 id="more-comparisons">More comparisons</h2>\n${cards(others)}`
    : ''
  const body = pickCards(labelCells(marked.parse(page.body, { renderer, gfm: true }))) + more
  return shell({ title: page.title, description: page.description, canonical: page.path, body, place: page.path })
}

/** The /alternatives hub: every page, grouped into head-to-heads and roundups. */
export function renderHub(pages) {
  const list = (kind) => { const l = pages.filter((p) => p.path.startsWith(`/${kind}/`)); return l.length ? cards(l) : '' }
  const vs = list('vs'), alt = list('alternatives')
  const body = `<h1>Life Console compared with other planners</h1>
<p class="summary">Life Console is a free, open-source planner: time-block your week, count down every deadline and link tasks to long-term goals. These pages compare it with the apps people usually look at instead, including where those apps are the better pick.</p>
${alt ? `<h2 id="alternatives">Alternatives to…</h2>\n${alt}` : ''}
${vs ? `<h2 id="head-to-head">Head to head</h2>\n${vs}` : ''}
<h2 id="what-life-console-doesnt-do">What Life Console doesn't do</h2>
<p>No calendar sync, no integrations with other task apps, no AI scheduling and no native phone apps (it installs from the browser instead, and has a Mac menu-bar app). If you need those, the pages above say which app does them.</p>`
  return shell({
    title: 'Life Console alternatives: open-source planner comparisons',
    description: 'How Life Console, the free and open-source time-blocking planner, compares with Sunsama and other daily planners: price, self-hosting, features and where each one is better.',
    canonical: '/alternatives', body, place: '/alternatives',
  })
}

/** Reads compare/*.md, sorted by path. */
export function loadPages(dir = path.join(root, 'compare')) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => parsePage(fs.readFileSync(path.join(dir, f), 'utf8'), f))
    .sort((a, b) => a.path.localeCompare(b.path))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = path.join(root, 'dist')
  const pages = loadPages()
  const seen = new Set()
  for (const p of pages) {
    if (seen.has(p.path)) throw new Error(`two pages use ${p.path}`)
    seen.add(p.path)
    const file = path.join(dist, `${p.path}.html`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, renderPage(p, pages.filter((o) => o !== p)))
  }
  fs.writeFileSync(path.join(dist, 'alternatives.html'), renderHub(pages))
  const updated = pages.map((p) => p.updated).sort().at(-1)
  const manifest = [{ path: '/alternatives', updated }, ...pages.map((p) => ({ path: p.path, updated: p.updated }))]
  fs.writeFileSync(path.join(dist, 'compare-pages.json'), JSON.stringify(manifest, null, 1) + '\n')
  console.log(`comparison pages: ${manifest.map((p) => p.path).join(', ')}`)
}
