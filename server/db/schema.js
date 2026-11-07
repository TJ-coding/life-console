// Database schema (Drizzle ORM, PostgreSQL). Source of truth for `npm run db:generate`, which
// writes the SQL migrations in server/db/migrations/ (committed, applied on server start).
//
// Rules for changing it on a live service (see docs/OPERATIONS.md "Database migrations"):
//   - additive changes only in one release (new table, new nullable/defaulted column, new index);
//   - renames/drops are two releases: stop using it, deploy, then drop it in a later migration;
//   - never edit a migration that has shipped; generate a new one.
import { pgTable, text, uuid, timestamp, integer, jsonb, serial, primaryKey, index, uniqueIndex, boolean } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const ts = (name) => timestamp(name, { withTimezone: true })
const created = () => ts('created_at').notNull().defaultNow()

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(), // stored lower-cased
  name: text('name').notNull().default(''),
  passwordHash: text('password_hash').notNull(), // '' = no password (signs in with Google only)
  googleSub: text('google_sub'), // Google account id ("sub"), set once linked
  role: text('role').notNull().default('user'), // user | admin
  disabled: boolean('disabled').notNull().default(false),
  createdAt: created(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  lastLoginAt: ts('last_login_at'),
}, (t) => [uniqueIndex('users_email_key').on(t.email), uniqueIndex('users_google_sub_key').on(t.googleSub)])

/** Browser sessions: the cookie holds a random token, the table holds only its SHA-256. */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: created(),
  expiresAt: ts('expires_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  userAgent: text('user_agent').notNull().default(''),
}, (t) => [index('sessions_user_idx').on(t.userId)])

/** Long-lived bearer tokens for scripts (e.g. `npm run issues`). Created with the admin CLI. */
export const apiTokens = pgTable('api_tokens', {
  id: serial('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default(''),
  createdAt: created(),
  lastUsedAt: ts('last_used_at'),
}, (t) => [uniqueIndex('api_tokens_hash_key').on(t.tokenHash)])

export const passwordResets = pgTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: created(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
})

/**
 * One planner document per user: the same JSON the app syncs (`state`), versioned for optimistic
 * concurrency. `schemaVersion` mirrors state.schemaVersion so the server can refuse downgrades.
 */
export const plannerDocs = pgTable('planner_docs', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(0),
  schemaVersion: integer('schema_version').notNull().default(1),
  state: jsonb('state').notNull(),
  device: text('device').notNull().default(''),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  lastRevisionAt: ts('last_revision_at'),
})

/** Point-in-time copies of a planner (hourly while it changes, and before every forced overwrite). */
export const plannerRevisions = pgTable('planner_revisions', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  state: jsonb('state').notNull(),
  device: text('device').notNull().default(''),
  reason: text('reason').notNull().default(''), // hourly | force | restore | import | notification
  createdAt: created(),
}, (t) => [index('planner_revisions_user_idx').on(t.userId, t.id)])

export const pushSubscriptions = pgTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  keys: jsonb('keys').notNull(), // { p256dh, auth }
  label: text('label').notNull().default(''),
  userAgent: text('user_agent').notNull().default(''),
  createdAt: created(),
}, (t) => [index('push_subscriptions_user_idx').on(t.userId)])

/** Notification de-duplication. The primary key makes it safe with two app instances (rolling deploys). */
export const notificationsSent = pgTable('notifications_sent', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  sentAt: ts('sent_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.key] })])

/** In-app issue log (ISS-n): feedback about the app itself, reported with key I on any screen. */
export const issues = pgTable('issues', {
  number: serial('number').primaryKey(), // shown as ISS-<number>
  reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  details: text('details').notNull().default(''),
  kind: text('kind').notNull().default('bug'),
  severity: text('severity').notNull().default('medium'),
  status: text('status').notNull().default('open'),
  screen: text('screen').notNull().default(''),
  screenTitle: text('screen_title').notNull().default(''),
  route: text('route').notNull().default(''),
  platform: text('platform').notNull().default('web'),
  context: jsonb('context').notNull().default(sql`'{}'::jsonb`),
  resolution: text('resolution').notNull().default(''),
  commit: text('commit').notNull().default(''),
  createdAt: created(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
}, (t) => [index('issues_status_idx').on(t.status)])

/** Server-wide settings that must survive redeploys (VAPID keys). */
export const appKv = pgTable('app_kv', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})
