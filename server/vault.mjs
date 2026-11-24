// The write-only vault and connections (goal 8, platform/whitepaper.md §9): a key is pasted once on the trusted page,
// stored encrypted (AES-256-GCM, VAULT_KEY), and never shown again: not to plugins, not to the console, not to the
// person. A plugin asks the server to make a request "with the strava connection"; the server adds the key, only for
// the site fixed when it was saved, over https, never to a private address, and returns the answer.
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import { and, eq } from 'drizzle-orm'
import { vaultSecrets } from './db/schema.js'
import { httpError } from './auth.mjs'
import { tokenRequest } from './oauth.mjs'

const NAME = /^[a-z0-9][a-z0-9-]{0,29}$/
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_RESPONSE = 1024 * 1024

/** Private, loopback and link-local addresses: the broker never calls them (no reaching into the server's network). */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v = ip.toLowerCase()
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7))
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')
}

export function createVault(db, cfg, { fetchImpl = fetch, lookup = (h) => dns.lookup(h, { all: true }) } = {}) {
  const key = cfg.vaultKey ? Buffer.from(cfg.vaultKey, 'base64') : null
  const on = !!key && key.length === 32
  const need = () => { if (!on) throw httpError(503, 'The vault is off on this server (the admin sets VAULT_KEY)') }
  function seal(text) {
    const iv = crypto.randomBytes(12)
    const c = crypto.createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([c.update(text, 'utf8'), c.final()])
    return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
  }
  function open(sealed) {
    const [iv, tag, data] = sealed.split('.').map((x) => Buffer.from(x, 'base64'))
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(data), d.final()]).toString('utf8')
  }

  /** Save (or replace) a key. Called only from the trusted page. */
  async function save(uid, { name, site, scheme = 'bearer', secret }) {
    need()
    name = String(name ?? '').toLowerCase().trim()
    site = String(site ?? '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!NAME.test(name)) throw httpError(400, 'A connection name is lower-case letters, digits and dashes, like strava')
    if (!HOST.test(site) && !(cfg.connectionsAllowPrivate && (net.isIP(site) || site === 'localhost'))) throw httpError(400, 'The site is a host name like www.strava.com')
    if (!/^(bearer|header:[A-Za-z0-9-]{1,40}|query:[A-Za-z0-9_]{1,40})$/.test(scheme)) throw httpError(400, 'scheme is bearer, header:<Name> or query:<param>')
    secret = String(secret ?? '')
    if (!secret || secret.length > 8192) throw httpError(400, 'Paste the key (up to 8 KB)')
    await db.insert(vaultSecrets).values({ userId: uid, name, site, scheme, ciphertext: seal(secret) })
      .onConflictDoUpdate({ target: [vaultSecrets.userId, vaultSecrets.name], set: { site, scheme, ciphertext: seal(secret), createdAt: new Date() } })
    return { name, site, scheme }
  }
  /** Save the tokens of an OAuth connection (from the trusted page's callback). */
  async function saveOAuth(uid, provider, tokens) {
    need()
    const value = { userId: uid, name: provider.name, site: provider.site, scheme: `oauth:${provider.name}`, ciphertext: seal(JSON.stringify(tokens)) }
    await db.insert(vaultSecrets).values(value).onConflictDoUpdate({ target: [vaultSecrets.userId, vaultSecrets.name], set: { site: value.site, scheme: value.scheme, ciphertext: value.ciphertext, createdAt: new Date() } })
    return { name: provider.name, site: provider.site }
  }
  /** Names and sites only: values are never returned. */
  async function list(uid) {
    return db.select({ name: vaultSecrets.name, site: vaultSecrets.site, scheme: vaultSecrets.scheme, createdAt: vaultSecrets.createdAt, lastUsedAt: vaultSecrets.lastUsedAt }).from(vaultSecrets).where(eq(vaultSecrets.userId, uid))
  }
  async function remove(uid, name) { await db.delete(vaultSecrets).where(and(eq(vaultSecrets.userId, uid), eq(vaultSecrets.name, String(name)))) }

  /** The broker: make a request with a saved key. b: { name, method, url, body } */
  async function request(uid, b) {
    need()
    const [row] = await db.select().from(vaultSecrets).where(and(eq(vaultSecrets.userId, uid), eq(vaultSecrets.name, String(b.name ?? ''))))
    if (!row) throw httpError(404, `No saved connection "${b.name}": add it in Settings → Plugins → Connections`)
    let url
    try { url = new URL(String(b.url)) } catch { throw httpError(400, 'url must be a full https:// address') }
    if (url.protocol !== 'https:' && !cfg.connectionsAllowPrivate) throw httpError(400, 'connections use https only')
    if (url.hostname.toLowerCase() !== row.site) throw httpError(403, `The ${row.name} connection only goes to ${row.site}`)
    if (url.username || url.password) throw httpError(400, 'no credentials in the url')
    if (!cfg.connectionsAllowPrivate) {
      const addrs = await lookup(url.hostname).catch(() => [])
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw httpError(403, `${url.hostname} isn't a public address`)
    }
    const method = String(b.method ?? 'GET').toUpperCase()
    if (!METHODS.has(method)) throw httpError(400, 'method not allowed')
    let secret = open(row.ciphertext)
    const headers = { 'User-Agent': 'LifeConsole-Connections/1', Accept: 'application/json, text/plain;q=0.8' }
    if (row.scheme.startsWith('oauth:')) {
      // an OAuth connection: refresh the access token when it's about to expire, then send it as a bearer token
      let t = JSON.parse(secret)
      const provider = cfg.oauthProviders?.[row.scheme.slice(6)]
      if (t.expiresAt && t.expiresAt < Date.now() + 60000) {
        if (!provider || !t.refresh) throw httpError(401, `The ${row.name} connection expired: connect it again in Plugins → Connections`)
        t = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: t.refresh }, fetchImpl)
        await db.update(vaultSecrets).set({ ciphertext: seal(JSON.stringify(t)) }).where(and(eq(vaultSecrets.userId, uid), eq(vaultSecrets.name, row.name)))
      }
      secret = t.access
      headers.Authorization = `Bearer ${secret}`
    } else if (row.scheme === 'bearer') headers.Authorization = `Bearer ${secret}`
    else if (row.scheme.startsWith('header:')) headers[row.scheme.slice(7)] = secret
    else url.searchParams.set(row.scheme.slice(6), secret)
    let body
    if (b.body !== undefined && method !== 'GET') { body = typeof b.body === 'string' ? b.body : JSON.stringify(b.body); headers['Content-Type'] = typeof b.body === 'string' ? 'text/plain' : 'application/json' }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    try {
      const r = await fetchImpl(url, { method, headers, body, redirect: 'manual', signal: ctrl.signal })
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > MAX_RESPONSE) throw httpError(502, 'the answer was larger than 1 MB')
      await db.update(vaultSecrets).set({ lastUsedAt: new Date() }).where(and(eq(vaultSecrets.userId, uid), eq(vaultSecrets.name, row.name)))
      const type = r.headers.get('content-type') ?? ''
      let text = buf.toString('utf8')
      text = text.split(secret).join('[key]') // never echo the key back, even if the other side does
      let json
      if (/json/i.test(type)) try { json = JSON.parse(text) } catch { /* not json after all */ }
      return { status: r.status, type, ...(json !== undefined ? { json } : { text }) }
    } catch (e) {
      if (e.status) throw e
      throw httpError(502, e.name === 'AbortError' ? 'the other site took too long' : 'could not reach the other site')
    } finally { clearTimeout(timer) }
  }
  return { on, save, saveOAuth, list, remove, request }
}
