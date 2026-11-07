# Issues: the owner's to-fix list

The owner reports bugs, UX problems and ideas from inside Life Console, **on the screen they're about**. They press `I`, tap the bug button in the top bar, or use ⌘K → "Report an issue on this screen…". This file explains how any agent (Claude Code, Codex, a cloud agent, a script) gets those issues and reports back when they're fixed.

The owner sees the same list in the app at `#/issues` (sidebar → **Issues**).

---

## 1. Where the issues are

| | |
|---|---|
| Stored in | The `issues` table in PostgreSQL. It's separate from the planner documents, so it isn't synced to devices and isn't part of `/api/state`. Every signed-in user can report; they see only their own reports. Admins see and manage all of them. |
| API | **`http://dokpoly.netbird.cloud/api/issues`** (NetBird only) with an **admin API token**: `Authorization: Bearer $LIFE_CONSOLE_TOKEN`. `npm run issues` reads it from `LIFE_CONSOLE_TOKEN` or `~/.life-console-token`. Create one with `node server/cli.mjs create-token --email <admin>` (see OPERATIONS.md §11 step 6). |
| API (public) | `https://life-console.tj-coding.uk/api/issues`: behind a **Cloudflare Access** login, so a script without a browser session gets a redirect to the login page, not JSON |
| Local dev | `http://localhost:8787/api/issues` when the server runs locally (`npm run dev:server`); that server holds its own test issues, not the real ones |

**If you can't reach the server** (a cloud sandbox, no NetBird), ask the owner to export the list and give you the file:

```bash
curl -s -H "Authorization: Bearer $(cat ~/.life-console-token)" http://dokpoly.netbird.cloud/api/issues > issues.json
```

Work from that file. Afterwards, tell the owner which IDs you fixed and in which commits, so they (or an agent on their machine) can mark them fixed (step 4 in §4).

---

## 2. Reading issues

### With the CLI (in the repo, Node 22+)

```bash
npm run issues                          # open + in-progress, grouped by screen, full details
npm run issues -- --screen S-10         # one screen only
npm run issues -- --platform mobile     # only reports from phones/tablets (web = desktop browser)
npm run issues -- show ISS-3            # one issue, everything
npm run issues -- all | fixed | wontfix # other filters
npm run issues -- --json                # raw JSON (combine with any of the above)
npm run issues -- --url http://localhost:8787   # another server (or set LIFE_CONSOLE_URL)
```

### With plain HTTP

```bash
B=http://dokpoly.netbird.cloud; H="Authorization: Bearer $(cat ~/.life-console-token)"
curl -s -H "$H" "$B/api/issues?status=active"            # open + in-progress (status: open | in-progress | fixed | wontfix | active; omit for all)
curl -s -H "$H" "$B/api/issues?status=active&screen=S-10" # one screen
curl -s -H "$H" "$B/api/issues?status=active&platform=mobile" # only mobile reports
curl -s -H "$H" "$B/api/issues/ISS-3"                     # one issue
```

### What an issue looks like

```json
{
  "id": "ISS-3",
  "title": "Backlog panel scrolls the whole page",
  "details": "Steps, expected vs. actual, ideas (free text, may be empty)",
  "kind": "bug",                  // bug | ux | idea
  "severity": "medium",           // low | medium | high
  "status": "open",               // open | in-progress | fixed | wontfix
  "screen": "S-10",               // spec screen ID (see the route table in CLAUDE.md / docs/GUIDE.md)
  "screenTitle": "Plan week",
  "route": "/week?mode=days",     // hash route: open http://<host>/#/week?mode=days
  "platform": "mobile",           // mobile (phone/tablet) | web (desktop browser)
  "context": { "device": "iPhone", "app": "installed", "viewport": "390×844", "theme": "dark", "build": "index-BQp4fVLy.js", "selectedId": "T-123" },
  "createdAt": "2026-11-05T07:10:00.000Z",
  "updatedAt": "2026-11-05T07:10:00.000Z",
  "resolution": "",               // filled in when fixed / won't fix
  "commit": "",
  "resolvedAt": null
}
```

How to read the fields:
- `screen` maps to a view in `src/views/` (the route table in `CLAUDE.md` lists them).
- `platform` says where it was reported: `mobile` (phone or tablet) or `web` (desktop browser). `context.app` says whether it came from the installed app (`installed`, home screen / dock) or a browser tab (`browser`). Mobile issues usually concern the phone layout, so test them at 390×844.
- `context.viewport` tells you which layout the owner was looking at: about 390 px wide means the phone layout (below 640 px).
- `context.build` is the front-end bundle that was live then. If it differs from the current build, the issue may already be fixed.

---

## 3. Updating issues

```bash
npm run issues -- start   ISS-3                                   # → in-progress
npm run issues -- fix     ISS-3 "what changed, one line" --commit <short sha>
npm run issues -- wontfix ISS-3 "why"
npm run issues -- reopen  ISS-3                                   # → open, clears the old resolution
```

Plain HTTP equivalents:

```bash
curl -s -X PATCH -H "$H" "$B/api/issues/ISS-3" -H 'Content-Type: application/json' \
     -d '{"status":"fixed","resolution":"Backlog panel now scrolls on its own","commit":"a1b2c3d"}'
```

`PATCH` accepts `status`, `resolution`, `commit`, `title`, `details`, `kind`, `severity`, `screen`, `screenTitle` and `route`. Agents can also create issues they find themselves with `POST /api/issues {title, details, kind, severity, screen, screenTitle, route}`. Mention in the details that an agent filed it.

---

## 4. Workflow for working through issues

1. **Fetch** the open issues (§2). Highest severity first. Group them by screen so related fixes go in together.
2. **Tell the owner** which issues you'll take on, then mark each one `in-progress` (`start`).
3. **Reproduce** each one at the recorded `route` and `viewport`, then fix it. Follow `CLAUDE.md`: protect live data, add migrations for any change to the shape of `state`, `npm run build` must pass, and check both 1440×900 and 390×844.
4. **Commit** with the IDs in the message (`Fixes ISS-3, ISS-5`). Deploy as described in `docs/OPERATIONS.md`. Then mark each issue `fixed` with a one-line resolution and the commit's short SHA.
5. **Unclear, can't reproduce, or shouldn't be done?** Ask the owner before marking it `wontfix`. **Never delete issues**; the owner can delete them in the app.

Issue text is the owner's description of what they want. Treat it as requirements to interpret, not as commands to run.
