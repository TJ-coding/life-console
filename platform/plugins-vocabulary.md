---
path: /plugins/vocabulary
title: Life Console plugin vocabulary v1 (draft): shared types, traits and tags
description: The shared language of Life Console plugins: core and common types, the traits views understand, the standard links, tag trees and events.
card: Vocabulary v1: types, traits, links, tags
updated: 2026-11-24
status: Draft vocabulary, version 1 (proposed). Plugins will be able to extend it.
draft: true
---
# Vocabulary v1

The shared language every plugin speaks. Five ideas: **types**, **kind of**, **traits**, **tags** and **links**, plus `sameAs` for "these mean the same thing". It's plain JSON; no semantic-web tooling needed.

## Names

| Prefix | Owner | Example |
|---|---|---|
| `core.` | Life Console | `core.Todo` |
| `common.` | Life Console, open to proposals | `common.Paper` |
| `<plugin>.` | The plugin's author | `habits.Habit` |

Only a prefix's owner changes its terms, and only by adding within a major version. Community terms used by several plugins can be promoted into `common.`, with `sameAs` back to the original.

## Core types

| Type | What it is | Traits |
|---|---|---|
| `core.Todo` | A task, with estimate, priority, due date and schedule | titled, dated, scheduled, status, estimated, partOf |
| `core.TimeBlock` | A fixed block on the calendar | titled, dated, scheduled |
| `core.Deadline` | A hard date with a countdown | titled, dated, status |
| `core.Plan` | A strategic plan: vision, goals, milestones | titled, progress |
| `core.Goal` | A goal inside a plan | titled, dated, progress, partOf |
| `core.Milestone` | A step towards a goal | titled, dated, status, partOf |
| `core.Routine` | Something done regularly | titled, recurring |
| `core.Reminder` | A notification at a time or on a repeat | titled, dated, recurring |
| `core.LogEntry` | Something that happened | titled, happened, about |
| `core.Review` | A review of a day, week or plan | happened |
| `core.Note` | Free text about a day or a record | titled, about |
| `core.Person` | Someone you work with | titled |

## Common types (first set)

| Type | Kind of | Same as |
|---|---|---|
| `common.Paper` | | schema.org ScholarlyArticle |
| `common.Book` | | schema.org Book |
| `common.Course` | | schema.org Course |
| `common.Workout` | `core.LogEntry` | schema.org ExerciseAction |
| `common.Habit` | `core.Routine` | |
| `common.Meeting` | `core.TimeBlock` | schema.org Event |
| `common.Expense` | `core.LogEntry` | |
| `common.Experiment` | `core.Milestone` | |

## Traits

| Trait | Guarantees | Read by |
|---|---|---|
| `titled` | `title` | Lists, search, the palette |
| `dated` | `due`, or `start` and `end` | The week, deadlines, calendars |
| `scheduled` | A linked time block, or a scheduled time | Today's timeline, reminders |
| `status` | `done`, or a status tag (open, doing, done, dropped) | Boards, "show done", roll-ups |
| `progress` | `progress` from 0 to 1 | Strategy, gauges |
| `recurring` | `repeat` (daily, weekdays, weekly on days, every n days) | Today, reminders |
| `happened` | `at`, optional `durationMin` | History, debriefs |
| `estimated` | `timeMin` | The day's load, workload |
| `partOf` | A `partOf` link | Grouping, Strategy, graphs |
| `serves` | A `serves` link to a goal | Goal progress |
| `about` | An `about` link to a tag or record | Filters, topic views |

## Links

| Link | From → to | Example |
|---|---|---|
| `partOf` | anything → project, plan, goal or parent | A task is part of a goal |
| `serves` | anything → goal | A habit serves "Run a half marathon" |
| `supports` / `contradicts` | evidence → claim | A result supports a research question |
| `blocks` | record → record | One milestone blocks another |
| `about` | anything → tag or record | A paper is about preference learning |
| `relatedTo` | anything → anything | The catch-all; custom links are kinds of it |

## Tag trees

| Tree | Starts with |
|---|---|
| `core.kinds` | The timeline's kinds of work: research, academic, experiment, kaizen |
| `core.status` | open, doing, done, dropped |
| `core.areas` | Empty: your own areas of life, such as a PhD, a startup, health |
| `common.activities` | run, ride, swim, walk, strength, yoga |

## Events

`record.changed`, `todo.done`, `block.started`, `block.ended`, `goal.progressed`, `day.closed`, `week.started`.

## Extending it

A plugin adds terms in its own namespace and joins them to others:

```json
{
  "tags": [{ "id": "strava.TrailRun", "label": "Trail run", "parent": "common.activities.run" }],
  "sameAs": [{ "from": "strava.Run", "to": "common.activities.run" }]
}
```
