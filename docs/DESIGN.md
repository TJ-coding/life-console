# Design guidelines: the driver's console

How Life Console screens should look and behave. The rules come from the S-01 Command Center redesign (Nov 2026, ISS-6), where the owner's feedback over several rounds settled on a style. Follow them for every screen, new or reworked.

- **Tokens** (colours, fonts) are in `src/styles.css`; their origin is the Stitch "Flight Deck" file (`../stitch_new_project_workspace/life_console_flight_deck/DESIGN.md`). This document doesn't change them. It covers **what goes on a screen, in what order, at what size**.
- **Where it conflicts with the spec:** the spec says "dense, information-rich". This guide wins on hierarchy: keep things dense where data really is dense (tables, timelines), but never show everything at once.
- **Reference implementation:** `src/views/CommandCenter.vue`, `src/components/NowCard.vue`, `src/components/CommandCenterMore.vue`.

---

## 1. The idea

Treat the owner like an F1 driver. A driver's display shows the few numbers that decide the next action, in large type, and nothing else until something needs attention.

Every screen answers its own short list of questions, in priority order. For S-01 they were the owner's own words (ISS-6):

1. What do I need to do **now**?
2. How long until the next **deadline**?
3. What do I need to do **today**?
4. What's **next**? (a hint, not a headline)

