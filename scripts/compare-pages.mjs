// Builds the comparison pages (life-console.dev/vs/<app>, /alternatives/<app> and the /alternatives hub), the
// free planning templates (/templates/<name>) from compare/*.md, and the platform pages (/manifesto, /roadmap,
// /whitepaper, /blog and /blog/<post>, /plugins and /plugins/<doc>) from platform/*.md. Runs after `vite build` and writes into dist/, plus dist/compare-pages.json, which the server reads
// to route the pages and list them in the sitemap.
//
// Each source file starts with a front-matter block:
//   ---
//   path: /vs/sunsama                  (or /alternatives/sunsama, or /templates/<name>)
//   title: …                           (<title>, ~60 characters, the search phrase first)
//   description: …                     (meta description, ~155 characters)
//   card: …                            (one line for the hub)
//   updated: 2026-11-18                (sitemap <lastmod>: bump when the page changes)
//   status: …                          (optional: a note shown above the page, e.g. "Proposal: not built yet")
//   draft: true                        (optional: noindex and left out of the sitemap until it's announced)
//   date: 2026-11-24                   (blog posts: the publication date shown on the post and the /blog list)
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
export const PATH_RE = /^\/(?:(?:vs|alternatives|templates|blog|plugins)\/[a-z0-9-]+|goals|manifesto|roadmap|whitepaper|plugins)$/
/** The platform pages: where Life Console is going (manifesto, roadmap, white paper, blog, plugin docs). */
export const isPlatform = (p) => /^\/(goals|manifesto|roadmap|whitepaper|blog|plugins)(\/|$)/.test(p)
/** A platform page's section, if it sits under one: /blog/… → Blog, /plugins/… → Plugins. */
const SECTIONS = { '/blog': 'Blog', '/plugins': 'Plugins' }
const sectionOf = (p) => Object.keys(SECTIONS).find((s) => p.startsWith(`${s}/`))
/** Templates aren't comparisons: no Comparisons crumb, not on the hub, and they don't list the comparison pages. */
export const isTemplate = (p) => p.startsWith('/templates/')

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
  if (!PATH_RE.test(meta.path)) throw new Error(`${name}: path must look like /vs/<app>, /alternatives/<app>, /templates/<name> or a platform page`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.updated)) throw new Error(`${name}: updated must be YYYY-MM-DD`)
  if (meta.path.startsWith('/blog/') && !/^\d{4}-\d{2}-\d{2}$/.test(meta.date ?? '')) throw new Error(`${name}: a blog post needs date: YYYY-MM-DD`)
  return { ...meta, draft: meta.draft === 'true', body: m[2] }
}

// the app as structured data, so search engines and AI answers can read price, licence and platforms. The same
// entity as the landing page's (#app, same fields), so every page describes one app rather than a new one each.
const APP = {
  '@type': 'SoftwareApplication', '@id': `${SITE}/#app`, name: 'Life Console', url: `${SITE}/`,
  applicationCategory: 'ProductivityApplication', operatingSystem: 'Web, Android, iOS, Windows, macOS, Linux',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  isAccessibleForFree: true, codeRepository: REPO,
}
/** This page (with its last update and breadcrumb trail) and the app it is about. */
function pageLd({ title, description, canonical, updated }) {
  const section = sectionOf(canonical)
  const middle = isPlatform(canonical) ? (section ? [[SECTIONS[section], section]] : [])
    : canonical === '/alternatives' || isTemplate(canonical) ? [] : [['Comparisons', '/alternatives']]
  const crumbs = [['Life Console', '/'], ...middle, [title, canonical]]
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      APP,
      {
        '@type': 'WebPage', '@id': `${SITE}${canonical}`, url: `${SITE}${canonical}`, name: title, description,
        inLanguage: 'en', isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': `${SITE}/#app` },
        ...(updated ? { dateModified: updated } : {}),
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: crumbs.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE}${p}` })),
        },
      },
    ],
  }).replace(/</g, '\\u003c')
}

/** Where a visit came from, for /app?from=…: comparison pages and templates say compare, platform pages platform. */
const fromOf = (place) => (isPlatform(place) ? 'platform' : 'compare')
const cta = (place) => `<aside class="closer"><div class="box"><div><p class="line">Try Life Console free</p><p class="sub">No account needed to try it. <a href="/docs/self-hosting">Or run it on your own server.</a></p></div><a class="btn primary big" href="/app?from=${fromOf(place)}" data-umami-event="open-app" data-umami-event-place="${esc(place)}">Try it now</a></div></aside>`

// the landing page's header and footer, so these pages feel like part of the site
const header = (place) => `<header>
  <div class="wrap">
    <a class="brand" href="/" aria-label="Life Console home"><img src="/icons/brand-48.png" alt="" width="24" height="24" />LIFE CONSOLE</a>
    <nav aria-label="Site">
      <a class="opt" href="/alternatives"${place === '/alternatives' ? ' aria-current="page"' : ''}>Comparisons</a>
      <a class="opt" href="/docs/guide">Guide</a>
      <a class="opt" href="/docs/self-hosting">Self-host</a>
      <a class="opt" href="/roadmap"${place === '/roadmap' ? ' aria-current="page"' : ''}>Roadmap</a>
    </nav>
    <a class="btn primary" href="/app?from=${fromOf(place)}" data-umami-event="open-app" data-umami-event-place="${esc(place)} header">Try it now</a>
  </div>
</header>`
const footer = `<footer>
  <div class="wrap">
    <span>Life Console · free software under AGPL-3.0</span>
    <nav aria-label="Footer"><a href="/">Home</a><a href="${REPO}" rel="noopener">GitHub</a><a href="/docs/self-hosting">Self-hosting</a><a href="/docs/guide">Guide</a><a href="/alternatives">Alternatives</a><a href="/manifesto">Manifesto</a><a href="/roadmap">Roadmap</a><a href="/blog">Blog</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
  </div>
</footer>`

function shell({ title, description, canonical, body, place, updated, draft = false, status = '' }) {
  const section = sectionOf(canonical)
  const crumbs = isPlatform(place) ? (section ? `<p class="crumbs"><a href="${section}">${SECTIONS[section]}</a> /</p>\n` : '')
    : place === '/alternatives' || isTemplate(place) ? '' : '<p class="crumbs"><a href="/alternatives">Comparisons</a> /</p>\n'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
${draft ? '<meta name="robots" content="noindex" />\n' : ''}<link rel="canonical" href="${SITE}${canonical}" />
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
<script type="application/ld+json">${pageLd({ title, description, canonical, updated })}</script>
</head>
<body>
${header(place)}
<main>
<article>
${crumbs}${status ? `<p class="status">${esc(status)}</p>\n` : ''}${body}
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
  const platform = isPlatform(page.path)
  const renderer = new marked.Renderer()
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens)
    return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`
  }
  renderer.image = ({ href, title, text }) => `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy"${title ? ` title="${esc(title)}"` : ''} />`
  const more = !others.length ? ''
    : platform ? `<h2 id="more">Where Life Console is going</h2>\n${cards(others)}`
    : `<h2 id="more-comparisons">More comparisons</h2>\n${cards(others)}`
  const dated = page.date ? `<p class="meta">${esc(page.date)}${page.author ? ` · ${esc(page.author)}` : ''}</p>\n` : ''
  const body = dated + pickCards(labelCells(marked.parse(page.body, { renderer, gfm: true }))) + more
  return shell({ title: page.title, description: page.description, canonical: page.path, body, place: page.path, updated: page.updated, draft: page.draft, status: page.status })
}

