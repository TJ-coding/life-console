# Life Console — operations guide

Where Life Console is hosted, how code gets from a commit to the live site, where the data lives, and what to do when something breaks.

> Keep this file up to date when the infrastructure changes. Never put secrets (API keys, setup keys) in it: the repository is **public**.

---

## 1. At a glance

| What | Where |
|---|---|
| **App (phones, install, notifications)** | **https://life-console.tj-coding.uk**, behind a Cloudflare Access login |
| App over NetBird (no login, HTTP only) | http://dokpoly.netbird.cloud (only works with NetBird connected) |
| Source code | https://github.com/TJ-coding/life-console (public), branch **`main`** is what's deployed |
| CI | GitHub Actions: `.github/workflows/deploy.yml` |
| Hosting | Self-hosted **Dokploy** on the `dokpoly` server (NetBird peer `100.82.103.214`) |
| Dokploy panel | http://dokpoly.netbird.cloud:3000 (NetBird only) → project **Life Console** → app **life-console** |
| Data | Docker volume **`life-console-data`** mounted at `/data` in the container |

---

## 2. How it fits together

```
 Phone / Mac browser
   │  https://life-console.tj-coding.uk
   ▼
 Cloudflare (DNS proxied, HTTPS) ── Cloudflare Access (login: your email, long session)
   │  Cloudflare Tunnel (cloudflared runs on the server, in Dokploy project "Portfolios")
   ▼
 Traefik (Dokploy's proxy, port 80) ── routes by Host header
   │       ▲
   │       └── http://dokpoly.netbird.cloud  (NetBird peers only, no Access)
   ▼
 Container  life-console-ulreqw   (Node 22: server/server.mjs)
   ├── serves the built app (dist/)
   ├── /api/state   planner document (sync)
   ├── /api/push/*  Web Push subscriptions
   ├── scheduler    sends notifications every 30 s
   └── /data  ◄── Docker volume life-console-data
        state.json · history/ · subscriptions.json · vapid.json · sent.json
```

Notifications travel **server → Apple/Google push services → your phone**. The push services never call the server, so Cloudflare Access doesn't get in the way.

---

## 3. Code and branches

- **Repo:** `TJ-coding/life-console`. Local working copy: `~/Downloads/Templates/life-console`.
- **`main`:** the deployed branch. Dokploy builds `main`.
- **Feature branches:** `feature/<name>` (or `ux/<name>`), merged into `main` with a fast-forward when done. Old ones (`ux/unified-planning`, `feature/pwa-sync-push`, `feature/multiple-plans`, `feature/update-guard`) are already merged and kept only for history.
- **Commit messages:** a short summary line, then the reasoning (see `git log`).

Layout:

| Path | What |
|---|---|
| `src/` | Vue 3 front end (`store.js` = data + migrations, `sync.js`, `merge.js`, `push.js`, `views/`, `components/`) |
| `public/` | Static files copied as-is: `sw.js` (service worker), `manifest.webmanifest`, `icons/` |
| `server/` | Node server: `server.mjs` (HTTP + API + scheduler loop), `schedule.mjs` (what to notify, when), `push.mjs`, `store.mjs` |
| `Dockerfile` | Builds the app, then runs `node server/server.mjs` on port 80 |
| `.github/workflows/deploy.yml` | CI build and smoke test, then deploy |
| `docs/OPERATIONS.md` | This file |

---

## 4. Deploying

### 4.1 The normal way: push to `main`

```bash
git switch main
git merge --ff-only feature/my-change   # or commit directly to main
git push origin main
```

GitHub Actions then runs `build-and-deploy`:

1. **build** (every push and PR):
   - `npm ci` and `npm run build`
   - `docker build` with the same Dockerfile Dokploy uses
   - a **smoke test** of the container: health, app page, manifest, push key, state API
2. **deploy** (pushes to `main`, and manual runs):
   - joins NetBird as a temporary peer;
   - calls Dokploy's `application.deploy`;
   - waits until Dokploy reports `done`, or fails the job on `error`.

The deploy job has to join NetBird because Dokploy is only reachable on the mesh. That's also why Dokploy's own GitHub auto-deploy is **off**: GitHub's webhooks can't reach the server.

**Required repository settings** (GitHub → Settings → Secrets and variables → Actions):

| Name | Type | Value |
|---|---|---|
| `DOKPLOY_API_KEY` | secret | Dokploy → Settings → Profile → API/CLI → generate |
| `NETBIRD_SETUP_KEY` | secret | NetBird → Setup Keys → **Reusable + Ephemeral peers**, in a group that's allowed to reach the `dokpoly` peer |
| `DOKPLOY_URL` | variable | `http://dokpoly.netbird.cloud:3000` |
| `DOKPLOY_APPLICATION_ID` | variable | `eb8lwLp0xjk1JwsShpgHN` |

