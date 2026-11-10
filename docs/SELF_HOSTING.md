# Self-hosting Life Console

Life Console runs as three containers: **PostgreSQL**, the **app** (web app + sync API + push notifications), and a **backup** job. Everything is in [`docker-compose.yml`](../docker-compose.yml).

## 1. Start it

Needs Docker with the compose plugin, about 300 MB of RAM and very little disk.

```bash
git clone https://github.com/TJ-coding/life-console.git && cd life-console   # or copy just docker-compose.yml + .env.example
cp .env.example .env
sed -i.bak "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env   # or edit it by hand
docker compose up -d
```

Open **http://localhost:8080** and create an account. **The first account is the admin**, unless `ADMIN_EMAILS` is set, in which case only those emails are. After that, set `SIGNUPS=closed` in `.env` (then `docker compose up -d`) if nobody else should sign up.

The images are prebuilt (`ghcr.io/tj-coding/life-console`). To build from source instead, run `docker compose up -d --build`.

## 2. Put it on the internet (HTTPS)

Phones only install the app and receive notifications over **HTTPS**. Put any reverse proxy in front of port 8080, then set these in `.env`:

```env
APP_URL=https://planner.example.com   # also turns on Secure cookies and the CSRF origin check
TRUST_PROXY=1                         # rate limits use the real client IP from the proxy
```

Examples: Caddy (`planner.example.com { reverse_proxy localhost:8080 }`), Traefik, nginx, or a Cloudflare Tunnel. Don't put another login in front of it (such as Cloudflare Access): the app has its own accounts, and a login proxy breaks install and push on phones.

## 3. Settings

All the settings are in [`.env.example`](../.env.example), with comments. These are the ones you're most likely to change:

