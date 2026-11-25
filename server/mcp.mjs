// The workshop for AI apps: a small MCP server (Model Context Protocol, Streamable HTTP, plain JSON replies) at
// POST /mcp. Claude Code and other MCP clients connect with an access token made on the trusted page
// (/trust?do=claude, scope 'extensions'), which opens nothing else in the API. The AI reads the SDK guide, opens an
// extension or writes a draft, and the workshop page in your browser shows it and runs its preview right away
// (server/workshop-live.mjs); the preview's findings come back as the tool's result. Installing still needs you on
// the trusted page: `use_draft` only takes the open workshop to it.
import { workshopPrompt } from '../src/sdk/prompt.js'
import { draftKey } from '../src/sdk/live.js'

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const WORKSHOP = '/app#/m/extensions/workshop'

const INSTRUCTIONS = `Life Console is a planner; extensions are one-file JavaScript add-ons for it. You work in the person's workshop:
the draft you write appears in their browser at once and runs on demo data in a sandboxed preview, and each change
returns what the preview found (errors, problems, what it shows). Read \`guide\` before writing your first extension.
Keep the draft working: after a change, fix any errors it reports. Installing is the person's choice: \`use_draft\`
asks them to confirm in their browser.`

const TOOLS = [
  { name: 'guide', title: 'How to write an extension', description: 'The extension SDK: the file format, the data API, the shared vocabulary and the look kit (CSS classes that make it look native). Read it before writing an extension.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'list_extensions', title: 'List extensions', description: "The person's installed extensions and the ones they made, with their names (handle/name) for open_extension.", inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'open_extension', title: 'Open an extension', description: "Open an extension in the workshop to change it. The person's own opens for editing; anyone else's becomes their own copy (it replaces the original when they use it). Returns its code and preview. Needs the workshop open in their browser.", inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'handle/name, e.g. ann/water' } }, required: ['name'] } },
  { name: 'read_draft', title: 'Read the draft', description: "The draft in the person's workshop (they may have edited it by hand) and its latest preview.", inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'write_draft', title: 'Write the draft', description: 'Replace the whole draft with a new file. It shows in the workshop at once; returns the preview (errors, problems, what each part shows).', inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'The whole extension file (an ES module, default export = manifest)' }, name: { type: 'string', description: 'Optional: the extension name (lowercase, a-z 0-9 -) for a new extension' } }, required: ['code'] } },
  { name: 'edit_draft', title: 'Edit the draft', description: 'Change part of the draft: replaces old_text (must appear exactly once) with new_text. Returns the preview.', inputSchema: { type: 'object', properties: { old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['old_text', 'new_text'] } },
  { name: 'use_draft', title: 'Use the draft', description: 'When the draft works and the person wants it: takes their workshop to the confirmation page, where they install it (or update theirs). Nothing is installed without their click.', inputSchema: { type: 'object', properties: {} } },
]

/** The preview's findings in plain text, for the AI. */
export function describeResult(r) {
  if (!r) return 'Preview: no result (is the workshop open in the browser?)'
  const lines = [`Preview: ${r.ok ? 'works' : 'HAS ERRORS'}`]
  if (r.errors?.length) lines.push('Errors:', ...r.errors.map((e) => `- ${e}`))
  if (r.problems?.length) lines.push('Problems:', ...r.problems.map((e) => `- ${e}`))
  const m = r.manifest
  if (m) {
    const where = [...(m.pageTitles ?? []).map((t) => `page "${t}"`), ...(m.slots ?? [])]
    lines.push(`Shows on: ${where.join(', ') || 'nothing'}`)
    if (m.types?.length) lines.push(`Keeps: ${m.types.join(', ')}`)
    if (m.says?.internet?.length) lines.push(`Internet: ${m.says.internet.join(', ')}`)
  }
  if (r.parts?.length) lines.push('What it shows (text, on demo data):', ...r.parts.map((p) => `[${p.label}] ${p.text || '(empty)'}`))
  return lines.join('\n')
}

