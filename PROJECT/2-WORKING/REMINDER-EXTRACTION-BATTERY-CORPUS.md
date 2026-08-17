---
title: "Reminder extraction battery corpus — before/after scenarios for GH-43"
status: COMPLETE
created: 2026-08-10
updated: 2026-08-10
owner: noel
goal: >
  The scenario set GH-43 is measured against; the executable copy lives at
  tests/fixtures/decision-scenarios/reminder-extraction-battery.json.
roadmap_exempt: true
doc_type: reference
gh_issue: 43
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/43
companion: "GH-43-REMINDER-EXTRACTION-FIDELITY.md (the plan this corpus measures)"
---

# Reminder extraction battery corpus

The scenario set [GH-43](GH-43-REMINDER-EXTRACTION-FIDELITY.md) is measured against. Each scenario
is a Slack message (or short thread) with a stated expected outcome on three axes: **recommendation**
(schedule/ignore), **owner** (who the reminder is assigned to), and **task text** (what the bullet
should say).

## Status

| What was just completed | What's next |
| --- | --- |
| Grown 15 → 20 scenarios during GH-43 execution; every baseline captured, no row still `TBD`. The battery reports **20 PASS** against the shipped fixes and goes red under perturbation of any single mechanism. | Add the counter-example the ratio ceiling still lacks (a long message that should stay verbatim) if prod telemetry produces one — see GH-43's open items. |

## Status of this file

**Resolved 2026-08-10 (GH-44 Phase 6).** Phase 0 Q5 is answered: the harness reads a machine copy at
`tests/fixtures/decision-scenarios/reminder-extraction-battery.json`, and **that file is now the
source of truth** for scenario text, recorded responses, and expectations. This doc is the readable
companion — the rationale for why each scenario exists — and must not be edited as if it were the
data. Run the battery with `npm run decision:replay`.

**Grown 15 → 20 during GH-43 execution (1.4.273).** The five additions are described here but their
data lives only in the JSON. Each exists because a mechanism was otherwise **unfalsifiable** — the
battery could not tell whether it worked:

| Scenario | Why it was added |
|---|---|
| `S-16` | A long unpunctuated note with **no quoted span**, so the buried-task ratio is unusable by design and the newline sentence rule is the only thing that can route it. Without this, disabling the newline rule failed nothing and it looked like dead code. |
| `S-17` | **Adversarial**, thread path: the recorded response assigns to a user who is not an author and is not mentioned anywhere. |
| `S-18` | **Adversarial**, single-message path: `owner_mentions` names a user absent from the message, which the intersection must narrow away. |
| `S-19` | Grammatically **ambiguous** — an address block with no first- or second-person marker. The deterministic rules cannot reach it; only the analyzer's `owner` verdict can. |
| `S-20` | **Adversarial** grounding: the synthesized title and context name a system and a figure the author never wrote. |

The baseline is no longer `TBD` anywhere — every row is captured in
`tests/fixtures/decision-scenarios/baseline.json`.

## How to read the baseline column

`Baseline` was what the pipeline did **before GH-43's fixes**, captured from unmodified `development`
HEAD rather than reasoned out. Baselines are **captured, never hand-authored**: filling one in by
reading the source would make the whole before/after comparison circular — the harness would be
validated against the same reasoning it is supposed to check.

> **The `TBD — Phase 0` markers in the per-scenario tables below are historical.** They were never
> filled in by hand, on purpose. The captured values live in
> `tests/fixtures/decision-scenarios/baseline.json`, which is regenerated with
> `npm run decision:replay --update-baseline` and is the only place to read a real before/after.
> Treat the `Expected after` column here as the intent and the JSON as the measurement.

## Placeholders

| Token | Meaning |
|---|---|
| `<@U_SENDER>` | the person who posted the message |
| `<@U_ALPHA>`, `<@U_BETA>` | other humans in the channel |
| `<@U_BOT>` | Sleuth itself (must never be an assignee) |

## Coverage map

| Axis | Scenarios | Guarding against |
|---|---|---|
| Reported case | S-01 | all three defects at once |
| Ownership | S-02 … S-06 | Defect 3; S-03/S-06 are regression guards |
| Synthesis gate | S-07 … S-11 | Defect 1; S-08/S-09/S-11 are regression guards |
| Task/context split | S-12, S-13 | Defect 2; S-13 is a regression guard |
| Negative controls | S-14, S-15 | the fixes must not manufacture work |
| Falsifiability (added during GH-43) | S-16 … S-20 | a mechanism that cannot be shown to fail — see the five-row table above |

Six of the original fifteen are **regression guards** — cases that already behaved correctly. A change
that fixes S-01 while breaking S-06 is not a fix. The five added later are the mirror image: cases
that must go RED when a shipped guard is disabled, so a guard that silently stops working cannot pass
as green.

---

## S-01 — Reported case: address block + status report + first-person commitment

**Targets:** Defects 1, 2, 3 · **Sender:** `<@U_SENDER>`

