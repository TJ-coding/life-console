---
path: /roadmap
title: Life Console roadmap: from planner to plugin platform
description: What's live in Life Console today, what we're building next, and what comes later: the plugin SDK, consent, the registry, AI-written plugins, Solid pods and ActivityPub sharing.
card: The roadmap: what's live, next and later
updated: 2026-11-24
status: Draft. Plans change as we learn; nothing below "Live today" is built yet, and there are no dates on purpose.
draft: true
---
# Roadmap

Life Console is a free, open-source planner today. Over the next stages it becomes a planner **you can extend**: a small core, plugins that can do anything with your consent, and a shared language so they work together. Why: the [manifesto](/manifesto). How: the [white paper](/whitepaper).

## Live today

- **The planner:** Today's Command Center, planning the week, time blocks, deadlines with countdowns, strategic plans with goals and milestones, focus mode, briefings and debriefs, pomodoro planning.
- **Everywhere:** installs from the browser on phones and desktops, works offline, push reminders, a Mac menu-bar app.
- **Open:** AGPL-3.0, self-hostable with Docker, listed in several self-hosting app stores.
- **The beginnings of the platform:** every screen is already a module registered with one registry, and small add-ons (sleep, caffeine, routines) can be switched on in Settings.

## Now: the foundations

Work that makes the platform possible, and improves the planner on its own.

| Step | What it means for you |
|---|---|
| **Plugins on paper** | We write three real plugins against the draft SDK (habits, a research hub, a fitness integration) before writing code, to find what's missing |
| **One SDK for everything** | Our own screens move onto the same plugin SDK anyone will use, so it's proven every day |
| **A trusted page for important actions** | Installing plugins, creating tokens, changing your email, exporting and deleting your account move to a page no script can reach |
| **One door for data** | Every read and write goes through one interface, so data stays valid, syncs and can be undone, whoever wrote the code |

## Next: plugins for everyone

| Step | What it means for you |
|---|---|
| **Core plugins** | The first plugins we ship ourselves, built only on the public SDK |
| **The registry** | A place to publish and find plugins, open to everyone: public or private plugins, every version kept, automated checks, reports |
| **Install with consent** | One clear screen when you install or update a plugin; after that, no prompts |
| **Connections** | Link apps like Strava or GitHub once; plugins can use the connection without ever seeing your keys |

## Later

| Step | What it means for you |
|---|---|
| **The workshop** | Describe a plugin, let AI draft it, try it on sample data, publish it privately or for everyone |
| **Plugin pages** | Every public plugin gets its own page, with screenshots, reviews and one-click install |
| **Background jobs** | Plugins that sync or process data while your tabs are closed, with clear limits, and the option to run them on your own machine |
| **A "Secure" tier** | Plugins that run in a sandbox with guarantees, for people who want safety ensured rather than trusted |
| **Your data in a Solid pod** | Your planner moves into a pod you own, next to Life Console by default, or on your own Solid server; moving is a copy |
| **Sharing across servers (ActivityPub)** | Share a plan with someone on another Life Console server, self-hosted or not; view or edit, revocable |
| **Working together** | Shared projects across servers, with each person's own tasks staying in their own pod |
| **Move anywhere** | Move your pod to another server or your own computer and keep working, with the same address |

## What won't change

- The planner stays excellent without any plugin.
- Life Console stays open source and self-hostable.
- Nothing is installed or updated without your consent.
- Your data stays yours: exportable today, in a pod you can move later.

Have an opinion on the order? Say so on [GitHub](https://github.com/TJ-coding/life-console) or [Discord](https://discord.gg/bWZS5QvPYd).
