---
path: /blog/a-planner-you-can-extend
title: Why Life Console is becoming a planner you can extend
description: Every planner eventually doesn't fit someone. Here's why Life Console is opening up to plugins, and the three things we won't compromise on: the planner first, consent, and plugins that add up.
card: Why Life Console is becoming a planner you can extend
updated: 2026-11-24
date: 2026-11-24
status: Draft post. It describes plans; the plugin platform isn't built yet.
draft: true
---
# Why Life Console is becoming a planner you can extend

Every planner, sooner or later, doesn't fit someone.

A PhD student wants research questions, experiments and papers next to their week. Someone training for a race wants their runs to count towards a goal. A founder wants their milestones and their investor deadlines on the same screen as their errands. Each of these is reasonable. None of them belongs in every planner.

The usual answers are both bad. Either the app keeps adding features until it's heavy for everyone, or it stays small and people who need more leave.

## A third way: a small core and plugins

Life Console is going to stay small at its heart and let everything else be a plugin: new screens, new kinds of records, integrations, even different versions of the screens we ship. Anyone can write one. With AI, "anyone" really means anyone: describe what you need, try the draft on sample data, keep it.

We were inspired by tools that took this route and stayed loved: editors whose plugins can do anything, coding tools whose core is tiny and whose users reshape them, open model hubs where anyone can publish. The lesson they share is that freedom works when the core is excellent on its own and the boundaries are few and clear.

## Three things we won't compromise on

**1. The planner comes first.** You'll never have to assemble a system before you can plan a day. Today, the week, goals and deadlines keep working exactly as they do now. Plugins are for when they don't fit you yet.

**2. Consent, not a permission maze.** A plugin can do a lot, so we'll ask you clearly, once, when you install it and whenever it updates. Those questions appear on a page no plugin can reach or fake. After you say yes, it simply works.

**3. Plugins that add up.** The real risk of an open platform isn't one bad plugin. It's a thousand plugins that can't see each other: a habit tracker that doesn't know about your runs, a research tool whose deadlines never reach your week. So every plugin shares one small vocabulary: types, a few traits every view understands, a short list of ways records relate. A run logged by one plugin counts towards a habit in another, without either knowing the other exists.

## And your data stays yours

Opening up the app goes together with opening up the data. Later, your planner will live in a **Solid pod**, an open standard for personal data stores, which you can keep next to Life Console, on your own server or even on your own computer, and move whenever you like. And Life Console will talk to other servers over **ActivityPub**, the open protocol behind Mastodon, so you can share a plan with a supervisor or a co-founder on another Life Console server the way email works between providers.

## What happens next

We're starting with foundations that help even without plugins: moving our own screens onto the same SDK anyone will use, putting important account actions behind a trusted page, and giving all data one door so it stays valid and can be undone. Then come the first plugins we ship ourselves, and the registry where anyone can publish.

The whole design is in the [white paper](/whitepaper), the order of work in the [roadmap](/roadmap), and the beliefs behind it in the [manifesto](/manifesto). They're drafts, on purpose. If you'd build a plugin, or you think we've got something wrong, tell us on [GitHub](https://github.com/TJ-coding/life-console) or [Discord](https://discord.gg/bWZS5QvPYd).