Before building or changing a screen, **write its 2–4 questions down in priority order** (in the component's header comment). Everything on the screen should answer one of them. Anything else goes into the telemetry strip or behind **More**.

---

## 2. Principles

1. **Most important at the top, largest, and first on a phone.** Position, size and colour all follow the priority list. Don't give a secondary item a big number.
2. **Show exceptions, not status.** Values that are fine render muted. Colour (amber/red) appears only when something needs action: overdue, over capacity, past cutoff. Reminders (plan checks, reviews, lectures) appear only when they are due within about a day.
3. **No empty space.** The owner finds empty areas inside or between boxes stressful. Fill height by **stretching an existing box** (a list panel grows to the bottom of its column), never by adding filler content: a "goals" filler was tried and rejected. Use the full width; no max-width cap on dashboards.
4. **Readable over compact.** Primary lists use 15px rows (14px on phones). The shared 11px "compact" row is too small for anything the owner reads first.
5. **Hints are one line.** Secondary facts that support a headline (e.g. "Next 13:30 Lecture 3 · in 2h 59m") are one readable line inside the related card, not their own card.
6. **Fewer, larger instruments.** One idea per card. Big ticking readouts for time-critical numbers; no decorative charts.
7. **The full view stays reachable.** Less important panels aren't deleted. They move behind a **More** toggle, remembered per device.
8. **One-click actions on rows**, with **Undo in the toast** instead of confirm dialogs (`toast(msg, { label: 'Undo', run })`).
9. **Remember view choices per device** in `localStorage` (`life-console/<screen>-<pref>`, wrapped in try/catch), not in synced `state`.

---

## 3. Screen anatomy

Top to bottom (on phones, the same order in one column):

| Zone | What goes there | S-01 example |
|---|---|---|
| **Primary instrument** (full width) | The one answer that matters most, with its main action | NOW card: task, 48px countdown, Done/Start/Focus, progress, *Next* hint line |
| **Work area** (fills the remaining height) | The thing you act on, beside the context it needs | vertical schedule on the left; deadline card + **Left today** on the right, stretched to the bottom |
| **Telemetry strip** (one line, pinned to the bottom) | Small secondary numbers and due-now alerts; the **More** button at the right | seals, sleep, caffeine, routines, plan-check / lecture alerts |
| **More** (hidden by default) | The full briefing from before the redesign | 7-day deadlines with quick add, goals, sign-off ledger, wellbeing tiles |

The page should fill the window on desktop: `.cc { min-height: 100% }` with the work area taking spare height (`flex: 1 0 auto`) and the telemetry strip `margin-top: auto`. Side-by-side columns end on the same line: the long one (the schedule) takes its height from the other column (`flex: 1 1 0` plus a sensible `min-height`).

---

## 4. Type scale

Body text stays 13px (`styles.css`). Size by role, not by component:

| Role | Desktop | Phone | Font |
|---|---|---|---|
| Hero readout (countdown, the one number) | 48px bold | 34px | mono, tabular |
| Primary title (what to do now) | 30px / 36px, 600 | 24px | Inter |
| Secondary title (deadline name) | 22px / 28px, 600 | 18px | Inter |
| Primary list rows | 15px, rows ≥ 46px tall | 14px | Inter; times and estimates 13px mono |
| Hint line / secondary rows | 15–16px | 15px | Inter; times mono, start time amber |
| Meta (due day, ranges) | 12–13px | same | mono, muted |
| Labels | 11px uppercase (`.tiny.upper.muted`) | same | — |
| Telemetry strip | 12px | same | mono |

Use the global instrument classes instead of one-off sizes: `.inst` (card padding/gap), `.inst-lbl` (label row), `.inst-big` (hero number), `.clamp2` (two-line title clamp).

---

## 5. Patterns to reuse

- **Instrument card:** `section.panel.inst`, label row at top, hero number or title, one action row. Left border colour = state: category colour while busy, `--warn` or `--danger` for urgency, `--border` otherwise.
- **Countdown:** `H:MM:SS` within a day (ticks every second off `ui.now`), otherwise `3d 7h`. Overdue shows time since due in `--danger` with "overdue by". Urgency: ≤ 12h or overdue = danger, ≤ 48h = warn. Use the helpers in `src/glance.js` (`minsTo`, `countdown`, `bigCountdown`, `urgency`, `dueStatus`) and the `DeadlineHero` component for a one-deadline headline.
- **Goal status:** `src/glance.js` also has `sigState` (done / late / soon / ok), `nextSigOf`, `psgGlance` (pct, behind, next SIG, linked deadline) and `nextMilestone`. A goal is *behind* when a SIG or the PSG is past its time bound. Never use these state names as bare CSS classes (`.ok`/`.done` are global); prefix them (`st-late`).
- **Run-sheet list:** `TodoRow` with `compact show-start show-prio removable :show-links="false"`, styled up to 15px by the screen (see `.list :deep(.trow.compact)`). Order = timed items by clock, then untimed by priority. Hide done items behind "Show N done". Quick-add line at the foot of the box.
- **Small meter:** a secondary quantity (workload) is a `2.7/7h` label plus an 18px vertical bar at the **right end of a header**, muted until it's over the limit.
- **Status pill:** `OVERDUE / DUE TODAY / TOMORROW / IN n DAYS`, mono 12px, bordered in the urgency colour.
- **Telemetry item:** `LABEL value/limit`, value bold, colour only when out of range; alerts are bordered chips that link to where you fix them.
- **More toggle:** a button at the right end of the telemetry strip; the expanded content is its own component (`CommandCenterMore.vue`).
- **Direction / zoom toggles:** small segmented icon buttons in the panel header (`.seg`), remembered per device.

---

## 6. Phones (≤ 700px)

- One column, in priority order. Reorder with flex `order` (use `display: contents` on wrapper columns), e.g. NOW → deadline → list → schedule.
- Make sure columns **stretch** (`align-items: stretch`). A shrink-to-fit column once made rows overflow off-screen.
- Same hierarchy, smaller steps (section 4). Drop the least useful column of a row (e.g. the due day/time on deadline rows), not the title.
- Check at 390×844.

---

## 7. Review checklist

Before shipping a screen change, take screenshots at **1920×992** (the owner's desktop), 1440×900 and 390×844 (see CLAUDE.md, *Verifying changes*), then check:

- [ ] The screen's questions are written down, and the top of the screen answers question 1 at a glance.
- [ ] Nothing secondary is bigger or more colourful than something primary.
- [ ] No empty area inside a box or between columns; columns end on the same line; no gap above the footer.
- [ ] Primary list text is ≥ 15px (14px on phones).
- [ ] Colour only marks things that need action.
- [ ] Anything removed from the main view is still reachable (More, or its own page).
- [ ] Row actions are one click, with Undo where it deletes something.
- [ ] Dark and light themes both work; phone order matches priority; no horizontal overflow.

---

## 8. Applying it to other screens

Starting points for the next reworks. Confirm each screen's questions with the owner before redesigning it.

| Screen | Likely questions (priority order) | Notes |
|---|---|---|
| **S-10 Plan week** | Which days are overloaded? What's still unscheduled? When is this week's next deadline? | Load per day as small meters on day headers; unscheduled count as the headline; let day columns fill the height. |
| **S-20 Todo inbox** | What should I do next? What's overdue? What has no date yet? | Run-sheet rows at 15px with P badges; overdue first; filters as a small segmented control, not a sidebar. ISS-10: multi-select is noise on phones. |
| **S-21 Deadlines** ✅ | What's due soonest and how long do I have? What's overdue? | Done (Nov 2026): DeadlineHero on top, rows lead with time left, list + month side by side on wide screens. |
| **S-35 Strategy overview** ✅ | Which goal is behind? What's the next milestone? What's next per goal? When's the next check? | Done (Nov 2026): next-milestone headline, PSG + SIG rows with BEHIND / NEXT tags. |
| **S-30 Strategic plan** | Which goal is behind? What's the next SIG to work on? When is the next check? | Editing workspace; tables can stay dense. Reuse `sigState` colouring for late SIGs; opened with `?goal=` it selects that goal. |
| **Focus mode** | What am I doing, and how long is left? | Should show the NOW card's content (task, countdown, Done, next hint) at a larger scale, and nothing else. |