> ⚠️ **Status (2026-11-05):** `NETBIRD_SETUP_KEY` is **not set yet**, so the deploy job stops at "Check configuration". Until it's added, deploy manually (4.2). Set it with:
> `pbpaste | gh secret set NETBIRD_SETUP_KEY -R TJ-coding/life-console`

Re-run a deploy without a new commit: GitHub → Actions → build-and-deploy → **Run workflow** (on `main`).

### 4.2 Manual deploy (from a machine on NetBird)

**Dokploy UI:** http://dokpoly.netbird.cloud:3000 → Life Console → life-console → **Deploy**.

**API** (needs the API key saved in `~/.dokploy-api-key`, with mode 600):

```bash
K=$(cat ~/.dokploy-api-key); U=http://dokpoly.netbird.cloud:3000; APP=eb8lwLp0xjk1JwsShpgHN
curl -s -X POST "$U/api/application.deploy" -H "x-api-key: $K" -H 'Content-Type: application/json' \
     -d "{\"applicationId\":\"$APP\"}"
# progress: idle → running → done | error
curl -s "$U/api/application.one?applicationId=$APP" -H "x-api-key: $K" | python3 -c 'import sys,json; print(json.load(sys.stdin)["applicationStatus"])'
# confirm the new build is live: "build" names the deployed bundle
curl -s http://dokpoly.netbird.cloud/api/health
```

Dokploy always builds the **latest `main` on GitHub**, so push first.

### 4.3 After a deploy

- **Brief 502s:** Swarm routes traffic only once the container's health check passes, after a few seconds, so expect at most a few seconds of 502.
- **Update banner:** open tabs show **"Life Console was updated — Reload"** within 2 minutes or on focus. Installed phone apps load the new version the next time they're opened.
- **Data survives:** it lives on the volume, not in the container.

### 4.4 Rolling back

- **Code:**
  - revert the commit (`git revert <sha>`), push, and deploy;
  - or in Dokploy → Deployments, pick an earlier one and **Rollback**, if offered.
- **Data:** see 6.3.

---

## 5. Hosting configuration (for rebuilding it from scratch)

### 5.1 Dokploy application `life-console`

| Setting | Value |
|---|---|
| Project / app | **Life Console** / `life-console` (`appName` `life-console-ulreqw`, id `eb8lwLp0xjk1JwsShpgHN`) |
| Source | GitHub provider *Dokploy-tj-coding*, `TJ-coding/life-console`, branch `main`, build path `/` |
| Build type | Dockerfile (`Dockerfile`, context `.`) |
| Auto deploy | **Off** (GitHub Actions triggers deploys) |
| Domains | `life-console.tj-coding.uk` → port 80, HTTP · `dokpoly.netbird.cloud` → port 80, HTTP |
| Volume | `life-console-data` → `/data` |
| Env | none needed. Optional: `VAPID_SUBJECT` (default `https://life-console.tj-coding.uk`), `TICK_MS` (scheduler, default 30000), `PUSH_DRY_RUN=1` (log instead of send) |

HTTPS isn't handled by Dokploy or Traefik: Cloudflare terminates it in front of the tunnel.

### 5.2 Cloudflare (`tj-coding.uk` zone)

- **Tunnel public hostname:** `life-console.tj-coding.uk` → the same service your other `tj-coding.uk` hostnames use, i.e. the Traefik proxy on the server. Traefik then routes by host to this app.
- **Access application** (self-hosted): `life-console.tj-coding.uk`, policy **Allow** for your email, with a long session (e.g. 1 month) so the installed app doesn't keep asking you to sign in.
- **Access Bypass application** (recommended, **not working as of 2026-11-05**): paths `life-console.tj-coding.uk/icons` and `life-console.tj-coding.uk/manifest.webmanifest`, policy **Bypass**, Include **Everyone**. Without it, Android may install a shortcut instead of a full app, because Google's install service can't log in. These paths contain no data.

### 5.3 NetBird

- The server is a NetBird peer, `dokpoly.netbird.cloud` (`100.82.103.214`). The Dokploy panel (`:3000`) and the HTTP address only work on the mesh.
- CI joins as an **ephemeral** peer using `NETBIRD_SETUP_KEY`, and leaves at the end of the job.

---

## 6. Data

### 6.1 What's stored

| File (in `/data`) | Contents |
|---|---|
| `state.json` | The whole planner: `{ version, updatedAt, device, state }`. `state.schemaVersion` is the data schema. |
| `history/` | The last 30 overwritten versions (written when a forced save replaces a different version) |
| `subscriptions.json` | Devices registered for push |
| `vapid.json` | Web Push keys. **Losing this unsubscribes every device**; they have to turn notifications on again. |
| `sent.json` | Recently sent notification keys (de-duplication) |

