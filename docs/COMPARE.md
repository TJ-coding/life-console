# Comparison pages (/vs/…, /alternatives/…) and templates (/templates/…)

Life Console gets organic search traffic from "alternative to …" pages. Each page is a markdown file in `compare/`. `scripts/compare-pages.mjs` builds it into `dist/` during `npm run build`, together with the `/alternatives` hub and `dist/compare-pages.json`. The server reads that JSON to route the pages and list them in the sitemap. The pages are served only where `LANDING=on`, and they carry the Umami tag `compare`. Their "Try it now" button links to `/app?from=compare`, so the sign-in funnel can be filtered by `from = compare`.

## Three kinds of page

- **`/vs/<app>`**: Life Console against one app. It has a summary, a feature table, *Pick them if* / *Pick Life Console if*, and *Moving a <app> routine to Life Console*. It targets searches like "<app> alternative" and "life console vs <app>".
- **`/alternatives/<app>`**: an honest roundup of 3–7 tools, with Life Console first. It targets searches like "free / open-source <app> alternatives", which is the more common plural phrasing, or a category ("best time blocking apps").
- **`/templates/<name>`**: a free, printable planning template (blank tables, how to fill it in, a worked example), then "do it in Life Console". It targets "<thing> template" searches. Same build and look, but no *Comparisons* crumb, not on the `/alternatives` hub, and no comparison cards at the bottom. Wrap the parts that shouldn't print in `<div class="no-print">` and the blank tables in `<div class="blank">`. Each template has a **free PDF**: the source is `templates/pdf/<name>.html` (A4, plain grey lines, `sheet.css`), rendered by `scripts/template-pdfs.mjs` to `public/media/templates/<name>.pdf` plus a `<name>.webp` preview for the page. The PDFs are committed, so re-render after editing a source (the script's header says how; it needs Chrome and a scratch `puppeteer-core`). Download links carry `data-umami-event="template-download"` with the file name. Templates are for everyone: no personal shorthand (PSG/SIG, L/S/D, stamps) and no personal routines (chores, courses).

## Writing rules (Google penalises thin, mass-produced comparison pages)

1. **Hand-write every page.** Don't generate pages from a template with the names swapped.
2. **Check every fact about the other apps** on their own site. Put the date in the `meta` line and in `updated:`.
3. **Say where the other app is better.** Life Console's real gaps are calendar sync, integrations, AI scheduling and native phone apps. A reader who needs those should leave knowing which app to pick.
4. **Add something only we can write:** real screenshots and the "moving your routine over" section.
5. **The title starts with the search phrase** (about 60 characters). The description is about 155 characters and includes the price difference.
6. After adding a page: run `npm run build`, open it at 390 px wide and in light and dark themes, add it to `public/llms.txt`, and resubmit the sitemap in Search Console.

## Keyword research (2026-11-23, DataForSEO, Google US)

life-console.dev ranked for no keywords yet. "Open source / self-hosted planner" phrasing gets 10–70 searches a month; the demand is in what the app does. Picked for low difficulty (KD) and a matching page type in the live top 10:

| Page | Main keywords (monthly searches, KD) |
|---|---|
| `/alternatives/time-blocking-apps` | time blocking app 880 (16), time blocking apps 720 (16), time blocking software 590 (20), time blocking for adhd 390 (0), best time blocking app 210 (20) |
| `/alternatives/todoist` | todoist alternative 260 (0), ticktick alternative 110 (0); People Also Ask: self-hosted Todoist alternatives |
| `/templates/personal-strategic-plan` | strategic plan template 1,900 (1), personal strategic plan template 20 (0), goal setting app 480 (14) |
| `/templates/weekly-time-blocking-planner` | weekly planner template 8,100 (26), time blocking template(s) 1,300 (0), weekly time blocking template 140 (1), daily time blocking template 110 (0) |
| landing page (title) | time blocking planner 1,900 (1), best planner app 1,600 (5), goal tracker app 590 (26) |

Queue by search volume: Structured (structured app 2,400, KD 25; structured day planner 590, KD 22), Lunatask (880, KD 17), Tweek (tweek calendar 480, KD 8), Ellie (ellie planner 320, KD 1). Full notes and cached API data are kept outside the repo.

## Queue (plan of 2026-11-18)

Done: Sunsama (vs + roundup) · open-source / self-hosted planners roundup (2026-11-22) · Notion Life OS (vs, 2026-11-23) · Amazing Marvin (vs, 2026-11-23) · time blocking apps roundup, Todoist alternatives roundup, personal strategic plan template, weekly time-blocking planner template with PDFs (2026-11-23).
Next: Structured · then Tweek, Ellie, digital paper planner, Todoist and TickTick (open-source angle), Lunatask.
Leave out apps whose main feature Life Console lacks (Reclaim, Morgen, Akiflow: calendar-first; Motion: AI auto-scheduling onto your calendar, checked 2026-11-23).

## Off-site (the owner submits these)

- AlternativeTo: submit Life Console, then use *Suggest alternative* on each competitor's page (text in `../life-console-listings.md`).
- OpenAlternative.co: submit it; the site ranks for "open source <app> alternative".
- Google Search Console: verify life-console.dev and submit `/sitemap.xml`. Check impressions per page at 4, 8 and 12 weeks.