export function createMcp({ auth, registry, live, limit, log = () => {}, build = 'dev', siteOf }) {
  const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) })
  const fail = (t) => text(t, true)
  const needWorkshop = (req) => `The workshop isn't open. Ask the person to open ${siteOf(req)}${WORKSHOP} in their browser (signed in), then try again.`

  async function afterWrite(req, uid, draft) {
    if (!live.open(uid)) return text(`Saved the draft. ${needWorkshop(req)} It loads there when they do.`)
    const r = await live.resultFor(uid, draft.key)
    return text(describeResult(r), !r || !r.ok)
  }

  const handlers = {
    async guide() {
      const sdk = workshopPrompt('').replace(/^[\s\S]*?(?=## The file)/, '')
      return text(`# Writing a Life Console extension\nWrite the file with write_draft and read the preview it returns. Keep the extension's own types named after it (an extension called water has water.Glass).\n\n${sdk}`)
    },
    async list_extensions(_a, user) {
      const installed = user.publicPlugins ? await registry.installed(user.id) : []
      const made = (await registry.list(user, '')).filter((p) => p.mine)
      const fmt = (p) => `- ${p.pkg ?? p.name}${p.version ? ` ${p.version}` : ''}: ${p.title ?? ''}${p.description ? `: ${p.description}` : ''}`
      const lines = ['Installed:', ...(installed.length ? installed.map((p) => `${fmt(p)}${p.mine ? ' (they made it)' : ''}${p.enabled === false ? ' (switched off)' : ''}`) : ['(none)'])]
      const notInstalled = made.filter((p) => !installed.some((i) => i.pkg === p.name))
      if (notInstalled.length) lines.push('', 'Made by them, not installed:', ...notInstalled.map(fmt))
      return text(lines.join('\n'))
    },
    async open_extension(a, user, req) {
      const pkg = String(a.name ?? '').trim()
      if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(pkg)) return fail('name must look like handle/name')
      if (!(await registry.one(user, pkg))) return fail(`There's no extension called ${pkg} that they can see.`)
      if (!live.open(user.id)) return fail(needWorkshop(req))
      const since = Date.now()
      live.tell(user.id, { type: 'open', pkg })
      const d = await live.until(user.id, (r) => r.draft && r.draft.at >= since && r.draft.from === 'you' && (r.draft.editing === pkg || r.draft.forkOf === pkg) && r.draft, 10000)
      if (!d) return fail("The workshop didn't open it (try again, or ask the person to reload the workshop).")
      const r = await live.resultFor(user.id, d.key)
      return text(`${d.editing ? `Editing their extension ${pkg}.` : `Their own copy of ${pkg} (named ${d.slug}): using it replaces the original for them.`}\n\n${describeResult(r)}\n\nThe code:\n${d.code}`)
    },
    async read_draft(_a, user) {
      const d = live.draft(user.id)
      if (!d) return text(live.open(user.id) ? 'The workshop is open but has sent no draft yet: ask the person to reload it.' : 'No draft yet. Write one with write_draft.')
      const about = d.editing ? `Editing ${d.editing}.` : d.forkOf ? `Their own copy of ${d.forkOf}.` : `A new extension called ${d.slug || '(unnamed)'}.`
      return text(`${about}${d.from === 'you' ? ' Last changed by the person.' : ''}\n\n${describeResult(live.result(user.id, d.key))}\n\nThe code:\n${d.code}`)
    },
    async write_draft(a, user, req) {
      if (typeof a.code !== 'string' || !a.code.trim()) return fail('code is required')
      const code = a.code.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trimEnd() + '\n'
      const name = a.name ? String(a.name).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) : undefined
      const draft = live.setDraft(user.id, { code, slug: name, ...(name ? { editing: null, forkOf: null } : {}) }, 'ai')
      return afterWrite(req, user.id, draft)
    },
    async edit_draft(a, user, req) {
      const d = live.draft(user.id)
      if (!d) return fail('There is no draft yet: use write_draft or open_extension first.')
      const from = String(a.old_text ?? '')
      const n = from ? d.code.split(from).length - 1 : 0
      if (n !== 1) return fail(n ? `old_text appears ${n} times: include more of the surrounding code.` : 'old_text is not in the draft (read_draft shows the current code).')
      const draft = live.setDraft(user.id, { code: d.code.replace(from, () => String(a.new_text ?? '')) }, 'ai')
      return afterWrite(req, user.id, draft)
    },
    async use_draft(_a, user, req) {
      if (!live.open(user.id)) return fail(needWorkshop(req))
      const d = live.draft(user.id)
      const r = d && live.result(user.id, d.key)
      if (!r?.ok) return fail('The draft has errors (or no preview yet): fix them first.')
      live.tell(user.id, { type: 'use' })
      return text('Asked the person to confirm in their browser: the confirmation page shows what it can do and where it appears. Nothing is installed until they click.')
    },
  }

  async function call(msg, user, req) {
    const { method, params = {} } = msg
    if (method === 'initialize') {
      const v = PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[1]
      return { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'life-console-workshop', title: 'Life Console workshop', version: build }, instructions: INSTRUCTIONS }
    }
    if (method === 'ping') return {}
    if (method === 'tools/list') return { tools: TOOLS }
    if (method === 'tools/call') {
      const h = handlers[params.name]
      if (!h) throw Object.assign(new Error(`Unknown tool: ${params.name}`), { code: -32602 })
      limit(`mcp:${user.id}`, 600, 3600000)
      try { return await h(params.arguments ?? {}, user, req) } catch (e) { if (e.status && e.status < 500) return fail(e.message); throw e }
    }
    throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
  }

  /** POST /mcp: one JSON-RPC message (or a batch); notifications get 202. GET/DELETE: no stream or session here. */
  async function handle(req, res, { send, readBody }) {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST JSON-RPC messages here' }, { Allow: 'POST' })
    const who = await auth.identify(req, { scope: 'extensions' })
    if (!who || who.via !== 'token') return send(res, 401, { error: 'Connect from the workshop: it makes an access token (Authorization: Bearer …)' }, { 'WWW-Authenticate': 'Bearer realm="life-console"' })
    const body = await readBody(req, 800 * 1024)
    const msgs = Array.isArray(body) ? body : [body]
    const out = []
    for (const m of msgs) {
      if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') { out.push({ jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32600, message: 'Invalid request' } }); continue }
      if (m.id === undefined) continue // a notification (e.g. notifications/initialized)
      try { out.push({ jsonrpc: '2.0', id: m.id, result: await call(m, who.user, req) }) } catch (e) {
        if (!e.code && (!e.status || e.status >= 500)) log(`[mcp] ${m.method} failed: ${e.message}`)
        out.push({ jsonrpc: '2.0', id: m.id, error: { code: e.code ?? (e.status === 429 ? -32000 : -32603), message: e.code || e.status ? e.message : 'Internal error' } })
      }
    }
    if (!out.length) return send(res, 202, '')
    return send(res, 200, Array.isArray(body) ? out : out[0])
  }

  return { handle }
}
