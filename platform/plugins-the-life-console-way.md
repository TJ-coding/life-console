---
path: /plugins/the-life-console-way
title: The Life Console way: seven habits for plugins that add up
description: The culture behind Life Console plugins: use before you make, extend before you fork, put time on the calendar, declare traits, share tags, link with standard relations, stay calm.
card: The Life Console way: seven habits for plugins
updated: 2026-11-24
status: Draft. Culture, not rules: nothing here blocks a plugin, but every example and template follows it.
draft: true
---
# The Life Console way

Life Console plugins are free to do anything. These seven habits are what make many free plugins feel like **one** planner. Nothing enforces them; the docs, the examples, the templates and the AI that helps you write plugins all follow them, so the harmonious way is the easy way.

## 1. Use before you make

Look in the [vocabulary](/plugins/vocabulary) first. If a type already exists, use it.

- Good: a reading-list plugin stores books as `common.Book`.
- Not good: a new `myapp.ReadingItem` with a title, an author and a "read" flag.

## 2. Extend before you fork

If a type is nearly right, add fields or make a kind of it.

- Good: `research.Question` is a kind of `core.Goal`, with an extra `hypothesis` field. It shows up on Strategy for free.
- Not good: a separate `research.Question` that Strategy has never heard of.

## 3. Put time on the planner

Anything with a time becomes a planner record: a task, a time block, a deadline or a reminder, linked back to your record.

- Good: a lecture creates a time block linked to the course. It's on Today, on the week, and it gets a reminder.
- Not good: lecture times kept inside the plugin, invisible everywhere else.

## 4. Declare your traits

Traits are how views understand records they've never seen. If it has a status, say `status`; if it has progress, say `progress`.

- Good: habits declare `progress`, so a goal's progress on Strategy includes them.
- Not good: progress kept in a field only your plugin knows how to read.

## 5. Share tags

Tags are a shared tree. Reuse a tag before adding one, add yours under the right parent, and join near-duplicates with `sameAs`.

- Good: a fitness plugin's "trail run" sits under `common.activities.run`, so a habit about running counts it.
- Not good: a private "Run" tag that nothing else recognises.

## 6. Link with the standard relations

Use `partOf`, `serves`, `supports`, `contradicts`, `blocks`, `about` or `relatedTo`. If you need your own, make it a kind of one of these.

- Good: `research.cites` is a kind of `relatedTo`, so any graph can still follow it.

## 7. Stay calm

The console is something people look at all day.

- One sidebar entry at most, and only if you have a page.
- No buttons for their own sake; details on hover or on demand.
- Cards start small.

## And one rule that isn't culture

**Data goes through the data door** (`lc.data.*`). It keeps everyone's records valid, synced and undoable. See the [SDK spec sheet](/plugins/sdk).
