---
path: /goals
title: Life Console goals: what we're building towards
description: The goals behind Life Console's next stage, each with how we'll know it's done: a planner you can extend, plugins that add up, consent, open data in Solid pods and sharing over ActivityPub.
card: The goals: what we're building towards
updated: 2026-11-24
status: Draft. Goal 1 is live; the rest are planned. This page is the single list of goals; every other page explains them.
draft: true
---
# Goals

One page, the whole direction. Each goal says how we'll know it's reached. The *why* is in the [manifesto](/manifesto), the *how* in the [white paper](/whitepaper), the *order* in the [roadmap](/roadmap).

## North star

**Know what to do right now, in a planner that fits your life and keeps your data yours.**

## The goals

| # | Goal | Done when | Status |
|---|---|---|---|
| 1 | **An excellent planner, with no plugins** | Today, the week, goals and deadlines answer "what now?" out of the box | Live; keeps improving |
| 2 | **Everything is a plugin, ours included** | Today, the week, Strategy, the sidebar, shortcuts and the theme run on the same SDK anyone uses, and any of them can be replaced | Planned |
| 3 | **Plugins can do anything, with consent** | Installing or updating a plugin takes one clear yes on a page no plugin can reach; after that, no prompts; safe mode always recovers | Planned |
| 4 | **Data stays valid, whoever writes it** | All data goes through one door (`lc.data`): checked, synced, undoable, labelled with the plugin that changed it | Planned |
| 5 | **Plugins add up, not drift apart** | Two plugins that never heard of each other work together through the shared [vocabulary](/plugins/vocabulary) (a run in one counts towards a habit in another); plugins can extend it | Planned |
| 6 | **Anyone can publish, anyone can install safely** | A registry where anyone publishes, public or private; fixed versions, automated checks, reports, and bad versions pulled everywhere | Planned |
| 7 | **You can build a plugin without being a developer** | Describe it, AI drafts it, you try it on sample data, you publish it, without touching your real planner until you choose to | Planned |
| 8 | **Integrations without handing over keys** | Connect Strava or GitHub once; plugins use the connection and never see the key | Planned |
| 9 | **Your data lives in a pod you own** | Your planner is in a Solid pod, next to Life Console or on your own Solid server; moving it is a copy | Later |
| 10 | **Share across servers** | Share a plan with someone on another Life Console server over ActivityPub, view or edit, and revoke it | Later |
| 11 | **Run it anywhere, keep working** | Move your pod to another server or your own computer and carry on, with the same address and the same collaborators | Later |

## Guardrails (true at every step)

- The planner stays excellent without any plugin.
- Calm by default: no buttons for their own sake.
- Simple enough to maintain: fewer, clearer rules.
- Open source (AGPL) and self-hostable.
- Nothing installed, updated or shared without your consent.

## For people building it

The engineering notes, phases and known gaps are in [`docs/PLATFORM.md`](https://github.com/TJ-coding/life-console/blob/main/docs/PLATFORM.md). When a goal's status changes, update this page in the same change.
