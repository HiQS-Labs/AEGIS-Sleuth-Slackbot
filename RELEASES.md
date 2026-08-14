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
Milestone: The log is authoritative for reminders, mutable writes retired, every switch still flips back
Target Date:
GH_URL:
Front-door reviewed: No
Shakedown reviewed: No
License file: No
Description: Take P3 Event-Sourced Core through the authority flip, for the reminders
  domain, behind reversible switches. Today the log is written but never read as truth:
  4 reminder-domain event types, 1 projection (summarize-week) shipped behind a
  default-OFF flag, no boot-time rebuild, and client/project mapping still a plain
  mutable store. Phases 0-2 are done and validated against real prod data — the GH-355
  baseline import took the prod shadow-diff from 11 mismatches to 0, leaving only a
  documented +/-1ms completedMs divergence. For PHASE 2 specifically the remaining work is
  cutover, not discovery — one human-gated prod flip. That does NOT generalise to the rest
  of the release: Phase 4 is blocked on event-schema discovery (see the scope check below),
  so "cutover, not discovery" describes the Phase 2 flag only, never Phases 4-6.
  Scope decision (operator, 2026-08-07): proceed aggressively through Phases 3, 4 and 5
  rather than stopping at Phase 3 — on the condition that every authority flip is a
  switch that can be flipped back. That condition is the gate now, replacing the earlier
  stop-and-re-decide checkpoint for these phases.
  SCOPE REALITY CHECK (2026-08-08, after the ledger-p3-entity-linking marathon):
  Phase 3 is DELIVERED — the entity-linking read-model (projection inputs, multi-signal
  scoring, canonical clustering, diagnostics CLI) is additive, tested, and touches no
  write path or authority boundary. Phase 4 is NOT reachable in this release as scoped:
  the ledger cannot reconstruct boot state, because ReminderCreated omits
  OriginalMessageID / OriginalThreadTs / OriginalSenderID / IgnoreSnooze, most lifecycle
  transitions are never emitted, ReminderCompleted lacks sourceChannelID / dueDate /
  clientId, and event-store.readAll() cannot signal a read error to trigger the required
  fallback. Phase 4 needs a schema-expansion proposal of its own FIRST. Phases 5 and 6a
  produced modules that convert no reads — their marathon lanes excluded
  src/reminders-module.js and src/web-api.js, so the work could not be integrated; the
  artifact lists are corrected. Of those two only PHASE 5 (p6) is re-runnable: Phase 6a
  is blocked with Phase 4, because its rollback criterion is "flip REMINDER_STATE_SOURCE
  off after running on the log", which needs the log-authoritative boot Phase 4 was to
  deliver, and that flag exists nowhere in src/. The reversibility drill asserts those
  same seams and waits with them. Runnable tranche for this release: Phase 3 (done) plus
  Phase 5's read cutovers. The reversibility drill
  correctly refuses to certify any switch that has no owning reader, which is how all of
  this was caught rather than shipped. Treat "the log is authoritative" as NOT YET MET.
  REVERSIBILITY CONTRACT — binding on every phase in this release:
  (a) every flip is an env var, default OFF, unset = today's behavior byte-for-byte;
  (b) mutable JSON writes CONTINUE at every phase, so the fallback is never stale;
  (c) any projection error falls back to the authoritative store, logged, never surfaced
      to the user — the pattern already shipped at reminders-app-mention-handler.js:1250;
  (d) each phase ships a TESTED rollback, not a claimed one: a test that flips the switch
      off and asserts correct behavior. A rollback path never exercised is not a rollback.
  (e) staged rollout, one workspace first, per the Phase 4 spec.
  Done when: (1) SUMMARIZE_WEEK_COMPLETED_SOURCE=projection runs live on prod after the
  baseline import; (2) Phase 3 entity-linking read-model exists — client-mapping.js
  references EventStore zero times today; (3) Phase 4 rebuilds reminder/completion state
  from the log at boot, behind a flag, with JSON still written as the escape hatch;
  (4) Phase 5 migrates _reminders.json, _completed.json and the rebalance export to
  folds, with a parity harness proving byte-compatibility before each cutover.
  (5) Phase 6a retires the MUTABLE write path — CompletionStore collapses into a
  projection, the bespoke durability queue and FlushAsync shutdown coupling are deleted,
  and snapshotting/compaction lands. The JSON keeps being produced, but as a DERIVED
  snapshot written through durable-write.js rather than by mutable in-place writes. That
  is what keeps it reversible: the fallback file stays fresh and legacy-loadable, so
  rollback is still a flag flip, while the old machinery is genuinely gone.
  HELD as its own later release — Phase 6b: dropping the derived writer entirely, so no
  on-disk fallback exists at all. That is the only genuinely one-way step in Phase 6, and
  it is separated out deliberately rather than bundled with the cleanup that does not need
  to be one-way. It should only be taken after 6a has soaked in production and snapshot
  restore has been exercised for real.
  Phase 7 (fork unlock) remains out of scope.
  Note on scope of the words "full event sourcing": P3 covers the REMINDERS/COMPLETION
  domain. chat, settings, stats, github-sync, notion and snapshot-relay emit no events and
  are not part of this release.
  Plan: PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md
  Marathon: PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE/MARATHON.yaml

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
Release: 1.4.280
Iterations: 1.4.280-1.4.289
Status: Draft
Codename: "Grounding"
Milestone: Every scheduled message yields a real quoted task span, not an empty one
Target Date:
GH_URL: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/51
Front-door reviewed: No
Shakedown reviewed: No
License file: No
Description: High-value correctness goal, and the unfinished half of the complex-message
  parsing work this session opened with. Measured against 30 days of production telemetry:
  128 of 216 scheduled messages (60%) log actionable_span_ratio=0 — the analyzer quoted NO
  actionable span for the message it had just decided to schedule. 48 of those are 400+
  characters; the largest is 6998. On every one of them the GH-43 buried-task gate is inert
  by design, because a zero ratio is absence of evidence rather than evidence of a buried
  task, so a very long note routes on sentence count alone.
  What already shipped, and why it is NOT this: GH-43 (1.4.273-274) fixed synthesis routing
  and ownership; GH-51 (1.4.277) fixed a rounding defect where toFixed(2) collapsed any span
  under 0.5% of the message to exactly 0, hiding the most deeply buried task of all. That
  rounding fix is real but explains AT MOST 1 of the 128 — the median zero-ratio message is
  241 characters, where nothing rounds away. The remaining ~127 are the analyzer returning an
  empty actionable_language. The schema already requires the field (strict: true), so the
  model is satisfying presence with "", and OpenAI strict mode has no minLength to forbid it.
  Deliberately NOT started by editing reminders-instructions.md on a hypothesis. The decision
  corpus wired in GH-50 (1.4.276) exists precisely so this can be diagnosed from real
  input/output pairs rather than guessed at — but it is default-OFF and carries raw tenant
  text with no rotation, cap, or expiry, so a retention policy is a hard prerequisite before
  it is armed anywhere real. That policy is currently unowned and unfiled.
  Done when: the ratio=0 share is explained with evidence rather than inference (schema,
  prompt, structural path, or a measurement bug); any extraction defect found is fixed with a
  regression test built from real production shapes; and the share is re-measured on
  production traffic with the before/after recorded.
  Plan: PROJECT/2-WORKING/ (to be written when the corpus is armed)

