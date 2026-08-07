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