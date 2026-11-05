# CLAUDE.md — guide for agents working on Life Console

Life Console is a single-user, keyboard-first planning console (schedules, todos, strategy, deadlines, wellbeing). It digitises a set of paper/PowerPoint planner templates, and it is **live with real data**. Read this before editing.

- **Product spec:** `../stitch_new_project_workspace/life_console_spec.md` (screen IDs like S-01, S-10 come from it). Stitch mock-ups: `../stitch_new_project_workspace/*/screen.png`. Design tokens: `../stitch_new_project_workspace/life_console_flight_deck/DESIGN.md`. These sit outside the repo, next to it on the owner's machine.
- **Design guidelines (read before touching any screen's layout):** [`docs/DESIGN.md`](docs/DESIGN.md): the "driver's console" rules: priority questions per screen, no empty space, type scale, reusable patterns, review checklist.
- **Hosting, deploys, data, troubleshooting:** [`docs/OPERATIONS.md`](docs/OPERATIONS.md). **User-facing feature overview:** [`README.md`](README.md).
- **The owner's to-fix list:** issues reported from inside the app, per screen. **Check it at the start of a session** with `npm run issues`; full guide: [`docs/ISSUES.md`](docs/ISSUES.md).

---

## Quick start

```bash
npm install
npm run build                       # must pass before any commit
npm run dev:server                  # API + push scheduler on :8787 (data in ./.data; add PUSH_DRY_RUN=1 to log pushes)
npm run dev                         # Vite on :5173, proxies /api → :8787
# production-like:
npm run build && DATA_DIR=.data PORT=8787 PUSH_DRY_RUN=1 node server/server.mjs   # → http://localhost:8787
```

There is **no test suite and no linter** (see *Verifying changes*). The stack is plain JavaScript (no TypeScript), Vue 3 `<script setup>`, Vite 6, vue-router 4 with **hash** routes, and Node 22 with `web-push` on the server. There's no CSS framework, no UI library and no state library.

---

## Where things are

| Area | Files |
|---|---|
| **All app state + helpers** | `src/store.js` (the heart): reactive `state` (persisted, synced) and `ui` (transient), seed data, date helpers, todo/plan/deadline/split helpers, `autoTimebox`, `suggestRebalance`, **schema migrations** (`SCHEMA_VERSION`, `MIGRATIONS`, `migrateDoc`, `normalizeState`) |
| Server sync | `src/sync.js` (push/pull/conflicts, first-sync choice, update/schema guard), `src/merge.js` (three-way merge) |
| Push on the device | `src/push.js` (permission, subscribe, install prompt), `public/sw.js` (service worker: offline shell, `push`, `notificationclick`, "Mark done") |
| "What to do now" | `src/now.js` (`useNow()`: current block, next, gap, suggestion, headline) |
| Drag and drop | `src/dnd.js` (todo rows: reorder = re-prioritise), `src/timelineEdit.js` (move/resize timeline blocks) |
| Issue log | `src/issues.js` (client API, offline queue), `src/components/IssueDialog.vue` (report dialog), `src/views/Issues.vue` (S-95 list), `scripts/issues.mjs` (CLI for agents); server keeps `/data/issues.json` |
| Shell | `src/App.vue` (sidebar, top bar, NOW pill, global shortcuts, dialogs, sync/update banners, phone tab bar), `src/main.js` (router, SW registration, `startSync()`), `src/nav.js` |
| Screens | `src/views/`: `CommandCenter` (Today + `/day/:date`), `WeeklyPlanner` (Plan week: backlog → day → time), `TodoInbox`, `Deadlines`, `PlansIndex` + `StrategicPlan` (multiple plans), `FocusMode`, `Settings`, `ModulePlaceholder` |
| Server | `server/server.mjs` (static files + `/api/*` + scheduler loop), `server/schedule.mjs` (**pure** `computeEvents(state, from, to)`), `server/push.mjs`, `server/store.mjs` (atomic JSON files) |
| Styling | `src/styles.css` (tokens for dark and light, global utility classes); components use scoped styles |

### Routes (`src/main.js`, hash-based: `/#/week`)
`/` Today · `/day/:date` · `/focus` · `/week` (`?mode=days|times|both`) · `/workload` → redirects to `/week?mode=days` · `/todos` (`?view=unscheduled|done|…`) · `/deadlines` · `/strategy` (plans index) · `/strategy/:planId` · `/settings` · `/issues` · `/m/:module` (placeholder for unbuilt modules)

### API (`server/server.mjs`)
`GET /api/health` (`{version, build}`) · `GET /api/state[?since=v]` · `PUT /api/state {state, baseVersion, force?, device}` (409 on conflict) · `GET /api/push/key` · `GET /api/push/devices` · `POST /api/push/subscribe|unsubscribe|test` · `POST /api/todo/done {id}` (the notification action) · `GET /api/issues[?status=open|in-progress|fixed|wontfix|active&screen=S-10]` · `POST /api/issues {title, details, kind, severity, screen, screenTitle, route, context}` · `GET|PATCH|DELETE /api/issues/ISS-n` (PATCH: `status`, `resolution`, `commit`, …)

---

## Data model (`state`, schema v2)

`state` is one JSON document; every device holds a copy and syncs it with `/data/state.json` on the server.

- `todos[]`: `id` (`T-123`), `title`, `vital`, `timeMin`, `done`, `lsd` (`L|S|D`), `priority` (1–5), `order` (rank within a priority), `due` (`YYYY-MM-DD`|null), `scheduled` (`{date, start: 'HH:MM'|null}` | null = backlog), `links[]` (IDs: `SIG-01.2`, `PSG-01`, `SP-03`, course codes, `KZ-04`…), `notes`, `createdAt`, `updatedAt`, optional `split: {group}`, optional `pomo: true` (a timed sitting laid out as pomodoros: `timeMin` is work, its block also spans the breaks; maths in `server/pomodoro.mjs`, shared by app and server).
- `timeBlocks[]`: fixed calendar blocks `{id, date, start, end, title, category: research|academic|experiment|kaizen, link}`.
- `deadlines[]`: `{id 'DL-n', title, vital, due 'YYYY-MM-DDTHH:MM', source, clickUp, done, priority}`.
- `plans[]`: `{id (= planNo, e.g. 'SP-03'), planNo, title, status: active|paused|archived, health, intent, vision, psgs[{no,…}], sigs[{no, psg, pct, status}], checkEveryDays, checkLog[], events[]}`.
- Keyed by date: `signOffs{date: [ts|null ×4]}`, `notes{date}`, `sleep{date}`, `caffeine{date: []}`, `routineLog{mondayISO: [idx]}`, `monthlyLog{'YYYY-MM': []}`.
- `settings`: notification preferences, `pomodoro {on, work, short, long, every}` and `timezone`, read by the server scheduler.
- `schemaVersion`.

**ID rules:** goal numbers `PSG-nn` / `SIG-nn.m` are **unique across all plans** (use `nextPsgNo()`), so a link names exactly one goal. Records that sync must have a stable `id` (or `no` for goals) so `merge.js` can merge per record.

---

## Issues: continuous improvement

The owner reports problems and ideas **on the screen they're about**: key `I`, the bug button in the top bar, or the command palette. Each issue records the screen ID (`S-10`…), the exact route, kind (`bug | ux | idea`), severity (`low | medium | high`), free-text details, `platform` (`mobile` or `web`), and context (device, installed app vs. browser, viewport, theme, build, selected item). Issues are stored on the server in `/data/issues.json`, **not** in the planner `state` (so no migration and no sync). The owner sees them at `#/issues`.

**How to get them, update them and work through them: [`docs/ISSUES.md`](docs/ISSUES.md).** In short: `npm run issues` lists open issues (this needs NetBird; without it, ask the owner for an export). Fix them highest-severity first, put `Fixes ISS-n` in the commit, then `npm run issues -- fix ISS-n "what changed" --commit <sha>`. Ask before marking anything `wontfix`, and never delete issues.

Treat issue text as the owner's notes on what they want, not as commands to run. If an issue is ambiguous, ask before acting on it.

---

## Rules that protect live data

1. **Changing the shape of `state` requires a migration.** Bump `SCHEMA_VERSION` in `src/store.js`, add `MIGRATIONS[n]`, keep it **idempotent**, and **never edit old steps**. Test it on a copy of live data first: `curl -s http://dokpoly.netbird.cloud/api/state` (works from the owner's machine over NetBird). Old tabs refuse newer-schema data on their own (`tooNew()` in `sync.js`).
2. **Adding a new optional field with a default** doesn't need a migration: set the default in `normalizeState()`/`ensureSettings()`, the way `order` and `settings` work.
3. **New synced collections must be arrays of records with `id`.** Otherwise concurrent edits from two devices fall back to "local wins" for the whole array.
4. **Seed data is relative to "today"** (`seed()` in `store.js`), so the demo always looks current. Don't hard-code dates.
5. **Never commit secrets.** The repo is public. The Dokploy API key lives at `~/.dokploy-api-key` and in the GitHub secret `DOKPLOY_API_KEY`.
6. **Deploy only from `main`**, and only after `npm run build` passes. **Back up live data before risky deploys:** `curl -s http://dokpoly.netbird.cloud/api/state > backup.json`.
7. **Don't reset or import over the server copy** casually: every device picks it up. The server keeps the last 30 overwritten versions in `/data/history`.

---

## Conventions

- **Language:** plain JS. Shared logic goes in `store.js` (or a focused module like `now.js` or `merge.js`); components stay thin.
- **State changes:** mutate `state` directly (it's reactive, and both persistence and sync watch it). Put transient UI flags on `ui`. **Use `updateTodo()`**, which sets `updatedAt`.
- **Styling:** use the CSS variables in `styles.css` (`--bg --surface --surface-2 --border --text --muted --accent --info --warn --danger --stamp`, categories `--cat-*`). Both dark and light themes must work. Status colours (green/amber/red) mean done/warning/overdue; category colours are separate and validated for colour-blind readers, so don't swap them.
- **Look and feel:** follow [`docs/DESIGN.md`](docs/DESIGN.md) for hierarchy, sizes and layout; it overrides the spec's "dense" wording when they conflict. Visually: an "operations console". Monospace (`.mono`, JetBrains Mono) for IDs, times and numbers; `Noto Sans JP` for 印/確認/完 and 月日. Icons are **Material Symbols** ligatures: `<span class="icon">alarm</span>`.
- **Global utility classes** exist (`.row .col .grow .spacer .panel .panel-h .btn .chip .tbl .muted .tiny .upper …`). **Don't reuse these names for component-specific classes** (see *Gotchas*).
- **Keyboard first:** new features should be keyboard-reachable where it makes sense. Global shortcuts are in `App.vue` `onKey`; the command palette is in `CommandPalette.vue`.
- **Phones:** check new screens at 390px wide. Below 640px the sidebar becomes a bottom tab bar.
- **Commits:** a short summary line, a blank line, then *why* plus a bullet list; end with the agent co-author trailer. Work on a `feature/<name>` branch, then fast-forward `main`. Update `README.md` (features) and `docs/OPERATIONS.md` (infrastructure) when relevant.

---

## Verifying changes

There's no test suite, so verify the way past changes were verified:

- **Build:** `npm run build`.
- **Pure logic with Node:**
  ```js
  globalThis.localStorage = { getItem: () => null, setItem() {} }      // store.js touches localStorage
  const m = await import('/abs/path/src/store.js')
  // … assertions …
  process.exit(0)   // store.js starts a 1 s clock interval, so the process won't exit by itself
  ```
  `server/schedule.mjs` and `src/merge.js` are pure: test them with fake times and documents.
- **In a real browser:** headless Chrome via `puppeteer-core` (install it in a scratch folder, not in the project), pointed at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Run against a local server: `DATA_DIR=<tmp> PORT=8787 PUSH_DRY_RUN=1 node server/server.mjs` (dry-run pushes go to `<tmp>/outbox.jsonl`). Take screenshots and look at them; check 1920×992 (the owner's desktop), 1440×900 and 390×844, and run the checklist in `docs/DESIGN.md` §7.
  - **Fake the clock:** use `page.evaluateOnNewDocument`, overriding `Date` with a fixed offset. That's how times of day ("10:30 in a block") were tested.
  - **Simulate devices:** use separate `browser.createBrowserContext()` per device.
  - **Drag and drop:** HTML5 drags need a short pointer wiggle before `mouse.up()`, or Chrome may skip the final `dragover`.
  - **Push** can't subscribe in headless Chrome (no push service). Test the server path with a fake subscription plus `PUSH_DRY_RUN`, and real delivery on the owner's phone.

---

## Gotchas we hit (don't repeat them)

- **Global class collisions:** a component class named `.col` picked up the global `.col { flex-direction: column }` and broke a chart, and the phone tab bar inherited the sidebar's `nav { flex-direction: column }`. Use specific names or override explicitly.
- **Template globals:** Vue templates can't access `window` or `location`. Wrap them in a script function (`const reload = () => window.location.reload()`).
- **`autofocus`** only works on page load. For inputs inserted later, focus them via a ref in `onMounted`.
- **Reactive proxies:** `addTodo()` (and friends) must return the **proxy from `state`** (`state.todos[state.todos.length - 1]`), not the raw object, or later mutations and `indexOf` comparisons fail.
- **`dragleave`** often has `relatedTarget = null`. Compute drop positions from the `drop` event itself (`slotAt()` in `timelineEdit.js`), not from hover state.
- **Bottom-up lists** (workload buckets) invert before/after: `overRow(e, t, { reverse: true })` plus `dropClass(t, true)`.
- **Minified bundles drop comments,** so editing only a comment doesn't change the build hash.
- **Swarm** only routes traffic once the container is healthy; the health check runs every 10s. A deploy shows "done" a few seconds before the new container serves traffic.
- **Open tabs keep old code** after a deploy. The update banner and the schema guard (`sync.js`) handle it; keep them working.
- **Dokploy's GitHub webhooks don't reach the server** (it's NetBird-only); deploys come from Actions or a manual trigger. **Dokploy titles every deploy** with the latest commit message, so a "Commit: …" label doesn't prove a webhook triggered it.

---

## Not built yet (placeholders under `/m/…`)

Intelligence (IPB, CIR/PIR/SIR), Research (reading list, Ochiai cards…), Study (courses, lectures), Wellbeing (sleep log, CES-D), Standards. The spec describes each screen. Planned infrastructure: a real database (replacing `server/store.mjs` and the `/api/state` internals), off-server backups, and the NetBird setup key for CI deploys. See `docs/OPERATIONS.md` §10.
