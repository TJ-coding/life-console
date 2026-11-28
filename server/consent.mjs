// The trusted page (goal 3, platform/whitepaper.md §6): where a person says yes to the things a plugin could abuse.
// Public plugins run inside the console's page, so they could click "Allow" themselves, draw a fake dialog or call
// an /api endpoint. Consent therefore never happens in the console:
//
//   - /trust is plain HTML with NO scripts (CSP script-src 'none'), never loads plugins and can't be framed;
//   - it is only served for a real top-level navigation (Fetch Metadata: Sec-Fetch-Dest: document), so a plugin
//     can't fetch() it to read the page; it's opened in a new tab whose window the console can't reach
//     (Cross-Origin-Opener-Policy: same-origin severs the opener);
//   - each page view carries a one-time nonce (only its hash is stored) bound to the exact action shown; the POST must
//     come from that page as a form submission (same-origin document navigation) with that nonce.
//
// A plugin can't read the nonce, so it can't complete an action, and an /api call for these actions is refused once
// the account has Public plugins switched on. Actions: enable/disable Public plugins, install/update/remove/toggle a
// plugin, create an API token, save/remove a connection key, change the password, delete the account.
import crypto from 'node:crypto'
import { and, eq, isNull, lt } from 'drizzle-orm'
import { consentNonces, users } from './db/schema.js'
import { sha256, verifyPassword, normEmail, httpError } from './auth.mjs'
import { tokenRequest } from './oauth.mjs'

const NONCE_TTL = 15 * 60000
/** The token Claude's MCP connection uses (server/mcp.mjs): scope 'extensions', plus 'planner' once confirmed here. */
export const CLAUDE_TOKEN = 'Claude (workshop)'
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const TRUST_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
}
/** A real top-level page load or form post (not fetch, not a frame). Browsers without Fetch Metadata are refused. */
export const isDocumentNavigation = (req) => req.headers['sec-fetch-dest'] === 'document' && req.headers['sec-fetch-mode'] === 'navigate'

const KINDS = {
  'enable-plugins': { title: 'Turn on Public plugins', danger: true },
  'disable-plugins': { title: 'Turn off all Public plugins' },
  install: { title: 'Install an extension', danger: true },
  remove: { title: 'Remove an extension' },
  toggle: { title: 'Switch an extension on or off' },
  token: { title: 'Create an access token', danger: true },
  claude: { title: 'Connect Claude to the workshop' },
  'claude-planner': { title: 'Let Claude see and change your planner', danger: true },
  'claude-planner-off': { title: 'Stop Claude seeing your planner' },
  'dev-test': { title: 'Live test a draft on your real planner', danger: true },
  'vault-save': { title: 'Save a connection key', danger: true },
  connect: { title: 'Connect an account', danger: true },
  'pod-use': { title: 'Keep your planner in your own Solid pod', danger: true },
  'pod-builtin': { title: 'Keep your planner in this server\'s pod' },
  'pod-import': { title: 'Copy your planner from a pod', danger: true },
  share: { title: 'Share a plan with someone on another server', danger: true },
  unshare: { title: 'Stop sharing a plan' },
  move: { title: 'Move your account to another server', danger: true },
  'vault-remove': { title: 'Remove a connection key' },
  password: { title: 'Change your password', danger: true },
  'delete-account': { title: 'Delete your account', danger: true },
}

