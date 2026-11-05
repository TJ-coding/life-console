# Life Console — prototype v0.1

A Vue 3 + Vite prototype of the Life Console spec (`../stitch_new_project_workspace/life_console_spec.md`). It follows the Stitch "Flight Deck" design.

```bash
npm install
npm run dev:server   # API + push scheduler on :8787 (data in ./.data)
npm run dev          # app on http://localhost:5173 (proxies /api to :8787)
```
Without the server the app still runs: sync stays off and data lives in the browser.

## What's in it
| Screen | Route | Works |
|---|---|---|
| S-01 Command Center | `#/` | driver's console: NOW · NEXT · next-deadline countdown on top; the day's timeline (vertical by default with S/M/L zoom and Now, or the horizontal strip; remembered per device; drag todos onto it); **Left today** with priority, start time, a vertical workload gauge and one-click delete (Undo in the toast); one telemetry line (seals, sleep, caffeine, routines, due-now alerts). **More** (remembered) brings back the full briefing: 7-day deadlines, top PSGs, sign-off ledger, routines/sleep/caffeine/reviews/lectures tiles |
| S-11 Day view | `#/day/YYYY-MM-DD` | the Command Center for any date: ‹ › arrows or `[` `]` step a day, **Today** returns; non-today dates show a day summary instead of the live NOW card; click a day header in Plan week to open it |
| S-10 Plan week | `#/week` | the whole planning flow on one sheet: ① backlog panel → ② a 7-hour workload bucket per day → ③ that day's timeline directly below; one-click day buttons, Auto time-box, linked hover, balance and routines in a side rail |
| S-20 Todo Inbox | `#/todos` | views / link / L-S-D / priority filters, smart quick-add parser, bulk schedule / priority / link / done, edit drawer |
| S-21 Deadlines | `#/deadlines` | list grouped Overdue / Today / This week / Next week / Later (+ Done), or a month calendar (click a day, or its +, to add a deadline right in that cell); quick-add, source filter, edit/delete dialog; overdue badge in the sidebar |
| S-35 Plans index | `#/strategy` | all strategic plans as cards (progress, goals, open tasks, next check), each Active / Paused / Archived, create and delete; tabs switch between plans |
| S-30 Strategic Plan | `#/strategy/SP-03` | Vision → PSG → SIG tree, editable PSG/SIG tables (PSG % = mean of SIG %), check schedule, events timetable, linked todos, "create todo for SIG" |
| S-95 Issues | `#/issues` | the to-fix list for the app itself: press `I` (or the bug button in the top bar) on any screen to report a bug, UX problem or idea about that screen; the screen, route and device are attached; filter by status/screen, change status, see how each was fixed. Agents read the list with `npm run issues` (see [docs/ISSUES.md](docs/ISSUES.md)) |
| Other modules | `#/m/...` | Placeholder that lists the planned screens |

**Keyboard:** `F` focus mode · `⌘K` palette · `N` new todo · `T` today · `W` week · `G S` strategy · `G I` inbox · `G L` workload · `G D` deadlines · `J/K` move · `Enter` open · `X` done · `1–5` priority · `S` stamp · `[` `]` week · `I` report an issue · `G B` issues.

**Quick-add syntax:** `Read chapter 3 #ST2001 30m due:fri p2 @SIG-02.1 [L]`

## Deadlines
Add one from the Deadlines screen, the **Deadlines · 7d** panel on Today / the day view, or the **+** in any Plan week day's Deadlines section (defaults to that day). Syntax: `ST2001 Report 3 due:fri 17:00 #ST2001 p1 ! Upload PDF` (`due:` today / tomorrow / weekday / MM-DD / YYYY-MM-DD, defaulting to the day you're on; `HH:MM`, default 23:59; `p1`–`p5`; `#` or `@` sets the source; text after `!` becomes the vital points). Click any deadline to edit or delete it.

