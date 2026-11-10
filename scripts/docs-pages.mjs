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
    title: 'Self-host Life Console with Docker: open-source planner setup guide',
    description: 'Run Life Console, the open-source (AGPL-3.0) time-blocking planner, on your own server: Docker Compose with PostgreSQL, HTTPS, Google sign-in, backups and updates.',
  },
  guide: {
    src: 'docs/GUIDE.md',
    title: 'Life Console user guide: time-blocking, deadlines, goals and keyboard shortcuts',
    description: 'Every Life Console screen and feature: the Command Center, planning the week, quick-add syntax, deadline countdowns, strategic goals, pomodoro planning, shortcuts and notifications.',
  },
}

// links between the markdown files become site links; links to other repo files go to GitHub
const LOCAL = { 'SELF_HOSTING.md': '/docs/self-hosting', 'GUIDE.md': '/docs/guide', '../README.md': '/' }
function rewriteHref(href) {
  if (/^(https?:|mailto:|#)/.test(href)) return href
  const [file, hash = ''] = href.split('#')
  const base = LOCAL[file] ?? LOCAL[file.replace(/^\.\//, '')]
  if (base) return base + (hash ? `#${hash}` : '')
  const repoPath = path.posix.normalize(path.posix.join('docs', file))
  return `${REPO}/${repoPath}${hash ? `#${hash}` : ''}`
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function renderDoc(slug, md) {
  const page = DOC_PAGES[slug]
  const renderer = new marked.Renderer()
  const link = renderer.link.bind(renderer)
  renderer.link = (tok) => link({ ...tok, href: rewriteHref(tok.href) })
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens)
    return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`
  }
  const body = marked.parse(md, { renderer, gfm: true })
  const nav = Object.entries(DOC_PAGES).map(([s, p]) => s === slug ? '' : ` · <a href="/docs/${s}">${s === 'guide' ? 'User guide' : 'Self-hosting'}</a>`).join('')
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
<link rel="icon" href="/icons/icon-192.png" />
<link rel="stylesheet" href="/legal.css" />
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
  for (const [slug, page] of Object.entries(DOC_PAGES)) {
    fs.writeFileSync(path.join(out, `${slug}.html`), renderDoc(slug, fs.readFileSync(path.join(root, page.src), 'utf8')))
  }
  console.log(`docs pages: ${Object.keys(DOC_PAGES).map((s) => `/docs/${s}`).join(', ')}`)
}
