#!/usr/bin/env node
// Read and resolve the in-app issue log (the continuous-improvement queue). See CLAUDE.md "Issues".
//
//   npm run issues                              open + in-progress issues, grouped by screen (full details)
//   npm run issues -- all | fixed | wontfix     other filters
//   npm run issues -- --screen S-10             only one screen
//   npm run issues -- --platform mobile         only reports from phones/tablets (or: web = desktop)
//   npm run issues -- show ISS-3                one issue, everything
//   npm run issues -- start ISS-3               mark in-progress
//   npm run issues -- fix ISS-3 "what changed" [--commit <sha>]
//   npm run issues -- wontfix ISS-3 "why"
//   npm run issues -- reopen ISS-3
//   add --json for raw JSON · --url http://localhost:8787 (or LIFE_CONSOLE_URL) to use another server
//
// Default server: http://dokpoly.netbird.cloud (NetBird only, no Cloudflare Access login needed).
// Auth: an admin API token in LIFE_CONSOLE_TOKEN or ~/.life-console-token (mode 600). Create one with
//   docker compose exec app node server/cli.mjs create-token --email you@example.com --name issues-cli
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const json = args.includes('--json') && args.splice(args.indexOf('--json'), 1)
const BASE = (flag('--url') || process.env.LIFE_CONSOLE_URL || 'http://dokpoly.netbird.cloud').replace(/\/$/, '')
const screen = flag('--screen')
const platform = flag('--platform')
const commit = flag('--commit')
const [cmd = 'active', id, ...rest] = args
const note = rest.join(' ')

const TOKEN = (process.env.LIFE_CONSOLE_TOKEN || (() => {
  try { return readFileSync(`${homedir()}/.life-console-token`, 'utf8') } catch { return '' }
})()).trim()

async function call(method, path, body) {
  const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) }
  const r = await fetch(BASE + path, { method, headers, body: body && JSON.stringify(body), redirect: 'manual' })
  if (r.status === 401) throw new Error(`${method} ${path} → 401: ${TOKEN ? 'the API token was refused' : 'no API token — set LIFE_CONSOLE_TOKEN or ~/.life-console-token (see the top of scripts/issues.mjs)'}`)
  if (!r.ok) throw new Error(`${method} ${path} → HTTP ${r.status}${r.status === 0 || r.type === 'opaqueredirect' ? ' (redirected: login required? use the NetBird URL)' : ''}`)
  return r.json()
}

function print(i, full = true) {
  const head = `${i.id}  [${i.status}] ${i.kind}/${i.severity}  ${i.platform || '?'}  ${i.screen || '—'} ${i.screenTitle ? `(${i.screenTitle})` : ''}`
  console.log(head)
  console.log(`  ${i.title}`)
  if (!full) return
  if (i.details) console.log(i.details.split('\n').map((l) => `  │ ${l}`).join('\n'))
  console.log(`  route: #${i.route || '/'}  · reported ${i.createdAt}`)
  const ctx = Object.entries(i.context || {}).filter(([k]) => k !== 'userAgent').map(([k, v]) => `${k}=${v}`).join('  ')
  if (ctx) console.log(`  context: ${ctx}`)
  if (i.resolution || i.commit) console.log(`  resolution: ${i.resolution}${i.commit ? `  (commit ${i.commit})` : ''}  ${i.resolvedAt || ''}`)
}

const STATUS_CMD = { start: 'in-progress', fix: 'fixed', wontfix: 'wontfix', reopen: 'open' }
try {
  if (cmd === 'show') {
    const i = await call('GET', `/api/issues/${id}`)
    json ? console.log(JSON.stringify(i, null, 2)) : print(i)
  } else if (STATUS_CMD[cmd]) {
    if (!/^ISS-\d+$/.test(id || '')) throw new Error(`usage: issues ${cmd} ISS-<n>${cmd === 'fix' || cmd === 'wontfix' ? ' "note" [--commit sha]' : ''}`)
    const patch = { status: STATUS_CMD[cmd] }
    if (note) patch.resolution = note
    if (commit) patch.commit = commit
    const i = await call('PATCH', `/api/issues/${id}`, patch)
    json ? console.log(JSON.stringify(i, null, 2)) : print(i)
  } else if (['active', 'open', 'all', 'fixed', 'wontfix', 'in-progress'].includes(cmd)) {
    const q = new URLSearchParams()
    if (cmd !== 'all') q.set('status', cmd)
    if (screen) q.set('screen', screen)
    if (platform) q.set('platform', platform)
    const list = await call('GET', `/api/issues?${q}`)
    if (json) { console.log(JSON.stringify(list, null, 2)); process.exit(0) }
    if (!list.length) { console.log(`No ${cmd === 'all' ? '' : cmd + ' '}issues.`); process.exit(0) }
    const SEV = { high: 0, medium: 1, low: 2 }
    const groups = Object.groupBy(list, (i) => i.screen || '—')
    for (const s of Object.keys(groups).sort()) {
      console.log(`\n━━ ${s} ${groups[s][0].screenTitle || ''} (${groups[s].length})`)
      for (const i of groups[s].sort((a, b) => SEV[a.severity] - SEV[b.severity])) { print(i, cmd !== 'all'); console.log() }
    }
  } else {
    throw new Error(`unknown command "${cmd}" — see the header of scripts/issues.mjs`)
  }
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
