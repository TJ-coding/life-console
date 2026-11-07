// Scheduled database backups (the `backup` service in docker-compose.yml runs this).
// Every BACKUP_INTERVAL_HOURS (24) it writes BACKUP_DIR/daily-<time>.dump (pg_dump custom format) and
// deletes daily dumps older than BACKUP_KEEP_DAYS (14); pre-migration dumps are kept twice as long.
// Restore: see docs/SELF_HOSTING.md "Restore a backup". Copy BACKUP_DIR off the server for real safety.
import fs from 'node:fs'
import path from 'node:path'
import { dumpDatabase } from './db/index.mjs'

const url = process.env.DATABASE_URL
const dir = process.env.BACKUP_DIR || '/backups'
const everyH = Number(process.env.BACKUP_INTERVAL_HOURS) || 24
const keepDays = Number(process.env.BACKUP_KEEP_DAYS) || 14
const log = (...a) => console.log(new Date().toISOString(), '[backup]', ...a)
if (!url) { log('DATABASE_URL is required'); process.exit(1) }

function prune() {
  const now = Date.now()
  for (const f of fs.readdirSync(dir)) {
    const keep = f.startsWith('daily-') ? keepDays : f.startsWith('pre-migrate-') ? keepDays * 2 : null
    if (keep === null) continue
    const p = path.join(dir, f)
    if (now - fs.statSync(p).mtimeMs > keep * 86400000) { fs.rmSync(p); log('pruned', f) }
  }
}
async function run() {
  try {
    const file = await dumpDatabase(url, dir, 'daily')
    log('wrote', file, `${Math.round(fs.statSync(file).size / 1024)} KB`)
    prune()
  } catch (e) { log('FAILED:', e.message) }
}
await new Promise((r) => setTimeout(r, 15000)) // let the app apply migrations first
await run()
setInterval(run, everyH * 3600000)
process.on('SIGTERM', () => process.exit(0))