Release: 1.4.290
Iterations: 1.4.290-1.4.299
Status: Draft
Codename: "Antecedent"
Milestone: A follow-up that points at earlier work resolves what it points at, before anything is scheduled
Target Date:
GH_URL: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/55
Front-door reviewed: No
Shakedown reviewed: No
License file: No
Description: High-value correctness goal. When someone writes "can we get it done by
  Monday?", the reminder currently records that literal sentence — the task it points at is
  never read, and the owner is lost with it. Observed live 2026-08-14: a follow-up to
  "@Vishal please make the fast-search GH issue and work on it" scheduled the string "Can we
  try to get it done by end of day on Monday?" and assigned it to the sender rather than
  Vishal. Telemetry confirms the analyzer behaved correctly on the text it was handed
  (ratio_usable=yes, analyzer_owner=unclear, resolved_by=sender-fallback) — it was handed the
  wrong text.
  This is the inverse of GH-43/GH-51, which decide whether to SHORTEN a long message; here a
  50-character message needs context ADDED. The wrong assignee is the same root cause rather
  than a second defect: "can we get it done" has no grammatical subject to own, so ownership
  correctly fell back to the sender, and the real owner is only recoverable from the
  antecedent. Fixing the antecedent fixes ownership for free.
  Two blockers, both verified: enrichment is gated on thread_ts and these were top-level
  channel posts (enrichment=none is a hardcoded literal on the auto-schedule path), and
  "get it done" matches none of the three vague-reference patterns. Deliberately NOT fixed by
  adding a verb to the enumerated list — that list is documented in-code as a losing
  whack-a-mole (GH-424 needed two rounds and "see above" still slipped through). The general
  rule is grammatical: an unresolved pronoun plus a scheduling trigger means the task is
  elsewhere, whatever verb surrounds it.
  Phase 1 generalizes reference detection in-thread and is independently shippable. Phase 2
  adds channel-level lookback behind a default-OFF flag with a recency window, and is the half
  that fixes the reported case; it does not open until Phase 1's gate is green. Neither phase
  touches the analyzer prompt or schema, which is what keeps the GH-44 replay battery a valid
  measuring stick across both.
  Done when: GH-55 is closed, a pronoun follow-up in a monitored channel schedules the real
  task with the real owner, and the GH-44 battery shows no regression.
  Plan: PROJECT/2-WORKING/GH-55-ANTECEDENT-RESOLUTION.md
