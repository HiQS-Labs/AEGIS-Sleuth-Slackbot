---
title: "Pronoun follow-ups schedule the literal sentence: the antecedent is never resolved, losing both the task and its owner"
status: Active (2-WORKING) — implemented and merged at 1.4.290 with the channel half default-OFF. Stays open: the milestone needs the flag armed and observed in production.
created: 2026-08-14
updated: 2026-08-14
owner: noel
goal: "When a follow-up refers to earlier work by pronoun, resolve the antecedent before scheduling, so the reminder records the real task and the real owner instead of the literal sentence — and record the resolution in the ledger so a wrong stitch is auditable rather than silent."
branch: gh-55-antecedent-resolution
doc_type: project
gh_issue: 55
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/55
release: 1.4.290 ("Antecedent")
related: "Not GH-43/GH-51 — those shorten long messages; this adds context to short ones. Uses the GH-44 replay battery as a REGRESSION GUARD only — it has no thread context, so it never reaches the enrichment path and cannot show the improvement. Generalizes the mechanism GH-424 introduced. Reuses the GH-43 grounding constraint in src/reminder-display-selection.js as the non-destructive guarantee."
context_tags: [extraction-fidelity, context-enrichment, ownership, thread-memory, blast-radius]
---

# GH-55 — resolve the antecedent before scheduling

## Status

| What was just completed | What's next |
|---|---|
| **Implemented and merged at 1.4.290.** Both blockers cleared: verb-agnostic object-position detection, and the `thread_ts` gate lifted with participant continuity. `enrichedFrom` provenance reaches the ledger. 47 new tests, 5 mutations all caught, full suite 111/1908 jest + 116 node, `tsc` 0, PDDA at baseline. | **Arm `CHANNEL_ANTECEDENT_LOOKBACK_ENABLED` on one workspace and observe.** The channel half — the half that fixes the reported case — is default-OFF, so the milestone is NOT met by the merge. Owner: noel. Then read `enrichedFrom` on real events for mis-stitches before arming more widely. |

## What the merge did NOT do

Stated plainly so a green suite is not read as a closed issue: **the reported production failure is
still reproducible in production today**, because the channel-lookback half ships default-OFF. The
merge makes the fix *available*; an operator arming the flag is what makes it *true*. The in-thread
half needs no flag and is live immediately.

The mutation testing surfaced a real gap worth carrying forward: the first noise corpus could not
fail on half the rule it existed to pin, because all nine cases happened to use an auxiliary verb.
The corpus now covers both closed classes independently. **Do not delete either block without
re-running the mutations** — a corpus that cannot fail is the same error as a check that cannot fail.

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
  reading of "Can we try to get it done" — there is no grammatical subject to own it. Vishal is only
  recoverable from the antecedent.
- **Enumerating verbs is a losing game, and this repo already learned that.**
  `reminders-app-mention-handler.js:56-59` says so in its own words: the verb list is *"a losing
  whack-a-mole — GH-424 alone needed two rounds ('follow up on' then 'follow on') and 'see above'
  still slipped through."* Adding `get it done` buys this case and loses the next.
- **This is not a precision/recall tradeoff — the codebase already made it non-destructive.** See
  *Why this is not zero-sum* below. The cost of a false positive is one AI call and a possibly noisy
  context line, not a wrong reminder. That is what collapses the plan from two gated phases to one.

## Two blockers, both verified

**1. Enrichment requires a thread.** `TryEnrichVagueCompletionFromAboveAsync`
(`src/reminders-app-mention-handler.js:246`) opens `if(!ArgEventInfo.thread_ts) return false;`, and
its caller (`src/reminders-module.js:1436`) only reaches it inside an `if(ArgEventInfo.thread_ts)`
block. The two messages were top-level channel posts 47 minutes apart. `enrichment=none` is a
**hardcoded literal** on the auto-schedule path (`src/reminders-module.js:1453`), not a computed
result — ambient channel messages have no read-back capability at all.

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

## Why this is not zero-sum — the machinery already exists

The earlier draft of this plan set a "zero false positives, no exceptions" precision bar and split
the work into two gated phases to contain blast radius. Operator review rejected both, and the code
agrees:

| Already in the codebase | What it guarantees |
|---|---|
| `src/reminder-display-selection.js:41` | `SelectTaskText` already returns `{text, source}` with `source ∈ verbatim\|title\|span\|fallback`. Original and synthesized are **both already first-class** — the display is not an either/or that this work has to invent. |
| `src/reminder-display-selection.js:57-66` | **The GH-43 grounding constraint.** A synthesized title naming any entity, identifier, or number absent from the source is **discarded** and the quoted span shown instead — *"a clumsier reminder beats a confidently wrong one."* |
| `src/reminders-module.js:643` | `#AppendLedgerEvent` — the event ledger's **write side is live**. Only the *read* path is parked by decision (P3), so logging a decision costs nothing new. |
| `src/event-store.js` `REQUIRED_PAYLOAD_KEYS` | Validation is **required-minimum, not strict**: extra payload keys pass. Adding a field to `ReminderCreated` is additive — no schema bump, no migration. |

So a false positive cannot produce an invented reminder; grounding already discards it. It costs one
AI call and possibly a noisy context line. That is a real cost, but it is spend and noise — not a
correctness cliff — and it does not justify a phase gate for a single-maintainer project.

