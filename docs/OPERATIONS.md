# Life Console — operations guide

Where Life Console is hosted, how code gets from a commit to the live site, where the data lives, how to ship changes safely, and what to do when something breaks. **Running your own copy:** see [SELF_HOSTING.md](SELF_HOSTING.md).

> Keep this file up to date when the infrastructure changes. Never put secrets (API keys, setup keys) in it: the repository is **public**.

---

## 1. At a glance

| What | Where |
|---|---|
| **App (test instance)** | **https://life-console.tj-coding.uk**: the owner's **self-hosted test deployment**, run with the self-hosted defaults (email + password) to try releases before the public service. Cloudflare Tunnel in front. |
| **Public service** | **https://life-console.dev**: Dokploy project *Life Console*, environment **public**, compose service `life-console-public` (`appName` `life-console-public-3usvai`, composeId `-jt4y2jcvoTE601CoLvZh`), its own database and backups, host port `127.0.0.1:18081`. Meant to run **Google sign-in only** (`AUTH_PASSWORD=off` + `GOOGLE_CLIENT_ID/SECRET`): it stores no passwords. Until Google is configured it runs with `SIGNUPS=closed` and no accounts. Cloudflare tunnel hostname `life-console.dev` → `http://localhost:80` (Traefik). Runs the **landing page** (`LANDING=on`): visitors without a session get `public/landing.html` at `/` (the app is at `/app`, and at `/` once signed in), plus `robots.txt`, `sitemap.xml` (with image and video entries) and `llms.txt`. Media for it is in `public/media/` (regenerate screenshots/clips with headless Chrome on the demo planner; see CLAUDE.md *Verifying changes*). Bump `LANDING_DATE` in `server/app.mjs` when the page changes. |
| **Analytics (landing page)** | Self-hosted **Umami 3** (cookieless): Dokploy project *Life Console*, environment **public**, compose service `umami` (raw compose, `appName` `compose-compress-online-microchip-vdfjck`, composeId `eRdmd4oJdMOZVblN4-p3Y`, its own Postgres in volume `db`). Only these paths are public, routed by a Traefik label rule ahead of the app: `life-console.dev/stats/lc.js` (tracker), `/stats/api/send` (collect), and for the landing-page heatmap `/stats/recorder.js`, `/stats/api/record` and `GET /stats/api/websites/<site id>/recorder` (the recorder's settings), so no extra hostname or tunnel entry. **Heatmap and replays:** the public service sets `ANALYTICS_RECORDER=/stats/recorder.js`, which the server adds to the landing page only, so the app is never recorded. In Umami the website has heatmaps **and** replays on (the landing page has no inputs; Umami masks inputs anyway). Self-hosted Umami 3.4.1 never deletes replays, and the privacy policy promises **30 days**, so the server's root crontab runs daily: `17 3 * * * docker exec compose-compress-online-microchip-vdfjck-db-1 psql -U umami -d umami -qc "delete from session_replay_saved where created_at < now() - interval '30 days'; delete from session_replay where created_at < now() - interval '30 days'"`. Keep that job whenever replays are on; turning replays off in Umami stops new recordings. The heatmap's background is the live landing page in an iframe, so the public service also sets `ANALYTICS_DASHBOARD=http://dokpoly.netbird.cloud:3100`: the landing page then sends `Content-Security-Policy: frame-ancestors 'self' <that origin>` instead of `X-Frame-Options: DENY` (everything else keeps `DENY`). Without it the heatmap shows on a white page. **Dashboard:** http://dokpoly.netbird.cloud:3100 (host port 3100, LAN/NetBird only), user `admin`. The public service sets `ANALYTICS_SCRIPT=/stats/lc.js` and `ANALYTICS_SITE_ID` (website `life-console.dev`); the server adds the tag to the landing page, and the app loads it itself (`src/analytics.js`: screen route patterns like `/app/day/:date` only, after the first sync, unless the person turned off Settings → Privacy → *Share anonymous usage statistics*). **Sign-up funnel:** landing-page links carry `data-umami-event` (`open-app`, `self-host`, `github`, `coffee`, each with a `place`: header, hero, end, footer); the signed-out sign-in screen sends a page view `/app/sign-in` and the events `signin-google`, `signin-open-browser`, `signin-copy-link` and `signin-error`, each with `inApp` (an app's built-in browser, where Google refuses sign-in). The page view also carries `from` when the link was `/app?from=<source>` and the source is allowlisted in `src/analytics.js` (`github`: the README's *Try it now*), so GitHub → sign-in shows up despite the app clearing the referrer. So: `open-app` clicks → `/app/sign-in` views → `signin-google` → `/app` page views (signed in). **Landing-page A/B test:** `LANDING_AB=on` serves `landing.html` (A) or `landing-b.html` (B: open source first, then Strategise → Distribute → Execute, each led by the problem it solves) at random to visitors without a session, remembered in the `lc_lp` cookie (90 days, readable by the app); `/?lp=a|b` forces one (previews). The tracker tag carries `data-tag="landing-a|b"`, so in Umami filter by **Tag** to split any report, and the sign-in screen's page view and events carry `lp: a|b`. Compare per tag: `open-app` clicks ÷ visitors, then `signin-google` by `lp`. Page B's Star button shows the GitHub star count, which the server fetches at most hourly (`GITHUB_REPO`) and writes into `<!--stars-->`. To end the test, set `LANDING_AB=off` (everyone gets A) or swap the files. Covered in `public/privacy.html` §1. |
| App over NetBird (HTTP only) | http://dokpoly.netbird.cloud (only works with NetBird connected) |
| Source code | https://github.com/TJ-coding/life-console (public), branch **`main`** is what's deployed |
| Images | `ghcr.io/tj-coding/life-console:latest` and `:sha-<short>`, published by CI from `main` |
| CI | GitHub Actions: `.github/workflows/deploy.yml` |
| Hosting | Self-hosted **Dokploy** on the `dokpoly` server (NetBird peer `100.82.103.214`) |
| Dokploy panel | http://dokpoly.netbird.cloud:3000 (NetBird only) → project **Life Console** |
| Data | PostgreSQL (`db` service of the compose stack, volume `db`); dumps in the `backups` volume |

> **Status (2026-11-07):** cut over. Production runs the compose service **`life-console-stack`** (Dokploy `appName` `life-console-stack-vkaqq8`, composeId `qM_iz40YcC1ORWTr81gnY`, containers `life-console-stack-vkaqq8-{app,db,backup}-1`, network `life-console-stack-vkaqq8_default`). The old application `life-console` (`life-console-ulreqw`) is **stopped, not deleted**, and its volume `life-console-data` is kept. Backups of it are in `/root/life-console-backups/` on the server and in `~/Downloads/Templates/life-console-backups/` on the owner's Mac. Still to do: remove Cloudflare Access (§5.2).

---

## 2. How it fits together

```
 Phone / Mac browser
   │  https://life-console.tj-coding.uk
   ▼
 Cloudflare (DNS proxied, HTTPS) ── Cloudflare Tunnel (cloudflared, Dokploy project "Portfolios")
   ▼
 Traefik (Dokploy's proxy) ── routes by Host header
   ▼
 compose stack "life-console"
   ├── app     Node 22: server/server.mjs on :8080
   │            ├── serves the built app (dist/)
   │            ├── /api/auth/*   accounts, cookie sessions
   │            ├── /api/state    the signed-in user's planner (sync)
   │            ├── /api/push/*   Web Push subscriptions
   │            └── scheduler     notifications every 30 s, for every user with push devices
   ├── db      PostgreSQL 17  ◄── volume db
   └── backup  pg_dump daily  ──► volume backups (also pre-migration dumps from app)
```

Notifications travel **server → Apple/Google push services → phone**. The push services never call the server.

---

## 3. Code and branches

- **Repo:** `TJ-coding/life-console`. Local working copy: `~/Downloads/Templates/life-console`.
- **`main`:** the deployed branch. Pushing to it publishes an image and deploys it.
- **Feature branches:** `feature/<name>` (or `ux/<name>`), merged into `main` with a fast-forward when done.

| Path | What |
|---|---|
| `src/` | Vue 3 front end (`store.js` = data + client-side schema migrations, `sync.js`, `merge.js`, `auth.js`, `push.js`, `views/`, `components/`) |
| `public/` | Static files: `sw.js` (service worker), `manifest.webmanifest`, `icons/` |
| `server/server.mjs` | Entry: connect → migrate → listen → scheduler |
| `server/app.mjs` | HTTP routes (static + `/api/*`), CSRF and auth checks |
| `server/auth.mjs` · `planner.mjs` · `push.mjs` · `issues.mjs` · `scheduler.mjs` · `mail.mjs` | Accounts/sessions · planner documents and snapshots · Web Push · issue log · notification loop · reset emails |
| `server/db/schema.js` · `server/db/migrations/` | Drizzle schema (source of truth) · generated SQL migrations (committed) |
| `server/cli.mjs` · `server/backup.mjs` | Admin CLI · backup loop (the `backup` service) |
| `test/api.test.mjs` | End-to-end API tests against a scratch Postgres database |
| `Dockerfile` · `docker-compose.yml` · `.env.example` | One image (app + backup), the stack, the settings |

---

## 4. Shipping changes (safely, often)

### 4.1 The normal way: push to `main`

```bash
npm test && npm run build                 # needs TEST_DATABASE_URL (see §7)
git switch main && git merge --ff-only feature/my-change && git push origin main
```

GitHub Actions then runs:

1. **test** (every push and PR): `npm ci`; checks that the committed migrations match `schema.js`; runs the API tests against Postgres 17; runs `npm run build`.
2. **image**: `docker build`, then a compose **upgrade test**. It starts the *previous* release (`:latest` from GHCR), creates an account and a planner, rolls this build onto the same database, and checks the data survived and the app, manifest, push key, backups and CLI all work. On `main` the image is then pushed as `:latest` and `:sha-<short>`.
3. **deploy** (main only): triggers Dokploy (`compose.deploy` if `DOKPLOY_COMPOSE_ID` is set, else `application.deploy`) and waits for `done`. It joins NetBird first when `NETBIRD_SETUP_KEY` is set. It's skipped while `DOKPLOY_URL` is unset.

| Name | Type | Value |
|---|---|---|
| `DOKPLOY_API_KEY` | secret | Dokploy → Settings → Profile → API/CLI |
| `NETBIRD_SETUP_KEY` | secret | NetBird → Setup Keys → Reusable + Ephemeral, in a group allowed to reach `dokpoly` |
| `DOKPLOY_URL` | variable | `http://dokpoly.netbird.cloud:3000` |
| `DOKPLOY_COMPOSE_ID` | variable | id of the compose service (set during §11) |
| `DOKPLOY_APPLICATION_ID` | variable | `eb8lwLp0xjk1JwsShpgHN`: the **old** app. Delete it after the cutover. |

### 4.2 What protects live data during a rollout

| Risk | Guard |
|---|---|
| A migration breaks the database | `pg_dump` to `/backups/pre-migrate-*.dump` before any pending migration; all pending steps run in **one transaction**; a failure leaves the DB untouched and the new container doesn't start (the old one keeps serving under Swarm/Dokploy health checks) |
| Two containers migrate at once | Postgres advisory lock around migrations |
| Old and new containers overlap | Additive-only migrations (§6.4); notifications are claimed in `notifications_sent` (primary key) before sending, so none go out twice |
| An old tab or rolled-back front end overwrites upgraded data | The server refuses `PUT /api/state` with an older `schemaVersion` than stored (`409 outdated`), even with `force`; the client shows "reload" |
| A bad front-end release corrupts planners | Hourly per-user snapshots plus one before every forced overwrite (`planner_revisions`, 200 kept); `npm run admin -- restore` |
| Two devices edit at once | Optimistic versioning + three-way merge on the client (unchanged) |
| A bug only shows up in production | Roll back by tag: deploy `LC_VERSION=sha-<previous>` (the DB stays compatible), or Dokploy → Deployments → Rollback |

### 4.3 Manual deploy (from a machine on NetBird)

Dokploy UI: Life Console → the compose service → **Deploy**. API:

```bash
K=$(cat ~/.dokploy-api-key); U=http://dokpoly.netbird.cloud:3000; C=<composeId>
curl -s -X POST "$U/api/compose.deploy" -H "x-api-key: $K" -H 'Content-Type: application/json' -d "{\"composeId\":\"$C\"}"
curl -s http://dokpoly.netbird.cloud/api/health      # "build" names the deployed bundle, "ok" includes the DB
```

### 4.4 After a deploy

- **A few seconds of 502** while the container restarts and migrates. The app is offline-first: edits wait on the device and sync afterwards.
- **Update banner:** open tabs show "Life Console was updated — Reload" within 2 minutes or on focus.
- **Sessions survive deploys** (they're in the database).

---

## 5. Hosting configuration

### 5.1 Dokploy compose service (after §11)

| Setting | Value |
|---|---|
| Source | GitHub `TJ-coding/life-console`, branch `main`, compose path `./docker-compose.yml` |
| Environment | `POSTGRES_PASSWORD` (hex), `APP_URL=https://life-console.tj-coding.uk`, `TRUST_PROXY=1`, `ADMIN_EMAILS=jinno.tomoyuki@gmail.com`, `SIGNUPS=open`, `LC_PORT=127.0.0.1:18080`, `LC_VERSION` (pin to roll back). Self-hosted defaults: password sign-in **on**. Optionally add `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (keeping passwords on) to try Google sign-in here before the public service. **Don't set `AUTH_PASSWORD=off` on this instance**; that's for the public service. |
| Domains | `life-console.tj-coding.uk` → service `app`, port **8080**, HTTP · `dokpoly.netbird.cloud` → `app`, 8080 |
| Auto deploy | Off (GitHub Actions triggers deploys) |

HTTPS is terminated by Cloudflare in front of the tunnel. The app listens on 8080 as a non-root user.

### 5.2 Cloudflare (`tj-coding.uk` zone)

- **Tunnel public hostname:** `life-console.tj-coding.uk` → Traefik on the server (same as the other hostnames).
- **Access:** the app has its own accounts now. **Remove the Access application** for `life-console.tj-coding.uk` at cutover, so others can sign up and phones can install the app. (The old Bypass rule for `/icons` becomes moot.) If you only want to test with Access still on, the app still works; you just log in twice.

### 5.3 NetBird

- The server is a NetBird peer, `dokpoly.netbird.cloud` (`100.82.103.214`). The Dokploy panel (`:3000`) and the HTTP address only work on the mesh.
- CI joins as an ephemeral peer using `NETBIRD_SETUP_KEY`.

---

## 6. Data

### 6.1 What's stored (PostgreSQL)

| Table | Contents |
|---|---|
| `users` | Email (lower-cased), name, `google_sub` (linked Google account), scrypt password hash (`''` for Google-only accounts, the norm on the public service), role (`user`/`admin`), disabled flag |
| `sessions` · `api_tokens` · `password_resets` | SHA-256 hashes of cookie sessions (90 days, sliding), script tokens, reset links (1 h) |
| `planner_docs` | One row per user: `version`, `schema_version`, `state` (jsonb: the whole planner, the same JSON as before) |
| `planner_revisions` | Snapshots: `periodic` (hourly while changing), `force`, `before-restore`, `import` |
| `push_subscriptions` | Push endpoints per user (an endpoint moves to whoever signs in on that browser) |
| `notifications_sent` | Notification de-dup keys (pruned after 4 days) |
| `issues` | The in-app issue log (`ISS-n` = `number`) |
| `app_kv` | `vapid`: Web Push keys. **Losing them unsubscribes every device.** |

Every device also keeps a copy of its user's planner in the browser. Signing out removes it, and signing in as another account on the same browser starts clean.

### 6.2 Backups

- **Automatic:** the `backup` service dumps daily (14 days kept). The app also dumps before every migration (28 days kept). Both go to the `backups` volume.
- **Off-server (still to do):** copy the `backups` volume elsewhere, e.g. a nightly `rclone` to the MinIO instance in Dokploy's *Dev* project.
- **By hand:** `docker exec <app container> node server/cli.mjs backup`, then `docker cp <app container>:/backups .`
- **One user's planner as JSON:** Settings → Data → Export JSON (on their device).

### 6.3 Restoring

- **One user's planner:** `node server/cli.mjs revisions --email E`, then `restore --email E --revision ID`.
- **The whole database:** `pg_restore`, see [SELF_HOSTING.md §6](SELF_HOSTING.md#6-backups-and-restore).

### 6.4 Changing data shapes: two kinds of migration

**a) The planner document (`state`, client-side).** This works as before. Bump `SCHEMA_VERSION` in `src/store.js` and add `MIGRATIONS[n]`, keeping it idempotent and never editing old steps. Clients migrate documents on load, on sync and on import. The server stores `schema_version` and refuses older writes, so a stale tab can't undo an upgrade. Test the step on a copy of a real planner (`revisions` / a dump) first.

**b) The database (server-side, Drizzle).** Edit `server/db/schema.js`, run `npm run db:generate -- --name what_changed`, read the generated SQL in `server/db/migrations/`, and commit both. The server applies it on start. CI fails if you forget to generate.

Rules that keep rolling deploys and rollbacks safe (**expand → migrate → contract**):

1. **One release = additive only:** new tables, new nullable or defaulted columns, new indexes (on big tables, write `CREATE INDEX CONCURRENTLY` by hand in a separate migration). The previous release must keep working on the new schema, because it's still running during the deploy and it's what you roll back to.
2. **Renames and drops take two or more releases:** add the new column and write both, then backfill, then read the new one, and only drop the old one in a later release, once nothing deployed uses it.
3. **Never edit or delete a migration that has reached `main`.** Fix forward with a new one.
4. **No long locks:** avoid `ALTER TABLE … SET NOT NULL` or type changes on large tables in one step. Add a `CHECK … NOT VALID`, then `VALIDATE` it.

---

## 7. Local development

```bash
npm install
cp .env.example .env              # then set DATABASE_URL (and TEST_DATABASE_URL) to a local Postgres
npm run dev:server                # API + scheduler (PORT from .env, e.g. 8787; PUSH_DRY_RUN=1 to log pushes)
npm run dev                       # app on http://localhost:5173, proxies /api to :8787
npm test                          # API tests in a scratch database (needs CREATE DATABASE rights)
npm run admin -- users            # the admin CLI against DATABASE_URL
```

Any Postgres ≥ 15 works: Homebrew (`brew services start postgresql@17`), `docker compose up -d db` with a published port, or a Supabase project. Without a server (`npm run dev` alone), the app runs in local-only mode with data in the browser.

---

## 8. Release checklist

1. Work on a branch. `npm test` and `npm run build` pass.
2. Changed the planner shape? Add a client migration (§6.4a). Changed the DB? Generate an additive migration and read its SQL (§6.4b).
3. Merge into `main` and push. CI must be green on **test** and **image** (that includes the upgrade test).
4. Check `curl -s http://dokpoly.netbird.cloud/api/health` shows the new `build` and `"ok":true`.
5. If something's wrong, roll back first (`LC_VERSION=sha-<previous>`, or Dokploy Rollback), then investigate.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **Container restarts, log says `[db] waiting for database`** | Postgres isn't up or `DATABASE_URL` is wrong (check the password has no URL-special characters). |
| **Log shows a failed migration** | Nothing was applied (one transaction). Roll back the image, fix the migration forward. The pre-migrate dump is in `/backups`. |
| **`/api/health` returns 503** | The app is up but can't reach the database. |
| **Sign-in screen keeps coming back** | The session cookie isn't stored. Over plain HTTP, `APP_URL` must not be `https://…` (that sets `Secure` cookies). Behind a proxy, check it passes `Cookie`/`Set-Cookie`. |
| **"Too many attempts"** | Login/sign-up rate limit (per IP and per email, 15 min). Behind a proxy without `TRUST_PROXY=1`, everyone shares one IP. |
| **Sync says RELOAD / "saved by a newer version"** | This tab's code is older than the data. Reload. |
| **No notifications** | Settings → Notifications: on for this device? *Send test*. iPhone: installed to the Home Screen (iOS 16.4+). Server log: `[notify]` and `[push]` lines. |
| **Notifications at the wrong time** | They use the timezone of the device the user last used (Settings → *What to notify*). |
| **`npm run issues` → 401** | Needs an admin API token: `node server/cli.mjs create-token --email …`, saved to `~/.life-console-token`. |
| **GitHub Actions `startup_failure`** | Usually account billing: https://github.com/settings/billing. |

---

## 10. Open items (as of 2026-11-07)

- [x] Cut over production to the database version (§11), 2026-11-07.
- [ ] Optional for the test instance: remove the Cloudflare Access application for `life-console.tj-coding.uk` if testers other than the owner need in (or to test phone install and sign-up as a stranger would).
- [ ] Public service `life-console.dev`: add the tunnel hostname (Cloudflare dashboard), create the Google OAuth client, then set `GOOGLE_CLIENT_ID/SECRET`, `AUTH_PASSWORD=off`, `SIGNUPS=open` and redeploy.
- [ ] Release flow: deploy to the test instance first; promote to the public service by deploying it (pin `LC_VERSION=sha-…` on public for full control).
- [ ] After a week: delete the stopped application `life-console` and the `life-console-data` volume.
- [ ] Off-server copies of the `backups` volume (MinIO / rclone).
- [ ] Add `NETBIRD_SETUP_KEY` so pushes to `main` deploy automatically.
- [ ] Rotate the Dokploy API key (an old one was pasted into a chat), then update `~/.dokploy-api-key` and the `DOKPLOY_API_KEY` secret.
- [ ] Decide whether new accounts start with the demo planner (current behaviour) or empty.
- [ ] Email verification on sign-up (today anyone can register any address; reset links go to the real inbox, so takeover isn't possible, but the address isn't proven).

---

## 11. Cutover plan: JSON files → database (one-time)

Do it with NetBird connected, on the server's shell (Dokploy → server terminal, or SSH).

1. **Back up the old data:** `docker run --rm -v life-console-data:/d -v "$PWD":/out alpine tar czf /out/life-console-data-$(date +%F).tgz -C /d .`, plus `curl -s http://dokpoly.netbird.cloud/api/state > state-$(date +%F).json` from the Mac.
2. **Create the compose service** in Dokploy → project *Life Console* → *Create Service → Compose*: GitHub `TJ-coding/life-console`, branch **`feature/accounts-postgres`** for now, path `./docker-compose.yml`. Set the environment from §5.1. Add a **temporary domain** (e.g. `lc-next.tj-coding.uk` → `app`:8080, plus a tunnel hostname) and deploy.
3. **Import the old data** into your account (the stack's network is listed by `docker network ls`, usually named after the compose app):
   ```bash
   docker run --rm --network <compose-network> -v life-console-data:/legacy:ro \
     -e DATABASE_URL='postgres://lifeconsole:<POSTGRES_PASSWORD>@db:5432/lifeconsole' \
     <app image> node server/cli.mjs import-legacy --dir /legacy --email <your email>
   ```
   Then restart the `app` service so it loads the imported VAPID keys. Sign in on the temporary domain with the printed password, change it, and check your planner, deadlines and issues.
4. **Switch over:** stop the old application `life-console` (keep its volume for now). Move the domains `life-console.tj-coding.uk` and `dokpoly.netbird.cloud` to the compose service (`app`, port 8080). Remove the Cloudflare Access application. Sign in on each phone and Mac. Their local copies continue at the same version, and unsynced edits merge.
5. **Make `main` the source:** set the repo variable `DOKPLOY_COMPOSE_ID`, delete `DOKPLOY_APPLICATION_ID`, merge `feature/accounts-postgres` into `main` and push. Switch the compose service's branch to `main`. CI publishes `:latest` and deploys.
6. **Save an API token for agents:** `docker exec <app container> node server/cli.mjs create-token --email <you> --name issues-cli`, then save it with `umask 077; pbpaste > ~/.life-console-token` on the Mac.
7. After a week of normal use, delete the old application and, once you have the tarball from step 1 somewhere safe, the `life-console-data` volume.