```
<@U_ALPHA> <@U_BETA> root cause: The weekly photo-request system could only ever see a small,
fixed batch of photos, and once it emailed about a plant once it never checked it again.
Over time that batch got fully used up, so the system had nothing left to send.
We fixed it so the scan now covers all photos, and plants can be re-requested after
enough time has passed. Emails will resume for every yard after the next deployment
i am going to deploy the changes tomorrow morning
```

| | Baseline (observed in prod) | Expected after |
|---|---|---|
| Recommendation | `schedule` ✅ | `schedule` |
| Owner | `[U_ALPHA, U_BETA]` ❌ | `[U_SENDER]` |
| Task text | entire message, verbatim, one line ❌ | short imperative, e.g. *"Deploy the photo-request scan fix"* |
| Context | none — fused into the bullet ❌ | one line, rendered separately |
| Trigger | `tomorrow morning` ✅ | `tomorrow morning` |

Note the sentence count is **3** (the last two lines have no terminal punctuation), which is what
routes it to the non-synthesizing segment. Any fix that only raises or lowers the sentence threshold
without addressing unpunctuated lines will still miss this message.

---

## S-02 — Address block, then a direct ask to one of the mentioned people

**Targets:** Defect 3 · **Sender:** `<@U_SENDER>`

```
<@U_ALPHA> <@U_BETA> heads up, the staging box is back.
<@U_ALPHA> can you run the smoke tests tomorrow morning?
```

| | Baseline | Expected after |
|---|---|---|
| Owner | `TBD — Phase 0` | `[U_ALPHA]` only — `U_BETA` was addressed, not asked |
| Recommendation | `TBD — Phase 0` | `schedule` |

Distinguishes "mentioned in the address block" from "named in the ask". The current regex cannot
tell these apart.

---

## S-03 — First person, no mentions at all (regression guard)

**Targets:** Defect 3 · **Sender:** `<@U_SENDER>`

```
I'll deploy the changes tomorrow morning.
```

| | Baseline | Expected after |
|---|---|---|
| Owner | `TBD — Phase 0` (expected `[U_SENDER]` via the empty-mention fallback) | `[U_SENDER]` — unchanged |
| Task text | `TBD — Phase 0` | unchanged from baseline |

This already works. It must stay byte-identical.

---

## S-04 — Self-commitment plus a delegation in one message

**Targets:** Defect 3 · **Sender:** `<@U_SENDER>`

```
I'll write up the migration notes tonight, and <@U_BETA> please review them by EOD tomorrow.
```

| | Baseline | Expected after |
|---|---|---|
| Owner | `TBD — Phase 0` | two tasks: write-up → `[U_SENDER]`; review → `[U_BETA]` |

The hardest ownership case, because owner varies **per candidate**, not per message. If the schema
change in Phase 1B cannot express this, say so explicitly rather than silently collapsing it — a
documented limitation is acceptable, a silent wrong answer is not.

---

## S-05 — Mention as a subject reference, not an assignee

**Targets:** Defect 3 · **Sender:** `<@U_SENDER>`

```
<@U_ALPHA> found the root cause in the cron job. I'll patch it tomorrow morning.
```

| | Baseline | Expected after |
|---|---|---|
| Owner | `TBD — Phase 0` | `[U_SENDER]` — `U_ALPHA` is the subject of a past-tense clause |

Not covered by the leading-address-block rule (the mention *is* first, but it is the grammatical
subject of a sentence, not an address block). Tests whether 1A alone is sufficient or 1B is required.

---

## S-06 — Genuine shared assignment (regression guard, GH-22)

**Targets:** Defect 3 · **Sender:** `<@U_SENDER>`

```
<@U_ALPHA> <@U_BETA> can you both test the new release tomorrow morning?
```

| | Baseline | Expected after |
|---|---|---|
| Owner | `TBD — Phase 0` (expected `[U_ALPHA, U_BETA]`) | `[U_ALPHA, U_BETA]` — unchanged |

**The most important regression guard in the corpus.** A leading-mention heuristic that is too
aggressive breaks GH-22 shared assignment. The distinguishing signal is the second-person ask
("can you both…"), not mention position.

---

## S-07 — Long unpunctuated note with a small buried task

**Targets:** Defect 1 · **Sender:** `<@U_SENDER>`

```
quick update on the billing sync we spent most of the week tracing why invoices were
duplicating turns out the retry handler was not idempotent so a timeout would replay the
whole batch we have a patch in review now
i'll ship it tomorrow morning
```

| | Baseline | Expected after |
|---|---|---|
| Sentence count | `TBD — Phase 0` (0 terminal marks → floor of 1) | newline-aware count ≥ 4 |
| Synthesis | `TBD — Phase 0` (expected off) | on |
| Task text | `TBD — Phase 0` | short imperative, e.g. *"Ship the billing-sync retry patch"* |

