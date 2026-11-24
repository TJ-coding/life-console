---
path: /plugins
title: Life Console plugin docs (draft): build plugins for the planner
description: Draft documentation for Life Console plugins: the culture, the SDK spec sheet and the shared vocabulary that lets plugins work together.
card: Plugin docs: culture, SDK and vocabulary
updated: 2026-11-24
status: Draft documentation for a platform that isn't built yet. Names and calls may change before release.
draft: true
---
# Plugin docs

Life Console plugins can add screens, records, views, integrations and even replace the screens we ship. These pages are the draft documentation, published early so you can tell us what's missing before it's built.

Start with the culture, then the spec sheets:

1. **[The Life Console way](/plugins/the-life-console-way):** seven habits that make plugins add up instead of drifting apart. Read this first.
2. **[SDK spec sheet](/plugins/sdk):** the plugin manifest, extension points, the data door, events and versioning.
3. **[Vocabulary v1](/plugins/vocabulary):** the shared types, traits, links and tags every plugin speaks.

The bigger picture is in the [white paper](/whitepaper), and the order of work in the [roadmap](/roadmap).

## A plugin at a glance

```js
// habits/plugin.js: one file can be a plugin
export default {
  id: 'alice/habits',
  sdk: 1,
  types: [{ type: 'habits.Habit', kindOf: 'core.Routine', traits: ['titled', 'recurring', 'progress', 'serves'],
            fields: { cadence: { enum: ['daily', 'weekdays', 'weekly'] }, target: { type: 'number' } } }],
  pages: [{ path: '/m/habits', title: 'Habits', component: () => import('./HabitsPage.js') }],
  slots: { 'today.card': () => import('./TodayHabits.js') },
  says: { internet: [], replaces: [] },        // shown at install, in plain words
}
```

## How a plugin reaches people

1. **Draft** it in the workshop or your editor, against sample data.
2. **Publish** it to the registry, privately (just you) or publicly.
3. People **install** it from its card, after one clear consent screen.
4. **Updates** are never silent: people see what changed and say yes.