/** The /alternatives hub: every page, grouped into head-to-heads and roundups. */
export function renderHub(pages) {
  const updated = pages.map((p) => p.updated).sort().at(-1)
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
    description: 'How Life Console, the free and open-source time-blocking planner, compares with Sunsama, Todoist, Notion and other planners: price, self-hosting, features and where each is better.',
    canonical: '/alternatives', body, place: '/alternatives', updated,
  })
}

/** The /blog list: every post, newest first. Drafts stay off search engines while any post is a draft. */
export function renderBlog(posts) {
  const list = [...posts].sort((a, b) => b.date.localeCompare(a.date))
  const items = list.map((p) => `<a href="${p.path}"><span class="when">${esc(p.date)}</span>${esc(p.card)}</a>`).join('')
  const body = `<h1>Blog</h1>
<p class="summary">Notes on building Life Console: what we're making, why, and what we learned on the way.</p>
<nav class="cards posts">${items}</nav>`
  return shell({
    title: 'Life Console blog: building an open-source planner',
    description: 'Posts about Life Console, the free and open-source planner: design decisions, the plugin platform and what is coming next.',
    canonical: '/blog', body, place: '/blog', updated: list.map((p) => p.updated).sort().at(-1),
    draft: list.some((p) => p.draft),
  })
}

/** Reads compare/*.md and platform/*.md, sorted by path. */
export function loadPages(dirs = [path.join(root, 'compare'), path.join(root, 'platform')]) {
  return [dirs].flat().filter((dir) => fs.existsSync(dir)).flatMap((dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => parsePage(fs.readFileSync(path.join(dir, f), 'utf8'), f)))
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
    const others = isTemplate(p.path) ? []
      : isPlatform(p.path) ? pages.filter((o) => o !== p && isPlatform(o.path) && !o.path.startsWith('/blog/'))
      : pages.filter((o) => o !== p && !isTemplate(o.path) && !isPlatform(o.path))
    fs.writeFileSync(file, renderPage(p, others))
  }
  const comparisons = pages.filter((p) => !isTemplate(p.path) && !isPlatform(p.path))
  fs.writeFileSync(path.join(dist, 'alternatives.html'), renderHub(comparisons))
  const updated = comparisons.map((p) => p.updated).sort().at(-1)
  const posts = pages.filter((p) => p.path.startsWith('/blog/'))
  if (posts.length) fs.writeFileSync(path.join(dist, 'blog.html'), renderBlog(posts))
  const entry = (p) => ({ path: p.path, updated: p.updated, ...(p.draft ? { draft: true } : {}) })
  const manifest = [{ path: '/alternatives', updated }, ...(posts.length ? [{ path: '/blog', updated: posts.map((p) => p.updated).sort().at(-1), ...(posts.some((p) => p.draft) ? { draft: true } : {}) }] : []), ...pages.map(entry)]
  fs.writeFileSync(path.join(dist, 'compare-pages.json'), JSON.stringify(manifest, null, 1) + '\n')
  console.log(`comparison pages: ${manifest.map((p) => p.path).join(', ')}`)
}
