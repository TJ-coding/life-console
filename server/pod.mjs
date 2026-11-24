// Your data in a Solid pod (goal 9, platform/whitepaper.md §13). Life Console talks to the pod over the Solid
// protocol (Linked Data Platform: GET / PUT / DELETE resources, containers that list them, ETag + If-Match), so the
// pod can be the one built into this server or the person's own Solid server, and moving is a copy.
//
// What this build does: every saved planner is written to the pod as a handful of JSON-LD resources typed with the
// vocabulary (platform/plugins-vocabulary.md); "Copy my planner from a pod" (trusted page) loads them on any server.
// Life Console keeps its working copy in Postgres (sync, merge, offline, snapshots) and the pod is written after it.
//
// The built-in pod: /pods/<handle>/<path>, for its owner (session or API token): a minimal Solid server, so any
// Solid app (or another Life Console) can read and write it with the owner's token.
import crypto from 'node:crypto'
import { and, eq, like } from 'drizzle-orm'
import { podResources, users } from './db/schema.js'
import { httpError } from './auth.mjs'

const NS = 'https://life-console.dev/ns/'
export const CONTEXT = { '@vocab': `${NS}core#`, core: `${NS}core#`, common: `${NS}common#`, schema: 'https://schema.org/', ldp: 'http://www.w3.org/ns/ldp#' }
const TYPES = { todos: 'core:Todo', timeBlocks: 'core:TimeBlock', deadlines: 'core:Deadline', plans: 'core:Plan', reviews: 'core:Review', reminders: 'core:Reminder', entities: 'core:Record', relations: 'core:Link' }
const etagOf = (body) => `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`
const PATH = /^[a-z0-9][a-z0-9._/-]{0,200}$/i

/**
 * The planner document → pod resources (path → JSON-LD). Records keep every field, plus @id and @type, so the
 * document round-trips exactly (fromPod) and other Solid apps can still read what things are. Time blocks are split
 * per month so each resource stays small; keys this build doesn't know go to planner/other.json untouched.
 */
export function toPod(state, base) {
  const out = {}
  const graph = (key, records) => ({ '@context': CONTEXT, '@id': `${base}planner/${key}`, '@graph': records.map((r) => ({ '@id': `${base}r/${encodeURIComponent(r.id ?? r.no ?? '')}`, '@type': TYPES[key] ?? 'core:Record', ...r })) })
  const rest = {}
  for (const [k, v] of Object.entries(state ?? {})) {
    if (k === 'timeBlocks' && Array.isArray(v)) {
      const byMonth = {}
      for (const b of v) (byMonth[String(b.date ?? 'undated').slice(0, 7)] ??= []).push(b)
      for (const [m, list] of Object.entries(byMonth)) out[`planner/blocks/${m}.jsonld`] = graph('timeBlocks', list)
    } else if (TYPES[k] && Array.isArray(v)) out[`planner/${k}.jsonld`] = graph(k, v)
    else if (k === 'settings') out['planner/settings.jsonld'] = { '@context': CONTEXT, '@id': `${base}planner/settings`, '@type': 'core:Settings', ...v }
    else rest[k] = v
  }
  out['planner/other.json'] = rest
  return out
}
/** Pod resources → the planner document. */
export function fromPod(resources) {
  const state = {}
  const strip = (n) => { const { '@id': _i, '@type': _t, ...r } = n; return r }
  for (const [path, doc] of Object.entries(resources)) {
    if (path === 'planner/other.json') Object.assign(state, doc)
    else if (path === 'planner/settings.jsonld') { const { '@context': _c, ...s } = doc; state.settings = strip(s) }
    else if (path.startsWith('planner/blocks/')) (state.timeBlocks ??= []).push(...(doc['@graph'] ?? []).map(strip))
    else { const key = /^planner\/([a-zA-Z]+)\.jsonld$/.exec(path)?.[1]; if (key) state[key] = (doc['@graph'] ?? []).map(strip) }
  }
  return state
}

/* ── Solid-OIDC (client credentials + DPoP), the way Solid servers such as the Community Solid Server authorise apps ── */
const b64u = (b) => Buffer.from(b).toString('base64url')
/** A DPoP proof (RFC 9449): a JWT signed with this client's key, bound to one method and URL (and the token, if any). */
export function dpopProof(key, method, url, accessToken) {
  const jwk = key.publicKey.export({ format: 'jwk' })
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } }
  const u = new URL(url)
  const payload = { htm: method, htu: `${u.origin}${u.pathname}`, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID(), ...(accessToken ? { ath: b64u(crypto.createHash('sha256').update(accessToken).digest()) } : {}) }
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`
  const sig = crypto.sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' })
  return `${input}.${b64u(sig)}`
}
/** Get a DPoP-bound access token with client credentials (the id and secret a Solid server's account page gives you). */
export async function solidToken({ issuer, clientId, clientSecret }, key, fetchImpl = fetch) {
  const conf = await (await fetchImpl(new URL('/.well-known/openid-configuration', issuer).toString())).json().catch(() => ({}))
  const tokenUrl = conf.token_endpoint ?? new URL('/.oidc/token', issuer).toString()
  const r = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`, DPoP: dpopProof(key, 'POST', tokenUrl) },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'webid' }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw httpError(502, `the Solid server refused the app credentials${j.error ? `: ${j.error}` : ''}`)
  return { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 600) * 1000 }
}

