# Life Console — prototype v0.1

A Vue 3 + Vite prototype of the Life Console spec (`../stitch_new_project_workspace/life_console_spec.md`). It follows the Stitch "Flight Deck" design.

```bash
npm install
npm run dev      # http://localhost:5173
```

## What's in it
| Screen | Route | Works |
|---|---|---|
| S-01 Command Center | `#/` | 24h timeline (drag todos onto it), workload gauge, 印→印→確認→完 sign-off, todos, 7-day deadlines, top PSGs, routines/sleep/caffeine/reviews/lectures tiles |
| S-10 Weekly Planner | `#/week` | Mon–Fri + weekend columns, vertical schedules, drag todos between days / timelines / backlog, notes, stamps, weekly routines, monthly group rotation, week KPI, link filter |
| S-13 Workload | `#/workload` | step ② of the planning flow: same day columns as the Weekly Planner, each a 7-hour bucket (like the paper "1–7 Hours" gauge) where tasks stack sized by their estimate; drag from the backlog into a day; balance summary, rebalance suggestions, hours by goal |
| S-20 Todo Inbox | `#/todos` | views / link / L-S-D / priority filters, smart quick-add parser, bulk schedule / priority / link / done, edit drawer |
| S-30 Strategic Plan | `#/strategy` | Vision → PSG → SIG tree, editable PSG/SIG tables (PSG % = mean of SIG %), check schedule, events timetable, linked todos, "create todo for SIG" |
| Other modules | `#/m/...` | Placeholder that lists the planned screens |

**Keyboard:** `F` focus mode · `⌘K` palette · `N` new todo · `T` today · `W` week · `G S` strategy · `G I` inbox · `G L` workload · `J/K` move · `Enter` open · `X` done · `1–5` priority · `S` stamp · `[` `]` week.

**Quick-add syntax:** `Read chapter 3 #ST2001 30m due:fri p2 @SIG-02.1 [L]`

## Planning flow (mirrors the paper planner)
① **Backlog** (Todo Inbox / Workload sidebar) → ② **Workload**: assign a *day* (`#/workload`) → ③ **Schedule**: assign a *time* (`#/week`).
Both screens share the step bar, week selector and day-column grid, so a day's workload sits in the same column as its schedule. On the Schedule screen, tasks with a day but no time are marked ⏰.

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