Every device also keeps a copy in its browser and syncs with the server (see README → *Phone app, sync and notifications*).

### 6.2 Backups

There's **no off-server backup yet**: everything is on one volume on one disk. Until there is, take one now and then (on NetBird, no login needed):

```bash
curl -s http://dokpoly.netbird.cloud/api/state > life-console-$(date +%F).json
```

Or use the app: Settings → Data → **Export JSON**, which exports this device's copy.

### 6.3 Restoring a backup

Replace the server copy. Every device picks it up within about 30 seconds, and the server keeps the copy it replaced in `history/`:

```bash
B=http://dokpoly.netbird.cloud
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"state": d["state"], "force": True, "device": "restore"}))' \
    life-console-2026-11-05.json \
  | curl -s -X PUT $B/api/state -H 'Content-Type: application/json' -d @-
```

### 6.4 Changing the data shape (schema migrations)

Bump `SCHEMA_VERSION` in `src/store.js` and add the next numbered step to `MIGRATIONS`. **Never edit an old step.** Migrations run on load, on sync (before merging) and on import, and must be idempotent. Old open tabs are protected: they won't apply or overwrite newer-schema data, and they ask you to reload. Test the step against a copy of the live document (`curl …/api/state`) before deploying.

> A real database (SQLite/Postgres) is planned for later. It would replace `server/store.mjs` and the `/api/state` internals; the client and its sync wouldn't change.

---

## 7. Local development

```bash
npm install
npm run dev:server   # API + scheduler on :8787, data in ./.data, real pushes (add PUSH_DRY_RUN=1 to just log them)
npm run dev          # app on http://localhost:5173, proxies /api to :8787
```

Production-like run: `npm run build && DATA_DIR=.data PORT=8787 PUSH_DRY_RUN=1 node server/server.mjs` → http://localhost:8787. Service workers and push need HTTPS, except on `localhost`.

---

## 8. Release checklist

1. Work on a branch; `npm run build` passes locally.
2. Changed the data shape? Add a migration (6.4) and test it on a copy of live data.
3. Merge into `main` and push. CI must be green on **build** (and on **deploy** once the NetBird key is set).
4. If CI didn't deploy, deploy manually (4.2).
5. Check `curl -s http://dokpoly.netbird.cloud/api/health` shows the new `build`, then open the app and reload any old tabs.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **Cloudflare Error 1002** ("DNS points to local or disallowed IP") | The browser or Mac is using an old DNS answer. Flush: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`, then clear Chrome's host cache (`chrome://net-internals/#dns`). |
| **Banner "Your sign-in expired"** / sync says SIGNED OUT | The Cloudflare Access session ended. Reload and sign in. On iPhone, the installed app has its own login, separate from Safari. |
| **Banner "Life Console was updated"** | A newer build is deployed. Reload. |
| **Sync says RELOAD / "saved by a newer version"** | This tab's code is older than the data's schema. Reload. |
| **502 right after a deploy** | The container is still starting (health check). Wait a few seconds. |
| **No notifications** | Settings → Notifications: is it **ON** for this device? Use **Send test**. Check `/api/push/devices` (on NetBird). iPhone: the app must be installed to the Home Screen (iOS 16.4+), with notifications allowed in iOS Settings. Server log: Dokploy → app → Logs, look for `[notify]` and `[push]` lines. |
| **Notifications at the wrong time** | They use the timezone of the device you last used (Settings → *What to notify* shows it). |
| **GitHub Actions `startup_failure`** | Usually account billing: check https://github.com/settings/billing. |
| **CI deploy fails at "Check configuration"** | A secret or variable from 4.1 is missing (currently `NETBIRD_SETUP_KEY`). |
| **CI deploy fails at "Join NetBird"** | The setup key expired or was revoked, or its group isn't allowed to reach the `dokpoly` peer. |

---

## 10. Open items (as of 2026-11-05)

- [ ] Add `NETBIRD_SETUP_KEY` so pushes to `main` deploy automatically.
- [ ] Fix the Cloudflare Access **Bypass** for `/icons` and `/manifest.webmanifest`.
- [ ] Rotate the Dokploy API key (an old one was pasted into a chat), then update `~/.dokploy-api-key` and the `DOKPLOY_API_KEY` secret.
- [ ] Off-server backups (e.g. a daily snapshot to the MinIO instance in Dokploy's *Dev* project).
- [ ] Move storage to a database (planned).
- [ ] Optional: switch the repo back to private (it went public during a billing lock).