## Planning flow (mirrors the paper planner)
Everything happens on **Plan week** (`#/week`). Each day column is stacked like the paper template: **② Workload** (a 7-hour bucket) directly above **③ Schedule** (that day's timeline).
1. **Backlog** (left panel): capture new tasks in the box at the top (`N` focuses it; same quick syntax as the Inbox, e.g. `Write report 90m p1 due:fri @SP-03`). Hover a task and click a day button (each shows that day's free hours), or drag it into a day's bucket. Drop a task back here to unassign it.
2. **Assign day:** tasks stack in the bucket, sized by their estimate. Red overflow above the 7h line means too much; the Balance rail suggests moves.
3. **Assign time:** drag a block from the bucket straight down onto the timeline, or press ⚡ (per day) / **Auto time-box week** to fill free gaps between 08:00 and 21:00 in priority order.

The step bar shows progress (`4 to place → 12 on this week → 4/12 time-boxed`), and its buttons switch the layout to emphasise days, times or both. A guide line names the next thing to do. Hovering a task highlights it in the backlog, its bucket and its timeline at once. `/workload` and `G L` open the planner with the day-focused layout.

### Splitting a task across days
Click a task's split button (on backlog cards and workload blocks, or **Split across days…** in the task drawer) to open the Split dialog. Choose a number of parts or a chunk size, edit each part's minutes, and pick a day for each part, or use **Auto-assign days** (most free capacity first, from today on, never past the due date, one part per day). The dialog previews every day's load before and after the split.
Each part is an ordinary task labelled `1/3`, `2/3`… in date order, sharing the original's title, links, priority and due date. **Merge open parts** in the drawer puts them back together. If dropping a task overfills a day, a message offers to split it.

## What should I do right now?
- **NOW card** (top of Today): the block you should be in, with a live countdown and a progress bar, or how much free time you have. It also shows **what to do**: a todo linked to the current block, or in free time the highest-priority open todo that fits before the next block (**Start now** schedules it at the current time). The next block is shown with a countdown.
- **NOW pill** in the top bar on every screen, and in the **browser tab title**.
- **Focus mode** (`F`, `#/focus`): a full-screen view of the same information plus the top 3 actions (`1`–`3` to tick them off). `X` completes the todo you're currently on. `Esc` leaves.

## Timeline editing
- **Move:** drag any block (fixed or todo) along a timeline. In the Weekly Planner you can drop it on another day. It snaps to 15 min and keeps its duration.
- **Resize:** drag a block's end edge (the right edge on Today, the bottom edge in the week view) to change its end time. For a todo this changes its time estimate.
- **Schedule:** drag a todo from any list onto a timeline to give it a start time.

## Notes
- Data lives in `localStorage`. The demo data is generated relative to the current week. Use Settings to reset, export or import it.
- Workload is the sum of the todo estimates scheduled on that day. Fixed time blocks are calendar items and don't count.
- ClickUp sync is mocked.
- Code layout: `src/store.js` (state, seed data, helpers), `src/components/*`, `src/views/*`.

- Category colours (`--cat-*` in `styles.css`) come from the validated categorical palette. They're separate from the status colours (green = done, amber = warning, red = overdue).

## Data schema and migrations
The planner document carries `schemaVersion`. `migrateDoc()` in `src/store.js` upgrades any document (from the server, a browser or an import) one numbered step at a time. It runs on load, on sync (before merging) and on import, and it is idempotent. To change the data shape, bump `SCHEMA_VERSION` and add the next step; never edit an old one.
- **v2:** `plan` (one strategic plan) became `plans: [{ id, planNo, title, status: active|paused|archived, health, … }]`. Goal numbers (`PSG-nn`, `SIG-nn.m`) are unique across all plans, so task links stay unambiguous.

## Phone app, sync and notifications
- **Install** (needs HTTPS): on iPhone use Safari → Share → *Add to Home Screen*; on Android use Chrome → *Install app*. Then go to Settings → Notifications → *Turn on for this device*. iOS needs 16.4+ and only delivers push to Home Screen apps.
- **Sync:** the planner is one document on the server (`/api/state`, versioned). Devices push edits after about 1.5s and pull every 30s, on focus and when back online. Conflicts are three-way merged per record and field (`src/merge.js`); only clashes on the same field go to the newest edit, and the server keeps backups of overwritten versions. A device with its own data asks once whether to use the server's copy or its own.
- **Notifications** (server scheduler, `server/schedule.mjs`, in the timezone of the device you last used):
  - **Blocks and tasks:** N min before each block or timed task starts, plus *Time's up* when a timed task ends, with a **Mark done** action.
  - **Deadlines:** 1 day and 1 hour before, and at the due time.
  - **Daily:** a morning briefing, and an evening sign-off reminder.
  - **Wellbeing:** a caffeine cutoff warning and a wind-down reminder.

  Each kind can be toggled, and its times set, in Settings.
- **Server** (`server/`): plain Node `http` plus `web-push`. Data, subscriptions and VAPID keys live in `DATA_DIR` (`/data`, a Docker volume).

## Working on the code
New to the codebase (human or AI agent)? Start with **[CLAUDE.md](CLAUDE.md)**: project map, data model, rules for changing the data shape, conventions, how to verify changes, and known gotchas.

## Hosting and deployment
**Full guide: [docs/OPERATIONS.md](docs/OPERATIONS.md)** covers where it's hosted, how to deploy (automatic and manual), CI secrets, Dokploy, Cloudflare and NetBird setup, data backup and restore, migrations, a release checklist and troubleshooting.

In short:
- **Live:**
  - https://life-console.tj-coding.uk (Cloudflare Tunnel + Access login; the address for installing on phones);
  - http://dokpoly.netbird.cloud (NetBird only, HTTP).
- **Code:** https://github.com/TJ-coding/life-console. `main` is the deployed branch.
- **Deploy:** push to `main`. GitHub Actions builds and smoke-tests the image, joins NetBird and triggers Dokploy (project *Life Console*, app `life-console`), which builds the `Dockerfile` from `main`. Or press **Deploy** in the Dokploy panel (http://dokpoly.netbird.cloud:3000, NetBird only).
- **Data:** the Docker volume `life-console-data` at `/data`. It survives deploys. Back it up with `curl -s http://dokpoly.netbird.cloud/api/state > backup.json`.