| Variable | Default | What it does |
|---|---|---|
| `POSTGRES_PASSWORD` | (required) | Database password. Use letters and digits only, because it goes into a URL. |
| `APP_URL` | `http://localhost:8080` | The public address. It's used in reset emails, the cookie `Secure` flag and the origin check. |
| `SIGNUPS` | `open` | `closed`: only the admin CLI can create accounts. |
| `ADMIN_EMAILS` | none | Emails that are always admin. |
| `SMTP_URL`, `MAIL_FROM` | none | Turns on "Forgot password?" emails. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none | Turns on "Continue with Google" (see below). |
| `AUTH_PASSWORD` | `on` | `off` = Google only: no passwords are accepted or stored. |
| `LANDING` | `off` | `on` shows the life-console.dev landing page at `/` to visitors who aren't signed in and lets search engines index it. Off, `robots.txt` asks crawlers to stay out. `/app` always opens the app. |
| `LANDING_AB` | `off` | With `LANDING=on`: `on` shows each new visitor one of two landing pages (`landing.html` or `landing-b.html`) at random and remembers it in the `lc_lp` cookie. `/?lp=a` or `/?lp=b` always shows that one. |
| `GITHUB_REPO` | `TJ-coding/life-console` | With `LANDING=on`: the repository whose star count the landing pages' Star button shows. The server fetches it at most hourly; visitors' browsers never contact GitHub. Empty = no count. |
| `ANALYTICS_SCRIPT`, `ANALYTICS_SITE_ID` | none | Anonymous [Umami](https://umami.is) statistics (script URL + website ID): the landing page and the `/docs/…` pages (with `LANDING=on`), and the app's screen views, as route patterns only. Each person can turn the app's off in Settings → Privacy. |
| `ANALYTICS_RECORDER` | none | Umami's `recorder.js` URL: a click and scroll heatmap, and optionally session replays, of the landing page only (the app never loads it). Switch them on for the website in Umami. Self-hosted Umami never deletes old replays, so add a cleanup job if you turn them on: delete rows older than your retention period from `session_replay` and `session_replay_saved` in Umami's database. |
| `ANALYTICS_DASHBOARD` | none | Your Umami dashboard's address (e.g. `https://umami.example.com`). Umami draws the heatmap over the live landing page in an iframe, and the server refuses all framing by default, so without this the heatmap sits on a blank page. Only that origin may frame the landing page; the app never can. |
| `LC_VERSION` | `latest` | The image tag to run. Pin one for controlled updates. |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP_DAYS` | 24 / 14 | The schedule and retention of the backup job. |

Advanced settings (set them under `app: environment:`): `SESSION_DAYS` (90), `MAX_STATE_BYTES` (4 MB per planner), `REVISION_EVERY_MIN` (60), `REVISIONS_KEEP` (200 per user), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (otherwise they're generated once and stored in the database).

**Sign in with Google:**

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), set up the *OAuth consent screen*: External, app name, support email, scopes `openid`, `email` and `profile`. Then press **Publish app**. These scopes don't need Google's review, and while the app is in *Testing* only listed test users can sign in.
2. Go to *Credentials → Create credentials → OAuth client ID → Web application*. Under *Authorized redirect URIs*, add `<APP_URL>/api/auth/google/callback`, e.g. `https://planner.example.com/api/auth/google/callback`.
3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then run `docker compose up -d`.

Existing accounts are linked by their (verified) email at their first Google sign-in. Add `AUTH_PASSWORD=off` to make Google the only way in. Each remaining password hash is then deleted at that user's next Google sign-in. Google sign-in works only on the `APP_URL` host, because the redirect URI is fixed.

**Using Supabase or another managed Postgres:** drop the `db` service and set `DATABASE_URL` for `app` and `backup` to that database's connection string (Supabase: *Project Settings → Database → Connection string*, the **session** pooler or a direct connection, not the transaction pooler, because migrations use advisory locks). Nothing else changes.

**Privacy policy and terms:** `/privacy` and `/terms` serve `public/privacy.html` and `public/terms.html`, which are written for the public service at life-console.dev. If other people use your server, replace them with your own (same file names) and build from source.

## 4. Updating

```bash
docker compose pull && docker compose up -d
```

Here's what happens on each update:

1. The new app container starts. If the database needs a migration, it first writes a full `pg_dump` to the backups volume (`pre-migrate-<time>.dump`), then applies the migrations in **one transaction** under a lock. If a migration fails, nothing changes and the container exits.
2. The app goes live once `/api/health` passes. Expect a few seconds of downtime while the container restarts. The app works offline and syncs when the server is back, so nobody loses edits.
3. Open tabs show "Life Console was updated — Reload". An old tab can never overwrite data that newer code has upgraded: the server refuses writes with an older data schema.

**Roll back:** set `LC_VERSION=sha-<previous>` in `.env` and run `docker compose up -d`. Database migrations are additive, so an older app version keeps working on a newer database (see *Database migrations* in [OPERATIONS.md](OPERATIONS.md)). If you ever need the database itself back, restore the pre-migration dump (section 6).

## 5. Admin tasks

```bash
docker compose exec app node server/cli.mjs            # list commands
docker compose exec app node server/cli.mjs users
docker compose exec app node server/cli.mjs create-user --email a@b.c [--admin]
docker compose exec app node server/cli.mjs set-password --email a@b.c        # prints a new password, signs them out everywhere
docker compose exec app node server/cli.mjs set-role --email a@b.c --role admin
docker compose exec app node server/cli.mjs disable --email a@b.c
docker compose exec app node server/cli.mjs create-token --email a@b.c        # API token for scripts (npm run issues)
docker compose exec app node server/cli.mjs revisions --email a@b.c           # a user's planner snapshots
docker compose exec app node server/cli.mjs restore --email a@b.c --revision 42
docker compose exec app node server/cli.mjs backup                            # a dump right now
```

**Planner snapshots:** each user's planner is snapshotted at most once an hour while it changes, and before every forced overwrite. The last 200 are kept. `restore` puts one back, after snapshotting the current copy, and every device picks it up within about 30 seconds. Use this when someone breaks their own planner. Use database backups for anything bigger.

## 6. Backups and restore

The `backup` service writes `daily-<time>.dump` to the `backups` volume every day and keeps 14 days. Pre-migration dumps are kept for 28 days. **Copy them off the server** (rclone, restic or rsync of the volume). One disk is not a backup.

```bash
docker compose exec app ls -la /backups                      # list dumps
docker compose cp app:/backups ./backups                     # copy them out
```

Restore a dump (this replaces the whole database):

```bash
docker compose stop app backup
docker compose exec -T db pg_restore -U lifeconsole -d lifeconsole --clean --if-exists --no-owner < ./backups/daily-XXXX.dump
docker compose start app backup
```

## 7. Moving from the pre-database version

Older installs kept everything in JSON files in `/data` (the `life-console-data` volume). Import them into an account once, with a new image running against your database:

```bash
docker run --rm --network <stack>_default -v life-console-data:/legacy:ro \
  -e DATABASE_URL=postgres://lifeconsole:<password>@db:5432/lifeconsole \
  ghcr.io/tj-coding/life-console:latest node server/cli.mjs import-legacy --dir /legacy --email you@example.com
docker compose restart app   # loads the imported push (VAPID) keys
```

`import-legacy` brings over:

- the planner, keeping its version number, so devices that synced before carry on without a conflict;
- the `history/` copies, as snapshots;
- push devices and VAPID keys, so phones keep getting notifications without re-enabling them;
- the issue log, keeping its `ISS-n` numbers.

It creates the account as an admin if it doesn't exist and prints a generated password; change it in Settings → Account. Without `--force`, it refuses to replace an existing planner.

On each device, open the app and sign in. Its local copy belongs to the first account that signs in there.
