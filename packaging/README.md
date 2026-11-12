# App-store packages

Ready-made listings of Life Console for self-hosting platforms' app stores. Each folder holds the files that platform's store expects, in its layout, so submitting means copying a folder into a fork of the store's repository and opening a pull request.

All of them run the published image `ghcr.io/tj-coding/life-console` (linux/amd64 and linux/arm64) with PostgreSQL 17, and differ from the repo's own `docker-compose.yml` in three ways:

- **No `updater` service.** Stores update apps themselves, and most of them forbid mounting the Docker socket. `UPDATE_CHECK=off` hides the in-app update notice for the same reason.
- **A pinned release** (`0.1.0`, or `0.1` where the store auto-updates within a release line) instead of `latest`.
- **The store generates the database password** where it can (Dokploy, CapRover, Cosmos, Umbrel). CasaOS can't, and its PR scanner (SonarCloud) rejects hard-coded passwords, so there the database uses trust auth: it publishes no ports and only the app's private network can reach it.

The first account created on a new install becomes the admin; every package says so after install.

## Before any submission: the release must exist

The packages pin `0.1.0` ([released](https://github.com/TJ-coding/life-console/releases/tag/v0.1.0) 2026-11-13). CI creates the image tags when a release tag is pushed (`.github/workflows/deploy.yml`, "Release tags"). For the next release, tag a commit that main has already built, using its **full** commit hash (GitHub rejects short ones):

```bash
gh release create v0.1.1 --repo TJ-coding/life-console --target <full commit hash> --title "Life Console 0.1.1" --generate-notes
```

Check it worked: `docker buildx imagetools inspect ghcr.io/tj-coding/life-console:0.1.0` lists `linux/amd64` and `linux/arm64`.

## Priority order

| # | Store | Status | Folder | Submit to |
|---|---|---|---|---|
| 1 | Dokploy | Ready | `dokploy/life-console/` | PR to [Dokploy/templates](https://github.com/Dokploy/templates) |
| 2 | CapRover | Ready | `caprover/` | PR to [caprover/one-click-apps](https://github.com/caprover/one-click-apps) |
| 3 | Cosmos | Ready | `cosmos/LifeConsole/` | PR to [azukaar/cosmos-servapps-official](https://github.com/azukaar/cosmos-servapps-official) |
| 4 | CasaOS | Ready | `casaos/LifeConsole/` | PR to [IceWhaleTech/CasaOS-AppStore](https://github.com/IceWhaleTech/CasaOS-AppStore) |
| 5 | Umbrel | Ready | `umbrel/life-console/` | PR to [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps) |
| 6 | Unraid | Ready; needs a template repo | `unraid/` | [ca.unraid.net/submit](https://ca.unraid.net/submit/new) |
| 7 | Railway | Owner, in the Railway dashboard | — | Workspace → Templates → Publish |
| 8 | PikaPods, Elestio | Owner, by email or Discord | — | Ask to be added (both share ~20% of revenue with authors) |
| 9 | TrueNAS | Owner, forum post first | — | Feature Request on the TrueNAS forum; PR only after approval |
| — | Coolify | Closed | — | Outside contributions paused; needs 1,000+ GitHub stars |
| — | Runtipi | Closed | — | Official store takes no new apps |
| — | YunoHost, Cloudron | Not now | — | Need native (non-Docker) packaging |

Why this order: Dokploy is what Life Console itself runs on, so its template can be tested on our own server; CapRover, Cosmos and CasaOS accept any working app; Umbrel has the biggest audience but the strictest review; Unraid needs a separate repository.

## 1. Dokploy

1. Test it on our Dokploy first: create a Compose service in a test project, then Advanced → Import with the files from `dokploy/life-console/` (or open the PR first and import from its preview site, which the PR description links to). Deploy, sign up, restart, check the data stays.
2. Fork `Dokploy/templates`, copy `dokploy/life-console/` to `blueprints/life-console/`, run `node build-scripts/generate-meta.js --check`, and open the PR. Put the preview URL and how you tested it in the description.

`APP_URL` is `http://` because Dokploy's generated domains are plain http. On a domain with HTTPS, change it to `https://` in the service's environment so cookies are marked secure and phones can get push reminders.

## 2. CapRover

1. Test: in CapRover, Apps → One-Click Apps/Databases → `>> TEMPLATE <<`, paste `caprover/life-console.yml`, deploy.
2. Fork `caprover/one-click-apps`, copy `life-console.yml` to `public/v4/apps/` and `life-console.png` to `public/v4/logos/`, then `npm ci && npm run validate_apps && npm run formatter-write`, and open the PR.

## 3. Cosmos

1. Add the screenshots: `servapps/LifeConsole/screenshots/` must exist with at least one image (the build breaks without it). On a Mac, from the repo root:
   ```bash
   mkdir -p packaging/cosmos/LifeConsole/screenshots
   i=1; for n in today week deadlines strategy; do sips -s format png public/media/$n.webp --out packaging/cosmos/LifeConsole/screenshots/$i.png; i=$((i+1)); done
   ```
2. Fork `azukaar/cosmos-servapps-official`, copy `cosmos/LifeConsole/` to `servapps/LifeConsole/`, run `npm install && node .github/scripts/validate-servapps.js LifeConsole` (it checks the image and its architectures live, so the release must exist), and open the PR.

## 4. CasaOS

1. Add `screenshot-1.png` … `screenshot-4.png` next to the compose file. The `icon`/`screenshot_link` URLs already point to where they'll live after merge. On a Mac:
   ```bash
   i=1; for n in today week deadlines strategy; do sips -s format png public/media/$n.webp --out packaging/casaos/LifeConsole/screenshot-$i.png; i=$((i+1)); done
   ```
2. Fork `IceWhaleTech/CasaOS-AppStore`, copy `casaos/LifeConsole/` to `Apps/LifeConsole/`, run `./scripts/build_dist.sh` and check `dist/apps/` has the app, then open the PR (say it's a new app and how you tested it).

## 5. Umbrel

Images are pinned by digest (`0.1.0@sha256:…`, the multi-arch index). After a new release, update both the tag and the digest: `docker buildx imagetools inspect ghcr.io/tj-coding/life-console:<version>` prints it.

1. Fork `getumbrel/umbrel-apps`, copy `umbrel/life-console/` to `life-console/`, run `npm run lint:apps -- life-console --check-images` and `git diff --check`.
2. Test on an Umbrel device or VM: install, open in the browser, sign up, restart the app, confirm the data stays.
3. Set `submission:` in `umbrel-app.yml` to the PR's URL. In the PR body: app and version, upstream URL, image source, what you tested, that there are no default credentials (the first sign-up is the admin), screenshots, and the logo (the Umbrel team makes the gallery and icon).

## 6. Unraid

Community Apps lists template **repositories**, and wants `ca_profile.xml`, a license and an icon at the repository root. Create a small public repo (for example `TJ-coding/unraid-templates`, MIT or AGPL-3.0) containing `ca_profile.xml`, `icon.png` and `templates/life-console.xml` from `unraid/`, then submit it at [ca.unraid.net/submit](https://ca.unraid.net/submit/new) (Validate → Scan → Submit). Update `TemplateURL` and `Icon` in the XML to the new repo's raw URLs.

Unraid templates are one container each, so users install PostgreSQL 17 separately and give Life Console its address in **Database URL**. The container runs as Unraid's `99:100` so it can write the backups folder in appdata.

## 7–9. Owner-only listings

- **Railway:** deploy the repo's compose stack in a Railway project (app + PostgreSQL plugin; `DATABASE_URL` from the plugin), then Workspace → Templates → Publish. Published templates earn a share of usage ("kickbacks").
- **PikaPods / Elestio:** email them (PikaPods: the address on pikapods.com; Elestio: their Discord or support) with the repo, the image, and that it's one app container + PostgreSQL.
- **TrueNAS:** post a Feature Request in the TrueNAS community forum (Problem/Justification, Impact, User Story). If the team approves, they'll ask for a PR to `truenas/apps`.

## When a new version is released

Bump the version in each package: `dokploy/…/docker-compose.yml` and `meta.json`, the CapRover default, CasaOS `image` and `version`, Umbrel `version` and the `image` tag + digest, and the Unraid `Repository` if it pins a patch. Cosmos and Unraid follow `0.1` on their own until a `0.2` release. Then open an update PR in each store.
