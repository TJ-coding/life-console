---
path: /whitepaper
title: Life Console plugin platform: white paper (draft)
description: The design of Life Console's plugin platform: a tiny kernel, Core and Public plugins, consent instead of permission mazes, one data door, a registry, and a shared vocabulary so plugins add up.
card: The white paper: how the plugin platform works
updated: 2026-11-24
status: Draft for discussion, version 0.1. Describes a design, not shipped software.
draft: true
---
# The Life Console plugin platform

**White paper, draft 0.1.** This paper describes how Life Console becomes extensible without becoming fragmented or unsafe. It's written for people who want to build plugins, people deciding whether to trust them, and anyone curious about the design. The short version is the [manifesto](/manifesto); the order of work is the [roadmap](/roadmap).

## 1. Goals

1. **The planner works perfectly without plugins.** Extensibility is an escape hatch.
2. **Plugins can do anything**, including replace the screens we ship.
3. **Nothing happens without the person's informed consent**, and consent can't be faked.
4. **Plugins add up.** Data from one is meaningful to all others.
5. **Simple enough to keep.** Every rule here has to be maintained for years; fewer, clearer rules beat clever ones.

Non-goals: guaranteeing that every plugin is harmless (that's the later Secure tier), becoming a database builder, or becoming a password manager.

## 2. Architecture: a tiny kernel

The kernel is the only part that isn't a plugin:

| Kernel part | Why it can't be a plugin |
|---|---|
| Accounts and the trusted page | Consent and account safety must live where plugins can't reach |
| Sync and the data door | Every device and every plugin must agree on the data |
| The registry client and consent | Decides what code runs at all |
| Safe mode | Must work whatever a plugin did |

Everything else is a plugin: Today, the week planner, Strategy, the sidebar, keyboard shortcuts, the theme. **Core plugins** are the ones we ship. Any other plugin can add to them or, with your consent, replace them.

## 3. Two tiers

| | Core | Public | Secure (later) |
|---|---|---|---|
| Made by | The Life Console project | Anyone, including you with AI | Anyone |
| Comes from | Shipped with each release | The registry | The registry |
| Runs | In the app | In the app, with the same power as Core | In a sandbox |
| Safety | Code review and tests | Your consent | Enforced by the platform |
| Server code | Yes | No | No |

Core and Public plugins use **the same SDK**. Our own screens prove it daily, and a popular Public plugin can become Core without a rewrite.

## 4. What a plugin can do

Plugins have two layers of freedom.

**The stable SDK** (versioned; plugins built on it keep working across releases):

| Extension point | Example |
|---|---|
| Pages and sidebar entries | A Habits page |
| Commands and shortcuts | "Log a workout" in the command palette |
| Slots in existing screens | A card on Today, a panel in the task drawer |
| Fields on existing records | A "paper" field on a task |
| New types of record | Habit, Research question, Workout |
| Links between records | A habit *serves* a goal |
| View types | A board or a graph any plugin's records can appear in |
| Events | React when a task is done or the day is closed |
| Settings | A plugin's own settings section |
| Replacing a screen | A different Today, declared and shown at install |

**Everything else:** plugins run in the app, so they can also use any framework, style the whole app (themes are plugins), or reach into internals. That's allowed but unsupported: it may break when Life Console updates.

## 5. One door for data

Every plugin, ours included, reads and writes through one interface:

```js
lc.data.list('core.Todo', { where: { day: '2026-11-24' } })
lc.data.create('habits.Habit', { title: 'Run 5k', cadence: 'weekdays' })
lc.data.update('core.Todo/T-42', { x: { habits: { streak: 4 } } })
lc.data.relate('habits.Habit/run-5k', 'serves', 'core.Goal/half-marathon')
```

What one door buys: data is checked against its type before it's saved; sync, conflict handling and undo keep working; every change raises an event other plugins can react to; and every change is labelled with the plugin that made it, so you can see (and undo) what a plugin did.

It protects **integrity**, not secrecy: a plugin you've installed could still read what's on your screen. That's what consent is for.

## 6. Consent

A Public plugin can do a lot, so you say yes at four moments, and nowhere else:

1. **Turning on Public plugins** for your account, once, with a plain warning: a plugin you install can see and change everything in your planner and send it anywhere.
2. **Installing a plugin:** who made it, what it says it does (sites it talks to, screens it replaces), its automated check results and reports.
3. **Updating a plugin:** never silent; you see what changed.
4. **Account actions** a plugin could abuse: creating access tokens, changing your email or password, exporting or deleting your account, saving a connection.

**Consent can't be faked.** Plugins run in the app's page, so they could click "Allow" themselves. These confirmations therefore happen on a separate **trusted page** on its own address, which never loads plugins; the browser keeps app code out of it. The server only accepts those actions with a one-time confirmation from that page.

**Safe mode** starts the app without Public plugins, after a crash or on request, so recovery always works.

What consent can't do: stop a plugin you accepted from misusing what it can see. Reputation, reports, the registry's ability to pull a bad version from every app, and your planner's automatic snapshots limit the damage.

## 7. The registry

Life Console installs Public plugins **only from the registry**, modelled on open hubs like Hugging Face:

- **Anyone can publish**, under their own name (`alice/habits`), publicly or privately.
- **Every version is kept and fixed**, identified by its content, so what you installed is exactly what runs.
- **Plugin cards** describe what a plugin does, with screenshots and a changelog.
- **Automated checks** run on every version: code that loads other code from the internet, hidden code, talking to sites it doesn't mention, bypassing the data door. Results appear on the card and the install screen.
- **Reports and pulling:** a version found to be harmful can be disabled in every app that has it.

## 8. Harmony: a shared language

The rule that keeps plugins from drifting into islands is a **shared vocabulary**, kept deliberately small. Plugin authors learn five ideas:

| Idea | Example |
|---|---|
| **Types** | `habits.Habit` with a cadence and a target |
| **Kind of** | A research question is a kind of goal, so it shows on Strategy |
| **Traits** | `status`, `progress`, `dated`: views understand traits, not types |
| **Tags** | A tree: health › training › trail run |
| **Links** | A short fixed list: part of, serves, supports, contradicts, blocks, about, related to |

Plus `sameAs`, to say two terms mean the same thing.

Three conventions make it work:

- **Anything with a time becomes a planner record** (a task, a time block, a deadline or a reminder), so every plugin's work shows on Today, the week and in reminders.
- **Plugins extend the vocabulary:** new types, tags, links, traits and events in their own namespace, joined to others with `sameAs`.
- **Extend before you fork** is culture, written into the docs and followed by every example and by the AI that helps write plugins. See [The Life Console way](/plugins/the-life-console-way).

Deliberately left out: heavyweight semantic-web machinery. The vocabulary is plain JSON. If another tool ever needs RDF, Life Console can generate it from these definitions.

## 9. Secrets and connections

Keys for other services go in a **write-only vault**: you paste them once on the trusted page and they're never shown again, to plugins or to you. A plugin asks Life Console to make a request "with your Strava connection"; the server adds the key, only for the site it was saved for, and returns the answer.

## 10. Reminders and background work

Public plugins don't run code on Life Console's servers. Reminders are **data**: a plugin creates a task, a time block or a reminder record, and the existing reminder system sends it, within limits per plugin. Background syncing happens when you next open the app. Later, plugins may run short, metered jobs (like CI jobs), including on your own machine.

## 11. Using mode and editing mode

Using Life Console and changing it are separate places. In the app, only installed, consented plugin versions run, and a failing plugin shows as unavailable without breaking the rest. In the **workshop**, drafts run against sample data on a separate address, with a live preview, until you publish them.

## 12. Open questions

- Should self-hosted servers be able to mirror the registry, for servers that can't reach it?
- How many plugins must use a community type before it joins the common vocabulary?
- Should "areas of life" (a PhD, a startup, health) become a first-class part of the vocabulary?

Feedback welcome on [GitHub](https://github.com/TJ-coding/life-console) or [Discord](https://discord.gg/bWZS5QvPYd).
