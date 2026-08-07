# Major Releases

Forward-looking planning ledger for major releases — one block per release, minimal fields, blank
line between blocks. Marathon plans and other forward planning cross-reference this doc for
target release names/dates; it is not a history of what shipped (that's CHANGELOG.md — lessons
learned belong there at ship time, not duplicated here). Contract lives in PROJECT/PDDA.md ->
"RELEASES.md — release ledger". Add new fields only when a real need shows up.

<!--test-->
Codename: "Test"
Release:
Front-door reviewed: No
Shakdedown reviwed: No
License file: No
Deadline: July 25, 2026
Description: FTest
<!--test-->

Codename: "Silverlining"
Release: TBD
Front-door reviewed: No
Shakdedown reviwed: No
License file: No
Deadline: July 25, 2026
Description: First public open source license

Release: 1.5.0
Iterations: 1.5.0-1.5.9
Status: Draft
Codename: "Ledger"
Milestone: The event log is the source of truth — mutable writes retired
Target Date:
GH_URL:
Front-door reviewed: No
Shakedown reviewed: No
License file: No
Description: Finish P3 Event-Sourced Core — the authority flip that has never happened.
  Today the log is written but never read as truth: 4 reminder-domain event types, 3 of
  ~10 modules dual-writing, 1 projection (summarize-week) shipped behind a default-OFF
  flag, no boot-time rebuild, and client/project mapping still a plain mutable store.
  Phases 0-2 are done and validated against real prod data — the GH-355 baseline import
  took the prod shadow-diff from 11 mismatches to 0, leaving only a documented +/-1ms
  completedMs divergence. So the remaining work is cutover and consolidation, not
  discovery.
  Done when: (1) SUMMARIZE_WEEK_COMPLETED_SOURCE=projection runs live on prod after the
  baseline import; (2) Phase 3 entity-linking read-model exists in code — today
  client-mapping.js references EventStore zero times; (3) Phase 4 rebuilds projections
  from the log at boot; (4) Phase 5 migrates the remaining projections; (5) Phase 6
  retires mutable writes.
  Phase 7 (fork unlock) is explicitly OUT of scope. Phases 4-6 keep their
  stop-and-re-decide checkpoint: reaching that checkpoint is a deliverable, not a gate to
  coast through. Step (1) alone is human-gated and could ship as 1.5.0 on its own.
  Plan: PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md

Release: 1.4.270
Iterations: 1.4.270-1.4.279
Status: Draft
Codename: "Roundup"
Milestone: Every open bug closed — correctness first, then the tooling that hides bugs
Target Date:
GH_URL:
Front-door reviewed: No
Shakedown reviewed: No
License file: No
Description: Clear the open-issue board. Three issues, deliberately ordered
  user-facing-correctness first, then the tooling that makes bugs hard to see.
  GH-22 (multiple reminder assignees) is the only user-visible defect: a reminder naming
  two people is persisted and indexed for the first mention only, while its confirmation
  claims both were scheduled, so the second person's `show-me` silently omits it. Plan
  exists (additive AssigneeIDs, legacy AssigneeID compatibility, membership-aware
  views/exports, per-user Slack List fan-out); implementation has not started.
  GH-25 (sanitize-scan.sh cannot run from a linked worktree) and GH-26 (RELEASES.md
  <!--test--> fixture errors every releases check, plus Codename absorbed by the preceding
  block) are both tooling defects that make other problems harder to see rather than
  breaking the product. GH-26 is what currently keeps `pdda.sh releases` from ever
  reaching errors=0, which in turn skips `pdda-doc-ready` entirely.
  Deliberately NOT included: the snapshot->Slack relay missing_scope failure (see
  PROJECT/2-WORKING/P2-SNAPSHOT-SLACK-RELAY.md). It is real and live since 2026-06-18, but
  the fix is a Slack app admin re-granting a file-upload scope — an ops action with no code
  change, so it cannot be a marathon phase.
  Done when: GH-22, GH-25 and GH-26 are closed, `pdda.sh releases` reports errors=0, and
  the full suite is green.
  Plan: PROJECT/2-WORKING/GH-22-MULTIPLE-REMINDER-ASSIGNEES.md