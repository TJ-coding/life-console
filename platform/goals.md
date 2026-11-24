---
path: /goals
title: Life Console goals: what we're building towards
description: The goals behind Life Console's next stage, each with how we'll know it's done: a planner you can extend, plugins that add up, consent, open data in Solid pods and sharing over ActivityPub.
card: The goals: what we're building towards
updated: 2026-11-24
status: Draft. Goal 1 is live. A first version of goals 2-11 is built on a development branch and tested, not released yet. This page is the single list of goals; every other page explains them.
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
| 2 | **Everything is a plugin, ours included** | Today, the week, Strategy, the sidebar, shortcuts and the theme run on the same SDK anyone uses, and any of them can be replaced | Built, not released yet: our screens are registered on the same SDK; a plugin can replace Today (or any screen), the sidebar, the shortcuts or the theme, with consent |
| 3 | **Plugins can do anything, with consent** | Installing or updating a plugin takes one clear yes on a page no plugin can reach; after that, no prompts; safe mode always recovers | Built, not released yet: the trusted page (no scripts, can't be faked), consent for install, update, tokens, keys, password and deletion; safe mode |
| 4 | **Data stays valid, whoever writes it** | All data goes through one door (`lc.data`): checked, synced, undoable, labelled with the plugin that changed it | Built for plugins, not released yet: checks, sync, undo, activity labels. Our own screens move onto it gradually |
| 5 | **Plugins add up, not drift apart** | Two plugins that never heard of each other work together through the shared [vocabulary](/plugins/vocabulary) (a run in one counts towards a habit in another); plugins can extend it | Built, not released yet: vocabulary v1, plugins extend it, `sameAs`; tested with a run counting towards a habit |
| 6 | **Anyone can publish, anyone can install safely** | A registry where anyone publishes, public or private; fixed versions, automated checks, reports, and bad versions pulled everywhere | Built, not released yet: a registry on each server, public or private, hashed versions, automated checks, reports, pulling |
| 7 | **You can build a plugin without being a developer** | Describe it, AI drafts it, you try it on sample data, you publish it, without touching your real planner until you choose to | Built, not released yet: the workshop with a sandboxed preview on demo data; drafting works with your own AI (copy the prompt), in-app drafting comes later |
| 8 | **Integrations without handing over keys** | Connect Strava or GitHub once; plugins use the connection and never see the key | Built, not released yet: a write-only vault, the broker, OAuth for Strava, GitHub and Google Calendar |
| 9 | **Your data lives in a pod you own** | Your planner is in a Solid pod, next to Life Console or on your own Solid server; moving it is a copy | Built, not released yet: every save is written to a Solid pod, built in or your own (with a token); copy a planner from any pod |
| 10 | **Share across servers** | Share a plan with someone on another Life Console server over ActivityPub, view or edit, and revoke it | Built, not released yet: share with view or edit, live signed reads, edits, revoking |
| 11 | **Run it anywhere, keep working** | Move your pod to another server or your own computer and carry on, with the same address and the same collaborators | Built, not released yet: moving keeps your address (forwarding), tells collaborators, carries your shares; a mailbox for late messages |

## Guardrails (true at every step)

- The planner stays excellent without any plugin.
- Calm by default: no buttons for their own sake.
- Simple enough to maintain: fewer, clearer rules.
- Open source (AGPL) and self-hostable.
- Nothing installed, updated or shared without your consent.

## For people building it

The engineering notes, phases and known gaps are in [`docs/PLATFORM.md`](https://github.com/TJ-coding/life-console/blob/main/docs/PLATFORM.md). When a goal's status changes, update this page in the same change.