/**
 * A Solid (LDP) client for any pod: base ends with '/'. Auth, one of:
 *   token: a bearer token (another Life Console's built-in pod, or none on a private network)
 *   oidc: { issuer?, clientId, clientSecret }: Solid-OIDC client credentials with DPoP (Community Solid Server and others)
 */
export function podClient(base, { token = '', oidc = null, fetchImpl: rawFetch = fetch } = {}) {
  if (!/^https?:\/\/.+\/$/.test(base)) throw httpError(400, 'A pod address looks like https://pod.example/alice/ (ending in /)')
  const headers = (extra = {}) => ({ ...(token && !oidc ? { Authorization: `Bearer ${token}` } : {}), ...extra })
  const url = (p) => new URL(p, base).toString()
  // with Solid-OIDC every request carries a fresh DPoP proof for its method and URL, and the token is renewed when old
  let key = null, cur = null
  const fetchImpl = !oidc ? rawFetch : async (u, opts = {}) => {
    key ??= crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    if (!cur || cur.expiresAt < Date.now() + 30000) cur = await solidToken({ issuer: oidc.issuer || new URL(base).origin, clientId: oidc.clientId, clientSecret: oidc.clientSecret }, key, rawFetch)
    const method = (opts.method ?? 'GET').toUpperCase()
    return rawFetch(u, { ...opts, headers: { ...(opts.headers ?? {}), Authorization: `DPoP ${cur.token}`, DPoP: dpopProof(key, method, u, cur.token) } })
  }
  return {
    base,
    async get(path) {
      const r = await fetchImpl(url(path), { headers: headers({ Accept: 'application/ld+json, application/json' }) })
      if (r.status === 404) return null
      if (!r.ok) throw httpError(502, `the pod answered ${r.status} for ${path}`)
      return { body: await r.json(), etag: r.headers.get('etag') }
    },
    async put(path, body, { ifMatch } = {}) {
      const r = await fetchImpl(url(path), { method: 'PUT', headers: headers({ 'Content-Type': path.endsWith('.json') ? 'application/json' : 'application/ld+json', ...(ifMatch ? { 'If-Match': ifMatch } : {}) }), body: JSON.stringify(body) })
      if (r.status === 412) throw httpError(409, `${path} changed in the pod meanwhile`)
      if (!r.ok) throw httpError(502, `the pod refused ${path} (${r.status})`)
      return r.headers.get('etag')
    },
    /** Every resource under a container, following sub-containers. */
    async list(dir = 'planner/') {
      const r = await fetchImpl(url(dir), { headers: headers({ Accept: 'application/ld+json' }) })
      if (r.status === 404) return []
      if (!r.ok) throw httpError(502, `the pod answered ${r.status} for ${dir}`)
      const j = await r.json()
      const items = [j['ldp:contains'] ?? j.contains ?? []].flat().map((x) => (typeof x === 'string' ? x : x['@id']))
      const out = []
      for (const it of items) {
        const rel = it.startsWith(base) ? it.slice(base.length) : new URL(it, url(dir)).toString().slice(base.length)
        if (rel.endsWith('/')) out.push(...(await this.list(rel)))
        else out.push(rel)
      }
      return out
    },
  }
}

