---
title: "Pronoun follow-ups schedule the literal sentence: the antecedent is never resolved, losing both the task and its owner"
status: Active (2-WORKING) — plan drafted, awaiting agy relay QA; no implementation started
created: 2026-08-14
updated: 2026-08-14
owner: noel
goal: "When a follow-up refers to earlier work by pronoun, resolve the antecedent before scheduling, so the reminder records the real task and the real owner instead of the literal sentence."
branch: gh-55-antecedent-resolution
doc_type: project
gh_issue: 55
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/55
release: 1.4.280 ("Antecedent")
related: "Not GH-43/GH-51 — those shorten long messages; this adds context to short ones. Consumes the GH-44 replay battery as the measuring stick. Generalizes the mechanism GH-424 introduced."
context_tags: [extraction-fidelity, context-enrichment, ownership, thread-memory, blast-radius]
---

# GH-55 — resolve the antecedent before scheduling

## Status

| What was just completed | What's next |
|---|---|
| Root cause diagnosed from production telemetry; both blockers verified empirically. Issue #55 filed with two gated phases. Release goalpost 1.4.280 ("Antecedent") reserved. **No code written yet.** | agy relay QA to sharpen the plan, then Phase 1. Phase 2 does not open until Phase 1's gate is fully green. |

## The observed failure

Production, 2026-08-14 20:02 UTC:

> **noel.saw** (19:14) — `@Vishal Kharche please make new faster Subscription customer email search GH issue on KISS Woo Fast Search, assign yourself, and work on it.`
> **noel.saw** (20:01) — `Can we try to get it done by end of day on Monday?`
> **Sleuth** — *1 Slack reminder has been scheduled for @noel.saw. Tasks for Monday, August 17th at 5:00 PM: • Can we try to get it done by end of day on Monday?*

The scheduled task is the literal question. What "it" is — and that **Vishal** owns it — are only knowable from the message above.

```
reminder path fired: path=message_event_auto_schedule enrichment=none temporal_trigger="by"
reminder display source: msg_len=50 sentences=1 segment=normal synthesis=off
                        actionable_span_ratio=0.5 ratio_usable=yes routed_by=sentence_count
reminder ownership: resolved_by=sender-fallback assignees=1 mentions=0 notify=0 analyzer_owner=unclear
```

## Quad Concepts

- **This is the inverse of GH-43/GH-51.** Those decide whether to *shorten a long message*. At 50
  chars / 1 sentence this correctly stays verbatim, and `ratio_usable=yes` proves the analyzer worked
  on the text it was given. It was given the wrong text. Context needs **adding**, not removing.
- **The wrong owner is the same bug, not a second one.** `analyzer_owner=unclear` is the *correct*
  reading of "Can we try to get it done" — there is no grammatical subject to own it, so GH-43's rule
  rightly fell back to the sender. Vishal is only recoverable from the antecedent. Fix the antecedent
  and ownership follows; fix ownership separately and you have built the wrong thing.
- **Enumerating verbs is a losing game, and this repo already learned that.**
  `reminders-app-mention-handler.js:56-59` says so in its own words: the verb list is *"a losing
  whack-a-mole — GH-424 alone needed two rounds ('follow up on' then 'follow on') and 'see above'
  still slipped through."* Adding `get it done` buys this case and loses the next.
- **The general signal is grammatical, not lexical.** An unresolved pronoun (`it`/`this`/`that`) plus
  a scheduling trigger means "the task is elsewhere" regardless of the verb around it — the same
  reasoning that already made `ABOVE_REFERENCE_PATTERN` verb-agnostic.

## Two blockers, both verified

**1. Enrichment requires a thread.** `TryEnrichVagueCompletionFromAboveAsync`
(`src/reminders-app-mention-handler.js:246`) opens `if(!ArgEventInfo.thread_ts) return false;`. The
two messages were top-level channel posts 47 minutes apart. `enrichment=none` is a **hardcoded
literal** on the auto-schedule path (`src/reminders-module.js:1453`), not a computed result —
ambient channel messages have no read-back capability at all.

**2. "get it done" matches none of the three patterns.** Verified by direct test; the known-good
controls match, which proves the check itself is sound rather than trivially failing:

```
NO MATCH  "Can we try to get it done by end of day on Monday?"
NO MATCH  "can you get it done by friday"
NO MATCH  "lets get this done tomorrow"
NO MATCH  "please get that done today"
MATCH     "I will do it tomorrow"          <- control
MATCH     "follow up on it next week"      <- control
MATCH     "see above tomorrow"             <- control
```

`VAGUE_COMPLETION_IN_THREAD_PATTERN` lists `get\s+to` ("get to it") but not the `get <pronoun> done`
shape, where the pronoun sits *between* verb and participle.

Either blocker alone is fatal, which is why the fix is two phases rather than one.

## Phase 1 — verb-agnostic reference detection (in-thread)

Replace the enumerated verb lists with the general rule, on the path that **already** enriches. No
new path; no change to *where* context comes from — only to *when* enrichment fires.

**Scope:** the pattern layer in `src/reminders-app-mention-handler.js`. The `thread_ts` gate stays.

**Gate — all must hold before Phase 2 opens:**

- [ ] All four `get it done` variants fire enrichment; the three controls still fire.
- [ ] Temporal false positives still suppressed — `"let's discuss this week"`, `"ship that morning"`,
      `"send it monday"` behave exactly as today.
- [ ] A pronoun with **no** scheduling trigger does NOT fire an AI call (preserves the 1.4.142
      hallucination guard).
- [ ] `ShouldSuppressHypotheticalSubordinateReply` still suppresses
      `"I'll keep that in mind when I get to it"`.
- [ ] GH-44 decision-replay battery: no regression against the committed baseline.
- [ ] Mutation-tested — reverting the generalization turns the new tests red.
- [ ] Full suite green, `tsc` exit 0.

Phase 1 is independently shippable and improves in-thread behavior on its own.

## Phase 2 — channel-level antecedent lookback (flagged, default OFF)

Let a top-level channel message resolve its antecedent from recent channel history. **This is the
half that fixes the reported case**, and the half carrying real blast radius: every channel message
with a pronoun plus a time reference becomes a candidate for a history read and an AI call.

**Scope:** the `thread_ts` gate and the auto-schedule path's hardcoded `enrichment=none`.

**Gate:**

- [ ] Behind an env flag, **default OFF**. Unset ⇒ behavior and AI-call volume byte-identical to today.
- [ ] A **recency window** (time and message count) so two unrelated conversations can never be
      stitched together. A named constant with documented rationale, not a magic number.
- [ ] Same-channel only; never reads across channels or DMs.
- [ ] Cost measured, not assumed: added AI-call volume reported against real production message rates
      before recommending it be armed.
- [ ] Multi-tenant safe — no workspace state resolved via globals (AGENTS.md §0.1).
- [ ] The reported production case yields a reminder naming the actual task **and** resolving Vishal
      as owner.
- [ ] Full suite green, `tsc` exit 0.

## Out of scope

Changing the analyzer prompt or schema. Both phases change *what text reaches* the analyzer, never
how it reasons — which is precisely what keeps the GH-44 battery a valid measuring stick across both
phases. Any prompt edit would invalidate the instrument being used to judge the change.

Also out of scope: cross-channel or DM antecedents, and any attempt to resolve an antecedent older
than the Phase 2 recency window.
