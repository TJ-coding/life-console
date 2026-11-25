// Database schema (Drizzle ORM, PostgreSQL). Source of truth for `npm run db:generate`, which
// writes the SQL migrations in server/db/migrations/ (committed, applied on server start).
//
// Rules for changing it on a live service (see docs/OPERATIONS.md "Database migrations"):
//   - additive changes only in one release (new table, new nullable/defaulted column, new index);
//   - renames/drops are two releases: stop using it, deploy, then drop it in a later migration;
//   - never edit a migration that has shipped; generate a new one.
import { pgTable, text, uuid, timestamp, date, integer, jsonb, serial, primaryKey, index, uniqueIndex, boolean } from 'drizzle-orm/pg-core'
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
  // the plugin platform (docs/PLATFORM.md): a public name for publishing plugins and sharing (alice), and whether
  // this account turned on Public plugins (from then on, account actions need the trusted page)
  handle: text('handle'),
  publicPlugins: boolean('public_plugins').notNull().default(false),
  // open data (goals 9-11): where this account's Solid pod is (null = the pod built into this server), and, after a
  // move, the address that now serves the account (this server keeps forwarding to it)
  podUrl: text('pod_url'),
  movedTo: text('moved_to'),
}, (t) => [uniqueIndex('users_email_key').on(t.email), uniqueIndex('users_google_sub_key').on(t.googleSub), uniqueIndex('users_handle_key').on(t.handle)])

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
  /** '' = the whole API (Mac app, scripts); 'extensions' = only the workshop connection for an AI (/mcp) */
  scope: text('scope').notNull().default(''),
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
  // when the reporter saw the "your issue is fixed" note (null = not yet; the app then shows it)
  reporterSeenAt: ts('reporter_seen_at'),
  // the conversation after the report: [{ by: 'reporter' | 'admin', text, at, reopened? }]
  replies: jsonb('replies').notNull().default(sql`'[]'::jsonb`),
}, (t) => [index('issues_status_idx').on(t.status)])

/**
 * One row per account per (UTC) day it used the app: the basis for usage metrics (daily/weekly/monthly
 * active users, churn; server/metrics.mjs). Only the date is kept: no times, pages or devices.
 */
export const userActivity = pgTable('user_activity', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.day] }), index('user_activity_day_idx').on(t.day)])

