---
path: /manifesto
title: The Life Console manifesto: a planner you can make your own
description: Why Life Console is becoming an open, extensible planner: a small core, plugins with your consent, a shared language, your data in a Solid pod and sharing over ActivityPub.
card: The manifesto: a small core, plugins that add up
updated: 2026-11-24
status: Draft. This is where Life Console is going. The plugin platform, Solid pods and ActivityPub sharing described here aren't built yet.
draft: true
---
# A planner you can make your own

Life Console exists for people with too much on their plate who want their days to add up to something. It answers one question all day: **what should I do right now?** Everything else serves that.

These are the beliefs behind where it goes next.

## 1. The planner comes first

Extensibility is an escape hatch, never a prerequisite. You should never have to build your own system before you can plan your day. Life Console works beautifully the moment you open it: Today, the week, your goals, your deadlines. Plugins are for the day it doesn't fit you yet.

## 2. A small core, everything else replaceable

The core is deliberately tiny: your account, sync, one way to read and write your data, and the guarantees that keep you safe. Everything else, **including the screens we ship**, is a plugin. Ours are just the first ones. If you'd rather have a different Today, someone can build it, and you can switch.

## 3. Freedom, with consent

A plugin can do anything: new screens, new views, new fields, changes to existing screens, integrations with other apps. We don't hide that behind a permission maze. Instead, nothing is installed, updated or allowed without **your informed yes**, given on a page no plugin can reach or fake. When you say yes, it just works.

## 4. Things should add up, not drift apart

A thousand plugins that can't see each other's data would be a thousand small apps in one window. That's not what we want. Plugins share **one language for what data means**: a common vocabulary of types, a few traits every view understands, a short list of ways records relate. A workout logged by one plugin counts towards a habit tracked by another, without either knowing the other exists.

## 5. Extend before you fork

If a type already exists, use it. If it's nearly right, extend it. If two plugins mean the same thing, link them. This is culture, not a rule we enforce: our docs, our examples and the AI that helps you write plugins all follow it, so the harmonious way is the easy way.

## 6. Your data is yours, and it can move

Your planner will live in a **Solid pod**: a standard, open store of your data that you can keep next to Life Console, on your own server, or with any Solid provider, and move between them. Plugins read and write through one door, so your data stays valid, syncs across devices and can be undone. Life Console is open source under the AGPL, and you can run all of it yourself, even on your own computer.

## 7. Open protocols, not walled gardens

Life Console will talk to the world through open standards: **Solid** for where your data lives, **ActivityPub**, the protocol behind Mastodon, for talking to other servers. Share a plan with someone on another Life Console server, self-hosted or not, the way email works between providers. Nothing leaves your server unless you share it.

## 8. Everyone can extend it, including you with AI

You shouldn't need to be a developer to make Life Console fit your life. Describe what you need, and AI drafts a plugin you can try safely on sample data before it ever touches your planner. Keep it private, or share it with others.

## 9. Calm by default

A console you look at all day must stay quiet. Plugins start small: no new buttons for their own sake, details on demand. Restraint is a feature.

## 10. Built in the open

Plans, decisions and drafts are published as they happen: the [roadmap](/roadmap), the [white paper](/whitepaper) and the [plugin docs](/plugins). They'll change as we learn. Tell us where they're wrong on [GitHub](https://github.com/TJ-coding/life-console) or [Discord](https://discord.gg/bWZS5QvPYd).
