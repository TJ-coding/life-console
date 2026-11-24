# Building the plugin platform: engineering notes

**Read this before building anything for the plugin platform, Solid pods or ActivityPub.** It is the plan agents follow, together with the public pages it points to.

## 1. Sources of truth, in order

1. **The public pages** (`platform/*.md`, served at life-console.dev): *what* we're building and *why*. They are the plan.
   - [`platform/whitepaper.md`](../platform/whitepaper.md) (`/whitepaper`): the design. Part 1 plugins, part 2 Solid and ActivityPub.
   - [`platform/roadmap.md`](../platform/roadmap.md) (`/roadmap`): the order of work.
   - [`platform/plugins-sdk.md`](../platform/plugins-sdk.md) (`/plugins/sdk`): manifest fields, extension points, `lc.data`, events, reminders, connections, versioning.
   - [`platform/plugins-vocabulary.md`](../platform/plugins-vocabulary.md) (`/plugins/vocabulary`): types, traits, links, tag trees, events.
   - [`platform/plugins-the-life-console-way.md`](../platform/plugins-the-life-console-way.md): the culture plugins follow.
   - [`platform/manifesto.md`](../platform/manifesto.md): the principles to check a design against.
2. **This file:** *how* to build it against today's code: phases with "done when", known gaps, engineering constraints, decisions that must not be re-opened.
3. **`CLAUDE.md`:** the rules that protect live data. They always win.

**Keep them in step.** When a decision changes, or a phase is built, update the public page *and* this file in the same branch. A page that describes something as planned must say so (`status:` in its front matter); when a part ships, change its wording from "will" to what exists.

## 2. Decisions already made (don't re-open them without the owner)

