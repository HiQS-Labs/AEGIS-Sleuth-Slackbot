---
title: "Pronoun follow-ups schedule the literal sentence: the antecedent is never resolved, losing both the task and its owner"
status: Active (2-WORKING) — implemented and merged at 1.4.290 with the channel half default-OFF. Stays open: the milestone needs the flag armed and observed in production.
created: 2026-08-14
updated: 2026-11-12
owner: noel
goal: "When a follow-up refers to earlier work by pronoun, resolve the antecedent before scheduling, so the reminder records the real task and the real owner instead of the literal sentence — and record the resolution in the ledger so a wrong stitch is auditable rather than silent."
branch: gh-55-antecedent-resolution
doc_type: project
gh_issue: 55
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/55
release: 1.4.290 ("Antecedent")
related: "Not GH-43/GH-51 — those shorten long messages; this adds context to short ones. Uses the GH-44 replay battery as a REGRESSION GUARD only — it has no thread context, so it never reaches the enrichment path and cannot show the improvement. Generalizes the mechanism GH-424 introduced. Reuses the GH-43 grounding constraint in src/reminder-display-selection.js as the non-destructive guarantee."
context_tags: [extraction-fidelity, context-enrichment, ownership, thread-memory, blast-radius]
---

# GH-55 — resolve the antecedent before scheduling

## Status

| What was just completed | What's next |
|---|---|
| **2026-11-12: three-helper fix implemented; 532 focused tests and selected-model 3/3 replay pass. Final QA pending.** Historical phase: implemented and merged at 1.4.290. Both blockers cleared: verb-agnostic object-position detection, and the `thread_ts` gate lifted with participant continuity. `enrichedFrom` provenance reaches the ledger. 47 new tests, 5 mutations all caught, full suite 111/1908 jest + 116 node, `tsc` 0, PDDA at baseline. | **Run independent final QA, final qualification and PR publication.** Historical rollout remains separately unverified: arm `CHANNEL_ANTECEDENT_LOOKBACK_ENABLED` on one workspace and observe. The channel half — the half that fixes the reported case — is default-OFF, so the milestone is NOT met by the merge. Owner: noel. Then read `enrichedFrom` on real events for mis-stitches before arming more widely. |

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


## 2026-11-12 recipient-reference follow-up

### Scope and current state

Requested outcome: a short communication commitment referring to an adjacent plan should retain the communication action and recover its subject, rather than display a vague reply. This is a bounded continuation of open GH-55, related to GH-66/GH-77; it does not close the historical rollout milestone above. No new issue is needed. Existing public examples above are historical; this continuation publishes synthetic cases only.

Base: `7e9e58f1ec79abe92453fa96724734745e9fb4ac`. Task branch: `fix/AEGIS-Sleuth-Slackbot-gh55-antecedent-resolution-2026-11-12`. Fresh full clone, hooks installed, dependencies installed. This paragraph records the planning baseline; current results are below.

### Measured ground truth and recon map

- Read-only production decision evidence reported `enrichment=none`, synthesis on, title/span refused as `bare-pointer`, accepted verbatim, and `repair=none`. Raw message, IDs and server evidence remain private; no server modules or tests were run.
- Public deterministic baseline: [baseline probe](../../TESTS-RESULTS/2026-11-12+GH-55/baseline-probe.json). `Yes I'll tell them by tomorrow.` has no reference shape and normalizes to valid `Yes I'll tell them`. `I will tell it tomorrow.` requests context and normalizes to refused `Tell it`. A self-contained task and subject-position control request no context.
- Context origin: `IsObjectPositionPronounReference` in `src/reminder-context-resolution.js` admits only `it|this|that`. Automatic handler `TryEnrichVagueCompletionFromAboveAsync` exits before context fetch if `NeedsEarlierContext` is false. Existing resolver reads at most three preceding human thread messages, anchors at the live timestamp, excludes bots, neutralizes context markers, and preserves live reply/provenance.
- Display origin: `NormalizeReminderTitle` in `src/reminder-title-contract.js` strips commitment framing only at the start. An affirmative hides it; `HasConcreteObject` then counts framing words as object content. `SelectTaskTextRaw` accepts verbatim before existing repair; `#RepairRefusedTitlesAsync` only repairs fallback once through WorkspaceAI with source-grounded object/title checks.
- Dates/ownership/write path: `#TryScheduleRemindersAsync` uses analyzer `scheduling_trigger` alone for date extraction; first-person live reply owns the commitment. Common scheduling factory/FSM, persistence, feedback and ledger remain the sole writers. The same candidate feeds posted confirmation and stored task.
- Blast radius: detector shared by automatic, explicit/reaction depth, optional same-channel lookback and triage. Normalizer shared by all title candidates and API retitling. Preserve kill switches, bounded collection, source grounding, quoted task names, person-versus-thing distinction, deadline/date and owner contracts.
- Independent graph leads were confirmed in the task checkout; the available graph indexed a different checkout revision. Index coverage unknown. No exhaustive repository-wide audit claimed.

