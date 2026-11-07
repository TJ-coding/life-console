// Web Push (VAPID), per user. Keys come from VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY, or are generated
// once and kept in the database (app_kv 'vapid'). Losing them unsubscribes every device.
import webpush from 'web-push'
import fs from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { appKv, pushSubscriptions } from './db/schema.js'
import { httpError } from './auth.mjs'

export async function loadVapid(db, cfg) {
  if (cfg.vapidPublicKey && cfg.vapidPrivateKey) return { publicKey: cfg.vapidPublicKey, privateKey: cfg.vapidPrivateKey }
  const read = async () => (await db.select().from(appKv).where(eq(appKv.key, 'vapid')).limit(1))[0]?.value
  let v = await read()
  if (!v) {
    // two instances starting together both try; the first insert wins and both read it back
    await db.insert(appKv).values({ key: 'vapid', value: webpush.generateVAPIDKeys() }).onConflictDoNothing()
    v = await read()
  }
  return v
}

export async function createPush(db, cfg, log = console.log) {
  const vapid = await loadVapid(db, cfg)
  webpush.setVapidDetails(cfg.vapidSubject, vapid.publicKey, vapid.privateKey)

  async function subscribe(userId, subscription, label = '', ua = '') {
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw httpError(400, 'invalid subscription')
    let host
    try { host = new URL(subscription.endpoint) } catch { throw httpError(400, 'invalid subscription') }
    if (host.protocol !== 'https:') throw httpError(400, 'invalid subscription')
    const row = { userId, keys: { p256dh: String(subscription.keys.p256dh), auth: String(subscription.keys.auth) }, label: String(label).slice(0, 60), userAgent: String(ua).slice(0, 200) }
    // an endpoint belongs to one browser: if someone else signs in there, it moves to them
    await db.insert(pushSubscriptions).values({ endpoint: subscription.endpoint, ...row }).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row })
  }
  async function unsubscribe(userId, endpoint) {
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, String(endpoint || ''))))
  }
  const listFor = (userId) => db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  async function devices(userId) {
    return (await listFor(userId)).map((s) => ({ label: s.label, createdAt: s.createdAt, service: new URL(s.endpoint).host, endpoint: s.endpoint }))
  }

  async function sendOne(s, payload, { ttl = 3600, urgency = 'high' } = {}) {
    if (cfg.pushDryRun) {
      if (cfg.outbox) fs.appendFileSync(cfg.outbox, JSON.stringify({ at: new Date().toISOString(), user: s.userId, to: s.label, payload }) + '\n')
      return true
    }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: ttl, urgency })
      return true
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint))
        log(`[push] removed expired subscription (${s.label})`)
      } else {
        log(`[push] send failed (${s.label}): ${err.statusCode ?? ''} ${err.body ?? err.message}`)
      }
      return false
    }
  }
  async function sendToUser(userId, payload, opts) {
    const list = await listFor(userId)
    return (await Promise.all(list.map((s) => sendOne(s, payload, opts)))).filter(Boolean).length
  }
  async function sendTo(userId, endpoint, payload, opts) {
    const s = (await listFor(userId)).find((x) => x.endpoint === endpoint)
    return s ? sendOne(s, payload, opts) : false
  }
  return { publicKey: vapid.publicKey, subscribe, unsubscribe, devices, sendToUser, sendTo }
}
