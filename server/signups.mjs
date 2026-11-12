// Who may create an account.
//
// SIGNUPS (environment) sets the default. An admin can open or close sign-ups in Settings; that choice is stored
// in app_kv ('signups') and wins over the default until an admin resets it. Whatever the mode, the very first
// account on an empty server is always allowed (it becomes the admin), so a server can start closed and its owner
// still signs up without the CLI. With ADMIN_EMAILS set, only those emails get that first-account exception, so a
// stranger can't slip in before the owner.
import { eq, sql } from 'drizzle-orm'
import { appKv, users } from './db/schema.js'

const KEY = 'signups'
const CACHE_MS = 5000 // other replicas see an admin's change within a few seconds

export function createSignups(db, cfg) {
  let cache = null
  async function setting() {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
    const v = (await db.select().from(appKv).where(eq(appKv.key, KEY)).limit(1))[0]?.value
    const value = v && (v.mode === 'open' || v.mode === 'closed') ? v : null
    cache = { at: Date.now(), value }
    return value
  }
  const noUsersYet = async () => (await db.select({ n: sql`count(*)::int` }).from(users))[0].n === 0

  /** For admins: the mode in force, whether an admin set it or it's the SIGNUPS default, and that default. */
  async function status() {
    const s = await setting()
    return { mode: s ? s.mode : cfg.signups, source: s ? 'admin' : 'default', defaultMode: cfg.signups, changedAt: s?.at ?? null }
  }
  /** May this (normalised) email create an account right now? */
  async function allows(email) {
    if ((await status()).mode === 'open') return true
    if (!(await noUsersYet())) return false
    return !cfg.adminEmails.length || cfg.adminEmails.includes(email)
  }
  /** What the sign-in screen offers: "open" also while the server has no accounts yet (the owner's first sign-up). */
  async function publicMode() {
    if ((await status()).mode === 'open') return 'open'
    return (await noUsersYet()) ? 'open' : 'closed'
  }
  /** Admins: 'open' or 'closed', or null to go back to the SIGNUPS default. */
  async function set(mode, byUserId) {
    if (mode === null) await db.delete(appKv).where(eq(appKv.key, KEY))
    else {
      const value = { mode, at: new Date().toISOString(), by: byUserId }
      await db.insert(appKv).values({ key: KEY, value }).onConflictDoUpdate({ target: appKv.key, set: { value, updatedAt: new Date() } })
    }
    cache = null
    return status()
  }
  return { status, allows, publicMode, set }
}