The pure form of Defect 1 with no punctuation at all, exercising the `CountSentences` floor.

---

## S-08 — Short, clean, already-actionable message (regression guard)

**Targets:** Defect 1 · **Sender:** `<@U_SENDER>`

```
Deploy the hotfix tomorrow morning.
```

| | Baseline | Expected after |
|---|---|---|
| Task text | `TBD — Phase 0` | unchanged — verbatim |
| LLM calls for synthesis | `TBD — Phase 0` (expected 0) | **0** |

Asserts the cost guard, not just the text. The per-segment force-schedule gate exists specifically
so short messages do not spend a model call; a ratio-based gate must not quietly undo that.

---

## S-09 — Long, properly punctuated note (regression guard)

**Targets:** Defect 1 · **Sender:** `<@U_SENDER>`

```
Finished the audit today. The connection pool was leaking on every failed handshake.
I patched it locally and the leak is gone. Tests are green on my branch.
I will merge and deploy it tomorrow morning.
```

| | Baseline | Expected after |
|---|---|---|
| Sentence count | `TBD — Phase 0` (expected 5) | ≥ 5 |
| Synthesis | `TBD — Phase 0` (expected on) | on — unchanged |

The case the current threshold already handles. It must keep working when the gate changes.

---

## S-10 — Long note with no actionable task (negative control)

**Targets:** Defect 1 · **Sender:** `<@U_SENDER>`

```
Post-mortem summary. The outage started at 02:14 and lasted 40 minutes.
Root cause was a bad DNS entry pushed by the provider. They have rolled it back.
No action needed on our side, sharing for visibility.
```

| | Baseline | Expected after |
|---|---|---|
| Recommendation | `TBD — Phase 0` (expected `ignore`) | `ignore` |

A more permissive synthesis gate must not turn an FYI into a task. This is the failure mode the
Phase 2 change most plausibly introduces.

---

## S-11 — Quoted task name (regression guard)

**Targets:** Defect 1 · **Sender:** `<@U_SENDER>`

```
I need to work on "On-going Project: Yard Photo Backfill" tomorrow morning.
```

| | Baseline | Expected after |
|---|---|---|
| Task text | `TBD — Phase 0` | contains `"On-going Project: Yard Photo Backfill"` verbatim, quote marks included |

Guards the CRITICAL quoted-text rule at
[reminders-instructions.md:90](../../data/static/ai/reminders-instructions.md#L90) against any
synthesis change.

---

## S-12 — Root cause plus commitment, context worth keeping

**Targets:** Defect 2 · **Sender:** `<@U_SENDER>`

```
Found it — the nightly export was writing to the old bucket after the migration,
so nothing downstream saw the new files. Fix is a one-line config change.
I'll roll it out tomorrow morning.
```

| | Baseline | Expected after |
|---|---|---|
| Task text | `TBD — Phase 0` | *"Roll out the export bucket config fix"* |
| Context | `TBD — Phase 0` (expected: none) | one line, e.g. *"nightly export was writing to the old bucket post-migration"* |
| Blockquote | full original | full original — unchanged |

The positive case for the split: context that is genuinely useful tomorrow morning, but does not
belong in the bullet.

---

## S-13 — Multi-step commitment (regression guard)

**Targets:** Defect 2 · **Sender:** `<@U_SENDER>`

```
Can you please review the Development branch and if it's safe push to Production this morning?
```

| | Baseline | Expected after |
|---|---|---|
| Task text | `TBD — Phase 0` | retains **both** review and push — not compressed to the last verb |

Guards the anti-over-compression rule at
[reminders-instructions.md:85-86](../../data/static/ai/reminders-instructions.md#L85). A title
synthesizer under length pressure is exactly what breaks this.

---

## S-14 — Past-tense completion (negative control)

**Targets:** cross-cutting · **Sender:** `<@U_SENDER>`

```
<@U_ALPHA> <@U_BETA> I deployed the changes this morning, all green.
```

| | Baseline | Expected after |
|---|---|---|
| Recommendation | `TBD — Phase 0` (expected `ignore`) | `ignore` |

Same address-block + first-person shape as S-01, but past tense. Confirms the ownership work keys on
*commitment*, not merely on first-person pronouns.

---

## S-15 — Weak acknowledgment (negative control)

**Targets:** cross-cutting · **Sender:** `<@U_SENDER>`

```
<@U_ALPHA> I'll keep that in mind when I get to that plugin.
```

| | Baseline | Expected after |
|---|---|---|
| Recommendation | `TBD — Phase 0` (expected `ignore`) | `ignore` |

Guards the weak-acknowledgment exclusions at
[reminders-instructions.md:67](../../data/static/ai/reminders-instructions.md#L67).

---

## Maintenance

Add a scenario whenever a real extraction failure is reported — the corpus is the durable record of
what "correct" means for this pipeline, and a bug that is only fixed in code will regress. Keep the
placeholder user IDs; never paste real workspace names, client names, or user IDs into this file.
