// All server settings come from the environment (see .env.example for the documented list).
const env = process.env
const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v))
/** an http(s) origin like http://umami.lan:3000 (a path is dropped), or '' when unset; anything else is a config error */
const origin = (v) => {
  if (!v) return ''
  let u
  try { u = new URL(v) } catch { u = null }
  if (!u || !/^https?:$/.test(u.protocol)) throw new Error(`ANALYTICS_DASHBOARD must be an http(s) URL, got ${JSON.stringify(v)}`)
  return u.origin
}
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d)

export function loadConfig(over = {}) {
  const e = { ...env, ...over }
  const appUrl = (e.APP_URL || '').replace(/\/$/, '')
  const cfg = {
    port: num(e.PORT, 80),
    databaseUrl: e.DATABASE_URL || '',
    appUrl, // public address, e.g. https://life-console.example.com (links in emails, cookie Secure flag, Origin check)
    dist: e.DIST || '',
    tickMs: num(e.TICK_MS, 30000),
    pushDryRun: bool(e.PUSH_DRY_RUN),
    outbox: e.PUSH_OUTBOX || '', // with PUSH_DRY_RUN: append dry-run pushes to this JSONL file
    vapidSubject: e.VAPID_SUBJECT || (appUrl.startsWith('https://') ? appUrl : 'mailto:admin@localhost'), // web-push needs https: or mailto:
    vapidPublicKey: e.VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: e.VAPID_PRIVATE_KEY || '',
    signups: (e.SIGNUPS || 'open').toLowerCase() === 'closed' ? 'closed' : 'open',
    adminEmails: (e.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    sessionDays: num(e.SESSION_DAYS, 90),
    cookieSecure: bool(e.COOKIE_SECURE, appUrl.startsWith('https://')),
    trustProxy: bool(e.TRUST_PROXY), // take the client IP from CF-Connecting-IP / X-Forwarded-For (rate limits)
    maxStateBytes: num(e.MAX_STATE_BYTES, 4 * 1024 * 1024),
    revisionEveryMin: num(e.REVISION_EVERY_MIN, 60), // snapshot a planner at most this often while it changes
    revisionsKeep: num(e.REVISIONS_KEEP, 200), // per user
    backupDir: e.BACKUP_DIR || '', // pre-migration pg_dump goes here (empty = skip)
    smtpUrl: e.SMTP_URL || '', // e.g. smtps://user:pass@smtp.example.com:465 — enables "Forgot password"
    mailFrom: e.MAIL_FROM || 'Life Console <no-reply@localhost>',
    skipMigrations: bool(e.SKIP_MIGRATIONS),
    // sign-in methods: email + password (default on), and/or Google (on when a client id + secret are set)
    passwordAuth: bool(e.AUTH_PASSWORD, true),
    googleClientId: e.GOOGLE_CLIENT_ID || '',
    googleClientSecret: e.GOOGLE_CLIENT_SECRET || '',
    googleAuthUrl: e.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth', // overridable for tests
    // public landing page at / for visitors who aren't signed in, plus a search-engine-friendly robots.txt/sitemap.
    // Off (the default) keeps a self-hosted server private: / is the app and robots.txt asks crawlers to stay out.
    landing: bool(e.LANDING),
    // A/B test of the landing page: on = each new visitor gets landing.html (A) or landing-b.html (B) at random,
    // remembered in the lc_lp cookie. Off: everyone gets A; /?lp=b still previews B
    landingAb: bool(e.LANDING_AB),
    // the GitHub repository whose star count the landing pages show (fetched hourly by the server, so visitors'
    // browsers never contact GitHub). Empty = no count
    githubRepo: 'GITHUB_REPO' in e ? e.GITHUB_REPO : 'TJ-coding/life-console',
    githubApi: e.GITHUB_API || 'https://api.github.com', // overridable for tests
    // optional Umami analytics: the tracker script URL and the website ID. The landing page (LANDING=on) gets the tag;
    // the app loads it itself, sends screen names only, and each person can turn it off in Settings → Privacy
    analyticsScript: e.ANALYTICS_SCRIPT || '',
    analyticsSiteId: e.ANALYTICS_SITE_ID || '',
    // optional Umami recorder script (recorder.js) for a click and scroll heatmap of the landing page only; never the app
    analyticsRecorder: e.ANALYTICS_RECORDER || '',
    // optional Umami dashboard origin (e.g. http://umami.lan:3000) allowed to show the landing page in a frame: Umami
    // draws the heatmap over the live page in an iframe. Only the landing page; everything else stays unframeable
    analyticsDashboard: origin(e.ANALYTICS_DASHBOARD),
    googleTokenUrl: e.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  }
  cfg.google = !!(cfg.googleClientId && cfg.googleClientSecret)
  if (cfg.google && !cfg.appUrl) throw new Error('GOOGLE_CLIENT_ID needs APP_URL (the redirect URL is APP_URL/api/auth/google/callback)')
  if (!cfg.passwordAuth && !cfg.google) throw new Error('AUTH_PASSWORD=off needs Google sign-in (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET), or nobody could sign in')
  if (!cfg.databaseUrl) throw new Error('DATABASE_URL is required (e.g. postgres://user:pass@localhost:5432/life_console)')
  return cfg
}
