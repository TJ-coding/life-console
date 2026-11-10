// Usage metrics (users, active users, churn), computed from the database and optionally reported to
// Umami once a day as one anonymous event. Nothing runs in people's browsers: the only input is
// user_activity (one row per account per UTC day it used the app, written by auth.identify()).
//
// Definitions, for a UTC day D (normally yesterday, the last complete day):
//   users      accounts (not disabled) that existed at the end of D      new_users  accounts created on D
//   dau        accounts active on D        wau  active in D-6…D            mau  active in D-29…D
//   stickiness dau / mau (%)
//   churned    active in the previous 30 days (D-59…D-30) but not in the last 30 (D-29…D)
//   churn_rate churned / active in the previous 30 days (%)   retained = the others
//   resurrected  active in the last 30 days, not in the previous 30, and created before D-59
// Settings: UMAMI_URL + UMAMI_WEBSITE_ID (both needed; off when either is empty), UMAMI_HOSTNAME.
import { eq } from 'drizzle-orm'
import { appKv } from './db/schema.js'

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10)
export const addDays = (day, n) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000))
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0)

/** All metrics for UTC day `day` ('YYYY-MM-DD'). */
export async function computeMetrics(pool, day) {
  const { rows: [r] } = await pool.query(`
    with a as (select user_id, day from user_activity where day between $1::date - 59 and $1::date),
    cur as (select distinct user_id from a where day >= $1::date - 29),
    prev as (select distinct user_id from a where day < $1::date - 29)
    select
      (select count(*) from users where not disabled and (created_at at time zone 'UTC')::date <= $1::date)::int as users,
      (select count(*) from users where (created_at at time zone 'UTC')::date = $1::date)::int as new_users,
      (select count(distinct user_id) from a where day = $1::date)::int as dau,
      (select count(distinct user_id) from a where day >= $1::date - 6)::int as wau,
      (select count(*) from cur)::int as mau,
      (select count(*) from prev)::int as prev_mau,
      (select count(*) from prev where user_id not in (select user_id from cur))::int as churned,
      (select count(*) from cur join users u on u.id = cur.user_id
        where cur.user_id not in (select user_id from prev) and (u.created_at at time zone 'UTC')::date < $1::date - 59)::int as resurrected`, [day])
  return {
    day, ...r,
    stickiness: pct(r.dau, r.mau),
    retained: r.prev_mau - r.churned,
    churn_rate: pct(r.churned, r.prev_mau),
  }
}

// Umami silently drops (200 {"beep":"boop"}) anything its isbot check flags, and isbot flags any non-browser
// suffix (even "Mozilla/5.0 (X11; Linux x86_64) Foo/1.0"), so this must read as a plain desktop Chrome.
export const UMAMI_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/** One Umami event: POST /api/send. Throws if Umami didn't record it. */
export async function sendToUmami(cfg, name, data) {
  const r = await fetch(`${cfg.umamiUrl}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UMAMI_UA },
    body: JSON.stringify({ type: 'event', payload: { website: cfg.umamiWebsiteId, hostname: cfg.umamiHostname, url: '/server/metrics', title: 'Server metrics', language: 'en', screen: '0x0', referrer: '', name, data } }),
    signal: AbortSignal.timeout(10000),
  })
  if (!r.ok) throw new Error(`Umami answered HTTP ${r.status}`)
  const body = await r.text()
  if (body.includes('boop')) throw new Error('Umami took this for a bot and dropped it')
}

/**
 * Once a day (checked hourly), report yesterday's metrics to Umami. The day is claimed in app_kv first,
 * so two app instances (rolling deploys) don't both send it; a failed send releases the claim for a retry.
 */
export function createMetricsReporter({ db, pool, cfg, log }) {
  let timer = null
  const KEY = 'umami_metrics_day'
  async function claim(day) {
    // v: 2 marks claims from releases that detect Umami's silent bot drop; an older marker may stand for a
    // report Umami discarded, so that day is claimable once more
    const { rowCount } = await pool.query(`insert into app_kv (key, value) values ($1, $2::jsonb)
      on conflict (key) do update set value = excluded.value, updated_at = now()
      where app_kv.value->>'day' < $3 or app_kv.value->>'v' is null`, [KEY, JSON.stringify({ day, v: 2 }), day])
    return rowCount === 1
  }
  async function report(now = new Date()) {
    if (!cfg.umami) return null
    const day = addDays(utcDay(now), -1)
    const before = (await db.select().from(appKv).where(eq(appKv.key, KEY)).limit(1))[0]?.value
    if (!(await claim(day))) return null
    try {
      const m = await computeMetrics(pool, day)
      await sendToUmami(cfg, 'daily-metrics', m)
      log(`[metrics] ${day} → Umami: ${m.users} users · DAU ${m.dau} · WAU ${m.wau} · MAU ${m.mau} · churn ${m.churn_rate}%`)
      return m
    } catch (e) {
      // give the day back so the next hourly check retries it
      if (before) await db.update(appKv).set({ value: before }).where(eq(appKv.key, KEY))
      else await db.delete(appKv).where(eq(appKv.key, KEY))
      log(`[metrics] ${day}: ${e.message}, will retry`)
      return null
    }
  }
  return {
    report,
    start() {
      if (!cfg.umami) return
      const tick = () => report().catch((e) => log('[metrics]', e.message))
      setTimeout(tick, 60000).unref() // shortly after start, then hourly
      timer = setInterval(tick, 3600000)
      timer.unref()
    },
    stop() { clearInterval(timer) },
  }
}