export function createPods(db, { log = () => {}, siteFor = () => '' } = {}) {
  const baseFor = (req, handle) => `${siteFor(req)}/pods/${handle}/`

  /* ── the built-in pod's storage ── */
  async function putLocal(ownerId, path, body, { ifMatch, contentType } = {}) {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    const etag = etagOf(text)
    const [cur] = await db.select({ etag: podResources.etag }).from(podResources).where(and(eq(podResources.ownerId, ownerId), eq(podResources.path, path)))
    if (ifMatch && ifMatch !== '*' && (!cur || cur.etag !== ifMatch)) throw httpError(412, 'precondition failed')
    if (cur?.etag === etag) return etag
    await db.insert(podResources).values({ ownerId, path, body: text, etag, contentType: contentType ?? (path.endsWith('.json') ? 'application/json' : 'application/ld+json') })
      .onConflictDoUpdate({ target: [podResources.ownerId, podResources.path], set: { body: text, etag, updatedAt: new Date(), ...(contentType ? { contentType } : {}) } })
    return etag
  }

  /** Write the planner to the account's pod: the built-in one, or the person's own Solid server. */
  async function mirror(user, state, { base, remote, extra = {} } = {}) {
    const resources = { ...toPod(state, base), ...extra }
    if (remote) { for (const [p, body] of Object.entries(resources)) await remote.put(p, body) }
    else for (const [p, body] of Object.entries(resources)) await putLocal(user.id, p, body)
    // resources this planner no longer has (a month without blocks) are left: they're harmless and fromPod merges them only if listed
    return Object.keys(resources).length
  }
  /** Read a whole planner from a pod (any Solid server, through the protocol). */
  async function readPlanner(client) {
    const paths = (await client.list('planner/')).filter((p) => PATH.test(p))
    if (!paths.length) throw httpError(404, 'There is no Life Console planner in that pod (no planner/ container)')
    const resources = {}
    for (const p of paths) { const r = await client.get(p); if (r) resources[p] = r.body }
    return fromPod(resources)
  }

  /** The built-in pod over HTTP (Solid/LDP subset). who = the identified caller (owner only). */
  async function serve(req, res, url, who, send) {
    const m = /^\/pods\/([a-z0-9][a-z0-9-]{1,29})\/(.*)$/.exec(url.pathname)
    if (!m) return send(res, 404, { error: 'no such pod' })
    const [owner] = await db.select().from(users).where(eq(users.handle, m[1]))
    if (!owner) return send(res, 404, { error: 'no such pod' })
    if (!who || who.user.id !== owner.id) return send(res, who ? 403 : 401, { error: 'this pod is private to its owner' }, { 'WWW-Authenticate': 'Bearer' })
    const path = decodeURIComponent(m[2])
    if (path && !PATH.test(path)) return send(res, 400, { error: 'bad path' })
    const ldp = (container) => ({ Link: `<http://www.w3.org/ns/ldp#${container ? 'BasicContainer' : 'Resource'}>; rel="type"`, 'Accept-Patch': '', 'Allow': 'GET, HEAD, PUT, DELETE, OPTIONS' })
    if (req.method === 'OPTIONS') return send(res, 204, '', ldp(path === '' || path.endsWith('/')))
    if (path === '' || path.endsWith('/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'containers are read-only here: PUT resources inside them' })
      const rows = await db.select({ path: podResources.path }).from(podResources).where(and(eq(podResources.ownerId, owner.id), like(podResources.path, `${path}%`)))
      const kids = [...new Set(rows.map((r) => r.path.slice(path.length)).map((rest) => (rest.includes('/') ? rest.slice(0, rest.indexOf('/') + 1) : rest)))]
      const base = `${url.origin === 'http://localhost' ? siteFor(req) : url.origin}/pods/${owner.handle}/`
      return send(res, 200, { '@context': CONTEXT, '@id': `${base}${path}`, '@type': ['ldp:Container', 'ldp:BasicContainer'], 'ldp:contains': kids.map((k) => ({ '@id': `${base}${path}${k}` })) }, { 'Content-Type': 'application/ld+json', ...ldp(true) })
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const [r] = await db.select().from(podResources).where(and(eq(podResources.ownerId, owner.id), eq(podResources.path, path)))
      if (!r) return send(res, 404, { error: 'not found' })
      if (req.headers['if-none-match'] === r.etag) return send(res, 304, '', { ETag: r.etag })
      return send(res, 200, r.body, { 'Content-Type': r.contentType, ETag: r.etag, ...ldp(false) })
    }
    if (req.method === 'PUT') {
      const text = await new Promise((resolve, reject) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > 4 * 1024 * 1024) { reject(httpError(413, 'too large')); req.destroy() } else c.push(d) }); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))) })
      try { JSON.parse(text) } catch { return send(res, 415, { error: 'this pod stores JSON and JSON-LD' }) }
      const etag = await putLocal(owner.id, path, text, { ifMatch: req.headers['if-match'], contentType: /json/.test(req.headers['content-type'] ?? '') ? String(req.headers['content-type']).split(';')[0] : undefined })
      return send(res, 201, '', { ETag: etag, ...ldp(false) })
    }
    if (req.method === 'DELETE') {
      await db.delete(podResources).where(and(eq(podResources.ownerId, owner.id), eq(podResources.path, path)))
      return send(res, 204, '')
    }
    return send(res, 405, { error: 'method not allowed' })
  }

  /** One resource from a pod, or null. */
  async function readOne(client, path) { const r = await client.get(path).catch(() => null); return r?.body ?? null }
  return { mirror, readPlanner, readOne, serve, baseFor, putLocal }
}
