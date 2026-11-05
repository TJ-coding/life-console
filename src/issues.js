// Issue log: report what should be fixed on the screen you're looking at (key I or the bug button).
// Issues live on the server in /data/issues.json, separate from the planner document, so agents can
// read them with `npm run issues` and fix them later. Reports made offline wait in localStorage.
import { reactive } from 'vue'
import { ui } from './store'
import { deviceName } from './sync'

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

function context() {
  const build = document.querySelector('script[src*="assets/index-"]')?.getAttribute('src')?.split('/').pop() ?? 'dev'
  return {
    device: deviceName(),
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    theme: ui.theme,
    build,
    selectedId: ui.selectedId ?? '',
    userAgent: navigator.userAgent,
  }
}

/** Send a report. Returns 'sent' or 'queued' (kept locally and retried later). */
export async function reportIssue(fields) {
  const body = { ...fields, context: context(), createdAt: new Date().toISOString() }
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
