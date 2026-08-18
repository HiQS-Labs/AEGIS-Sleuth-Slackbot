---
gh_issue: 87
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/87
title: "\"for tonight\" schedules for tomorrow night: jitter pushes the anchor into the past, then the past-handler adds a day"
status: Proposed (1-INBOX — not yet active)
created: 2026-08-18
doc_type: bugfix
related: "GH-55 (antecedent resolution) touches the same pipeline; GH-88 diagnostics should expose the jitter draw"
---

# GH-87 — Jitter must never change the calendar day

## Observed

"@Mike for tonight, can you review this PR..." sent at **~20:57** local was scheduled for
**tomorrow 20:58**, annotated *"The requested time was in the past, so the reminder has been
scheduled for the next occurrence."*

## Root cause — three correct steps composing into a wrong answer

1. **Anchor.** `data/static/ai/date-extraction-instructions.md:55` — *"Treat `night` or `tonight` or
   `later tonight` as `9 PM`."* → 21:00, three minutes in the future at send time.

2. **Jitter.** `src/reminders-ai-pipeline.js:848-857`. `tonight` carries no digits, so
   `HasExplicitClockTime` is false and the fuzzy-keyword branch fires:
   ```js
   ExtractedDate.setUTCMinutes(ExtractedDate.getUTCMinutes() + Math.floor(Math.random() * 91) - 45);
   ```
   Range **−45..+45**. A −2 draw yields 20:58 — now in the past.

3. **Past-handler.** `src/reminders-ai-pipeline.js:864-877` rolls a past date forward **24 hours**.
   `ShouldKeepSameDayWhenPast` matches only `\bthis morning\b`, so `tonight` does not qualify.

20:58 tomorrow. The arithmetic reproduces the screenshot exactly.

## Why it is systemic, not a one-off

Jitter exists to spread simultaneous reminders apart — a **presentation** concern. It is currently
allowed to change **which day** a reminder fires. Roughly half the distribution is negative, so any
message sent within 45 minutes *before* its anchor has close to a coin-flip chance of a 24-hour
deferral. And the anchor nearest the send time is the one people actually say: "tonight" at 8:57 PM,
"this morning" at 8:50 AM, "by noon" at 11:40.

The bug is therefore worst exactly where the phrase is most urgent.

## Plan

**Phase 1 — clamp jitter so it cannot cross "now".** The minimal, sufficient fix for this report.
After applying jitter, if the result is earlier than the current time but the un-jittered anchor was
not, restore the anchor (or clamp to `now + epsilon`). Equivalent alternative: make jitter one-sided
(`0..+45`) whenever the anchor is within 45 minutes of now. Prefer the clamp — it states the
invariant directly rather than encoding it in a bound.

**Phase 2 — teach the past-handler about evening intent.** Extend `ShouldKeepSameDayWhenPast` from
`this morning` to `tonight`, `later tonight`, `night`, `evening`. Someone saying "tonight" at 23:00
means *soon*, not *in 23 hours*. Independent of Phase 1 and fixes the genuinely-past case.

**Phase 3 — make the rule explicit.** A named helper (`ApplyPresentationJitter`) whose contract is
"never changes the calendar day", so the next person adding an anchor inherits the invariant instead
of rediscovering it.

## Acceptance

- [ ] "for tonight" at 20:57 with a forced negative jitter draw schedules **today**.
- [ ] A loop/property test asserts that across the full jitter range, no fuzzy anchor changes the
      scheduled calendar day relative to the un-jittered anchor.
- [ ] "tonight" at 23:00 schedules soon rather than the next night.
- [ ] Existing jitter behaviour (spreading within a day) is unchanged — pinned, not deleted.

## Risks

- The tests need a deterministic jitter draw. `jest.spyOn(global.Math, 'random')` is sufficient —
  do **not** add an injection seam to production code for this. Only reach for a seam if the spy
  proves insufficient (e.g. the call moves behind a worker boundary).
- Phase 2 changes behaviour for genuinely-past evening phrases. Confirm the "too soon" guard
  (`SecondsForTooSoon`, line ~882) still prevents an immediate fire.
