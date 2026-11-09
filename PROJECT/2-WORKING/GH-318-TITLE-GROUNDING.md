---
title: Preserve useful grounded reminder titles
gh_issue: 318
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/318
status: In Progress
created: 2026-11-09
updated: 2026-11-09
owner: Codex
goal: Preserve valid synthesized titles without permitting invented factual entities.
doc_type: bugfix
effort: 2
complexity: 2
risk: 2
phases: 1
roadmap_exempt: true
---

# GH-318 — Title grounding

PR: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/pull/319 (development). This plan remains active until landing.

## Status

| What was just completed | What's next |
|---|---|
| Implementation, double QA and branch comparisons complete; PR published | Review and merge PR separately; latest hosted checks and readiness are on the PR |

## Requirements and smallest viable bet
Source `I am working on a list of publicly indexable reference URL for you later today` with candidate `Compile a list of publicly indexable reference URLs` currently rejects Compile/URLs and can select a generic fallback. Extend existing src/task-grounding.js only: add compile to the bounded leading ImperativeVerbs set; let an ASCII uppercase acronym followed by lowercase plural s (URLs, APIs) use existing whole-token plural matching. Keep ordinary capitalized proper nouns (Teams), quoted strings, dates, figures and invented identifiers checked. No global first-word exemption or general proper-noun plural tolerance. No prompt, model, admission, CRUD, persistence/FSM, server, deploy or framework changes.

## Recon and evidence
Base: 6c5576ecb5bdce9085433a995ab2d97a5ed828b1. src/reminders-module.js calls reminder-display-selection.js and reminder-title-contract.js; both consume UngroundedTerms from task-grounding.js; refused candidates can reach bounded model repair and generic fallback. Context-line grounding shares the same helper, so preserve its controls as well. IsBareProperNoun currently classifies URLs as a capitalized bare name, disabling the existing plural tolerance. ExtractGroundedTerms only exempts recognized opening verbs; compile is absent. Source, candidate and final selected text must be observed separately; stronger raw drafts alone do not prove the saved output improved.
Public prior art #68/#69 already widened grounding to analyzed context; current defect remains with identical source context and different token classification. #250/#316 cover broader title/evaluation work, not this specific token bug. Recent 14 days versus preceding14: one distinct newly observed incident from frozen local replay; older #68 is a different context defect; no established increasing incident rate. Full recurrence coverage unknown.

The task is registered in the RELEASES roadmap. `roadmap_exempt` suppresses the legacy ROADMAP.md-only coverage check, which does not read this repo's canonical DB. The intake redirect preserves the registered pointer.

## Rating rationale (2026-11-09)
PRS rated 75/55/50/85: user-selected priority, recoverable loss of title specificity with original source retained, appeal neutral, bounded existing-rule edit and focused coverage. No operator override. PDDA size/risk fields are distinct planning metadata.

## Plan and falsifiable acceptance
1. Add synthetic cases to existing tests/task-grounding.test.js and existing selector/contract suites. Witness red for Compile and URL→URLs; positive source nonempty. Control invented first noun Acme, Teams from team, made-up acronyms/numbers/dates/quoted entities, substring lookalikes, and nonleading Compile. Keep acronym singular/plural matching whole-token and do not disable grounding.
2. Make the two small changes in the canonical helper. Run focused grounding, analyzed-context, display-selection and title-contract tests; synthetic main smoke must preserve useful final title and adjacent invented entity must still be refused. Record commands/red-green evidence in TESTS-RESULTS/2026-11-09+GH-318 using synthetic data only.
3. Repeat the exact frozen nine real cases × six model/prompt settings locally on this branch, reusing existing replay harness/settings/historical clock/native effort and source hashes, new bounded $5/200-attempt/30min run. Compare prior baseline and branch raw/selected/saved outputs, input equality, admission and repair/fallback/cost. Retain causal unknowns/excluded tenth case, no title hints/future turns. Private full results/changelog/readable before/after remain in private tracker; public receipt aggregate/data-agnostic only. Provider availability/isolation errors stop that run without substitution or resetting bounds. Full original live Slack ingress/Lists/delivery remain untested. Prefer retained original API responses as an additional deterministic check so stochastic generation cannot get mistaken for a code effect.
4. Build, applicable validators and final required full test gate on final code; final independent QA; ready PR into development. No version bump, merge or production promotion. Keep failed/pending checks truthful.

## Alternatives and rollback
Prompt-only wording avoidance rejected: valid outputs still hit the shared check. Broad lexicon or blanket proper-noun exemption rejected: larger mechanism or unsafe acceptance. A bounded rule extension reuses current ownership. Revert the code/test commit to restore old classification; no data migration or live write. All real evaluation data stays private.

## Review questions
Is the ASCII plural-acronym exception sufficiently narrow while preserving Teams/quoted/temporal/identifier controls? Does existing selector coverage prove the user-visible result rather than raw title alone? Is any parallel subsystem introduced? Grade against this small shared pure-function edit, not speculative architecture. Writes restricted to relay thread; no production edits or full test suite in review worktree.