### Triangulate card and root-cause statement

**GROUND:** production took the unenriched path; isolated baseline demonstrates two deterministic gaps.
**FALSIFY:** hypothesis that the model ignored already-supplied context is contradicted by `enrichment=none`. Synthesis-off is contradicted by telemetry. Missing Slack pagination could independently matter, but this path exits before fetching; pagination is deferred, not asserted as this incident's cause.
**SMALLEST:** extend the existing object-pronoun detector and framing cleanup, then exercise the existing resolver, selector and one-repair path. Do not create a new reasoning subsystem.

Root cause: recipient `them` is absent from context admission and affirmative-prefixed commitment scaffolding survives normalization; Fix site: existing detector and title normalizer; Why not upstream/downstream: Slack delivery and model selection cannot recover context never supplied, and broadening repair or deterministic person replacement would bypass existing safeguards.

### Logic ladder and smallest viable bet

1. Recognize object-position `them` through the existing closed pronoun detector; retain subject/clause controls. Limit temporal-demonstrative exclusion to `this|that`, so `Tell them Monday` remains eligible.
2. Retrieve the existing bounded preceding thread context. Preserve the live reply as the authority for ownership and scheduling commitment.
3. Let the current analyzer resolve what is being communicated. Synthetic case: `Tell the vendor about the April downgrade`; notification deadline `tomorrow`; April is the change's effective month. Recipient and subject require supplied evidence.
4. Remove a leading affirmative only when it introduces already-recognized request/commitment framing. Then existing validation refuses unresolved `Tell them` and existing one-shot model repair may resolve it from context. Do not replace person pointers with thing objects.
5. Select, validate, ground and persist through the current common writer; verify confirmation and stored text agree.

Alternatives: changing model/prompt first cannot fix the demonstrated pre-model admission gap; a verb list repeats prior whack-a-mole; stripping every leading affirmative can damage a real task name; widening context or adding a new inference ladder increases unrelated-topic exposure. Strongest counterargument: `them` may be locally resolved inside a self-contained sentence, so it can cause an unnecessary bounded lookup. Existing bounds/switches remain containment; test self-contained and subject controls. No promise of universal topic resolution.

Non-goals: model/provider changes, prompt redesign, unbounded history, channel rollout/pagination work, production mutations/deployment, statuses/deadlines/owners/links edits, new persistent fields, new frameworks/runners/fuzzers. No server tests. No new paid-provider budget inferred from prior projects.

Rollback: revert the two helper changes; no migration. Existing thread-context and title-repair switches remain available containment. No new feature flag.

### Ordered implementation and falsifiable acceptance