export function createConsent({ db, auth, registry, vault, log = () => {}, appPath = '/app', secureFor = () => false, providers = {}, appUrl = '', planner = null, pods = null, podClient = null, siteOf = () => '', fed = null, live = null, checkDraft = () => ({ errors: [] }) }) {
  const origin = (req) => appUrl || `${secureFor(req) ? 'https' : 'http'}://${req.headers.host}`
  function page(title, body, { status = 200 } = {}) {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Life Console trusted page</title>
<style>
:root{--bg:#0e1116;--surface:#161b22;--border:#2a323d;--text:#e6edf3;--muted:#8b96a3;--accent:#2bd4e6;--danger:#e5534b;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f7f7f5;--surface:#fff;--border:#d9dde2;--text:#1a1f24;--muted:#5f6b77;--accent:#0a7d8c;--danger:#c4332b;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:560px;margin:40px auto;padding:0 16px}.badge{display:inline-flex;gap:8px;align-items:center;font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;color:var(--accent);border:1px solid var(--accent);border-radius:2px;padding:6px 10px;margin-bottom:18px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:22px}h1{font-size:22px;margin:0 0 10px}p{margin:0 0 12px}.muted{color:var(--muted)}.warn{color:var(--danger);font-weight:600}
dl{display:grid;grid-template-columns:auto 1fr;gap:1px;margin:16px 0;border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--border)}dt,dd{margin:0;padding:9px 12px;background:var(--bg)}dt{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.04em}dd{word-break:break-word}ul{padding-left:20px;margin:6px 0 12px}
label{display:block;margin:12px 0 4px;font-weight:600}input[type=text],input[type=password]{width:100%;padding:9px 10px;border-radius:2px;border:1px solid var(--border);background:var(--bg);color:var(--text);font:inherit}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}button,.btn{font-family:inherit;font-weight:600;font-size:15px;line-height:1;padding:11px 16px;border-radius:2px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;text-decoration:none}
button.yes{background:var(--accent);border-color:var(--accent);color:var(--bg)}button.yes.danger{background:var(--danger);border-color:var(--danger);color:#fff}code{font:13px ui-monospace,Menlo,monospace}
.ok{color:var(--accent)}.note{border-left:3px solid var(--accent);padding-left:10px}ul.flags{margin:0;padding-left:0;list-style:none;color:var(--danger)}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:400}footer{margin-top:18px;font-size:13px;color:var(--muted)}
</style></head><body><main><div class="badge">🔒 LIFE CONSOLE · TRUSTED PAGE</div><div class="card">${body}</div>
<footer>This page never runs extensions or scripts. Life Console only asks for consent, keys and passwords here. <a href="${appPath}?safe=1" style="color:inherit">Open the console without Public extensions</a></footer></main></body></html>`
    return { status, html }
  }
  /** Plain names for the places an extension can appear (src/sdk/whereShown.js). */
  const SLOT_NAMES = { 'today.card': 'Today', 'week.strip': 'Plan week', 'strategy.plan': 'Strategic plans', 'todo.panel': 'Todo details', 'settings.section': 'Settings' }
  /** Where to go back to in the console: only a path in this app (never another site). */
  const safeBack = (v) => (typeof v === 'string' && /^\/app(#\/[\w\-/.?=&%]*)?$/.test(v) ? v : `${appPath}#/m/extensions`)
  /** Add a notice (and other query values) to a console address, for the console to show when you're back. */
  const withQuery = (back, params) => {
    const [path, hash = '/'] = back.split('#')
    const [route, q = ''] = hash.split('?')
    const qs = new URLSearchParams(q)
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
    return `${path}#${route}?${qs}`
  }
  const back = (label = 'Back to Life Console') => `<div class="row"><a class="btn" href="${appPath}">${esc(label)}</a></div>`

  async function newNonce(uid, action) {
    const nonce = crypto.randomBytes(32).toString('base64url')
    await db.delete(consentNonces).where(lt(consentNonces.createdAt, new Date(Date.now() - NONCE_TTL)))
    await db.insert(consentNonces).values({ nonceHash: sha256(nonce), userId: uid, action })
    return nonce
  }

  /** What the page shows for an action (and the extra fields it asks for). */
  async function describe(user, q, req) {
    const kind = q.get('do')
    const k = KINDS[kind]
    if (!k) return null
    const action = { kind }
    let details = '', fields = '', warning = '', gentle = false, formAction = ''
    if (kind === 'enable-plugins') {
      warning = 'Public extensions are made by other people. An extension you install can see and change everything in your planner and send it anywhere. Only install extensions from people you trust.'
      details = '<p class="muted">From now on, creating access tokens, changing your password and deleting your account also need this page.</p>'
    } else if (kind === 'disable-plugins') {
      details = '<p>Every Public extension is switched off. Your planner and the extensions\' data stay; you can switch them on again one by one.</p>'
    } else if (kind === 'install') {
      const v = await registry.version(user, q.get('hash'))
      if (!v || v.packageName !== q.get('pkg') || v.pulled) return { missing: true }
      action.pkg = v.packageName; action.hash = v.hash
      const says = v.manifest.says ?? {}
      const warnings = v.checks.warnings ?? []
      const shows = v.manifest.shows ?? {}
      const where = [...(shows.pages ? [`its own page${shows.pages > 1 ? 's' : ''}`] : []), ...(shows.slots ?? []).map((x) => SLOT_NAMES[x] ?? x)]
      const passed = v.checks.passed ?? []
      details = `<dl><dt>Extension</dt><dd><b>${esc(v.manifest.title)}</b> <code>${esc(v.packageName)}</code></dd><dt>Version</dt><dd>${esc(v.version)}</dd>
<dt>Made by</dt><dd>${esc(v.packageName.split('/')[0])}</dd><dt>Who can see it</dt><dd>${v.pkg.visibility === 'public' ? 'Everyone' : 'Only you'}</dd>
${where.length ? `<dt>Where it appears</dt><dd>${esc(where.join(', '))}</dd>` : ''}
<dt>Internet</dt><dd>${says.internet?.length ? `Talks to ${esc(says.internet.join(', '))}` : '<span class="ok">None: it talks to no outside sites</span>'}</dd>
${says.connections?.length ? `<dt>Uses your accounts</dt><dd>${esc(says.connections.join(', '))}</dd>` : ''}
${says.replaces?.length ? `<dt>Replaces</dt><dd class="warn">${esc(says.replaces.join(', '))}</dd>` : ''}
${v.pkg?.forkedFrom && (await registry.installed(user.id)).some((x) => x.pkg === v.pkg.forkedFrom) ? `<dt>Instead of</dt><dd>${esc(v.pkg.forkedFrom)} (your copy takes its place; its data stays)</dd>` : ''}
<dt>Automated checks</dt><dd>${warnings.length ? `<ul class="flags">${warnings.map((w) => `<li>⚠ ${esc(w.msg)}</li>`).join('')}</ul>` : `<span class="ok">${passed.length ? `All ${passed.length} passed` : 'Nothing to flag'}</span>`}</dd></dl>
<p class="muted">What it says it does is the author's statement, not a guarantee. You can switch it off or remove it any time in Extensions.</p>
${v.changelog ? `<p><b>What's new:</b> ${esc(v.changelog.slice(0, 600))}</p>` : ''}`
      const own = user.handle && v.packageName.startsWith(`${user.handle}/`)
      gentle = !!own
      warning = own
        ? 'This is your own extension. Like any extension, it can see and change everything in your planner.'
        : 'It will be able to see and change everything in your planner and send it to the sites it talks to (listed below). Only install extensions from people you trust.'
      if (!user.publicPlugins) details += '<p class="muted">This is your first extension: installing it also turns on extensions for your account. From then on, creating access tokens, changing your password and deleting your account are confirmed on this page too.</p>'
    } else if (kind === 'remove' || kind === 'toggle') {
      action.pkg = String(q.get('pkg') ?? '')
      if (kind === 'toggle') action.on = q.get('on') === '1'
      details = `<p>${kind === 'remove' ? 'Remove' : action.on ? 'Switch on' : 'Switch off'} <code>${esc(action.pkg)}</code>.</p>${kind === 'remove' ? '<label class="check"><input type="checkbox" name="forget" value="1"> Also delete its data from my planner</label>' : ''}`
    } else if (kind === 'token') {
      action.name = String(q.get('name') ?? 'Mac app').slice(0, 60)
      details = `<p>An access token lets the app named <b>${esc(action.name)}</b> read your planner and mark tasks done, without signing in. It replaces that name's previous token.</p>`
    } else if (kind === 'claude') {
      details = '<p>Claude (Claude Code, or another app that supports MCP) can work in your workshop and manage your extensions: publish, edit listings, remove and switch off. It can\'t see your planner, and installing, updating or switching on still asks you here.</p><p class="muted">Connecting again replaces the previous connection (and switches planner access off).</p>'
    } else if (kind === 'claude-planner' || kind === 'claude-planner-off') {
      const has = await auth.hasTokenScope(user.id, CLAUDE_TOKEN, 'planner')
      if (has === null) return { noClaude: true }
      if (kind === 'claude-planner') {
        warning = 'Claude will read your tasks, time blocks, deadlines and plans, and the app you connected sends them to Anthropic (or whichever AI it uses). It can add tasks and deadlines and change or complete tasks. It can\'t delete anything.'
        details = `<p>This is separate from the workshop: Claude already connected there can't see your planner until you confirm here.${has ? ' <b>It already can.</b>' : ''}</p><p class="muted">Every change is labelled "Claude" and kept in your planner's snapshots. Switch it off any time at <a href="/trust?do=claude-planner-off" style="color:inherit">${esc(origin(req))}/trust?do=claude-planner-off</a>, or by connecting Claude again.</p>`
      } else {
        details = `<p>Claude keeps working in your workshop, but can no longer read or change your planner.${has ? '' : ' <span class="muted">(It can\'t now either.)</span>'}</p>`
      }
    } else if (kind === 'dev-test') {
      await live?.ensure?.(user.id)
      const d = q.get('slug') ? live?.draft(user.id, q.get('slug')) : live?.draft(user.id)
      if (!d) return { noDraft: true }
      const on = live.dev(user.id)
      const adding = on && !on.slugs.includes(d.slug) ? on : null // a test is on for another draft: this one joins it
      const name = d.editing ?? `${user.handle || 'you'}/${d.slug || 'draft'}`
      action.name = name
      action.slug = d.slug // the draft shown here is the one that runs, even if the workshop switches meanwhile
      const blocked = checkDraft(d.files).errors
      warning = 'The draft will see and change everything in your planner. Unlike an installed version, its code can change while it runs: each time Claude (or you) edits it, the new version loads without asking you again.'
      details = `<dl><dt>Draft</dt><dd><code>${esc(name)}</code>${d.editing ? ' (in place of your installed version)' : ''}${adding ? `, joining the live test that's on (${adding.slugs.map(esc).join(', ')})` : ''}</dd>
<dt>For</dt><dd>${adding ? `Until the test ends, at <b>${new Date(adding.until).toISOString().slice(11, 16)}</b> UTC.` : '60 minutes at most, through a server restart too.'}</dd>
<dt>Safety net</dt><dd>${adding ? 'The snapshot taken when the test started.' : 'A snapshot of your planner is taken now.'} The <b>Live test</b> bar in the console has <b>Stop</b> and <b>Stop and undo</b>: undo puts your planner back as it was ${adding ? 'when the test started' : 'now'} (your own changes in the meantime too).</dd>
<dt>Checks</dt><dd>${blocked.length ? `<span class="warn">This version is blocked: ${esc(blocked.join('; '))}</span>` : 'Each version is checked before it runs (no code from elsewhere, no eval); a blocked one doesn\'t load.'}</dd></dl>
<p class="muted">Anything it saves in your planner stays after the test, unless you undo.</p>`
    } else if (kind === 'vault-save') {
      if (!vault.on) return { vaultOff: true }
      action.name = String(q.get('name') ?? '').toLowerCase().slice(0, 30)
      action.site = String(q.get('site') ?? '').toLowerCase().slice(0, 200)
      action.scheme = String(q.get('scheme') ?? 'bearer').slice(0, 60)
      details = `<p>Paste the key for <b>${esc(action.name || 'this connection')}</b>. It's stored encrypted and never shown again, to extensions or to you. It is only ever sent to <b>${esc(action.site || 'the site you name')}</b>.</p>`
      fields = `${action.name ? '' : '<label for="n">Name</label><input id="n" type="text" name="name" placeholder="strava" required>'}
${action.site ? '' : '<label for="s">Site</label><input id="s" type="text" name="site" placeholder="www.strava.com" required>'}
<label for="k">Key</label><input id="k" type="password" name="secret" autocomplete="off" required>`
    } else if (kind === 'connect') {
      if (!vault.on) return { vaultOff: true }
      const p = providers[String(q.get('provider') ?? '')]
      if (!p) return { missing: true }
      action.provider = p.name
      formAction = new URL(p.authUrl).origin // the form's POST answers with a redirect there: CSP form-action must allow it
      details = `<p>Connect your <b>${esc(p.title)}</b> account. You'll sign in on ${esc(p.title)}'s own site and come back here.</p>
<dl><dt>Access asked for</dt><dd><code>${esc(p.scope || 'basic')}</code></dd><dt>Sent only to</dt><dd>${esc(p.site)}</dd></dl>
<p class="muted">The tokens are stored encrypted and never shown, to extensions or to you. Extensions that say they use the ${esc(p.name)} connection can ask Life Console to make requests with it.</p>`
    } else if (kind === 'pod-use' || kind === 'pod-import') {
      details = kind === 'pod-use'
        ? '<p>From now on, every time your planner is saved it is also written to this Solid pod, as JSON-LD any Solid app can read. Life Console keeps its working copy here too.</p>'
        : '<p>Read a Life Console planner from a Solid pod (another server\'s built-in pod, or your own Solid server) and <b>replace the planner on this server with it</b>. The current one is kept as a snapshot you can restore.</p>'
      if (kind === 'pod-import') warning = 'This replaces your planner on this server.'
      fields = `<label for="u">Pod address</label><input id="u" type="text" name="pod" placeholder="https://pod.example/alice/ (or https://other-life-console/pods/alice/)" required>
<label for="t">Access token (if the pod needs one)</label><input id="t" type="password" name="token" autocomplete="off">
<p class="muted" style="font-size:13px">A Solid server such as the Community Solid Server gives apps an <b>id and secret</b> instead (its account page → credential tokens):</p>
<label for="ci">App id</label><input id="ci" type="text" name="clientId" autocomplete="off"><label for="cs">App secret</label><input id="cs" type="password" name="clientSecret" autocomplete="off">
<p class="muted" style="font-size:13px">${kind === 'pod-use' ? 'The token is kept in the vault, encrypted, and only sent to that pod.' : 'For another Life Console server: its Settings → Mac menu-bar app creates an access token. The token is used once and not kept.'}</p>`
    } else if (kind === 'share') {
      if (!user.handle) return { noHandle: true }
      const doc = await planner.get(user.id)
      const plan = (doc.state?.plans ?? []).find((p) => p.id === q.get('plan'))
      if (!plan) return { missing: true }
      action.planId = plan.id
      details = `<p>Share <b>${esc(plan.title ?? plan.id)}</b> with someone on another Life Console server (or another ActivityPub server).</p>
<p class="muted">Life Console servers read it live from here, so stopping sharing works for them. Other fediverse servers (Mastodon…) get a copy they keep.</p>`
      fields = `<label for="to">Their address</label><input id="to" type="text" name="to" placeholder="@supervisor@lc.example-uni.ac.uk" value="${esc(q.get('to') ?? '')}" required>
<label class="check"><input type="checkbox" name="edit" value="1"${q.get('access') === 'edit' ? ' checked' : ''}> They can edit milestones and health</label>`
    } else if (kind === 'unshare') {
      action.id = String(q.get('id') ?? '')
      details = '<p>Stop sharing this plan. Their server can\'t read it any more; a copy a plain fediverse server already got stays there.</p>'
    } else if (kind === 'move') {
      if (!user.handle) return { noHandle: true }
      warning = 'After moving, this server forwards your address and messages to the new place.'
      details = '<p>First copy your planner to the new server (there: Settings → Your data → Copy my planner from a pod) and choose a handle there. Then give its address here. Everyone you share with is told where you are now.</p>'
      fields = '<label for="to">Your new address</label><input id="to" type="text" name="to" placeholder="@alice@my-own-server.example" required>'
    } else if (kind === 'pod-builtin') {
      details = '<p>Your planner goes back to being written to the pod built into this server. Your own pod keeps what it already has.</p>'
    } else if (kind === 'vault-remove') {
      action.name = String(q.get('name') ?? '').slice(0, 30)
      details = `<p>Remove the saved key <b>${esc(action.name)}</b>. Extensions that use it stop working until you add it again.</p>`
    } else if (kind === 'password') {
      if (!user.passwordHash) return { noPassword: true }
      fields = '<label for="c">Current password</label><input id="c" type="password" name="current" autocomplete="current-password" required><label for="p">New password</label><input id="p" type="password" name="password" autocomplete="new-password" required minlength="8">'
    } else if (kind === 'delete-account') {
      warning = 'This deletes your account and your whole planner on this server. It can\'t be undone.'
      fields = user.passwordHash ? '<label for="c">Your password</label><input id="c" type="password" name="password" required>' : `<label for="c">Type your email (${esc(user.email)})</label><input id="c" type="text" name="confirm" required>`
    }
    return { kind, k, action, details, fields, warning, gentle, formAction }
  }

  async function get(req, res, url) {
    if (!isDocumentNavigation(req)) return { status: 403, html: page('Not available', '<h1>Open this page directly</h1><p>The trusted page only opens as a page of its own, in a browser that sends Fetch Metadata (current Chrome, Edge, Firefox and Safari).</p>').html }
    const who = await auth.identify(req)
    if (!who || who.via !== 'session') return page('Sign in first', `<h1>Sign in first</h1><p>Sign in to Life Console in this browser, then try again.</p>${back('Go to Life Console')}`)
    const user = who.user
    const d = await describe(user, url.searchParams, req)
    if (!d) return page('Trusted page', `<h1>Trusted page</h1><p>Nothing to confirm.</p><p class="muted">Life Console asks for consent, keys and passwords only on this page.</p>${back()}`)
    if (d.missing) return page('Not found', `<h1>That extension version isn't available</h1><p>It may have been pulled from the registry.</p>${back()}`)
    if (d.vaultOff) return page('Vault off', `<h1>Connections are off on this server</h1><p>The server's admin hasn't set a vault key (VAULT_KEY).</p>${back()}`)
    if (d.noHandle) return page('Choose a handle', `<h1>Choose a handle first</h1><p>Your handle is your address for sharing (Extensions → Publishing).</p>${back()}`)
    if (d.noDraft) return page('No draft', `<h1>There's no draft to test</h1><p>Open the workshop, or ask Claude to write one, then try again.</p>${back()}`)
    if (d.noClaude) return page('Connect Claude first', `<h1>Connect Claude first</h1><p>Planner access is added to Claude's workshop connection: <a href="/trust?do=claude" style="color:inherit">connect Claude</a>, then come back here.</p>${back()}`)
    if (d.noPassword) return page('No password', `<h1>This account signs in with Google</h1><p>It has no password to change.</p>${back()}`)
    const backTo = safeBack(url.searchParams.get('back'))
    d.action.back = backTo
    const nonce = await newNonce(user.id, d.action)
    const html = page(d.k.title, `<h1>${esc(d.k.title)}</h1>${d.warning ? `<p class="${d.gentle ? 'note' : 'warn'}">${esc(d.warning)}</p>` : ''}${d.details}
<form method="post" action="/trust"><input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="do" value="${esc(d.kind)}">${d.fields}
<div class="row"><button class="yes${d.k.danger ? ' danger' : ''}" type="submit" name="decision" value="yes">${d.kind === 'install' ? 'Install' : d.kind === 'connect' ? 'Continue' : 'Confirm'}</button><a class="btn" href="${esc(backTo)}">Cancel</a></div></form>
<p class="muted" style="margin-top:14px;font-size:13px">Signed in as ${esc(user.email)}</p>`)
    if (d.formAction) html.headers = { 'Content-Security-Policy': TRUST_HEADERS['Content-Security-Policy'].replace("form-action 'self'", `form-action 'self' ${d.formAction}`) }
    return html
  }

  /** Run a confirmed action. `form` holds the fields typed on the page (password, key…); the action comes from the nonce. */
  async function run(who, a, form, req) {
    const user = who.user
    const uid = user.id
    switch (a.kind) {
      case 'enable-plugins':
        await db.update(users).set({ publicPlugins: true, updatedAt: new Date() }).where(eq(users.id, uid))
        return { msg: 'Public extensions are on for your account. Install extensions from Settings → Extensions.' }
      case 'disable-plugins':
        await registry.disableAll(uid)
        return { msg: 'Every Public extension is switched off.' }
      case 'install': {
        if (!user.publicPlugins) await db.update(users).set({ publicPlugins: true, updatedAt: new Date() }).where(eq(users.id, uid))
        const r = await registry.install(uid, a.pkg, a.hash)
        log(`[consent] ${uid.slice(0, 8)} installed ${a.pkg}@${r.version}`)
        return { msg: `Installed ${a.pkg} ${r.version}`, added: a.pkg }
      }
      case 'remove':
        await registry.uninstall(uid, a.pkg)
        return { msg: `Removed ${a.pkg}.`, forget: form.get('forget') === '1' ? a.pkg : null }
      case 'toggle':
        await registry.setEnabled(uid, a.pkg, a.on)
        return { msg: `${a.pkg} is ${a.on ? 'on' : 'off'}.`, added: a.on ? a.pkg : null }
      case 'token': {
        const token = await auth.replaceApiToken(uid, a.name)
        log(`[consent] api token "${a.name}" for ${uid.slice(0, 8)}`)
        return { msg: `Token for ${a.name} created. It is shown once.`, token }
      }
      case 'claude': {
        const token = await auth.replaceApiToken(uid, CLAUDE_TOKEN, 'extensions')
        log(`[consent] workshop token for ${uid.slice(0, 8)}`)
        return { msg: 'Claude can now work in your workshop. Run this once in a terminal, then ask Claude to make or change an extension with the workshop open.', command: `claude mcp add --transport http life-console ${origin(req)}/mcp --header "Authorization: Bearer ${token}"`, url: `${origin(req)}/mcp`, token }
      }
      case 'dev-test': {
        await live?.ensure?.(uid)
        const d = a.slug ? live?.draft(uid, a.slug) : live?.draft(uid)
        if (!d) return { msg: 'There is no draft to test any more.' }
        // joining a test that's on keeps its end and its snapshot; a new test takes a snapshot first
        const checkpoint = live.dev(uid) ? null : await planner.checkpoint(uid, 'before live test')
        live.startDev(uid, { checkpoint, slug: d.slug })
        log(`[consent] live test on for ${uid.slice(0, 8)}`)
        return { msg: 'Live test on for 60 minutes: the draft runs on your planner. Stop it from the bar at the top.' }
      }
      case 'claude-planner':
      case 'claude-planner-off': {
        const on = a.kind === 'claude-planner'
        if (!(await auth.setTokenScope(uid, CLAUDE_TOKEN, 'planner', on))) return { msg: 'Connect Claude to the workshop first.' }
        log(`[consent] claude planner access ${on ? 'on' : 'off'} for ${uid.slice(0, 8)}`)
        return { msg: on ? 'Claude can now see and change your planner.' : 'Claude can no longer see your planner.' }
      }
      case 'vault-save': {
        const saved = await vault.save(uid, { name: a.name || form.get('name'), site: a.site || form.get('site'), scheme: a.scheme || 'bearer', secret: form.get('secret') })
        return { msg: `Saved the ${saved.name} key for ${saved.site}. It won't be shown again.` }
      }
      case 'connect': {
        const p = providers[a.provider]
        if (!p) throw httpError(404, 'That provider is not set up on this server')
        const state = await newNonce(uid, { kind: 'connect-callback', provider: p.name })
        const u = new URL(p.authUrl)
        for (const [k, v] of Object.entries({ client_id: p.clientId, redirect_uri: `${origin(req)}/trust/oauth`, response_type: 'code', scope: p.scope, state, ...p.extra })) if (v) u.searchParams.set(k, v)
        return { redirect: u.toString() }
      }
      case 'pod-use': {
        const podUrl = String(form.get('pod') ?? '').trim()
        const token = String(form.get('token') ?? '')
        const oidc = form.get('clientId') ? { clientId: String(form.get('clientId')), clientSecret: String(form.get('clientSecret') ?? '') } : null
        const client = podClient(podUrl, oidc ? { oidc } : { token })
        if (token || oidc) {
          if (!vault.on) throw httpError(503, 'Saving pod credentials needs the vault (the admin sets VAULT_KEY)')
          await vault.save(uid, { name: 'pod', site: new URL(podUrl).hostname, scheme: 'bearer', secret: oidc ? JSON.stringify(oidc) : token })
        }
        const doc = await planner.get(uid)
        const n = doc.state ? await pods.mirror(user, doc.state, { base: client.base, remote: client }) : 0
        await db.update(users).set({ podUrl: client.base, updatedAt: new Date() }).where(eq(users.id, uid))
        return { msg: `Your planner now lives in ${client.base} too (${n} resources written).` }
      }
      case 'share': {
        const s = await fed.share(user, req, { planId: a.planId, to: form.get('to'), access: form.get('edit') === '1' ? 'edit' : 'view' })
        return { msg: `Shared with ${s.actor} (${s.access === 'edit' ? 'can edit' : 'view only'}).` }
      }
      case 'unshare':
        await fed.unshare(user, req, a.id)
        return { msg: 'Stopped sharing.' }
      case 'move': {
        const m = await fed.move(user, req, form.get('to'))
        return { msg: `Moved: your address now leads to ${m.movedTo}. ${m.told} partner server(s) were told.` }
      }
      case 'pod-builtin':
        await db.update(users).set({ podUrl: null, updatedAt: new Date() }).where(eq(users.id, uid))
        if (vault.on) await vault.remove(uid, 'pod')
        return { msg: 'Your planner is written to this server\'s pod again.' }
      case 'pod-import': {
        const oidcIn = form.get('clientId') ? { clientId: String(form.get('clientId')), clientSecret: String(form.get('clientSecret') ?? '') } : null
        const client = podClient(String(form.get('pod') ?? '').trim(), oidcIn ? { oidc: oidcIn } : { token: String(form.get('token') ?? '') })
        const state = await pods.readPlanner(client)
        const r = await planner.save(uid, { state, force: true, device: 'pod-import', reason: 'pod-import' })
        if (!r.ok) throw httpError(409, 'The planner could not be replaced (it is newer than this server understands)')
        // the people this planner was shared with come along (records are read from this server from now on)
        const sh = await pods.readOne(client, 'sharing/shares.json')
        for (const s of (sh?.shares ?? []).slice(0, 500)) await fed.adoptShare(user, s)
        log(`[consent] ${uid.slice(0, 8)} copied a planner from ${client.base}`)
        return { msg: `Copied your planner from ${client.base}. Your devices pick it up at their next sync; the old one is a snapshot in Settings → Sync.` }
      }
      case 'vault-remove':
        await vault.remove(uid, a.name)
        return { msg: `Removed the ${a.name} key.` }
      case 'password':
        if (!(await verifyPassword(String(form.get('current') ?? ''), user.passwordHash))) throw httpError(401, 'Current password is wrong')
        await auth.setPassword(uid, String(form.get('password') ?? ''))
        await auth.endOtherSessions(uid, who.tokenHash)
        return { msg: 'Password changed. Other devices have to sign in again.' }
      case 'delete-account': {
        const ok = user.passwordHash ? await verifyPassword(String(form.get('password') ?? ''), user.passwordHash) : normEmail(form.get('confirm')) === user.email
        if (!ok) throw httpError(401, user.passwordHash ? 'Wrong password' : 'Type your email exactly to confirm')
        await db.delete(users).where(eq(users.id, uid))
        log(`[consent] deleted account ${uid.slice(0, 8)}`)
        return { msg: 'Your account is deleted.', deleted: true }
      }
    }
    throw httpError(400, 'unknown action')
  }

  async function post(req, res, rawBody) {
    if (!isDocumentNavigation(req) || req.headers['sec-fetch-site'] !== 'same-origin') return { status: 403, html: page('Refused', '<h1>Refused</h1><p>Confirmations only come from the trusted page itself.</p>').html }
    const who = await auth.identify(req)
    if (!who || who.via !== 'session') return page('Sign in first', `<h1>Sign in first</h1>${back('Go to Life Console')}`)
    const form = new URLSearchParams(rawBody)
    const nonce = String(form.get('nonce') ?? '')
    const [row] = nonce ? await db.select().from(consentNonces).where(and(eq(consentNonces.nonceHash, sha256(nonce)), eq(consentNonces.userId, who.user.id), isNull(consentNonces.usedAt))) : []
    if (!row || Date.now() - new Date(row.createdAt).getTime() > NONCE_TTL || row.action.kind !== form.get('do')) {
      return { status: 400, html: page('Expired', `<h1>This confirmation expired</h1><p>Start again from the console.</p>${back()}`).html }
    }
    await db.update(consentNonces).set({ usedAt: new Date() }).where(eq(consentNonces.nonceHash, row.nonceHash))
    const backTo = safeBack(row.action.back)
    if (form.get('decision') !== 'yes') return { status: 303, html: '', headers: { Location: backTo } }
    try {
      const r = await run(who, row.action, form, req)
      if (r.redirect) return { status: 303, html: '', headers: { Location: r.redirect } }
      const extra = r.command ? `<label for="cmd">Claude Code</label><textarea id="cmd" readonly rows="4" style="width:100%;padding:9px 10px;border-radius:2px;border:1px solid var(--border);background:var(--bg);color:var(--text);font:13px ui-monospace,Menlo,monospace;resize:vertical">${esc(r.command)}</textarea><details><summary class="muted">Another app</summary><p class="muted">Add an MCP server at <code>${esc(r.url)}</code> (HTTP) with the header <code>Authorization: Bearer …</code> and this token:</p><input type="text" readonly value="${esc(r.token)}"></details><p class="muted">It's shown once.</p>` : r.token ? `<label>Token</label><input type="text" readonly value="${esc(r.token)}"><div class="row"><a class="btn" href="lifeconsole-now://connect?server=${encodeURIComponent(`${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`)}&token=${encodeURIComponent(r.token)}">Open in the Mac app</a></div>` : ''
      if (!r.token && !r.deleted) return { status: 303, html: '', headers: { Location: withQuery(backTo, { notice: r.msg, forget: r.forget, added: r.added }) } }
      const next = r.deleted ? '/' : backTo
      const headers = r.deleted ? { 'Set-Cookie': auth.clearCookie(secureFor(req)) } : {}
      return { ...page('Done', `<h1>Done</h1><p>${esc(r.msg)}</p>${extra}<div class="row"><a class="btn" href="${esc(next)}">Back to Life Console</a></div>`), headers }
    } catch (e) {
      if (!e.status || e.status >= 500) throw e
      return { status: e.status, html: page('Not done', `<h1>Not done</h1><p>${esc(e.message)}</p><div class="row"><a class="btn" href="${esc(backTo)}">Back to Life Console</a></div>`).html }
    }
  }

  /** The provider sends the person back here: check the state (a one-time nonce), exchange the code, save the tokens. */
  async function oauthCallback(req, url) {
    if (!isDocumentNavigation(req)) return { status: 403, html: page('Refused', '<h1>Refused</h1>').html }
    const who = await auth.identify(req)
    if (!who || who.via !== 'session') return page('Sign in first', `<h1>Sign in first</h1>${back('Go to Life Console')}`)
    const state = String(url.searchParams.get('state') ?? '')
    const [row] = state ? await db.select().from(consentNonces).where(and(eq(consentNonces.nonceHash, sha256(state)), eq(consentNonces.userId, who.user.id), isNull(consentNonces.usedAt))) : []
    if (!row || row.action.kind !== 'connect-callback' || Date.now() - new Date(row.createdAt).getTime() > NONCE_TTL) return { status: 400, html: page('Expired', `<h1>This connection attempt expired</h1><p>Start again from Extensions → Connections.</p>${back()}`).html }
    await db.update(consentNonces).set({ usedAt: new Date() }).where(eq(consentNonces.nonceHash, row.nonceHash))
    const p = providers[row.action.provider]
    if (!p) return { status: 404, html: page('Not set up', `<h1>That provider is not set up on this server</h1>${back()}`).html }
    if (url.searchParams.get('error') || !url.searchParams.get('code')) return page('Not connected', `<h1>Not connected</h1><p>${esc(p.title)} said: ${esc(url.searchParams.get('error') ?? 'no code')}</p>${back()}`)
    try {
      const tokens = await tokenRequest(p, { grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: `${origin(req)}/trust/oauth` })
      await vault.saveOAuth(who.user.id, p, tokens)
      log(`[consent] ${who.user.id.slice(0, 8)} connected ${p.name}`)
      return page('Connected', `<h1>Connected</h1><p>Your ${esc(p.title)} account is connected. Extensions that use it can make requests to ${esc(p.site)}; you can remove it any time in Extensions → Connections.</p>${back()}`)
    } catch (e) {
      return { status: 502, html: page('Not connected', `<h1>Not connected</h1><p>${esc(e.message)}</p>${back()}`).html }
    }
  }

  return { get, post, oauthCallback, KINDS }
}