**The one risk that survives.** Enrichment **widens the grounding source**: prepend an unrelated
message and its terms become groundable, so grounding stops protecting against *mis-stitching*
specifically. That is the entire justification for participant continuity below — not ceremony, but
the thing that keeps the existing guarantee meaningful.

## The change set

One set, shipped whole.

**1. Verb-agnostic object-position reference detection.** An unresolved pronoun means "the task is
elsewhere" — but only when the pronoun is the **object**, not the **subject**. "get **it** done by
Monday" points at earlier work; "**it** will rain on friday" is small talk that happens to contain a
pronoun and a weekday.

Object position is decided by **two closed word classes**, neither of which grows when someone
invents a new way to say "finish this":

- **Clause boundaries** — a pronoun that opens a clause is that clause's subject.
- **Auxiliaries and modals** — a pronoun immediately followed by one is the subject of that verb.

A pronoun that is neither clause-initial nor followed by an auxiliary is an object. This is the
grammatical rule the plan has claimed since the start, finally expressed without enumerating a single
content verb.

Proven before writing production code:

```
FIRES  "Can we try to get it done by end of day on Monday?"   quiet  "it will rain on friday"
FIRES  "can you get it done by friday"                        quiet  "that is a problem for next week"
FIRES  "lets get this done tomorrow"                          quiet  "it will be sunny tomorrow"
FIRES  "please get that done today"                           quiet  "I think it will rain on friday"
                                                              quiet  "let's discuss this week"
                                                              quiet  "ship that morning"
                                                              quiet  "The deploy is done. It looks fine for monday."
                                                              quiet  "that was broken yesterday"
                                                              quiet  "this is due tomorrow and it is fine"
```

**2. Channel-level lookback.** Lift the `thread_ts` gate so a top-level channel message can resolve
its antecedent. No new Slack plumbing: `SlackApp#GetRecentChannelMessagesAsync`
(`src/slack-app.js:853`) already wraps `conversations.history`, and the scope is already in use in
production. **Participant continuity is required**: the candidate antecedent must be from the
follow-up's author, or must mention them. A busy channel interleaves conversations, and a thread is
an explicit human assertion that messages belong together where a channel offers no such signal.

**3. Record the resolution.** Add `enrichedFrom` to the `ReminderCreated` ledger payload — the source
message ts and the structural path that fired. Free per the validation note above. This is what turns
a mis-stitch from a silent wrong reminder into an auditable record, and it is why the false-stitching
corpus is not a prerequisite deliverable: production will show us real ones.

**4. One env flag as a kill switch** on the channel read, default OFF. Not a phase gate — a switch to
flip back. It exists because this changes AI-call volume on a live production bot, and the blast
radius of "cannot turn it off" is worse than the cost of one boolean.

## Gate

- [x] All four `get it done` variants fire enrichment; the three existing controls still fire.
- [x] **Conversational noise does NOT fire an AI call** — the nine-case corpus above stays quiet.
      This corpus is a test fixture, not a comment; extend it whenever production shows a new one.
- [x] Temporal false positives still suppressed — `"let's discuss this week"`, `"ship that morning"`,
      `"send it monday"` behave exactly as today.
- [x] A pronoun with **no** scheduling trigger does NOT fire an AI call (preserves the 1.4.142
      hallucination guard).
- [x] `ShouldSuppressHypotheticalSubordinateReply` still suppresses
      `"I'll keep that in mind when I get to it"`.
- [x] **Multiple mentions in the prepended context do not hijack assignment** — *bounded, not
      eliminated, and pinned as a characterization test rather than papered over.* With two or more
      `<@U…>` in one antecedent the mentions fallback still assigns to **all** of them; that is
      pre-existing `reminder-ownership.js` behavior this issue does not change. What this work
      bounds is EXPOSURE: the channel collector returns **at most one** message (vs the thread
      path's three), so a second unrelated mention cannot be dragged in from a second message.
      Tests cover all three: two-mention → both assigned, single-mention → the real owner,
      no-enrichment → `sender-fallback` (the reported bug).
- [x] Channel lookback enforces participant continuity, is same-channel only, and is inert when the
      flag is unset — AI-call volume byte-identical to today.
- [x] `enrichedFrom` present on every enriched `ReminderCreated` event.
- [ ] The reported production case yields a reminder naming the actual task **and** resolving Vishal.
- [x] GH-44 decision-replay battery: no regression against the committed baseline.
- [x] Mutation-tested — reverting the generalization turns the new tests red.
- [x] Full suite green, `tsc` exit 0.

## Ownership is not free — it rides on the mentions fallback

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

## The GH-44 battery is a regression guard, not an improvement measure

The battery exercises **single-message routing with no thread context**, while this work fires only
when thread or channel context exists. So it can prove we did not **break** existing non-enriched
behavior — which is exactly what the gate uses it for — but it can never **show the improvement**,
because it never reaches the enrichment path at all.

Do not read a green battery as evidence the fix works. The improvement needs its own instrument: the
noise corpus and `get it done` variants above, and the reported production case. Treating a
regression guard as proof of improvement is the same error as trusting a check that cannot fail.

## Out of scope

Changing the analyzer prompt or schema. This work changes *what text reaches* the analyzer, never how
it reasons — which is what keeps the battery valid as a regression guard. Any prompt edit would
invalidate even that.

Also out of scope: cross-channel or DM antecedents, and any attempt to resolve an antecedent older
than the recency window.