- [x] Independent Codex plan QA, maximum three rounds; reviewer paraphrases this proposal before reading source, then validates against source-backed requirements.
- [x] Extend only existing detector/normalizer and existing test seams. Add focused positives and negatives; record pre-fix red and post-fix green output in this receipt directory. Reverting each runtime change must make its new regression fail.
- [x] Main-path integration: synthetic preceding `We should downgrade the vendor service plan for April`, `Should we tell them?`, live `Yes I'll tell them by tomorrow.` yields one scheduled reminder. Assert enriched model input, useful notification title in BOTH confirmation and persisted task, live author, tomorrow due date, original source and enrichment provenance. A mock tests plumbing only, never proves real synthesis quality.
- [x] Adjacent repair: affirmative-prefixed vague title/span/verbatim must reach existing one-repair path; accepted repair must be grounded. Missing context must not invent vendor/downgrade. Preserve existing `Ask them` != `Ask invoice` negative. Quoted names and affirmative task-name controls remain intact.
- [x] Subject `They will reply tomorrow`, scheduling-word controls, bot/future-message boundaries and disabled-thread switch preserve current contracts. Date extraction input must be tomorrow rather than April; owner/state/source unchanged by title cleanup.
- [x] Run focused context/title/display/integration suites, build, applicable validators and decision replay. Run bounded real-model handler replay locally with complete confirmation + stored output; report actual provider/settings and semantic outcome, never equate mocked output with real quality. If access or authorization is unavailable, mark that acceptance unverified and do not claim ready.
- [ ] Smoke main and adjacent path with receipts, independent final Codex QA (three-round cap), then final required repository gate and PR into development. No package version bump. Update CHANGELOG and issue closeout; historical GH-55 stays open. Final qualification not yet run.

### Rating and recurrence

2026-11-12 assessment: `rated 75/55/50/80` (priority/severity/neutral appeal/cheapness). A recoverable reminder can omit the actual task; no data loss or evidence of changed owner/deadline in this incident. User prioritizes fixing synthesis. Two existing pure helpers bound effort. One current incident observed; related old GH-55/GH-66/GH-77 are not counted as new incidents. Recent windows 2026-10-30–11-12 versus 2026-10-16–29 have incomplete incident coverage: trend unknown. No operator rank override.

Legacy ledger row `rmi-01M0XWWTRY5MGRN69J63G4WZSX` owns this exact doc/title but has no native issue number or URL. Preserve and rate it through the supported `--gid` writer; do not create a duplicate row or hand-edit DB identity. This limitation does not authorize schema or upstream tool changes.

### Experiment ledger and next action

1. Production read-only telemetry: context absent, synthesis active, vague verbatim survived; excludes synthesis-off and supplied-context-only hypotheses.
2. Baseline synthetic probe: missing `them` admission and affirmative normalization reproduced; controls distinguished.
3. Three independent read-only recon lanes corroborated caller, display and write/date/owner contracts. No implementation or provider run yet.

Next action: independent plan review, then implement only approved scope. Plan/final QA and real-model evidence remain pending.


### Plan amendment after real-model evidence (review round 2 requested)

Plan round 1 PASS/attested Approved, reviewed `2a2efbd`, receipt `96399fc`. Two approved helper changes implemented. Four focused suites: 311 passed; three adjacent suites: 168 passed; build and FSM/pipeline validators pass; deterministic decision replay 23 passed. Reverting context change made four targeted cases fail; reverting affirmative change made five fail. The initial red run had 8 test failures/2 controls passing and completed assertions, but its Jest process needed termination for an open handle; subsequent runs use the repo's `--forceExit` convention. No full final gate yet.

**New observed failure, not a successful quality result:** real end-to-end replay using the harness defaults `gpt-4o-mini` / `gpt-4o` passed only 2/3 scenarios twice. Main output was `Follow up: Downgrade the vendor service plan for April`. This is a local synthetic qualification, not production's mixed model configuration. Diagnostic output includes complete posted and stored surfaces, raw model answers, and tomorrow date extraction: [receipt](../../TESTS-RESULTS/2026-11-12+GH-55/real-replay-diagnostic.log).

The context fix worked: three preceding messages reached analysis. The analyzer returned `Inform the vendor about the service plan downgrade`; repair returned `Inform the vendor about the service plan downgrade for April`. Both were refused as ungrounded because the existing leading-imperative allowlist omits `inform`. Pure probe must confirm `UngroundedTerms` returns exactly `Inform`; quoted/body entity controls must remain strict. This is the same bounded shared-verifier seam as GH-318, not a reason to disable grounding. The initial analyzer title also omitted the effective month, keeping it only as context; an explicit instruction is needed if the title itself must preserve it reliably.

