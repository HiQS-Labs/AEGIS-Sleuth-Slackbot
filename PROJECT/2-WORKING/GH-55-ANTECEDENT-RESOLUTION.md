---
title: "Pronoun follow-ups schedule the literal sentence: the antecedent is never resolved, losing both the task and its owner"
status: Active (2-WORKING) — plan drafted and hardened by agy relay QA (3 Blockers, 1 Should, all actioned); no implementation started
created: 2026-08-14
updated: 2026-08-14
owner: noel
goal: "When a follow-up refers to earlier work by pronoun, resolve the antecedent before scheduling, so the reminder records the real task and the real owner instead of the literal sentence."
branch: gh-55-antecedent-resolution
doc_type: project
gh_issue: 55
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/55
release: 1.4.290 ("Antecedent")
related: "Not GH-43/GH-51 — those shorten long messages; this adds context to short ones. Uses the GH-44 replay battery as a REGRESSION GUARD only — it has no thread context, so it never reaches the enrichment path and cannot show the improvement. Generalizes the mechanism GH-424 introduced."
context_tags: [extraction-fidelity, context-enrichment, ownership, thread-memory, blast-radius]
---

# GH-55 — resolve the antecedent before scheduling

## Status

| What was just completed | What's next |
|---|---|
| Root cause diagnosed from production telemetry; both blockers verified empirically. Issue #55 filed, release goalpost 1.4.290 ("Antecedent") reserved. **agy relay QA complete** — 3 Blockers + 1 Should, every citation verified and the false-positive claim reproduced before acting; all findings actioned. The naive "pronoun + trigger" rule was proven too broad and replaced with a subject/object candidate; ownership was proven *not* free; the battery was demoted to regression guard. **No code written yet.** | Phase 1: implement verb-agnostic detection against the noise corpus. Phase 2 does not open until Phase 1's gate is fully green — and may yet conclude channel lookback is unsafe outside threads and stop there. |

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

### The naive rule is too broad — corrected after agy QA

"Pronoun + scheduling trigger" as originally written fires on ordinary conversation. Reproduced:

```
FIRES  <-- false positive  "it will rain on friday"
FIRES  <-- false positive  "that is a problem for next week"
FIRES  <-- false positive  "it will be sunny tomorrow"
FIRES   "Can we try to get it done by end of day on Monday?"   <- the real case
```

The existing temporal guard does **not** save this: it guards `this/that + <period>` only, so it hits
neither `"...for next week"` nor `"...on friday"` in these shapes (verified).

**Candidate strategy — pronoun in OBJECT position, not SUBJECT position.** In every false positive the
pronoun is the grammatical *subject* ("**it** will rain", "**that** is a problem"); in every true
positive it is the *object* ("get **it** done", "follow up on **it**"). That keeps the rule
grammatical rather than lexical — the property this plan is built on — and separates all four noise
cases from both real cases without enumerating a single verb. This is a **candidate**, not a mandate:
the gate below is the requirement, and any implementation that clears it is acceptable.

**Gate — all must hold before Phase 2 opens:**

- [ ] All four `get it done` variants fire enrichment; the three controls still fire.
- [ ] **Conversational noise does NOT fire an AI call** — `"it will rain on friday"`, `"that is a
      problem for next week"`, `"it will be sunny tomorrow"` must be quiet. This corpus is a test
      fixture, not a comment; extend it whenever a new false positive is found in production.
- [ ] Temporal false positives still suppressed — `"let's discuss this week"`, `"ship that morning"`,
      `"send it monday"` behave exactly as today.
- [ ] A pronoun with **no** scheduling trigger does NOT fire an AI call (preserves the 1.4.142
      hallucination guard).
- [ ] `ShouldSuppressHypotheticalSubordinateReply` still suppresses
      `"I'll keep that in mind when I get to it"`.
- [ ] **Multiple mentions in the prepended context do not hijack assignment.** See *Ownership is not
      free* below — with two or more `<@U…>` in the enriched block the mentions fallback assigns to
      **all** of them.
- [ ] GH-44 decision-replay battery: no regression against the committed baseline.
- [ ] Mutation-tested — reverting the generalization turns the new tests red.
- [ ] Full suite green, `tsc` exit 0.

Phase 1 is independently shippable: even though Phase 2 is what fixes the reported top-level-channel
case, Phase 1 alone fixes `"get it done by Monday"` **in threads**, which
`VAGUE_COMPLETION_IN_THREAD_PATTERN` misses today.

