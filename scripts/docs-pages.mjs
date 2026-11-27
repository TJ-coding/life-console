// Builds the public documentation pages (life-console.dev/docs/…) from docs/*.md, so the website and
// GitHub show the same text. Runs after `vite build` and writes into dist/docs/.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'https://github.com/TJ-coding/life-console/blob/main'
const SITE = 'https://life-console.dev'

// slug → source file, title and search-result description
export const DOC_PAGES = {
  'self-hosting': {
    src: 'docs/SELF_HOSTING.md',
    label: 'Self-hosting',
    title: 'Self-host Life Console with Docker: open-source planner setup guide',
    description: 'Run Life Console, the open-source (AGPL-3.0) time-blocking planner, on your own server: Docker Compose with PostgreSQL, HTTPS, Google sign-in, backups and updates.',
  },
  guide: {
    src: 'docs/GUIDE.md',
    label: 'User guide',
    title: 'Life Console user guide: time-blocking, goals and shortcuts',
    description: 'Every Life Console screen and feature: the Command Center, planning the week, quick-add syntax, deadline countdowns, strategic goals, pomodoro planning, shortcuts and notifications.',
  },
  data: {
    src: 'docs/DATA.md',
    label: 'How data is stored',
    title: 'How Life Console stores your data: local-first sync, merging and backups',
    description: 'How the Life Console planner stores and syncs your data: one document per account, a full copy in your browser for offline use, three-way merging between devices, snapshots, backups and JSON export.',
  },
}

// links between the markdown files become site links; links to other repo files go to GitHub
const LOCAL = { 'SELF_HOSTING.md': '/docs/self-hosting', 'GUIDE.md': '/docs/guide', 'DATA.md': '/docs/data', '../README.md': '/' }
function rewriteHref(href) {
  if (/^(https?:|mailto:|#)/.test(href)) return href
  const [file, hash = ''] = href.split('#')
  const base = LOCAL[file] ?? LOCAL[file.replace(/^\.\//, '')]
  if (base) return base + (hash ? `#${hash}` : '')
  const repoPath = path.posix.normalize(path.posix.join('docs', file))
  return `${REPO}/${repoPath}${hash ? `#${hash}` : ''}`
}

// images sit in docs/media/ (so GitHub shows them too); the site serves that folder at /media/docs/
const imageHref = (href) => (/^(https?:|\/)/.test(href) ? href : href.replace(/^(\.\/)?media\//, '/media/docs/'))

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&(#\d+|[a-z]+);/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** The doc as a web page about the app (the landing page's #app entity), with a breadcrumb trail. */
const docLd = (slug, page) => JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebPage', '@id': `${SITE}/docs/${slug}`, url: `${SITE}/docs/${slug}`, name: page.title, description: page.description,
  inLanguage: 'en', isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': `${SITE}/#app` },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [['Life Console', '/'], [page.label, `/docs/${slug}`]]
      .map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE}${p}` })),
  },
}).replace(/</g, '\\u003c')

export function renderDoc(slug, md) {
  const page = DOC_PAGES[slug]
  const renderer = new marked.Renderer()
  const link = renderer.link.bind(renderer)
  renderer.link = (tok) => link({ ...tok, href: rewriteHref(tok.href) })
  const image = renderer.image.bind(renderer)
  renderer.image = (tok) => { // a diagram opens full size on a tap (its small text on phones)
    const href = imageHref(tok.href)
    return `<a href="${href}">${image({ ...tok, href }).replace('<img ', '<img loading="lazy" ')}</a>`
  }
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens)
    return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`
  }
  const body = marked.parse(md, { renderer, gfm: true })
  const nav = Object.entries(DOC_PAGES).map(([s, p]) => s === slug ? '' : ` · <a href="/docs/${s}">${p.label}</a>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}" />
<link rel="canonical" href="${SITE}/docs/${slug}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Life Console" />
<meta property="og:title" content="${esc(page.title)}" />
<meta property="og:description" content="${esc(page.description)}" />
<meta property="og:url" content="${SITE}/docs/${slug}" />
<meta property="og:image" content="${SITE}/media/og.png" />
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="stylesheet" href="/legal.css" />
<script type="application/ld+json">${docLd(slug, page)}</script>
</head>
<body>
<main class="doc">
<p class="back"><a href="/">← Life Console</a>${nav} · <a href="/app">Open the app</a> · <a href="${REPO}/${page.src}" rel="noopener">Edit on GitHub</a></p>
${body}
</main>
</body>
</html>
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.join(root, 'dist', 'docs')
  fs.mkdirSync(out, { recursive: true })
  fs.cpSync(path.join(root, 'docs', 'media'), path.join(root, 'dist', 'media', 'docs'), { recursive: true })
  for (const [slug, page] of Object.entries(DOC_PAGES)) {
    fs.writeFileSync(path.join(out, `${slug}.html`), renderDoc(slug, fs.readFileSync(path.join(root, page.src), 'utf8')))
  }
  console.log(`docs pages: ${Object.keys(DOC_PAGES).map((s) => `/docs/${s}`).join(', ')}`)
}
