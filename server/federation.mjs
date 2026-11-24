// Sharing across servers over ActivityPub (goals 10 and 11, platform/whitepaper.md §12-15). Life Console is the only
// thing that touches the pod; other servers talk to Life Console, never to the pod.
//
//   - every account with a handle is an ActivityPub actor: /u/<handle> (found with WebFinger, acct:<handle>@<host>)
//   - sharing a plan (trusted page): a `shares` row + an `Offer` to the other person's inbox with a link to the record;
//     a plain fediverse server gets a copy inside the Offer, a Life Console server fetches the record live
//   - the record (/u/<handle>/r/plan/<id>) answers only signed requests from actors it's shared with; revoking stops
//     answering and sends `Undo`; edits come back as `Update` and are applied if the share allows editing
//   - moving (trusted page): the account's actor says `movedTo`, its address keeps resolving to the new place, record
//     links redirect, and partners get a `Move`; messages that still arrive wait in a mailbox the new server can fetch
//
// Requests are signed with HTTP Signatures (rsa-sha256 over (request-target) host date digest), like Mastodon.
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import { and, eq, isNull, inArray, or } from 'drizzle-orm'
import { actorKeys, remoteActors, shares, federationInbox, users } from './db/schema.js'
import { httpError } from './auth.mjs'
import { isPrivateAddress } from './vault.mjs'
import { CONTEXT } from './pod.mjs'

const AS = 'https://www.w3.org/ns/activitystreams'
const AP_TYPE = 'application/activity+json'
const HANDLE = /^@?([a-z0-9][a-z0-9-]{1,29})@([a-z0-9.-]+(?::\d+)?)$/i
const digestOf = (body) => `SHA-256=${crypto.createHash('sha256').update(body).digest('base64')}`
const rid = () => crypto.randomBytes(9).toString('base64url')
/** The fields of a plan someone with edit access may change. */
const EDITABLE = (patch) => ({
  ...(typeof patch.health === 'string' ? { health: patch.health.slice(0, 40) } : {}),
  ...(Array.isArray(patch.sigs) ? { sigs: patch.sigs.slice(0, 50).filter((s) => s && s.no).map((s) => ({ no: String(s.no), ...(Number.isFinite(s.pct) ? { pct: Math.max(0, Math.min(100, s.pct)) } : {}), ...(typeof s.status === 'string' ? { status: s.status.slice(0, 20) } : {}) })) } : {}),
})

