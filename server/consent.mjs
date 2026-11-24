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
  install: { title: 'Install a plugin', danger: true },
  remove: { title: 'Remove a plugin' },
  toggle: { title: 'Switch a plugin on or off' },
  token: { title: 'Create an access token', danger: true },
  'vault-save': { title: 'Save a connection key', danger: true },
  connect: { title: 'Connect an account', danger: true },
  'vault-remove': { title: 'Remove a connection key' },
  password: { title: 'Change your password', danger: true },
  'delete-account': { title: 'Delete your account', danger: true },
}

export function createConsent({ db, auth, registry, vault, log = () => {}, appPath = '/app', secureFor = () => false, providers = {}, appUrl = '' }) {
  const origin = (req) => appUrl || `${secureFor(req) ? 'https' : 'http'}://${req.headers.host}`
  function page(title, body, { status = 200 } = {}) {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Life Console trusted page</title>
<style>
:root{--bg:#0e1116;--surface:#161b22;--border:#2a323d;--text:#e6edf3;--muted:#8b96a3;--accent:#3fb68b;--danger:#e5534b;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f7f7f5;--surface:#fff;--border:#d9dde2;--text:#1a1f24;--muted:#5f6b77;--accent:#187a56;--danger:#c4332b;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:560px;margin:40px auto;padding:0 16px}.badge{display:inline-flex;gap:8px;align-items:center;font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;color:var(--accent);border:1px solid var(--accent);border-radius:999px;padding:6px 10px;margin-bottom:18px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:22px}h1{font-size:22px;margin:0 0 10px}p{margin:0 0 12px}.muted{color:var(--muted)}.warn{color:var(--danger);font-weight:600}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:14px 0}dt{color:var(--muted)}dd{margin:0;word-break:break-word}ul{padding-left:20px;margin:6px 0 12px}
label{display:block;margin:12px 0 4px;font-weight:600}input[type=text],input[type=password]{width:100%;padding:9px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font:inherit}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}button,.btn{font:600 15px/1 inherit;padding:11px 16px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;text-decoration:none}
button.yes{background:var(--accent);border-color:var(--accent);color:var(--bg)}button.yes.danger{background:var(--danger);border-color:var(--danger);color:#fff}code{font:13px ui-monospace,Menlo,monospace}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:400}footer{margin-top:18px;font-size:13px;color:var(--muted)}
</style></head><body><main><div class="badge">🔒 LIFE CONSOLE · TRUSTED PAGE</div><div class="card">${body}</div>
<footer>This page never runs plugins or scripts. Life Console only asks for consent, keys and passwords here. <a href="${appPath}?safe=1" style="color:inherit">Open the console without Public plugins</a></footer></main></body></html>`
    return { status, html }
  }
  const back = (label = 'Back to Life Console') => `<div class="row"><a class="btn" href="${appPath}">${esc(label)}</a></div>`

  async function newNonce(uid, action) {
    const nonce = crypto.randomBytes(32).toString('base64url')
    await db.delete(consentNonces).where(lt(consentNonces.createdAt, new Date(Date.now() - NONCE_TTL)))
    await db.insert(consentNonces).values({ nonceHash: sha256(nonce), userId: uid, action })
    return nonce
  }

  /** What the page shows for an action (and the extra fields it asks for). */
  async function describe(user, q) {
    const kind = q.get('do')
    const k = KINDS[kind]
    if (!k) return null
    const action = { kind }
    let details = '', fields = '', warning = '', formAction = ''
    if (kind === 'enable-plugins') {
      warning = 'Public plugins are made by other people. A plugin you install can see and change everything in your planner and send it anywhere. Only install plugins from people you trust.'
      details = '<p class="muted">From now on, creating access tokens, changing your password and deleting your account also need this page.</p>'
    } else if (kind === 'disable-plugins') {
      details = '<p>Every Public plugin is switched off. Your planner and the plugins\' data stay; you can switch them on again one by one.</p>'
    } else if (kind === 'install') {
      if (!user.publicPlugins) return { needEnable: true }
      const v = await registry.version(user, q.get('hash'))
      if (!v || v.packageName !== q.get('pkg') || v.pulled) return { missing: true }
      action.pkg = v.packageName; action.hash = v.hash
      const says = v.manifest.says ?? {}
      const warnings = v.checks.warnings ?? []
      details = `<dl><dt>Plugin</dt><dd><b>${esc(v.manifest.title)}</b> <code>${esc(v.packageName)}</code></dd><dt>Version</dt><dd>${esc(v.version)}</dd>
<dt>Made by</dt><dd>${esc(v.packageName.split('/')[0])}</dd><dt>Visibility</dt><dd>${esc(v.pkg.visibility)}</dd>
<dt>Talks to</dt><dd>${says.internet?.length ? esc(says.internet.join(', ')) : 'no sites (it says)'}</dd>
${says.connections?.length ? `<dt>Uses connections</dt><dd>${esc(says.connections.join(', '))}</dd>` : ''}
${says.replaces?.length ? `<dt>Replaces</dt><dd class="warn">${esc(says.replaces.join(', '))}</dd>` : ''}</dl>
<p class="muted">What it says it does is the author's statement, not a guarantee.</p>
${warnings.length ? `<p><b>Automated checks found:</b></p><ul>${warnings.map((w) => `<li>${esc(w.msg)}</li>`).join('')}</ul>` : '<p class="muted">Automated checks found nothing to flag.</p>'}
${v.changelog ? `<p><b>What's new:</b> ${esc(v.changelog.slice(0, 600))}</p>` : ''}`
      warning = 'It will be able to see and change everything in your planner and send it to the sites it talks to (listed below).'
    } else if (kind === 'remove' || kind === 'toggle') {
      action.pkg = String(q.get('pkg') ?? '')
      if (kind === 'toggle') action.on = q.get('on') === '1'
      details = `<p>${kind === 'remove' ? 'Remove' : action.on ? 'Switch on' : 'Switch off'} <code>${esc(action.pkg)}</code>.</p>${kind === 'remove' ? '<label class="check"><input type="checkbox" name="forget" value="1"> Also delete its data from my planner</label>' : ''}`
    } else if (kind === 'token') {
      action.name = String(q.get('name') ?? 'Mac app').slice(0, 60)
      details = `<p>An access token lets the app named <b>${esc(action.name)}</b> read your planner and mark tasks done, without signing in. It replaces that name's previous token.</p>`
    } else if (kind === 'vault-save') {
      if (!vault.on) return { vaultOff: true }
      action.name = String(q.get('name') ?? '').toLowerCase().slice(0, 30)
      action.site = String(q.get('site') ?? '').toLowerCase().slice(0, 200)
      action.scheme = String(q.get('scheme') ?? 'bearer').slice(0, 60)
      details = `<p>Paste the key for <b>${esc(action.name || 'this connection')}</b>. It's stored encrypted and never shown again, to plugins or to you. It is only ever sent to <b>${esc(action.site || 'the site you name')}</b>.</p>`
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
<p class="muted">The tokens are stored encrypted and never shown, to plugins or to you. Plugins that say they use the ${esc(p.name)} connection can ask Life Console to make requests with it.</p>`
    } else if (kind === 'vault-remove') {
      action.name = String(q.get('name') ?? '').slice(0, 30)
      details = `<p>Remove the saved key <b>${esc(action.name)}</b>. Plugins that use it stop working until you add it again.</p>`
    } else if (kind === 'password') {
      if (!user.passwordHash) return { noPassword: true }
      fields = '<label for="c">Current password</label><input id="c" type="password" name="current" autocomplete="current-password" required><label for="p">New password</label><input id="p" type="password" name="password" autocomplete="new-password" required minlength="8">'
    } else if (kind === 'delete-account') {
      warning = 'This deletes your account and your whole planner on this server. It can\'t be undone.'
      fields = user.passwordHash ? '<label for="c">Your password</label><input id="c" type="password" name="password" required>' : `<label for="c">Type your email (${esc(user.email)})</label><input id="c" type="text" name="confirm" required>`
    }
    return { kind, k, action, details, fields, warning, formAction }
  }

  async function get(req, res, url) {
    if (!isDocumentNavigation(req)) return { status: 403, html: page('Not available', '<h1>Open this page directly</h1><p>The trusted page only opens as a page of its own, in a browser that sends Fetch Metadata (current Chrome, Edge, Firefox and Safari).</p>').html }
    const who = await auth.identify(req)
    if (!who || who.via !== 'session') return page('Sign in first', `<h1>Sign in first</h1><p>Sign in to Life Console in this browser, then try again.</p>${back('Go to Life Console')}`)
    const user = who.user
    const d = await describe(user, url.searchParams)
    if (!d) return page('Trusted page', `<h1>Trusted page</h1><p>Nothing to confirm.</p><p class="muted">Life Console asks for consent, keys and passwords only on this page.</p>${back()}`)
    if (d.needEnable) return page('Turn on Public plugins first', `<h1>Turn on Public plugins first</h1><p>Public plugins are off for your account.</p><div class="row"><a class="btn" href="/trust?do=enable-plugins">Turn them on…</a><a class="btn" href="${appPath}">Cancel</a></div>`)
    if (d.missing) return page('Not found', `<h1>That plugin version isn't available</h1><p>It may have been pulled from the registry.</p>${back()}`)
    if (d.vaultOff) return page('Vault off', `<h1>Connections are off on this server</h1><p>The server's admin hasn't set a vault key (VAULT_KEY).</p>${back()}`)
    if (d.noPassword) return page('No password', `<h1>This account signs in with Google</h1><p>It has no password to change.</p>${back()}`)
    const nonce = await newNonce(user.id, d.action)
    const html = page(d.k.title, `<h1>${esc(d.k.title)}</h1>${d.warning ? `<p class="warn">${esc(d.warning)}</p>` : ''}${d.details}
<form method="post" action="/trust"><input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="do" value="${esc(d.kind)}">${d.fields}
<div class="row"><button class="yes${d.k.danger ? ' danger' : ''}" type="submit" name="decision" value="yes">${d.kind === 'install' ? 'Install' : d.kind === 'connect' ? 'Continue' : 'Confirm'}</button><a class="btn" href="${appPath}">Cancel</a></div></form>
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
        return { msg: 'Public plugins are on for your account. Install plugins from Settings → Plugins.' }
      case 'disable-plugins':
        await registry.disableAll(uid)
        return { msg: 'Every Public plugin is switched off.' }
      case 'install': {
        const r = await registry.install(uid, a.pkg, a.hash)
        log(`[consent] ${uid.slice(0, 8)} installed ${a.pkg}@${r.version}`)
        return { msg: `Installed ${a.pkg} ${r.version}. It loads the next time the console opens.` }
      }
      case 'remove':
        await registry.uninstall(uid, a.pkg)
        return { msg: `Removed ${a.pkg}.`, forget: form.get('forget') === '1' ? a.pkg : null }
      case 'toggle':
        await registry.setEnabled(uid, a.pkg, a.on)
        return { msg: `${a.pkg} is ${a.on ? 'on' : 'off'}.` }
      case 'token': {
        const token = await auth.replaceApiToken(uid, a.name)
        log(`[consent] api token "${a.name}" for ${uid.slice(0, 8)}`)
        return { msg: `Token for ${a.name} created. It is shown once.`, token }
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
    if (form.get('decision') !== 'yes') return page('Cancelled', `<h1>Cancelled</h1>${back()}`)
    try {
      const r = await run(who, row.action, form, req)
      if (r.redirect) return { status: 303, html: '', headers: { Location: r.redirect } }
      const extra = r.token ? `<label>Token</label><input type="text" readonly value="${esc(r.token)}"><div class="row"><a class="btn" href="lifeconsole-now://connect?server=${encodeURIComponent(`${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`)}&token=${encodeURIComponent(r.token)}">Open in the Mac app</a></div>` : ''
      const next = r.deleted ? '/' : r.forget ? `${appPath}#/m/plugins?forget=${encodeURIComponent(r.forget)}` : appPath
      const headers = r.deleted ? { 'Set-Cookie': auth.clearCookie(secureFor(req)) } : {}
      return { ...page('Done', `<h1>Done</h1><p>${esc(r.msg)}</p>${extra}<div class="row"><a class="btn" href="${next}">Back to Life Console</a></div>`), headers }
    } catch (e) {
      if (!e.status || e.status >= 500) throw e
      return { status: e.status, html: page('Not done', `<h1>Not done</h1><p>${esc(e.message)}</p><div class="row"><a class="btn" href="${appPath}">Back to Life Console</a></div>`).html }
    }
  }

  /** The provider sends the person back here: check the state (a one-time nonce), exchange the code, save the tokens. */
  async function oauthCallback(req, url) {
    if (!isDocumentNavigation(req)) return { status: 403, html: page('Refused', '<h1>Refused</h1>').html }
    const who = await auth.identify(req)
    if (!who || who.via !== 'session') return page('Sign in first', `<h1>Sign in first</h1>${back('Go to Life Console')}`)
    const state = String(url.searchParams.get('state') ?? '')
    const [row] = state ? await db.select().from(consentNonces).where(and(eq(consentNonces.nonceHash, sha256(state)), eq(consentNonces.userId, who.user.id), isNull(consentNonces.usedAt))) : []
    if (!row || row.action.kind !== 'connect-callback' || Date.now() - new Date(row.createdAt).getTime() > NONCE_TTL) return { status: 400, html: page('Expired', `<h1>This connection attempt expired</h1><p>Start again from Plugins → Connections.</p>${back()}`).html }
    await db.update(consentNonces).set({ usedAt: new Date() }).where(eq(consentNonces.nonceHash, row.nonceHash))
    const p = providers[row.action.provider]
    if (!p) return { status: 404, html: page('Not set up', `<h1>That provider is not set up on this server</h1>${back()}`).html }
    if (url.searchParams.get('error') || !url.searchParams.get('code')) return page('Not connected', `<h1>Not connected</h1><p>${esc(p.title)} said: ${esc(url.searchParams.get('error') ?? 'no code')}</p>${back()}`)
    try {
      const tokens = await tokenRequest(p, { grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: `${origin(req)}/trust/oauth` })
      await vault.saveOAuth(who.user.id, p, tokens)
      log(`[consent] ${who.user.id.slice(0, 8)} connected ${p.name}`)
      return page('Connected', `<h1>Connected</h1><p>Your ${esc(p.title)} account is connected. Plugins that use it can make requests to ${esc(p.site)}; you can remove it any time in Plugins → Connections.</p>${back()}`)
    } catch (e) {
      return { status: 502, html: page('Not connected', `<h1>Not connected</h1><p>${esc(e.message)}</p>${back()}`).html }
    }
  }

  return { get, post, oauthCallback, KINDS }
}
