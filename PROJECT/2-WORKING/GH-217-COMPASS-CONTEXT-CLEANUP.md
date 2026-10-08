---
title: "GH-217: Remove redundant Compass evidence and thread reads"
status: working
created: 2026-10-08
updated: 2026-10-08
owner: Codex
goal: "Avoid duplicate model evidence and Slack reads while respecting hands-free stop controls."
gh_issue: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/217
branch: fix/compass-context-cleanup
---

# Compass context cleanup

## Status

| What was just completed | What's next |
|---|---|
| Two fixes and focused/mutation checks pass | Final review, full gate and PR |

## Recon and scope

Base: `72d60c98e042ed75f7868712c3eeaf27604643dd`; follow-up to GH-215/PR-216.
The prior three-lane recon found no duplicate ingestion, RAG or persistent context system. This task fixes two local redundancies only.

- `src/product-compass.js:166-224`: each subsequent model call serializes raw `Result.passages` plus citation `Sources`; `Sources[].Passage` duplicates the raw passage. Renderer at 176-193 consumes Id/Title/Link/Excerpt only. Remove the unused property; retain source evidence and citation fields.
- `src/chat-module.js:2046-2083,2718-2755,3016-3024`: complete hands-free reads pass their array to RunCompass. An incomplete read instead fetches the first page, derives reaction state from it and returns undefined context; RunCompass refetches. `src/slack-app.js:851-870` permits five pages then throws `context-incomplete`. Thus up to 5+1+5 reads. An unseen stop reaction may be missed.
- Smallest safe resolution: in the existing incomplete-history catch, return `ShouldRespond: false`. No first-page fallback and no handoff/refetch; unread reaction history cannot authorize an automatic reply. Explicit mentions still use RunCompass's existing incomplete-context refusal. Complete mapped threads and ordinary non-mapped threads keep their existing behavior.
- No state writer changes: uploaded-file Map/JSON, shared GatherThreadContext and WorkspaceAI are reused unchanged. No MCP/PC server modifications.

Graph: only the older task clone is indexed (generation 2026-10-08T02:29:43Z); search yielded the prior ShouldRespond/GatherThreadContext, two results with no remainder. Coverage marked chat/slack metadata_changed and Compass module/test not_tracked. Exact current source reads above supersede stale graph. Previous ask-self orientation failed without Cloudflare credentials. No live cost/Slack/PC benchmark; those remain unknown and unnecessary for this source-level fix.

## Solution fit and risks

Outcome: one raw passage payload per result and at most one bounded read for a hands-free event. Scope: two production files, existing pipeline canary and necessary docs. Delete rather than add; no new API/result shape, cache, summarizer, framework, persistence, dependency or CI suite/job.

Rejected alternative: pass an incomplete flag to post a refusal automatically. It saves reads but still cannot honor unread stop reactions. Raising the page cap or adding a second reader does not fix the discarded outcome.

Behavior change: oversized automatic threads go quiet, including attachment/model-identity shortcuts downstream of the existing gate. Users can explicitly mention Sleuth for its existing start-a-new-thread response. This is intentional fail-closed gating, not claiming complete thread context. Blast radius: mapped-channel automatic replies only; evidence cleanup applies to Compass searches. Undo class easy: revert the two edits, no migration. Shield: existing mapping opt-in; no new flag. Unexpected errors retain existing Error in ShouldRespondToMessageAsync logging. Debug-mantra governs reproduce, trace, falsify and cross-check; known context limit is an expected suppression, not an infrastructure error.

## Ordered work and acceptance

- [x] Obtain independent plan approval before production edits (three rounds maximum).
- [x] Extend the existing first pipeline canary to assert raw passage retained once and Sources has no Passage, preserving rendered excerpt/citation. Observe failure with current duplicate property.
- [x] Replace the existing oversized-thread canary with real SlackApp paging through mocked conversations.replies: five pages plus an unread stop beyond cap, no automatic message, no MCP/model work, exactly five API reads. Explicit mention still refuses once after five reads. Observe failure against the old fallback.
- [x] Remove the unused Passage property; return false in the incomplete-context catch. Keep complete-history reuse and later-page stop checks green in the existing canary.
- [x] Run focused Compass tests and build; reintroduce each defect separately to verify its regression assertion fails. Restore fixed sources.
- [ ] Update changelog and document the automatic-thread limit. Final independent review followed by one final full repo test gate, build and focused PDDA check. Push and open PR into development; verify hosted checks. Do not merge/deploy here.

Test non-scope: no new suite files, synthetic runner, fuzzer, CI jobs, new live credentials, or unrelated reminder replay (reminder context is unchanged). Existing mock canary verifies plumbing/payload counts; it cannot certify actual model answer quality or live SaaS authorization.

## Rating and recurrence

2026-10-08 UTC RELEASES assessment: rated 55/45/50/85 (priority/severity/appeal/cheapness); no override. Waste and possible unwanted refusal are source-confirmed, not data loss or a live outage. Small local deletion makes effort cheap; appeal neutral. Issue-title review for 2026-09-24–10-07 versus 2026-09-10–23 identified the original GH-215 feature but no separate same-class reports. One source discovery; comments/reopenings/metrics not exhaustive, trend unknown. Ledger read-back will establish the stored rating.

## Verification and QA

Plan QA: round 1 source PASS was rejected by the driver for rewriting its template; round 2 appended its findings correctly and received attested Approved (driver exit 0) on `6393fc8`. No substantive findings or scope additions. `docs/web-api.md:564` already specifies silent hands-free suppression for incomplete history; the fix restores that documented contract. Retain clone until PR landing is verified; no deployment claim is part of this task.

Implementation evidence (2026-10-08 UTC): initial combined red run had exactly two failures (unexpected Sources.Passage and 11 vs five Slack calls); fixed focused suite passes all five cases. Reintroducing each original production file separately fails exactly its targeted test (four others excluded by the test-name filter). Sources were restored after each probe. `npm run build` passes. Test fixtures call the real SlackApp reader with mocked pages; this is not a live Slack cost measurement. Existing `docs/web-api.md:564` already describes the restored behavior, so no duplicate doc edit is needed. Logs retained locally under temp/gh217-*.log.

Final QA round 1: production changes and canaries accepted; Changes Requested for stale ledger doc_path after plan promotion. Implemented with the existing roadmap repoint verb (raw_text update alone does not change doc_path). Corrected premature changelog wording. Optional pre-existing wrench-triage omission of octagonal_sign is deferred outside GH-217: no runtime repro, and not needed for either fix. PDDA frontmatter reports 12 existing findings in unrelated unchanged files, none in this plan. Final full gate remains pending.