export function createFederation(db, { planner, cfg, log = () => {}, siteOf, fetchImpl = fetch, onSharesChanged = () => {} }) {
  const allowPrivate = !!cfg.federationAllowPrivate
  const site = (req) => siteOf(req)
  const actorUrl = (req, handle) => `${site(req)}/u/${handle}`

  /* ── keys ── */
  async function keysFor(uid) {
    const [k] = await db.select().from(actorKeys).where(eq(actorKeys.userId, uid))
    if (k) return k
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
    await db.insert(actorKeys).values({ userId: uid, publicPem: publicKey, privatePem: privateKey }).onConflictDoNothing()
    const [k2] = await db.select().from(actorKeys).where(eq(actorKeys.userId, uid))
    return k2
  }

  /* ── outgoing requests: safe addresses only, signed ── */
  async function checkUrl(u) {
    const url = new URL(u)
    if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw httpError(400, 'other servers are reached over https')
    if (!allowPrivate) {
      const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => [])
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw httpError(400, `${url.hostname} isn't a public address`)
    }
    return url
  }
  function signHeaders({ method, url, body, keyId, privatePem }) {
    const u = new URL(url)
    const date = new Date().toUTCString()
    const h = { host: u.host, date, ...(body !== undefined ? { digest: digestOf(body) } : {}) }
    const names = ['(request-target)', 'host', 'date', ...(body !== undefined ? ['digest'] : [])]
    const str = names.map((n) => (n === '(request-target)' ? `(request-target): ${method.toLowerCase()} ${u.pathname}${u.search}` : `${n}: ${h[n]}`)).join('\n')
    const signature = crypto.sign('sha256', Buffer.from(str), privatePem).toString('base64')
    return { Host: h.host, Date: date, ...(h.digest ? { Digest: h.digest } : {}), Signature: `keyId="${keyId}",algorithm="rsa-sha256",headers="${names.join(' ')}",signature="${signature}"` }
  }
  /** A request signed as a local account. */
  async function signedFetch(user, req, url, { method = 'GET', json } = {}) {
    await checkUrl(url)
    const k = await keysFor(user.id)
    const body = json === undefined ? undefined : JSON.stringify(json)
    const headers = { Accept: `${AP_TYPE}, application/ld+json`, ...(body ? { 'Content-Type': AP_TYPE } : {}), ...signHeaders({ method, url, body, keyId: `${actorUrl(req, user.handle)}#main-key`, privatePem: k.privatePem }) }
    delete headers.Host
    return fetchImpl(url, { method, headers, body, redirect: 'follow' })
  }

  /* ── remote actors ── */
  async function fetchActor(id, { force = false } = {}) {
    if (!force) {
      const [a] = await db.select().from(remoteActors).where(eq(remoteActors.id, id))
      if (a && Date.now() - new Date(a.fetchedAt).getTime() < 24 * 3600000) return a
    }
    await checkUrl(id)
    const r = await fetchImpl(id, { headers: { Accept: AP_TYPE } })
    if (!r.ok) throw httpError(502, `couldn't read ${id} (${r.status})`)
    const j = await r.json()
    if (!j.inbox || !j.publicKey?.publicKeyPem) throw httpError(502, `${id} isn't an ActivityPub actor`)
    const row = { id: j.id ?? id, inbox: j.inbox, publicPem: j.publicKey.publicKeyPem, handle: j.preferredUsername ?? '', movedTo: j.movedTo ?? null, fetchedAt: new Date() }
    await db.insert(remoteActors).values(row).onConflictDoUpdate({ target: remoteActors.id, set: { inbox: row.inbox, publicPem: row.publicPem, handle: row.handle, movedTo: row.movedTo, fetchedAt: row.fetchedAt } })
    return row
  }
  /** '@bob@other.example' → the actor (WebFinger). A full actor URL works too. */
  async function resolve(address) {
    const a = String(address ?? '').trim()
    if (/^https?:\/\//.test(a)) return fetchActor(a)
    const m = HANDLE.exec(a)
    if (!m) throw httpError(400, 'An address looks like @bob@other.example')
    const proto = allowPrivate && /^(127\.|localhost|\[::1\])/.test(m[2]) ? 'http' : 'https'
    const wf = `${proto}://${m[2]}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${m[1]}@${m[2]}`)}`
    await checkUrl(wf)
    const r = await fetchImpl(wf, { headers: { Accept: 'application/jrd+json' } })
    if (!r.ok) throw httpError(404, `No one called ${a}`)
    const j = await r.json()
    const self = (j.links ?? []).find((l) => l.rel === 'self' && /activity\+json|ld\+json/.test(l.type ?? ''))?.href
    if (!self) throw httpError(404, `${a} has no ActivityPub actor`)
    return fetchActor(self)
  }
  async function deliver(user, req, actorId, activity) {
    const a = await fetchActor(actorId)
    const target = a.movedTo ? await fetchActor(a.movedTo) : a
    const r = await signedFetch(user, req, target.inbox, { method: 'POST', json: activity })
    if (!r.ok) throw httpError(502, `${target.id} refused the message (${r.status})`)
  }

  /* ── incoming: verify a signed request ── */
  async function verify(req, rawBody) {
    const sig = Object.fromEntries([...String(req.headers.signature ?? '').matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
    if (!sig.keyId || !sig.signature || !sig.headers) throw httpError(401, 'unsigned request')
    const date = Date.parse(req.headers.date ?? '')
    if (!date || Math.abs(Date.now() - date) > 5 * 60000) throw httpError(401, 'stale or missing Date')
    const names = sig.headers.split(' ')
    if (rawBody !== undefined && (!names.includes('digest') || req.headers.digest !== digestOf(rawBody))) throw httpError(401, 'digest mismatch')
    const u = new URL(req.url, 'http://x')
    const str = names.map((n) => (n === '(request-target)' ? `(request-target): ${req.method.toLowerCase()} ${u.pathname}${u.search}` : `${n}: ${req.headers[n]}`)).join('\n')
    const actorId = sig.keyId.split('#')[0]
    for (const force of [false, true]) { // a key may have rotated: fetch the actor again once
      const a = await fetchActor(actorId, { force })
      if (crypto.verify('sha256', Buffer.from(str), a.publicPem, Buffer.from(sig.signature, 'base64'))) return a.id
    }
    throw httpError(401, 'bad signature')
  }

  /* ── what this server serves ── */
  async function localUser(handle) {
    const [u] = await db.select().from(users).where(eq(users.handle, String(handle).toLowerCase()))
    return u ?? null
  }
  async function webfinger(req, url) {
    const m = /^acct:([a-z0-9-]+)@(.+)$/i.exec(url.searchParams.get('resource') ?? '')
    const u = m && (await localUser(m[1]))
    if (!u) return null
    const self = u.movedTo ?? actorUrl(req, u.handle) // a moved account's address resolves to where it lives now
    return { subject: `acct:${u.handle}@${m[2]}`, aliases: [actorUrl(req, u.handle)], links: [{ rel: 'self', type: AP_TYPE, href: self }] }
  }
  async function actor(req, handle) {
    const u = await localUser(handle)
    if (!u) return null
    const id = actorUrl(req, u.handle)
    const k = await keysFor(u.id)
    return {
      '@context': [AS, 'https://w3id.org/security/v1'], id, type: 'Person', preferredUsername: u.handle, name: u.name || u.handle,
      inbox: `${id}/inbox`, outbox: `${id}/outbox`, publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: k.publicPem },
      ...(u.movedTo ? { movedTo: u.movedTo } : {}),
    }
  }
  /** A shared plan, for an actor it's shared with. */
  async function record(req, handle, type, id, rawSigner) {
    const u = await localUser(handle)
    if (!u) return { status: 404 }
    if (u.movedTo) return { status: 301, location: `${u.movedTo}/r/${type}/${encodeURIComponent(id)}` }
    const signer = rawSigner
    const [share] = await db.select().from(shares).where(and(eq(shares.ownerId, u.id), eq(shares.recordType, 'core.Plan'), eq(shares.recordId, id), eq(shares.actor, signer), isNull(shares.revokedAt)))
    if (type !== 'plan' || !share) return { status: 403 }
    const doc = await planner.get(u.id)
    const plan = (doc.state?.plans ?? []).find((p) => p.id === id)
    if (!plan) return { status: 410 }
    return { status: 200, body: planObject(req, u.handle, plan, share.access) }
  }
  const planObject = (req, handle, plan, access) => ({
    '@context': [AS, CONTEXT], id: `${actorUrl(req, handle)}/r/plan/${encodeURIComponent(plan.id)}`, type: 'core:Plan', attributedTo: actorUrl(req, handle),
    name: plan.title ?? plan.id, 'core:access': access,
    plan: { id: plan.id, title: plan.title, status: plan.status, health: plan.health, intent: plan.intent, vision: plan.vision, psgs: plan.psgs ?? [], sigs: plan.sigs ?? [] },
  })

  /** POST /u/<handle>/inbox */
  async function inbox(req, handle, rawBody) {
    const u = await localUser(handle)
    if (!u) return { status: 404 }
    const from = await verify(req, rawBody)
    let a
    try { a = JSON.parse(rawBody) } catch { throw httpError(400, 'invalid JSON') }
    if (a.actor && a.actor !== from) throw httpError(401, "the signer isn't the actor")
    const type = String(a.type ?? '')
    const objectId = typeof a.object === 'string' ? a.object : String(a.object?.id ?? '')
    if (type === 'Update' && !u.movedTo) {
      // an edit to one of our records: apply it if it's shared with that actor for editing
      const m = /\/r\/plan\/([^/]+)$/.exec(objectId)
      const planId = m && decodeURIComponent(m[1])
      const [share] = planId ? await db.select().from(shares).where(and(eq(shares.ownerId, u.id), eq(shares.recordId, planId), eq(shares.actor, from), eq(shares.access, 'edit'), isNull(shares.revokedAt))) : []
      if (!share) return { status: 403 }
      const patch = EDITABLE(a.object?.patch ?? {})
      const r = await planner.save(u.id, { mutate: (state) => {
        const plan = (state.plans ?? []).find((p) => p.id === planId)
        if (!plan) return false
        if (patch.health) plan.health = patch.health
        for (const s of patch.sigs ?? []) { const t = (plan.sigs ?? []).find((x) => x.no === s.no); if (t) Object.assign(t, s) }
        plan.events = [...(plan.events ?? []), { at: new Date().toISOString(), by: from, kind: 'remote-edit' }].slice(-200)
      }, device: `ap:${new URL(from).host}`, reason: 'remote-edit' })
      return { status: r.ok ? 202 : 409 }
    }
    if (type === 'Move') {
      // a partner moved: remember where, and point what they shared with us at the new place
      const target = String(a.target ?? '')
      if (target) {
        await db.update(remoteActors).set({ movedTo: target }).where(eq(remoteActors.id, from))
        const rows = await db.select().from(federationInbox).where(and(eq(federationInbox.userId, u.id), eq(federationInbox.actor, from)))
        for (const r of rows) if (r.objectId.startsWith(from)) await db.update(federationInbox).set({ objectId: target + r.objectId.slice(from.length), actor: target }).where(eq(federationInbox.id, r.id))
      }
    }
    if (type === 'Undo') {
      await db.update(federationInbox).set({ status: 'revoked' }).where(and(eq(federationInbox.userId, u.id), eq(federationInbox.actor, from), eq(federationInbox.objectId, String(a.object?.object?.id ?? a.object?.object ?? objectId))))
    }
    if (!['Offer', 'Undo', 'Move', 'Update'].includes(type)) return { status: 202 } // others: accepted and ignored
    await db.insert(federationInbox).values({ userId: u.id, actor: from, type, objectId: type === 'Offer' ? String(a.object?.id ?? objectId) : objectId, activity: a, status: type === 'Offer' ? 'new' : 'done' })
    return { status: 202 }
  }

  /* ── local actions (the owner's share / unshare / move go through the trusted page) ── */
  async function share(user, req, { planId, to, access }) {
    if (!user.handle) throw httpError(400, 'Choose a handle first (Plugins → Publishing): it is your address for sharing')
    const doc = await planner.get(user.id)
    const plan = (doc.state?.plans ?? []).find((p) => p.id === planId)
    if (!plan) throw httpError(404, 'no such plan')
    const remote = await resolve(to)
    const id = rid()
    await db.insert(shares).values({ id, ownerId: user.id, recordType: 'core.Plan', recordId: planId, actor: remote.id, access: access === 'edit' ? 'edit' : 'view' })
    const obj = planObject(req, user.handle, plan, access === 'edit' ? 'edit' : 'view')
    await deliver(user, req, remote.id, { '@context': AS, id: `${actorUrl(req, user.handle)}#share-${id}`, type: 'Offer', actor: actorUrl(req, user.handle), to: [remote.id], object: obj })
    log(`[federation] ${user.handle} shared ${planId} with ${remote.id} (${obj['core:access']})`)
    onSharesChanged(user, req)
    return { id, actor: remote.id, access: obj['core:access'] }
  }
  async function unshare(user, req, shareId) {
    const [s] = await db.select().from(shares).where(and(eq(shares.id, shareId), eq(shares.ownerId, user.id)))
    if (!s) throw httpError(404, 'no such share')
    await db.update(shares).set({ revokedAt: new Date() }).where(eq(shares.id, shareId))
    onSharesChanged(user, req)
    const recordId = `${actorUrl(req, user.handle)}/r/plan/${encodeURIComponent(s.recordId)}`
    await deliver(user, req, s.actor, { '@context': AS, id: `${actorUrl(req, user.handle)}#undo-${shareId}`, type: 'Undo', actor: actorUrl(req, user.handle), to: [s.actor], object: { type: 'Offer', object: recordId } }).catch((e) => log(`[federation] undo not delivered: ${e.message}`))
    return { ok: true }
  }
  /** A share that moved here with a pod (pod-import). */
  async function adoptShare(user, s) {
    if (!s?.actor || !s?.recordId) return
    const [dup] = await db.select({ id: shares.id }).from(shares).where(and(eq(shares.ownerId, user.id), eq(shares.recordId, String(s.recordId)), eq(shares.actor, String(s.actor)), isNull(shares.revokedAt)))
    if (!dup) await db.insert(shares).values({ id: rid(), ownerId: user.id, recordType: 'core.Plan', recordId: String(s.recordId), actor: String(s.actor), access: s.access === 'edit' ? 'edit' : 'view' })
  }
  async function myShares(user) {
    return db.select().from(shares).where(and(eq(shares.ownerId, user.id), isNull(shares.revokedAt)))
  }
  async function inboxFor(user) {
    return db.select({ id: federationInbox.id, actor: federationInbox.actor, type: federationInbox.type, objectId: federationInbox.objectId, status: federationInbox.status, receivedAt: federationInbox.receivedAt, name: federationInbox.activity })
      .from(federationInbox).where(and(eq(federationInbox.userId, user.id), eq(federationInbox.type, 'Offer'))).then((rows) => rows.map((r) => ({ ...r, name: r.name?.object?.name ?? '', access: r.name?.object?.['core:access'] ?? 'view' })))
  }
  async function setInbox(user, id, status) {
    if (!['accepted', 'declined'].includes(status)) throw httpError(400, 'accepted or declined')
    await db.update(federationInbox).set({ status }).where(and(eq(federationInbox.id, Number(id)), eq(federationInbox.userId, user.id)))
    return { ok: true }
  }
  /** Read a plan shared with me, live from its home server (signed as me). */
  async function readShared(user, req, id) {
    const [row] = await db.select().from(federationInbox).where(and(eq(federationInbox.id, Number(id)), eq(federationInbox.userId, user.id)))
    if (row?.status === 'revoked') throw httpError(410, 'The owner stopped sharing it')
    if (!row || row.status !== 'accepted') throw httpError(404, 'not an accepted share')
    const r = await signedFetch(user, req, row.objectId)
    if (r.status === 403 || r.status === 410) throw httpError(410, 'The owner stopped sharing it')
    if (!r.ok) throw httpError(502, `the owner's server answered ${r.status}`)
    return r.json()
  }
  /** Send an edit to a plan shared with me for editing. */
  async function editShared(user, req, id, patch) {
    const [row] = await db.select().from(federationInbox).where(and(eq(federationInbox.id, Number(id)), eq(federationInbox.userId, user.id)))
    if (!row || row.status !== 'accepted') throw httpError(404, 'not an accepted share')
    if (row.activity?.object?.['core:access'] !== 'edit') throw httpError(403, 'This plan is shared with you to view only')
    await deliver(user, req, row.actor, { '@context': AS, id: `${actorUrl(req, user.handle)}#edit-${rid()}`, type: 'Update', actor: actorUrl(req, user.handle), to: [row.actor], object: { id: row.objectId, patch: EDITABLE(patch) } })
    return { ok: true }
  }

  /** Move this account (goal 11): `to` is the new address. Partners get a Move; this server keeps forwarding. */
  async function move(user, req, to) {
    const target = await resolve(to)
    const from = actorUrl(req, user.handle)
    if (target.id === from) throw httpError(400, "That's this account")
    await db.update(users).set({ movedTo: target.id, updatedAt: new Date() }).where(eq(users.id, user.id))
    const partners = new Set([...(await db.select({ a: shares.actor }).from(shares).where(eq(shares.ownerId, user.id))).map((r) => r.a), ...(await db.select({ a: federationInbox.actor }).from(federationInbox).where(eq(federationInbox.userId, user.id))).map((r) => r.a)])
    let told = 0
    for (const p of partners) {
      try { await deliver(user, req, p, { '@context': AS, id: `${from}#move-${rid()}`, type: 'Move', actor: from, object: from, target: target.id }); told++ } catch (e) { log(`[federation] move not delivered to ${p}: ${e.message}`) }
    }
    return { movedTo: target.id, told }
  }
  /** The mailbox: messages that arrived for a moved account, for its new server to fetch (with this account's token). */
  async function mailbox(user, { since = 0 } = {}) {
    const rows = await db.select().from(federationInbox).where(eq(federationInbox.userId, user.id))
    return rows.filter((r) => r.id > Number(since)).map((r) => ({ id: r.id, actor: r.actor, type: r.type, objectId: r.objectId, activity: r.activity, status: r.status }))
  }
  /** Fetch the old server's mailbox into this account's inbox (old server URL + an access token for the old account). */
  async function pullMailbox(user, { from, token }) {
    const u = await checkUrl(`${String(from).replace(/\/$/, '')}/api/federation/mailbox`)
    const r = await fetchImpl(u, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (!r.ok) throw httpError(502, `the old server answered ${r.status}`)
    const { messages = [] } = await r.json()
    let n = 0
    for (const m of messages) {
      if (m.type !== 'Offer') continue
      await db.insert(federationInbox).values({ userId: user.id, actor: m.actor, type: m.type, objectId: m.objectId, activity: m.activity, status: m.status === 'accepted' ? 'accepted' : 'new' })
      n++
    }
    return { imported: n }
  }

  return { webfinger, actor, record, inbox, verify, resolve, share, unshare, adoptShare, myShares, inboxFor, setInbox, readShared, editShared, move, mailbox, pullMailbox, keysFor }
}
