# Comparison pages (/vs/…, /alternatives/…)

Life Console gets organic search traffic from "alternative to …" pages. Each page is a markdown file in `compare/`. `scripts/compare-pages.mjs` builds it into `dist/` during `npm run build`, together with the `/alternatives` hub and `dist/compare-pages.json`. The server reads that JSON to route the pages and list them in the sitemap. The pages are served only where `LANDING=on`, and they carry the Umami tag `compare`. Their "Try it now" button links to `/app?from=compare`, so the sign-in funnel can be filtered by `from = compare`.

## Two kinds of page

- **`/vs/<app>`**: Life Console against one app. It has a summary, a feature table, *Pick them if* / *Pick Life Console if*, and *Moving a <app> routine to Life Console*. It targets searches like "<app> alternative" and "life console vs <app>".
- **`/alternatives/<app>`**: an honest roundup of 3–6 tools, with Life Console first. It targets searches like "free / open-source <app> alternatives", which is the more common plural phrasing.

## Writing rules (Google penalises thin, mass-produced comparison pages)

1. **Hand-write every page.** Don't generate pages from a template with the names swapped.
2. **Check every fact about the other apps** on their own site. Put the date in the `meta` line and in `updated:`.
3. **Say where the other app is better.** Life Console's real gaps are calendar sync, integrations, AI scheduling and native phone apps. A reader who needs those should leave knowing which app to pick.
4. **Add something only we can write:** real screenshots and the "moving your routine over" section.
5. **The title starts with the search phrase** (about 60 characters). The description is about 155 characters and includes the price difference.
6. After adding a page: run `npm run build`, open it at 390 px wide and in light and dark themes, add it to `public/llms.txt`, and resubmit the sitemap in Search Console.

## Queue (plan of 2026-11-18)

Done: Sunsama (vs + roundup) · open-source / self-hosted planners roundup (2026-11-22) · Notion Life OS (vs, 2026-11-23).
Next: Motion · Akiflow · Amazing Marvin · Structured · then Tweek, Ellie, digital paper planner, Todoist and TickTick (open-source angle), Lunatask.
Leave out apps whose main feature Life Console lacks (Reclaim, Morgen: calendar-first).

## Off-site (the owner submits these)

- AlternativeTo: submit Life Console, then use *Suggest alternative* on each competitor's page (text in `../life-console-listings.md`).
- OpenAlternative.co: submit it; the site ranks for "open source <app> alternative".
- Google Search Console: verify life-console.dev and submit `/sitemap.xml`. Check impressions per page at 4, 8 and 12 weeks.
