// Issue log: report what should be fixed on the screen you're looking at (key I or the bug button).
// Issues live on the server in /data/issues.json, separate from the planner document, so agents can
// read them with `npm run issues` and fix them later. Reports made offline wait in localStorage.
import { reactive } from 'vue'
import { ui } from './store'
import { deviceName } from './sync'
import { auth } from './auth'

export const KINDS = [
  { key: 'bug', label: 'Bug', icon: 'bug_report' },
  { key: 'ux', label: 'UX / layout', icon: 'design_services' },
  { key: 'idea', label: 'Idea', icon: 'lightbulb' },
]
export const SEVERITIES = ['low', 'medium', 'high']
export const STATUSES = ['open', 'in-progress', 'fixed', 'wontfix']

const QUEUE = 'life-console/issue-queue'
const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE) || '[]') } catch { return [] } }
const writeQueue = (q) => { try { localStorage.setItem(QUEUE, JSON.stringify(q)) } catch { /* ignore */ } }

export const issues = reactive({
  list: [],
  loaded: false,
  error: '',
  queued: readQueue().length, // reports waiting to be sent
  dialog: null, // { screen, screenTitle, route } while the report dialog is open
})

async function call(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual', // a Cloudflare Access login redirect means "signed out", not success
  })
  if (!r.ok) throw new Error(r.type === 'opaqueredirect' ? 'signed out' : `HTTP ${r.status}`)
  return r.json()
}

/** Open the report dialog for the given route (defaults are taken from it). */
export function openIssueDialog(route) {
  const screenTitle = route.name === 'module' ? `Module: ${route.params.module}` : route.meta?.title ?? ''
  issues.dialog = { screen: route.meta?.screen ?? '', screenTitle, route: route.fullPath }
}

/** 'mobile' for phones and tablets (iPadOS reports a Mac user agent, so also check touch), else 'web'. */
function platform() {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'mobile' : 'web'
}
/** Installed to the home screen / dock (PWA), or running in a browser tab. */
const appMode = () => (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone ? 'installed' : 'browser')

function context() {
  const build = document.querySelector('script[src*="assets/index-"]')?.getAttribute('src')?.split('/').pop() ?? 'dev'
  return {
    device: deviceName(),
    app: appMode(),
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    theme: ui.theme,
    accent: ui.accent,
    build,
    selectedId: ui.selectedId ?? '',
    userAgent: navigator.userAgent,
  }
}

/** Send a report. Returns 'sent' or 'queued' (kept locally and retried later). */
export async function reportIssue(fields) {
  const body = { ...fields, platform: platform(), context: context(), createdAt: new Date().toISOString() }
  try {
    const i = await call('POST', '/api/issues', body)
    issues.list.push(i)
    return 'sent'
  } catch {
    const q = readQueue()
    q.push(body)
    writeQueue(q)
    issues.queued = q.length
    return 'queued'
  }
}

/** Send any reports that were made while offline. */
export async function flushQueue() {
  let q = readQueue()
  while (q.length) {
    try { issues.list.push(await call('POST', '/api/issues', q[0])) } catch { break }
    q = q.slice(1)
    writeQueue(q)
  }
  issues.queued = q.length
}

export async function loadIssues() {
  await flushQueue()
  try {
    issues.list = await call('GET', '/api/issues')
    issues.error = ''
  } catch (e) {
    issues.error = e.message
  }
  issues.loaded = true
}

export async function updateIssue(id, patch) {
  const i = await call('PATCH', `/api/issues/${id}`, patch)
  const k = issues.list.findIndex((x) => x.id === id)
  if (k >= 0) issues.list[k] = i
  return i
}

export async function deleteIssue(id) {
  await call('DELETE', `/api/issues/${id}`)
  issues.list = issues.list.filter((x) => x.id !== id)
}

export const openCount = () => issues.list.filter((i) => i.status === 'open' || i.status === 'in-progress').length

/* Closing the loop with reporters: when one of your issues is fixed, the app thanks you (IssueFixedNote.vue)
   and asks you to check it; if it isn't fixed for you, reopen it with a reply saying why. */
/** Your fixed issues you haven't seen the note for yet. */
export const fixedUnseen = () => issues.list.filter((i) => i.mine && i.status === 'fixed' && !i.seenAt)
/** Mark the fixed note as seen for these issues (your own). */
export async function markSeen(ids) {
  if (!ids.length) return
  const now = new Date().toISOString()
  for (const i of issues.list) if (ids.includes(i.id)) i.seenAt = now
  try { await call('POST', '/api/issues/seen', { ids }) } catch { /* shown again next time */ }
}
/** Reply to an issue; reopen = it isn't fixed (the reply says why). Updates the list. */
export async function replyIssue(id, text, reopen = false) {
  const i = await call('POST', `/api/issues/${id}/reply`, { text, reopen })
  const k = issues.list.findIndex((x) => x.id === id)
  if (k >= 0) issues.list[k] = i
  return i
}

/* Self-hosted servers keep their issues to themselves (they go to that server's admin). So the reporter can
   also tell the Life Console project: a pre-filled GitHub issue, opened in the browser only when they ask.
   It carries the report and the app context, never the account, email or device name. The server decides
   whether to offer it (UPSTREAM_ISSUES), so a new domain doesn't change anything. */
const UPSTREAM = 'https://github.com/TJ-coding/life-console/issues/new'
/** The server offers the GitHub link (UPSTREAM_ISSUES, on unless its admin turns it off; off on life-console.dev). */
export const selfHosted = () => !!auth.upstreamIssues
/** The GitHub "new issue" link for a report: { title, details, kind, severity, screen, screenTitle, route }. */
export function upstreamUrl(r) {
  const c = context()
  const body = [
    (r.details || '').trim().slice(0, 3000) || '_No details._',
    '',
    '---',
    `- **Kind / severity:** ${r.kind} / ${r.severity}`,
    `- **Screen:** ${[r.screen, r.screenTitle].filter(Boolean).join(' · ') || '—'}${r.route ? ` (\`#${r.route}\`)` : ''}`,
    `- **Build:** ${c.build} · ${platform()} · ${c.app} · ${c.viewport} · ${c.theme} theme`,
    '',
    '_Reported from a self-hosted Life Console._',
  ].join('\n')
  return `${UPSTREAM}?${new URLSearchParams({ title: r.title, body })}`
}
