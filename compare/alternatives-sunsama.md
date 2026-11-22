---
path: /alternatives/sunsama
title: Free and open-source Sunsama alternatives (2026)
description: Four free, open-source Sunsama alternatives compared: Life Console, Super Productivity, Vikunja and WeekToDo. Price, self-hosting, time-blocking, sync and what each lacks.
card: Free and open-source Sunsama alternatives: Life Console, Super Productivity, Vikunja, WeekToDo
updated: 2026-11-22
---
# Free and open-source Sunsama alternatives

<p class="meta">Checked 18 November 2026; Super Productivity and WeekToDo rechecked 22 November 2026. Written by the developer of Life Console, which is listed first; the others are listed for what they do better.</p>

<p class="summary">Sunsama costs $17 a month billed yearly or $22 monthly and has no free plan. If you want its core loop (plan the day, time-block it, close it out) without the subscription, these four are free and open source. None of them matches Sunsama's calendar sync and two dozen integrations.</p>

| | Best for | Runs where | Time-blocking | Licence |
|---|---|---|---|---|
| **Life Console** | Planning from goals and deadlines down to today | Browser (installable, offline), hosted free or self-hosted | Day timeline, Auto time-box | AGPL-3.0 |
| **Super Productivity** | Developers tracking time against Jira, GitHub or GitLab issues | Desktop, phone and web apps; data on your device, optional self-hosted sync | Schedule next to calendar events, timeboxing | MIT |
| **Vikunja** | Projects and lists on your own server | Self-hosted server (Docker), paid cloud | No day planner | AGPL-3.0 |
| **WeekToDo** | A simple weekly to-do list | Desktop apps and browser; data on your device | No | GPL-3.0 |

## 1. Life Console

![Life Console's Command Center: the current block counting down, today's timeline and the next deadline](/media/today@2x.webp)

The closest to Sunsama's daily rituals: a morning **Briefing** and an evening **Debrief** walk through what needs a decision, previewed on the day's real schedule. **Plan week** moves tasks from a backlog into a 7-hour budget per day and then onto a timeline, and **Auto time-box** fills free gaps by priority. On top of that it does what Sunsama doesn't: deadlines as live countdowns, and long-term plans (vision → goals → milestones) that tasks link to.

- **Free:** hosted at life-console.dev, or self-host it with Docker Compose ([guide](/docs/self-hosting)).
- **Lacks:** calendar sync, integrations and native phone apps (it installs from the browser).

[Life Console vs Sunsama, feature by feature →](/vs/sunsama)

## 2. Super Productivity

A mature desktop-first task manager with time tracking, idle detection, Pomodoro and timeboxing. Its standout is issue-tracker integration: it imports Jira, GitHub and GitLab tickets as tasks and logs time back to them. It also has a plan-your-day and finish-your-day flow. Data stays on your device; sync goes through its own end-to-end encrypted SuperSync (which you can host yourself), Dropbox or WebDAV.

- **Pick it over Life Console** if you're a developer whose work lives in issue trackers, or you want detailed time tracking.
- **Lacks:** long-term goals that tasks link to.

## 3. Vikunja

A self-hosted to-do and project app with list, Kanban, Gantt and table views, and importers from Todoist, Trello and Microsoft To Do. It's a task and project manager rather than a daily planner: there's no day timeline or planning ritual.

- **Pick it** if you want shared projects for a household or team on your own server.

## 4. WeekToDo

A minimalist weekly planner: one column per day, with recurring tasks, subtasks and reminders, stored on your device. Good if Sunsama felt like too much, though its code hasn't changed since July 2025.

- **Lacks:** time-blocking, sync and goals.

## Which one?

- Want Sunsama's daily planning loop, plus goals and deadlines, for free → **Life Console**
- Work tracked in Jira or GitHub, need time logs → **Super Productivity**
- Projects with other people on your own server → **Vikunja**
- Just a week of to-dos → **WeekToDo**
- Need calendar sync and integrations → stay with Sunsama; nothing free and open source matches them yet
