// Life Console server: serves the built app, stores each user's planner in PostgreSQL (synced
// between their devices), and sends scheduled Web Push notifications.
//
// Start-up order: connect → apply pending migrations (locked, with a pg_dump first when BACKUP_DIR
// is set) → listen → scheduler. Settings: see config.mjs and .env.example.
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'
import { connect, runMigrations } from './db/index.mjs'
import { createApp } from './app.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const log = (...a) => console.log(new Date().toISOString(), ...a)

const cfg = loadConfig()
cfg.dist ||= path.join(here, '..', 'dist')
const { pool, db } = connect(cfg.databaseUrl)

// the database may still be starting (compose, first boot): retry for a minute
for (let i = 0; ; i++) {
  try { await pool.query('select 1'); break } catch (e) {
    if (i >= 30) { log('[db] unreachable:', e.message); process.exit(1) }
    log(`[db] waiting for database (${e.code || e.message})`)
    await new Promise((r) => setTimeout(r, 2000))
  }
}
if (!cfg.skipMigrations) await runMigrations(pool, { databaseUrl: cfg.databaseUrl, backupDir: cfg.backupDir, log })

const app = await createApp({ cfg, db, pool, log })
const server = http.createServer(app.handler)
server.keepAliveTimeout = 65000
server.listen(cfg.port, () => log(`life-console listening on :${cfg.port} · build ${app.build} · sign-ups default ${cfg.signups}${cfg.pushDryRun ? ' · PUSH DRY RUN' : ''}`))
app.scheduler.start()

let stopping = false
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (stopping) return
    stopping = true
    log(`${sig}: finishing open requests, then exiting`)
    app.close()
    server.close(() => pool.end().finally(() => process.exit(0)))
    server.closeIdleConnections?.()
    setTimeout(() => process.exit(0), 10000).unref() // don't hang a deploy on a stuck connection
  })
}