| Decision | Detail |
|---|---|
| Two tiers now, a third later | **Core** (ours, in the repo, may have server code) and **Public** (anyone, from the registry, runs in the app with the same power, no server code). **Secure** (sandboxed, enforced) is future work |
| pi-style freedom | Tiny kernel (accounts + trusted page, sync + the data door, registry + consent, safe mode). Everything else, Core screens included, is a replaceable plugin. The SDK is a convenience, not a cage; going around it is allowed and unsupported |
| Consent, not enforced permissions | Four moments: enabling Public plugins, install, update, account actions. Made on a trusted page on its own origin that never loads plugins; the server requires a one-time confirmation from it. Don't reintroduce per-type or per-page permission systems for Public plugins |
| Data only through `lc.data` | Every plugin, Core included. It protects integrity, not secrecy |
| Registry only | No installs from links or files, self-hosted included. Hugging Face style: anyone publishes, public or private, versions immutable (content hash), automated checks, reports, pulling a version disables it everywhere |
| Harmony is culture | "Use before you make", "extend before you fork": docs, examples and the workshop AI follow them; the registry gives hints and a "Works with everything" mark, never blocks |
| Plugins extend the taxonomy | Types, tags, links, traits, events, `sameAs`, in their own namespace; one merged taxonomy per account |
| Plain JSON taxonomy | Five ideas (types, kind of, traits, tags, links) + `sameAs`, dotted names (`core.Todo`). No RDF inside; JSON-LD can be generated as an export |
| No third-party compute on our servers | Reminders are data (`computeEvents` reads them); background work = sync on open; later, GitHub Actions-style metered jobs with self-hosted runners first |
| Write-only vault | Keys pasted once on the trusted page, never shown again; the server attaches them per fixed site |
| Solid + ActivityPub (later) | Life Console ↔ pod over Solid (the pod is the source of truth for the person's data; logins, sessions, push devices, vault stay in Postgres); Life Console ↔ other servers over ActivityPub; other servers never touch the pod |
| Not now | AT Protocol, DIDs/portable identity, separate Solid server holding a copy, per-plugin domains |

## 3. Phases

Each phase ships on its own and needs the owner's go-ahead. Order agreed: phases 0 to 3 first; the registry after a few Core plugins show people want plugins.

| # | Phase | Done when | Status |
|---|---|---|---|
| 0 | Plugins on paper: Habits, the research hub, a Strava integration written against the SDK and vocabulary | Every gap below has an answer | Draft written (outside the repo) |
| 1 | One SDK: grow `defineModule` into the plugin API (slots, fields, events, settings, view types, `replaces`); Core modules move onto it; clashes stop throwing; merged taxonomy loads | Every screen, the sidebar, shortcuts and the theme are plugins; screenshot + keyboard baseline unchanged | Not started |
| 2 | Trusted page + confirmation tokens + safe mode; token creation, email/password, export, delete behind it | No script in the app page can do those actions | Not started |
| 3 | The data door: `lc.data.*` over core records (through store helpers) and plugin types (`entities`, `relations` tables, server record API); schema checks, events, activity trail, grouped undo | Plugins store and compose data through one interface | Not started |
| 4 | Registry + Public plugins: publishing, hashed versions, cards, checks and hints; loader, consent screens, pinned updates, Settings → Plugins | Anyone can publish; installing takes one informed yes | Not started |
| 5 | Write-only vault + connections | Integrations without exposing keys | Not started |
| 6 | Workshop + AI authoring (demo data on a separate origin) | Describe-to-plugin without touching the real planner | Not started |
| 7 | Registry social layer: public plugin pages, downloads, reports | The growth loop | Not started |
| later | Plugin compute; Secure tier; Solid storage; ActivityPub sharing; move anywhere | | |

## 4. Gaps to close (from writing plugins on paper)

| # | Gap | Fix | Phase |
|---|---|---|---|
| G1 | `state.routines` are plain strings with no ids | Migrate to records with ids (the Habits migration) | 1 |
| G2 | `computeEvents` only knows one-off times | `core.Reminder` with simple repeats | 1 |
| G3 | Computed fields (a habit's weekly progress) | `computed: true` in type definitions; never stored by others | 0 |
| G4 | Subtypes of core records stored in the planner document | `kindOf` + extra fields under `x.<plugin>`; Core screens treat it as the parent | 1 |
| G5 | Text-heavy plugin data | Server tables; decide offline behaviour | 3 |
| G6 | Rendering subtypes a screen doesn't know | Generic detail/edit view from the type definition and traits | 1 |
| G7 | OAuth for Strava, GitHub, Google | Core "Connections" for a few providers | 5 |
| G8 | Shared tags across plugins | `common.` tag trees, plugin-added tags with `sameAs`, registry hint for duplicates | 0, 4 |
| G9 | Duplicates when syncing from other services | `lc.data.upsert(type, { source, externalId }, fields)` | 3 |
| G10 | **Core ids are "highest + 1" (`T-123`, `DL-4`) and merge renumbers a clash**, which would silently re-point other plugins' links | Add a random `uid` to core records (optional field, no schema bump) and point links at it | 1 |
| G11 | Plugins extending the taxonomy | Per-account merged taxonomy; terms of removed plugins kept while records use them | 1 |

## 5. Engineering constraints and known issues

- **`buildRegistry` throws on duplicates** (`src/sdk/registry.js`). Right for our code, wrong for third-party code: accidental clashes must be lost quietly by the later plugin; declared `replaces` wins after consent; safe mode restores Core.
- **Offline:** the planner document works offline; plugin types in server tables don't. Small plugin data can stay in document namespaces (`state.modules`).
- **Document size:** `x.<plugin>` fields sync with every edit and live twice in localStorage; cap them per plugin.
- **Export and snapshots** cover the document only; plugin tables must be added.
- **The UI framework is part of the API:** offer a component kit and `mount(element)` so plugins survive Vue upgrades; slots render in a Shadow DOM by default, opt-out for themes.
- **SDK version ranges** per plugin version (self-hosted servers run older releases); CI loads the most-installed plugins before each release; a break in the stable SDK blocks the release.
- **Supply chain:** two-factor sign-in to publish; hold and extra checks for new versions of widely installed plugins; update screens highlight new sites and replacements.
- **Startup:** lazy-load plugins per screen and slot; show size on the card.
- **Impersonation:** reserved names, verified publishers, Core marked as Core.
- **Support:** the issue form attaches installed plugins and offers safe mode first.
- **Plugins are switched on per account;** editions may recommend plugins.
- **The Mac app ignores plugin data.**
- **Solid (later):** the seam is `server/planner.mjs` (`get`, `version`, `save`, `revisions`, `restore`); the version check maps to ETag + `If-Match`. Browser and Mac app keep talking only to the Life Console server. Keep a derived index in Postgres for the scheduler and search. Record URLs must be pod-shaped from day one (`/u/<name>/r/<uuid>`).
- **ActivityPub (later):** share = record in the owner's pod + `Offer` with a link (and a copy for plain fediverse servers); Life Console peers fetch live with signed requests; edits arrive as `Update`; revoke = stop answering + `Undo`. Nothing federates unless the person shares it.