**Bounded amendment proposed, before implementation:**
1. Add only observed imperative `inform` to existing `ImperativeVerbs`; extend existing grounding/selector tests with the captured response and invented-entity/date/quoted/non-leading controls. Mutation-revert the one token and require the positive to fail. Do not exempt arbitrary first words or extend entity matching.
2. Add one concise communication-commitment rule to existing analyzer and one-repair instructions: keep the live communication action, resolve recipient/topic only from supplied context, retain a stated effective period that distinguishes the topic, and put only the communication deadline in scheduling_trigger. Use generic wording; no private examples. This is a targeted clarification, not a prompt redesign or new stage. Keep admission/exclusions, schema, providers, spend limits, ownership and writes unchanged.
3. Real replay's literal `tell` criterion is too narrow: `Inform`/`Notify` are valid paraphrases. Extend the EXISTING replay grader with optional `taskStartsWithAny` (accepted communication openings), and narrowly extend its EXISTING tests if present; otherwise a pure existing-seam check recorded in receipts, not a new suite. An unchanged failing fallback must fail this predicate, as must `Downgrade the plan`; empty output must still fail. Retain month/subject and no-fallback assertions. This improves measurement, not runtime logic. Subject/model uncertainty stays explicit.
4. Re-run the bounded actual-model main + self-contained + no-context cases locally with complete surfaces and provider identity; pin semantic checks to communication action/recipient/topic/effective month, live owner, tomorrow due date and stored/confirmation agreement. Prompt validation required. Preserve first failed results and report variability honestly. Full qualification still waits until final review.

Updated root cause: two pre-model/normalization gaps plus a demonstrated `Inform` false refusal and insufficiently explicit effective-period instruction. Fix sites remain existing detector, normalizer, grounding allowlist and two prompt assets; no new runtime subsystem, model switch or durable writer. Strongest counterargument: a one-word allowlist addition cannot guarantee all paraphrases and prompting is probabilistic; acceptance is bounded, failures remain red, and no universal reliability claim is allowed.

Paraphrase-first review applies again to this amendment, same three-round plan budget (round 2/3). Existing private/public separation and historical GH55-open status remain. Amendment not yet implemented.


### Retained implementation and final-review handoff

Plan amendment round 2 PASS/attested Approved (`b7437938` receipt). Implemented the three helper changes plus optional anchored replay-grader action openings. Two targeted Inform tests went red before the one-token fix, passed after, and failed again under its mutation. Eight focused suites now pass 532 cases (12 added cases in existing suites). Build passes. No new runtime modules, writer, provider client, fields or feature flag.

**Prompt disposition: removed, not shipped.** Two prompt variants failed the stricter main case on the default replay model; Luna passed with both modified and original prompts. Original-prompt main-only ablation 1/1 and retained-original-prompt full three-case run 3/3 provide no observed benefit for adding the rules. Both prompt assets equal base; no prompt or live model-setting change remains. This narrows the approved amendment; it does not silently claim its proposed prompt experiment succeeded.

Real qualification is bounded: local Luna analysis/repair with gpt-4o dates; last production observation used Luna/Sonnet. Explicit gpt-4o-mini replay failures stay recorded. Exact original private incident, live transport, production date provider, universal topic/recipient resolution and historical GH55 rollout are not claimed verified. Current useful title still conservatively says `them` where recipient identity is implicit. Default-model effective-month omission stays open. See [verification and experiment ledger](../../TESTS-RESULTS/2026-11-12+GH-55/verification.md) and complete output.

Current code decisions: context and affirmative changes **helped** under independent mutation; inform exemption **helped** under captured real response and mutation; prompt wording **no observed effect**, removed; cross-model result **confounded**, not a ranking. No root LESSONS-LEARNED entry (NO_ENTRY).

Final QA and full qualification remain pending. Final reviewer must assess whether bounded selected-model success plus explicit default-model limitations justifies the scoped PR; do not close GH55 or claim production fixed. No full suite has been run yet. Once final review approves, run the repo's qualifying CI commands once on the final artifact, publish only with truthful gate results, and leave the idempotent issue closeout.
