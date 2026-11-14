#!/usr/bin/env node
// Admin CLI. Uses DATABASE_URL. In Docker: `docker compose exec app node server/cli.mjs <command>`;
// locally: `npm run admin -- <command>`.
//
//   migrate                                    apply pending migrations (the server also does this on start)
//   users                                      list accounts
//   create-user --email E [--password P] [--name N] [--admin]
//   set-role --email E --role admin|user
//   disable --email E | enable --email E       block / unblock sign-in
//   set-password --email E [--password P]     (prints a generated one if omitted; signs out every device)
//   create-token --email E [--name N]          API token for scripts (npm run issues): printed once
//   check-docs [--revisions] [--prefix LEC-,X-]
//                                              read-only: migrate/normalise/merge every planner on a copy; prints only totals
//                                              (problems, schema versions, sizes); --prefix counts goals already named that way
//   revisions --email E                        planner snapshots for an account
//   restore --email E --revision ID            put a snapshot back (the current copy is snapshotted first)
//   metrics [--day YYYY-MM-DD] [--days N] [--send]
//                                              users, active users (DAU/WAU/MAU) and churn (default: yesterday, UTC);
//                                              --days N: the last N days; --send: also report that day to Umami
//   backup [--dir D]                           pg_dump the database now (default BACKUP_DIR or ./backups)
//   import-legacy --dir D --email E [--password P] [--force]
//                                              move a pre-database install (/data JSON files) into an account
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { loadConfig } from './config.mjs'
import { connect, runMigrations, dumpDatabase } from './db/index.mjs'
import { users, plannerDocs, plannerRevisions, pushSubscriptions, issues, appKv, sessions } from './db/schema.js'
import { createAuth, normEmail } from './auth.mjs'
import { createPlanner } from './planner.mjs'
import { issueNo, platformFromUA } from './issues.mjs'
import { checkDocs } from './checkdocs.mjs'
import { computeMetrics, sendToUmami, utcDay, addDays, labelled } from './metrics.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i > 0 ? argv[i + 1] : undefined }
const has = (name) => argv.includes(`--${name}`)
const need = (name) => { const v = opt(name); if (!v) throw new Error(`--${name} is required`); return v }
const genPassword = () => crypto.randomBytes(12).toString('base64url')

const cfg = loadConfig()
const { pool, db } = connect(cfg.databaseUrl, { max: 2 })
const auth = createAuth(db, cfg)
const planner = createPlanner(db, cfg)
const userBy = async (email) => {
  const u = await auth.findUserByEmail(email)
  if (!u) throw new Error(`no account for ${normEmail(email)}`)
  return u
}
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }

const commands = {
  /** Read-only: run the schema code over every stored planner (and, with --revisions, every snapshot); totals only. */
  async 'check-docs'() {
    const prefixes = (opt('prefix') || '').split(',').map((s) => s.trim()).filter(Boolean)
    const docs = (await db.select({ state: plannerDocs.state }).from(plannerDocs).where(sql`${plannerDocs.version} > 0`)).map((r) => r.state)
    const report = { planners: checkDocs(docs, { prefixes }) }
    if (has('revisions')) {
      const states = []
      for (let after = 0; ;) {
        const page = await db.select({ id: plannerRevisions.id, state: plannerRevisions.state }).from(plannerRevisions).where(sql`${plannerRevisions.id} > ${after}`).orderBy(plannerRevisions.id).limit(200)
        if (!page.length) break
        states.push(...page.map((r) => r.state))
        after = page[page.length - 1].id
      }
      report.snapshots = checkDocs(states)
    }
    console.log(JSON.stringify(report, null, 2))
    if (report.planners.failed || report.snapshots?.failed) process.exitCode = 1
  },
  async metrics() {
    const last = opt('day') || addDays(utcDay(), -1)
    const n = Number(opt('days') || 1)
    const rows = []
    for (let i = n - 1; i >= 0; i--) rows.push(await computeMetrics(pool, addDays(last, -i)))
    for (const m of rows) { console.log(''); for (const [k, v] of Object.entries(labelled(m))) console.log(`${k.padEnd(52)} ${v}`) }
    if (has('send')) {
      if (!cfg.umami) throw new Error('set UMAMI_URL and UMAMI_WEBSITE_ID (or ANALYTICS_SITE_ID) to send')
      await sendToUmami(cfg, 'daily-metrics', labelled(rows[rows.length - 1]))
      console.log(`sent ${last} to ${cfg.umamiUrl}`)
    }
  },
  async migrate() { await runMigrations(pool, { databaseUrl: cfg.databaseUrl, backupDir: cfg.backupDir }) },
  async users() {
    const r = await db.execute(sql`select u.email, u.role, u.disabled, u.created_at, u.last_login_at, coalesce(d.version, 0) as version,
      coalesce(octet_length(d.state::text), 0) as bytes, (select count(*) from push_subscriptions s where s.user_id = u.id)::int as devices
      from users u left join planner_docs d on d.user_id = u.id order by u.created_at`)
    console.table(r.rows.map((x) => ({ email: x.email, role: x.role + (x.disabled ? ' (disabled)' : ''), created: new Date(x.created_at).toISOString().slice(0, 10), lastLogin: x.last_login_at ? new Date(x.last_login_at).toISOString().slice(0, 16) : '', version: x.version, kb: Math.round(x.bytes / 1024), pushDevices: x.devices })))
  },
  async 'create-user'() {
    const password = opt('password') || genPassword()
    const u = await auth.createUser({ email: need('email'), password, name: opt('name') || '', role: has('admin') ? 'admin' : undefined })
    console.log(`created ${u.email} (${u.role})${opt('password') ? '' : `\npassword: ${password}`}`)
  },
  async 'set-role'() {
    const role = need('role')
    if (!['admin', 'user'].includes(role)) throw new Error('--role must be admin or user')
    const u = await userBy(need('email'))
    await db.update(users).set({ role }).where(eq(users.id, u.id))
    console.log(`${u.email} is now ${role}`)
  },
  async disable() {
    const u = await userBy(need('email'))
    await db.update(users).set({ disabled: true }).where(eq(users.id, u.id))
    await db.delete(sessions).where(eq(sessions.userId, u.id))
    console.log(`${u.email} disabled and signed out`)
  },
  async enable() {
    const u = await userBy(need('email'))
    await db.update(users).set({ disabled: false }).where(eq(users.id, u.id))
    console.log(`${u.email} enabled`)
  },
  async 'set-password'() {
    const u = await userBy(need('email'))
    const password = opt('password') || genPassword()
    await auth.setPassword(u.id, password)
    await auth.endOtherSessions(u.id)
    console.log(`password changed for ${u.email}${opt('password') ? '' : `: ${password}`}`)
  },
  async 'create-token'() {
    const u = await userBy(need('email'))
    const token = await auth.createApiToken(u.id, opt('name') || 'cli')
    console.log(`API token for ${u.email} (shown once, keep it secret):\n${token}`)
  },
  async revisions() {
    const u = await userBy(need('email'))
    const cur = await planner.get(u.id)
    console.log(`current: v${cur.version}  ${cur.updatedAt?.toISOString?.() ?? ''}  ${cur.device ?? ''}`)
    console.table((await planner.revisions(u.id, 200)).map((r) => ({ id: r.id, version: r.version, schema: r.schemaVersion, reason: r.reason, device: r.device, at: r.createdAt.toISOString().slice(0, 19), kb: Math.round(r.bytes / 1024) })))
  },
  async restore() {
    const u = await userBy(need('email'))
    const r = await planner.restore(u.id, Number(need('revision')))
    console.log(`restored revision ${opt('revision')} for ${u.email} as v${r.version}; devices pick it up within ~30 s`)
  },
  async backup() {
    const dir = opt('dir') || cfg.backupDir || './backups'
    console.log(`wrote ${await dumpDatabase(cfg.databaseUrl, dir, 'manual')}`)
  },

  async 'import-legacy'() {
    const dir = need('dir')
    const email = need('email')
    await runMigrations(pool, { databaseUrl: cfg.databaseUrl, backupDir: cfg.backupDir })
    let u = await auth.findUserByEmail(email)
    let password = null
    if (!u) {
      password = opt('password') || genPassword()
      u = await auth.createUser({ email, password, role: 'admin' })
      console.log(`created admin account ${u.email}`)
    }
    const doc = readJson(path.join(dir, 'state.json'), null)
    await db.transaction(async (tx) => {
      if (doc?.state) {
        const [cur] = await tx.select().from(plannerDocs).where(eq(plannerDocs.userId, u.id))
        if (cur?.version > 0 && !has('force')) throw new Error(`${u.email} already has a planner (v${cur.version}); add --force to replace it (it is kept as a revision)`)
        if (cur?.version > 0) await tx.insert(plannerRevisions).values({ userId: u.id, version: cur.version, schemaVersion: cur.schemaVersion, state: cur.state, device: cur.device, reason: 'before-import' })
        // keep the version number, so devices that already synced with the old server carry on without a conflict
        const row = { version: doc.version || 1, schemaVersion: Number(doc.state.schemaVersion) || 1, state: doc.state, device: doc.device || 'import', updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(), lastRevisionAt: new Date() }
        await tx.insert(plannerDocs).values({ userId: u.id, ...row }).onConflictDoUpdate({ target: plannerDocs.userId, set: row })
        console.log(`planner: v${row.version} (schema ${row.schemaVersion}, ${Math.round(JSON.stringify(doc.state).length / 1024)} KB)`)
      }
      const hist = path.join(dir, 'history')
      const files = fs.existsSync(hist) ? fs.readdirSync(hist).filter((f) => f.endsWith('.json')).sort() : []
      for (const f of files) {
        const h = readJson(path.join(hist, f), null)
        if (!h?.state) continue
        const at = Number(f.match(/-(\d{13})\.json$/)?.[1]) || Date.now()
        await tx.insert(plannerRevisions).values({ userId: u.id, version: h.version || 0, schemaVersion: Number(h.state.schemaVersion) || 1, state: h.state, device: h.device || '', reason: 'import', createdAt: new Date(at) })
      }
      if (files.length) console.log(`history: ${files.length} revision(s)`)

      const subs = readJson(path.join(dir, 'subscriptions.json'), [])
      for (const s of subs) {
        if (!s?.subscription?.endpoint || !s.subscription.keys) continue
        const row = { userId: u.id, keys: s.subscription.keys, label: s.label || '', userAgent: s.ua || '', createdAt: s.createdAt ? new Date(s.createdAt) : new Date() }
        await tx.insert(pushSubscriptions).values({ endpoint: s.subscription.endpoint, ...row }).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row })
      }
      if (subs.length) console.log(`push devices: ${subs.length}`)

      const vapid = readJson(path.join(dir, 'vapid.json'), null)
      if (vapid?.publicKey && vapid?.privateKey) {
        await tx.insert(appKv).values({ key: 'vapid', value: vapid }).onConflictDoUpdate({ target: appKv.key, set: { value: vapid, updatedAt: new Date() } })
        console.log('VAPID keys: imported (existing phone subscriptions keep working; restart the app container to load them)')
      }

      const list = readJson(path.join(dir, 'issues.json'), [])
      let n = 0
      for (const i of list) {
        const no = issueNo(i.id)
        if (!no) continue
        const d = (v) => (v ? new Date(v) : null)
        await tx.insert(issues).values({
          number: no, reporterId: u.id, title: i.title || '(untitled)', details: i.details || '', kind: i.kind || 'bug', severity: i.severity || 'medium',
          status: i.status || 'open', screen: i.screen || '', screenTitle: i.screenTitle || '', route: i.route || '',
          platform: i.platform || platformFromUA(i.context?.userAgent), context: i.context || {}, resolution: i.resolution || '', commit: i.commit || '',
          createdAt: d(i.createdAt) || new Date(), updatedAt: d(i.updatedAt) || new Date(), resolvedAt: d(i.resolvedAt),
        }).onConflictDoNothing()
        n++
      }
      if (n) {
        await tx.execute(sql`select setval(pg_get_serial_sequence('issues', 'number'), (select max(number) from issues))`)
        console.log(`issues: ${n}`)
      }
    })
    if (password) console.log(`\nSign in as ${u.email} with password: ${password}\n(change it in Settings → Account)`)
  },
}

try {
  if (!commands[cmd]) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
    process.exitCode = cmd ? 1 : 0
  } else {
    await commands[cmd]()
  }
} catch (e) {
  console.error(`error: ${e.message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
