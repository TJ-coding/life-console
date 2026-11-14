// The planner document's schema: versions, migrations and the defaults every document is normalised to.
// Pure JS with no Vue, so the browser (store.js), the server (cli.mjs check-docs) and Node tests share it.
//
// Each migration step upgrades a stored document by one version. They run on every load / sync / import,
// so data saved by older versions of the app (on the server or in a browser) keeps working.
// To change the data shape: bump SCHEMA_VERSION and add the next numbered step. Never edit old steps.
// A new OPTIONAL field with a default needs no step: default it in normalizeDoc() instead.
// Keys this code doesn't know are never dropped (a newer release may have written them); test/state.test.mjs checks it.
import { POMODORO_DEFAULTS } from './pomodoro.mjs'

export const SCHEMA_VERSION = 2
const PLAN_STATUSES = ['active', 'paused', 'archived']
function planV2(p) {
  const legacyLabel = typeof p.status === 'string' && !PLAN_STATUSES.includes(p.status) ? p.status : null
  return {
    ...p,
    id: p.id ?? p.planNo ?? 'SP-01',
    status: PLAN_STATUSES.includes(p.status) ? p.status : 'active',
    health: p.health ?? (legacyLabel ? legacyLabel.replace(/^Active\s*·\s*/i, '') : 'On-track'),
  }
}
export const MIGRATIONS = {
  // v1 → v2: a single strategic plan (`plan`) becomes a list (`plans`), each with an id and status
  2(doc) {
    if (!Array.isArray(doc.plans)) doc.plans = []
    if (doc.plan) {
      const p = planV2(doc.plan)
      if (!doc.plans.some((x) => x.id === p.id)) doc.plans.unshift(p)
      delete doc.plan
    }
    doc.plans = doc.plans.map(planV2)
  },
}
/** Upgrade a document in place to SCHEMA_VERSION (idempotent; tolerates stale clients re-adding old fields). */
export function migrateDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc
  let v = Number(doc.schemaVersion) || 1
  while (v < SCHEMA_VERSION) { MIGRATIONS[v + 1](doc); v += 1 }
  if (doc.plan) MIGRATIONS[2](doc) // an out-of-date device synced the old field back
  doc.schemaVersion = SCHEMA_VERSION
  return doc
}

/** Notification preferences live in the synced document so the server scheduler can read them. */
export const NOTIFY_DEFAULTS = {
  notify: { blocks: true, deadlines: true, daily: true, wellbeing: true, vibrate: true, pomodoro: true },
  pomodoro: { ...POMODORO_DEFAULTS }, // work/short/long minutes, long break after `every` pomodoros
  shareUsage: true, // anonymous usage statistics, when the server collects them (Settings → Privacy)
  blockLeadMin: 5, briefingTime: '07:30', eveningTime: '21:00', bedTime: '23:00', windDownMin: 60, caffeineWarnMin: 30,
}
/** Every todo carries a numeric `order` used to rank todos that share a priority. */
export function ensureOrderDoc(doc) {
  doc.todos?.forEach((t, i) => { if (typeof t.order !== 'number') t.order = (i + 1) * 1000 })
}
/** Fill in missing settings (the device's timezone is set by store.js, since it depends on the device). */
export function ensureSettingsDoc(doc) {
  if (!doc.settings) doc.settings = {}
  const s = doc.settings
  for (const [k, v] of Object.entries(NOTIFY_DEFAULTS)) if (s[k] === undefined) s[k] = typeof v === 'object' ? { ...v } : v
  for (const [k, v] of Object.entries(NOTIFY_DEFAULTS.notify)) if (s.notify[k] === undefined) s.notify[k] = v
  for (const [k, v] of Object.entries(POMODORO_DEFAULTS)) if (s.pomodoro[k] === undefined) s.pomodoro[k] = v
}
/**
 * The document part of normalizeState(): migrations plus the defaults of optional fields. Runs in place.
 * store.js adds what depends on the device or the live store (timezone, linked dues, subtask invariants).
 */
export function normalizeDoc(doc) {
  migrateDoc(doc)
  ensureOrderDoc(doc)
  ensureSettingsDoc(doc)
  // SIGs may depend on other SIGs (ISS-5); the field is optional, so default it instead of a migration
  for (const p of doc.plans ?? []) for (const s of p.sigs ?? []) if (!Array.isArray(s.deps)) s.deps = []
  // an internal (earlier, personal) deadline beside the hard due date (ISS-9); also optional
  for (const d of doc.deadlines ?? []) {
    if (d.internal === undefined) d.internal = ''
    delete d.clickUp // the mock ClickUp sync was removed; the field was never used for anything else
  }
  return doc
}
