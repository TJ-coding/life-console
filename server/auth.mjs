// Accounts: password hashing (scrypt, no native deps), cookie sessions, API tokens, password resets.
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { users, sessions, apiTokens, passwordResets } from './db/schema.js'

const scrypt = promisify(crypto.scrypt)
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
export const COOKIE = 'lc_session'
export const MIN_PASSWORD = 8

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
export const newToken = (prefix = '') => prefix + crypto.randomBytes(32).toString('base64url')
export const normEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16)
  const key = await scrypt(pw, salt, 64, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}
export async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, key] = String(stored).split('$')
  if (alg !== 'scrypt') return false
  const want = Buffer.from(key, 'base64')
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem })
  return crypto.timingSafeEqual(want, got)
}
/** Spend the same time on unknown emails, so login timing doesn't reveal which accounts exist. */
const DUMMY_HASH = hashPassword('not-a-real-password')
export const burnPasswordCheck = async (pw) => { await verifyPassword(pw, await DUMMY_HASH) }

export function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`
  if (pw.length > 200) return 'Password is too long'
  return ''
}

export const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt }

export function createAuth(db, cfg) {
  const days = cfg.sessionDays
  const cookieAttrs = (maxAge) => `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.cookieSecure ? '; Secure' : ''}`

  async function findUserByEmail(email) {
    return (await db.select().from(users).where(eq(users.email, normEmail(email))).limit(1))[0] ?? null
  }
  /** Admins: emails in ADMIN_EMAILS, plus the very first account on a fresh install. */
  async function roleFor(email) {
    if (cfg.adminEmails.includes(email)) return 'admin'
    const [{ n }] = await db.select({ n: sql`count(*)::int` }).from(users)
    return n === 0 ? 'admin' : 'user'
  }
  async function createUser({ email, password, name = '', role }) {
    email = normEmail(email)
    if (!validEmail(email)) throw httpError(400, 'Enter a valid email address')
    const bad = checkPassword(password)
    if (bad) throw httpError(400, bad)
    if (await findUserByEmail(email)) throw httpError(409, 'An account with this email already exists')
    const [u] = await db.insert(users).values({
      email, name: String(name).trim().slice(0, 80), passwordHash: await hashPassword(password), role: role || (await roleFor(email)),
    }).returning()
    return u
  }

  async function startSession(userId, userAgent = '') {
    const token = newToken()
    await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + days * 86400000), userAgent: String(userAgent).slice(0, 200) })
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId))
    return { token, cookie: `${COOKIE}=${token}; ${cookieAttrs(days * 86400)}` }
  }
  const clearCookie = () => `${COOKIE}=; ${cookieAttrs(0)}`

  /** Who is calling: a session cookie or `Authorization: Bearer <api token>`. Returns { user, via, tokenHash } or null. */
  async function identify(req) {
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1]
    if (bearer) {
      const h = sha256(bearer)
      const row = (await db.select({ u: users, t: apiTokens }).from(apiTokens).innerJoin(users, eq(users.id, apiTokens.userId)).where(eq(apiTokens.tokenHash, h)).limit(1))[0]
      if (!row || row.u.disabled) return null
      if (!row.t.lastUsedAt || Date.now() - row.t.lastUsedAt.getTime() > 3600000) await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.t.id))
      return { user: row.u, via: 'token' }
    }
    const token = parseCookies(req.headers.cookie)[COOKIE]
    if (!token) return null
    const h = sha256(token)
    const row = (await db.select({ u: users, s: sessions }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, h), gt(sessions.expiresAt, new Date()))).limit(1))[0]
    if (!row || row.u.disabled) return null
    // sliding expiry, written at most once a day per session
    if (Date.now() - row.s.lastSeenAt.getTime() > 86400000) {
      await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + days * 86400000) }).where(eq(sessions.tokenHash, h))
    }
    return { user: row.u, via: 'session', tokenHash: h }
  }

  async function endSession(tokenHash) { if (tokenHash) await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)) }
  async function endOtherSessions(userId, keepHash) {
    await db.delete(sessions).where(keepHash ? and(eq(sessions.userId, userId), sql`${sessions.tokenHash} <> ${keepHash}`) : eq(sessions.userId, userId))
  }
  async function setPassword(userId, password) {
    const bad = checkPassword(password)
    if (bad) throw httpError(400, bad)
    await db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, userId))
  }

  async function createResetToken(userId, ttlMin = 60) {
    const token = newToken()
    await db.insert(passwordResets).values({ tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + ttlMin * 60000) })
    return token
  }
  async function useResetToken(token, password) {
    const bad = checkPassword(password)
    if (bad) throw httpError(400, bad)
    const h = sha256(String(token || ''))
    const [row] = await db.update(passwordResets).set({ usedAt: new Date() })
      .where(and(eq(passwordResets.tokenHash, h), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date()))).returning()
    if (!row) throw httpError(400, 'This reset link has expired or was already used')
    await setPassword(row.userId, password)
    await endOtherSessions(row.userId) // a reset signs every device out
    return row.userId
  }
  async function createApiToken(userId, name = '') {
    const token = newToken('lct_')
    await db.insert(apiTokens).values({ tokenHash: sha256(token), userId, name: String(name).slice(0, 60) })
    return token
  }
  async function purgeExpired() {
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
    await db.delete(passwordResets).where(lt(passwordResets.expiresAt, new Date(Date.now() - 86400000)))
  }

  return { findUserByEmail, createUser, startSession, clearCookie, identify, endSession, endOtherSessions, setPassword, createResetToken, useResetToken, createApiToken, purgeExpired }
}

export function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export const httpError = (status, message) => Object.assign(new Error(message), { status })

/** Fixed-window rate limiter kept in memory (per instance — enough to stop password guessing). */
export function createLimiter() {
  const hits = new Map()
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k) }, 60000).unref()
  return function limit(key, max, windowMs) {
    const now = Date.now()
    let h = hits.get(key)
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h) }
    h.n += 1
    if (h.n > max) throw Object.assign(httpError(429, 'Too many attempts — try again later'), { retryAfter: Math.ceil((h.reset - now) / 1000) })
  }
}
