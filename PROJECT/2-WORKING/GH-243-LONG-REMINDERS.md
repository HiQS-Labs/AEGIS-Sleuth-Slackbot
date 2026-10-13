---
title: "GH-243: long reminders — ignore automatic notes, synthesize explicit tasks"
status: Working (2-WORKING)
created: 2026-10-12
updated: 2026-10-12
owner: noel
doc_type: project
gh_issue: 243
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/243
branch: codex/AEGIS-Sleuth-Slackbot-gh243-long-reminders-2026-10-12
complexity: 2
risk: 2
effort: 2
phases: 3
goal: >
  Never paste long Slack messages into scheduled reminders; ignore them automatically and
  synthesize concise source-linked tasks only when explicitly requested.
---

# GH-243 — long reminders

| Most recently completed phase | What's next |
| --- | --- |
| Intake registered; production incident and prior fixes verified. | Recon map and surgical plan QA; implement Phases 1–2 only. |

## Operator requirements

- A long message means more than 500 characters, regardless of sentence or line count (operator choice 2026-10-12).
- Automatic detection ignores long messages. An incidental time word in a status report is not a deadline.
- Explicitly scheduled long reminders must be concise and link to the original Slack message/list; no full original blockquote, task bullet or failure fallback.
- Phase 3 stays deferred: @sleuth "what are scheduling options" returns three choices and accepts a typed choice.
- No merge, deployment, historical record rewrite or Phase 3 runtime implementation is included.


## Table of contents
- [Grounded scope](#grounded-scope)
- [Phase 1](#phase-1--conservative-admission-and-no-long-verbatim-text)
- [Phase 2](#phase-2--concise-explicit-reminders-with-source-links)
- [Phase 3 deferred](#phase-3--scheduling-options-deferred)
- [Verification and rollback](#verification-and-rollback)

## Grounded scope
Recon: [recon-gh243-long-reminders.md](recon-gh243-long-reminders.md).
Cell: irreversible x crossing -> full evidence floor, because stored presentation is consumed by exports.
Outcome: long notes stay out of automatic queues; explicit reminders are readable and retain source access.
Smallest bet: extend existing judgement, selection, composer and two explicit callers; no new scheduler.
Rejected: flags alone (live incident had synthesis on), truncation alone (loses task intent), another model
router or retry framework (existing manual extraction already supplies the capability).
Prior-art search: GH-337/43/68/143 fixed different earlier gates; this incident is verified on current
production. Open GH-51 is empty-span telemetry, not this full-source fallback. No overlapping open PR.
Source scope is newly created Slack-message reminders; authored Slack List rows and existing records excluded.

## Phase 1 — conservative admission and no long verbatim text
1. Define one shared >500 raw-character predicate in reminder-judgement. Auto admission and triage ignore
   long live messages before the model (use LiveText when enriched; context length alone must not suppress
   a short genuine commitment). Keep short tasks unchanged.
2. Remove the automatic post-model direct-ask override; keep its cheap detector for discovery hints.
   Model ignore remains ignore. Mark explicitly confirmed/task-above scheduling separately from force,
   since both currently pass force=false and must retain their date/dedup semantics.
3. Enforce safe display in the canonical selector for long original OR analyzed source: a grounded
   single-line title/span <=280 characters can display; oversized/missing/rejected output uses a
   neutral short source-reference fallback. No original-message fallback, even master/segment flags off.
   A fallback must not claim to be successful synthesis. Bound/suppress subordinate context too.
4. Composer omits long original blockquotes. Resolve mentions directly from original display source
   so assignee/notify sets do not depend on a discarded quote.
Acceptance: >500 auto message (including actual deadline) produces no analyzer call, record or confirmation;
500-char positive control still analyzed. Explicit long requests never contain a full source copy in
stored body/confirmation, including flag-off, oversize, invalid title and extraction failure.
Red controls: base auto fallback creates a record; base long force body/selector emits full source.
Replace existing tests that require these retired behaviors rather than silently disabling coverage.

## Phase 2 — concise explicit reminders with source links
1. Reuse ExtractManualReminderTaskAsync for long explicit force fallback regardless of legacy flags.
   Existing analyzer brief remains the usual title source; keep grounding and ownership.
2. Tighten current manual/analyzer prompt and schema descriptions to a <=280-character single-line
   imperative summary of requested work, including review/confirmation intent for a long plan/list.
   Do not list every background phase. Quoted task names remain exact only when safely short.
3. Add original-message link to confirmation using the permalink already built into the stored body;
   no extra model call or new source state. Persisted body and canonical delivered messages retain
   original channel/message identity. Null permalink gives a channel reference plus concise text.
4. Extend existing real replay with anonymized >500 list: automatic ignore, explicit alarm concise task,
   correct assignee/source link/no full original. Grade complete bullet blocks and full stored/post bodies
   so multiline source below a short first bullet cannot escape.
Acceptance: same long plan via automatic event ignored, via explicit scheduling creates grounded concise
task (e.g. Review the handoff plan and confirm alignment) linking original source; shared ownership,
snooze, FSM, reaction metadata and short everyday reminders remain intact.
Red control: base confirmation lacks source link and full stored quote fails source-copy assertion.
Existing task-above and confirmed-proposal callers remain functional without bypassing the gateway.

## Phase 3 — scheduling options (deferred)
User tags @sleuth and asks "what are scheduling options"; offer exactly three clear choices, then accept
typed choice in the same thread and schedule through the existing gateway. Future work must define
what those three options mean, expiry/cancel behavior, ownership, duplicate choice handling and explicit
confirmation. No route, proposal store, model call or catalog/help entry is implemented now.

## Verification and rollback
Focused existing suites: reminder judgement corpus, AI pipeline, decision capture, selector, integration,
task/context, app-mention, quoted-text, ownership and compact display.
Extend existing suites/scenarios only; no new framework, CI lane, fuzzing or speculative tests.
Run build, AI prompt validation, decision replay, FSM/isolation/render guards, full npm test once on
approved final implementation, PDDA checks, then final independent Codex relay QA and ready PR.
Real model replay: existing temporary-data harness; no Slack posts, no raw tenant fixture. Record any
unrelated pre-existing scenario failures honestly, and require new project scenarios to pass.
Startup smoke only with isolated data/no production tokens. No live production write/deploy.
Rollback by reverting this PR; new concise bodies remain compatible with readers. Historical bodies
remain untouched. Ignore-long behavior is an intentional detection change and explicit force remains.
Stop on any ownership, snooze, schema or workspace-isolation regression.

## Task rating — 2026-10-12
PRS rated 75/55/50/70: recurring display class and operator priority; unreadable/spurious reminders are
recoverable, no observed corruption/loss; neutral appeal; bounded existing-helper implementation.
Recent window 2026-09-29–10-12 vs prior 2026-09-15–28: one distinct verified incident this session;
searched related issues/PRs, no measured increase established. Trend unknown, not zero.
Phase 3 remains deferred under this one project, not a hidden active task or separate speculative build.

## QA and execution ledger
- Intake GH-243, isolated full clone/base 40a911a, branch recorded in frontmatter.
- Operator chose >500 characters only, rejecting sentence/line threshold for this project.
- Parent reproduction: model ignore override and full enriched source confirmed; summary flag already on.
- Plan review pending. Implementation not started.