/** Server-wide settings that must survive redeploys (VAPID keys). */
export const appKv = pgTable('app_kv', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

/* ── the plugin platform (platform/whitepaper.md, docs/PLATFORM.md) ── */

/** Consent (goal 3): one-time nonces the trusted page (/trust) embeds; an action runs only with one. Hash only. */
export const consentNonces = pgTable('consent_nonces', {
  nonceHash: text('nonce_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  action: jsonb('action').notNull(), // { kind, … } what the page showed, so the POST can't be swapped for another action
  createdAt: created(),
  usedAt: ts('used_at'),
}, (t) => [index('consent_nonces_user_idx').on(t.userId)])

/** The registry (goal 6): packages named author/name, public or private. */
export const pluginPackages = pgTable('plugin_packages', {
  name: text('name').primaryKey(), // alice/habits
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  visibility: text('visibility').notNull().default('private'), // public | private | unlisted (off the listing, still works for people who installed it)
  title: text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  icon: text('icon').notNull().default('extension'),
  downloads: integer('downloads').notNull().default(0),
  upstream: text('upstream'), // a copy of a plugin from another server's registry (REGISTRY_UPSTREAM): never published to here
  forkedFrom: text('forked_from'), // the extension this one was forked from (its author gets suggestions from here)
  createdAt: created(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('plugin_packages_owner_idx').on(t.ownerId)])

/** Every published version, fixed: identified by the SHA-256 of its code. */
export const pluginVersions = pgTable('plugin_versions', {
  hash: text('hash').primaryKey(),
  packageName: text('package_name').notNull().references(() => pluginPackages.name, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  code: text('code').notNull(),
  manifest: jsonb('manifest').notNull(), // what the registry read from the code: title, says, replaces, sdk…
  checks: jsonb('checks').notNull(), // automated check results
  changelog: text('changelog').notNull().default(''),
  pulled: boolean('pulled').notNull().default(false),
  pulledReason: text('pulled_reason').notNull().default(''),
  createdAt: created(),
}, (t) => [uniqueIndex('plugin_versions_pkg_version_key').on(t.packageName, t.version)])

/** What each account installed (only through the trusted page). */
export const pluginInstalls = pgTable('plugin_installs', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  packageName: text('package_name').notNull(),
  hash: text('hash').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  installedAt: created(),
}, (t) => [primaryKey({ columns: [t.userId, t.packageName] })])

export const pluginReports = pgTable('plugin_reports', {
  id: serial('id').primaryKey(),
  packageName: text('package_name').notNull(),
  hash: text('hash').notNull().default(''),
  reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  createdAt: created(),
}, (t) => [index('plugin_reports_pkg_idx').on(t.packageName)])

/** Likes: one per person per extension (shown as a count on listings). */
export const pluginLikes = pgTable('plugin_likes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  packageName: text('package_name').notNull().references(() => pluginPackages.name, { onDelete: 'cascade' }),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.userId, t.packageName] }), index('plugin_likes_pkg_idx').on(t.packageName)])

/** Suggestions (pull requests): someone proposes a version of their fork as the next version of the original. */
export const pluginProposals = pgTable('plugin_proposals', {
  id: serial('id').primaryKey(),
  packageName: text('package_name').notNull().references(() => pluginPackages.name, { onDelete: 'cascade' }), // the original
  fromHash: text('from_hash').notNull(), // a version of the proposer's fork
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }), // who proposes it
  message: text('message').notNull().default(''),
  status: text('status').notNull().default('open'), // open | accepted | declined
  createdAt: created(),
  decidedAt: ts('decided_at'),
}, (t) => [index('plugin_proposals_pkg_idx').on(t.packageName)])

/** The write-only vault (goal 8): keys saved once on the trusted page, used by the server, never shown again. */
export const vaultSecrets = pgTable('vault_secrets', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // strava
  site: text('site').notNull(), // www.strava.com: the only host the key is ever sent to
  scheme: text('scheme').notNull().default('bearer'), // bearer | header:<Name> | query:<param>
  ciphertext: text('ciphertext').notNull(), // AES-256-GCM, base64 (iv.tag.data)
  createdAt: created(),
  lastUsedAt: ts('last_used_at'),
}, (t) => [primaryKey({ columns: [t.userId, t.name] })])

/* ── open data: Solid pods and ActivityPub (goals 9-11, platform/whitepaper.md part 2) ── */

/** The pod built into this server: Solid resources (LDP) per account, served at /pods/<handle>/… */
export const podResources = pgTable('pod_resources', {
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  path: text('path').notNull(), // planner/todos.jsonld (no leading slash)
  contentType: text('content_type').notNull().default('application/ld+json'),
  body: text('body').notNull(),
  etag: text('etag').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.path] })])

/** Each account's ActivityPub key pair (HTTP Signatures). */
export const actorKeys = pgTable('actor_keys', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  publicPem: text('public_pem').notNull(),
  privatePem: text('private_pem').notNull(),
  createdAt: created(),
})

/** What this account shared with whom (the share list lives with the owner; revoking stops answering). */
export const shares = pgTable('shares', {
  id: text('id').primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  recordType: text('record_type').notNull(), // core.Plan
  recordId: text('record_id').notNull(), // SP-01
  actor: text('actor').notNull(), // https://other.example/u/bob
  access: text('access').notNull().default('view'), // view | edit
  revokedAt: ts('revoked_at'),
  createdAt: created(),
}, (t) => [index('shares_owner_idx').on(t.ownerId), index('shares_actor_idx').on(t.actor)])

/** Activities that arrived for an account: shares offered to it, updates, moves. */
export const federationInbox = pgTable('federation_inbox', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  actor: text('actor').notNull(),
  type: text('type').notNull(), // Offer | Update | Undo | Move
  objectId: text('object_id').notNull().default(''),
  activity: jsonb('activity').notNull(),
  status: text('status').notNull().default('new'), // new | accepted | declined | done
  receivedAt: ts('received_at').notNull().defaultNow(),
}, (t) => [index('federation_inbox_user_idx').on(t.userId)])

/** Remote actors this server has fetched (public keys, inboxes), refreshed when a signature fails. */
export const remoteActors = pgTable('remote_actors', {
  id: text('id').primaryKey(), // the actor URL
  inbox: text('inbox').notNull(),
  publicPem: text('public_pem').notNull(),
  handle: text('handle').notNull().default(''),
  movedTo: text('moved_to'),
  fetchedAt: ts('fetched_at').notNull().defaultNow(),
})
