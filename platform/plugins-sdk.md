---
path: /plugins/sdk
title: Life Console plugin SDK spec sheet (draft)
description: The draft spec for Life Console plugins: manifest fields, extension points, the lc.data API, events, reminders, connections, consent declarations and versioning.
card: SDK spec sheet: manifest, data API, events
updated: 2026-11-24
status: Draft spec, SDK version 1 (proposed). Not built yet; names may change.
draft: true
---
# SDK spec sheet

**SDK 1, draft.** Everything a plugin declares and calls. The reasoning behind it is in the [white paper](/whitepaper); the habits that make plugins work together are in [The Life Console way](/plugins/the-life-console-way).

## The manifest

| Field | Required | What it is |
|---|---|---|
| `id` | yes | `author/name`, the registry name. Unique |
| `sdk` | yes | The SDK version range it needs, e.g. `1` or `>=1 <3`. Servers only offer versions they can run |
| `version` | yes | The plugin's own version (semver) |
| `title`, `icon`, `description` | yes | Shown on its card and in Settings |
| `types` | no | Record types it defines or extends ([vocabulary](/plugins/vocabulary)) |
| `tags`, `links`, `traits`, `events`, `sameAs` | no | Additions to the shared vocabulary, in its namespace |
| `pages` | no | Its own screens, under `/m/<name>` |
| `slots` | no | Parts of other screens it fills |
| `commands`, `chords` | no | Command palette entries and `G` + key shortcuts |
| `settings` | no | Its settings section |
| `replaces` | no | Screens it takes over, e.g. `core/today`. Shown at install |
| `says` | no | What the author says it does: `internet` (sites), `connections` (e.g. `strava`), `replaces`. Shown at install; the registry's checks compare it with the code |
| `seed` | no | Sample records for previews and the workshop |

## Extension points

| Point | Example | Notes |
|---|---|---|
| Pages | `/m/habits` | One sidebar entry at most |
| Slots | `today.card`, `todo.panel`, `week.strip`, `settings.section`, `strategy.goal` | Rendered in an isolated style scope by default |
| Commands | "Log a workout" | Appear in the command palette |
| Chords | `G` then `H` | Single-key shortcuts stay with the app. A clash is lost quietly by the later plugin |
| View types | `board`, `graph`, `heatmap` | Any plugin's records with the right traits can use them |
| Replacing a screen | `replaces: ['core/today']` | Wins once the person consents; safe mode brings ours back |

UI can be written with the SDK's component kit (card, list, table, form, board, chart), which survives app updates, or with any framework mounted into an element.

## The data door

All data goes through `lc.data`, ours included.

| Call | What it does |
|---|---|
| `lc.data.list(type, { where, linkedTo, from, to, limit })` | Records of a type (including kinds of it) |
| `lc.data.get(id)` | One record |
| `lc.data.create(type, fields)` | Checked against the type and its traits |
| `lc.data.update(id, patch)` | On core records, only the plugin's own fields (`x.<plugin>`) |
| `lc.data.upsert(type, { source, externalId }, fields)` | For syncing from other services without duplicates |
| `lc.data.delete(id)` | Its own records |
| `lc.data.relate(from, link, to)` / `unrelate` | Links from the shared list |

Every call is labelled with the plugin that made it (activity, undo), and calls made in one action undo as one step.

## Events

`lc.on(event, handler)`: `record.changed` (every write: type, id, plugin), `todo.done`, `block.started`, `block.ended`, `goal.progressed`, `day.closed`, `week.started`, plus events plugins add to the vocabulary.

## Reminders

Plugins don't run code on the server. To remind someone, create a task or time block with a time, or a `core.Reminder` record (`at` or `repeat`, `text`, `open`). Limits: 50 active reminders per plugin, repeats no more often than every 15 minutes, a daily cap per account. People can mute a plugin's reminders.

## Connections

`lc.connections.request('strava', { method: 'GET', url: 'https://www.strava.com/api/v3/athlete/activities' })`: Life Console adds the saved key on the server, only for the site it was saved for, and returns the response. Plugins never see keys.

## Consent declarations

What a person sees at install comes from the manifest and the registry: name, author, version, `replaces`, `says`, automated check results, reports. Updates show what changed, with new sites and new replacements highlighted.

## Versioning

- The SDK is versioned; a version is never broken. New versions are added and old ones kept for a stated time.
- Anything outside the SDK may change on any release. Plugins that use internals are labelled on their card.
- Plugin versions in the registry are fixed once published.