## Ownership is not free — it rides on the mentions fallback

The original plan claimed "fix the antecedent and ownership follows for free." That is true in the
reported case but **only by luck of it having exactly one mention**, and the plan must not rest on it
unexamined.

`src/reminder-ownership.js` falls back, when the analyzer returns no usable owner, to:

```js
if(MentionedIDs.length > 0) {
  return { assigneeIDs: MentionedIDs, notifyIDs: [], resolvedBy: 'mentions' };
}
```

It assigns to **every** mention it finds. Enriching prepends the earlier message, which is what puts
`@Vishal` in scope — so ownership resolves correctly here because that block contains exactly one
mention. Prepend a block containing two or three unrelated `<@U…>` and the same fallback assigns the
task to all of them.

So enrichment does not merely add context; it **changes the input to the ownership resolver**. That
is a second-order effect of a change framed as "text only", and it needs the gate item above.

## Phase 2 — channel-level antecedent lookback (flagged, default OFF)

Let a top-level channel message resolve its antecedent from recent channel history. **This is the
half that fixes the reported case**, and the half carrying real blast radius: every channel message
with a pronoun plus a time reference becomes a candidate for a history read and an AI call.

**Scope:** the `thread_ts` gate and the auto-schedule path's hardcoded `enrichment=none`.

**Recency alone is not enough — corrected after agy QA.** A busy channel interleaves conversations, so
time + message count will happily stitch `"get it done by Friday"` onto an unrelated mention three
messages earlier. **Participant continuity is required**, not optional: the antecedent must be from
the same author as the follow-up, or must mention its author. This is the single largest risk in the
plan, and it may yet prove that channel-level lookback is **fundamentally unsafe outside threads** — a
thread is an explicit human assertion that messages belong together, and a channel offers no such
signal. Phase 2 must be prepared to conclude that and stop, with Phase 1 still shipped.

**Gate:**

- [ ] Behind an env flag, **default OFF**. Unset ⇒ behavior and AI-call volume byte-identical to today.
- [ ] A **recency window** (time and message count) — a named constant with documented rationale, not
      a magic number.
- [ ] **Participant continuity enforced**: the candidate antecedent is from the follow-up's author, or
      mentions them. A false-stitching corpus built from real production channel history is a test
      fixture, not a thought experiment.
- [ ] Same-channel only; never reads across channels or DMs.
- [ ] **Cost measured with this specific method** (vague "measure cost" was unfalsifiable): count
      top-level channel messages matching the Phase 1 pattern over 7 days of production telemetry,
      then multiply by one `conversations.history` call plus one OpenAI call. Report the absolute
      added call volume and the Slack rate-limit headroom before recommending it be armed.
- [ ] Multi-tenant safe — no workspace state resolved via globals (AGENTS.md §0.1).
- [ ] The reported production case yields a reminder naming the actual task **and** resolving Vishal
      as owner.
- [ ] Full suite green, `tsc` exit 0.

Phase 2 does **not** duplicate `#CollectPrecedingHumanThreadMessagesAsync`
(`src/reminders-app-mention-handler.js:747`): that method opens `if(!ArgEventInfo.thread_ts) return [];`
and walks a thread, whereas Phase 2 needs `conversations.history` on a channel with no thread. Distinct
mechanism, not redundant machinery — checked against the same standard that removed the redundant
ignore-pattern in GH-48.

## The GH-44 battery is a regression guard, not an improvement measure

The original plan called the battery "a valid measuring stick" for this work. Sharpened after QA: the
battery exercises **single-message routing with no thread context**, while both phases fire only when
thread or channel context exists. So the battery can prove we did not **break** existing non-enriched
behavior — which is exactly what the gates use it for — but it can never **show the improvement**,
because it never reaches the enrichment path at all.

Do not read a green battery as evidence the fix works. The improvement needs its own instrument:
the noise corpus and `get it done` variants in Phase 1's gate, and the reported production case in
Phase 2's. Treating a regression guard as proof of improvement is the same error as trusting a check
that cannot fail.

## Out of scope

Changing the analyzer prompt or schema. Both phases change *what text reaches* the analyzer, never
how it reasons — which is what keeps the battery valid as a regression guard across both phases. Any
prompt edit would invalidate even that.

Also out of scope: cross-channel or DM antecedents, and any attempt to resolve an antecedent older
than the Phase 2 recency window.
