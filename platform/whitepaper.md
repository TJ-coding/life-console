---
path: /whitepaper
title: Life Console plugin platform: white paper (draft)
description: The design of Life Console's plugin platform and open data: a tiny kernel, plugins with consent, one data door, a registry, a shared vocabulary, Solid pods and ActivityPub sharing.
card: The white paper: plugins, Solid pods and ActivityPub
updated: 2026-11-24
status: Draft for discussion, version 0.1. Describes a design, not shipped software.
draft: true
---
# The Life Console plugin platform

**White paper, draft 0.1.** This paper describes how Life Console becomes extensible without becoming fragmented or unsafe (part 1), and how your data stays yours and reaches other servers through open standards, Solid and ActivityPub (part 2). It's written for people who want to build plugins, people deciding whether to trust them, and anyone curious about the design. The short version is the [manifesto](/manifesto); the order of work is the [roadmap](/roadmap).

## Part 1: plugins

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

## Part 2: your data, and other servers

Part 1 is about extending Life Console. Part 2 is about where your data lives and how Life Console talks to the rest of the world. It comes later in the [roadmap](/roadmap), but it shapes decisions we make now, such as how records are named.

## 12. Two open protocols, one on each side

Life Console sits in the middle and speaks one open standard in each direction:

```
your pod  <-- Solid -->  Life Console  <-- ActivityPub -->  other servers
```

| Direction | Standard | Used for |
|---|---|---|
| Life Console ↔ your data | **[Solid](https://solidproject.org/)** | Storing and reading your planner, in a "pod" you own |
| Life Console ↔ other services | **[ActivityPub](https://www.w3.org/TR/activitypub/)** (the W3C standard behind Mastodon and the fediverse) | Sharing, sending, receiving |

Both are W3C work and both speak JSON-LD, the same format the [vocabulary](/plugins/vocabulary) exports to, so a record means the same thing in your pod, in Life Console and on another server.

**Other servers never touch your pod.** Life Console is the only thing that reads and writes it, and it decides who may see a shared record. That keeps one outward-facing protocol to secure, and keeps the pod's location your private business.

## 13. Your data in a pod (Solid)

Everything that should move with you lives in your **Solid pod**: your planner (tasks, time blocks, deadlines, plans, settings), plugin records and links, the plugins you've installed, and who you've shared what with.

What stays with the server you use, because it's about running the service or about security: your login, sessions and access tokens, which devices get notifications, and the vault of connection keys. A pod can be opened by any Solid app you approve, so secrets don't belong there.

**Where the pod runs:**

- **By default, next to Life Console:** a Solid server runs alongside it, on the hosted service and in the self-hosted setup. Nothing to set up.
- **Your own Solid server, or a Solid provider:** point Life Console at it once.

Because Life Console only talks to the pod through the Solid standard, **the storage is swappable**: moving is a copy of your pod, and Life Console keeps working. Your phone, the Mac app and offline use don't change; they still talk to Life Console, which talks to the pod.

## 14. Sharing across servers (ActivityPub)

Example: you use life-console.dev, your supervisor runs Life Console at their university, and you want them to see your research plan.

1. You share the plan with `@supervisor@lc.example-uni.ac.uk`, view only or can edit.
2. Life Console sends an ActivityPub message to their inbox with a link to the plan. It appears in their inbox, and in their console once they accept.
3. Their server fetches the latest version through that link, with a signed request. Your Life Console checks the share, reads the plan from your pod and answers.
4. If they can edit, their changes come back as messages; your Life Console checks their rights and writes the change to your pod.
5. **Revoking works:** stop sharing, and your server stops answering.

**Working on one project together:** the project lives in the pod of whoever created it. Each person's own tasks and time blocks for it stay in **their own** pod, linked to the project, so you see progress without seeing anyone's whole calendar. Two people editing the same thing are merged field by field, the way Life Console already merges two devices.

**Other fediverse servers**, such as Mastodon, don't fetch live; they receive a copy, so for them, deleting is a request rather than a guarantee. The share screen says so.

**Kept simple on purpose:** nothing leaves your server unless you share it with a named person; incoming shares wait in an inbox until you accept; access is view or edit; no public timeline or followers to begin with.

## 15. Moving anywhere, even to your own computer

You should be able to move your whole pod to your own machine and keep working as before, collaborators included:

- **Your address doesn't change.** `@you@life-console.dev` keeps pointing to wherever you're now served from, and shared links keep working. With your own domain, you don't depend on us at all.
- **A computer at home can still receive.** Your local Life Console keeps an outgoing connection to a small mailbox at life-console.dev, so no router setup is needed; messages wait there while your machine is off. Or use your own tunnel.
- **Life Console runs next to the pod:** the self-hosted setup today, and perhaps a desktop build later.
- **Moving is one action** in Settings: copy the pod, check it, switch over. Your login and notification devices are set up fresh on the new server, and connection keys re-entered.

Not now: Bluesky's AT Protocol (its data is public by design, and a planner is private) and portable identifiers that survive any server disappearing. Both are worth revisiting later.

## 16. Open questions

- Should self-hosted servers be able to mirror the registry, for servers that can't reach it?
- How many plugins must use a community type before it joins the common vocabulary?
- Should "areas of life" (a PhD, a startup, health) become a first-class part of the vocabulary?
- Should the first cross-server feature be sharing a plan with one person, or projects several people edit?
- Should life-console.dev keep forwarding addresses for everyone who moves away, for as long as the service exists?

Feedback welcome on [GitHub](https://github.com/TJ-coding/life-console) or [Discord](https://discord.gg/bWZS5QvPYd).
