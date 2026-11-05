// Web Push (VAPID). Keys are generated once and persisted in DATA_DIR/vapid.json.
import webpush from 'web-push'
import fs from 'node:fs'
import path from 'node:path'

export function createPush(store, { subject, dryRun = false, log = console.log } = {}) {
  let vapid = store.read('vapid.json', null)
  if (!vapid) {
    vapid = webpush.generateVAPIDKeys()
    store.write('vapid.json', vapid)
    log('[push] generated VAPID keys')
  }
  webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey)

  const subs = () => store.read('subscriptions.json', [])
  const saveSubs = (list) => store.write('subscriptions.json', list)

  function subscribe(subscription, label = '', ua = '') {
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw new Error('invalid subscription')
    const list = subs().filter((s) => s.subscription.endpoint !== subscription.endpoint)
    list.push({ subscription, label: String(label).slice(0, 60), ua: String(ua).slice(0, 200), createdAt: new Date().toISOString() })
    saveSubs(list)
  }
  function unsubscribe(endpoint) {
    saveSubs(subs().filter((s) => s.subscription.endpoint !== endpoint))
  }
  function devices() {
    return subs().map((s) => ({ label: s.label, createdAt: s.createdAt, service: new URL(s.subscription.endpoint).host, endpoint: s.subscription.endpoint }))
  }

  /** Send to one subscription; drops it when the push service says it's gone. */
  async function sendOne(entry, payload, { ttl = 3600, urgency = 'high' } = {}) {
    if (dryRun) {
      fs.appendFileSync(path.join(store.dir, 'outbox.jsonl'), JSON.stringify({ at: new Date().toISOString(), to: entry.label, payload }) + '\n')
      return true
    }
    try {
      await webpush.sendNotification(entry.subscription, JSON.stringify(payload), { TTL: ttl, urgency })
      return true
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        unsubscribe(entry.subscription.endpoint)
        log(`[push] removed expired subscription (${entry.label})`)
      } else {
        log(`[push] send failed (${entry.label}): ${err.statusCode ?? ''} ${err.body ?? err.message}`)
      }
      return false
    }
  }
  async function sendAll(payload, opts) {
    const list = subs()
    const results = await Promise.all(list.map((e) => sendOne(e, payload, opts)))
    return results.filter(Boolean).length
  }
  async function sendTo(endpoint, payload, opts) {
    const e = subs().find((s) => s.subscription.endpoint === endpoint)
    return e ? sendOne(e, payload, opts) : false
  }
  return { publicKey: vapid.publicKey, subscribe, unsubscribe, devices, sendAll, sendTo }
}
