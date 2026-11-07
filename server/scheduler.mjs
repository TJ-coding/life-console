// Notification scheduler: every TICK_MS, for each user with push devices, compute what became due
// since the last tick (pure computeEvents in schedule.mjs) and send it.
//
// Safe with several instances (rolling deploys, replicas): each notification is claimed with an
// INSERT into notifications_sent first, and only the instance whose insert succeeds sends it.
import { lt, sql } from 'drizzle-orm'
import { notificationsSent } from './db/schema.js'
import { computeEvents, settingsOf } from './schedule.mjs'

export function createScheduler({ db, planner, push, tickMs, log }) {
  let lastTick = Date.now() // never back-fill notifications missed while the server was down
  let running = false
  let lastPrune = 0
  const cache = new Map() // userId → { version, state }

  async function claim(userId, key) {
    const r = await db.insert(notificationsSent).values({ userId, key }).onConflictDoNothing().returning({ key: notificationsSent.key })
    return r.length > 0
  }

  async function tick(now = Date.now()) {
    if (running) return
    running = true
    try {
      const from = lastTick
      lastTick = now
      const rows = await planner.versionsWithDevices()
      const live = new Set(rows.map((r) => r.userId))
      for (const k of cache.keys()) if (!live.has(k)) cache.delete(k)
      for (const { userId, version } of rows) {
        let c = cache.get(userId)
        if (!c || c.version !== version) {
          const doc = await planner.get(userId)
          c = { version: doc.version, state: doc.state }
          cache.set(userId, c)
        }
        let events = []
        try { events = computeEvents(c.state, from, now) } catch (e) { log(`[notify] ${userId}: ${e.message}`); continue }
        for (const e of events) {
          if (!(await claim(userId, e.key))) continue
          const n = await push.sendToUser(userId, { title: e.title, body: e.body, url: e.url, tag: e.tag, data: e.data, actions: e.actions, vibrate: settingsOf(c.state).notify.vibrate !== false })
          log(`[notify] ${userId.slice(0, 8)} ${e.key} → ${n} device(s)`)
        }
      }
      if (now - lastPrune > 3600000) {
        lastPrune = now
        await db.delete(notificationsSent).where(lt(notificationsSent.sentAt, sql`now() - interval '4 days'`))
      }
    } finally {
      running = false
    }
  }

  let timer = null
  return {
    tick,
    start() { timer = setInterval(() => tick().catch((e) => log('[notify] tick failed', e.message)), tickMs) },
    stop() { clearInterval(timer) },
  }
}
