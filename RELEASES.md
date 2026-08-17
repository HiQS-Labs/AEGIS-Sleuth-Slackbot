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
Status: Closed — concluded 2026-08-09 WITHOUT the authority flip, by decision
Codename: "Ledger"
Milestone: SUPERSEDED — the log is deliberately NOT authoritative; it is a non-authoritative
  projection/research substrate, and that is the settled end state
Target Date:
GH_URL: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/35
Issues: (none open) — #35 P3 Phase 5 close-out, CLOSED
Version NOT consumed: 1.5.0 was a forward RESERVATION for a minor-version-worthy capability
  (the log becoming authoritative). That capability was declined, so 1.5.0 was never spent —
  zero 1.5.x entries in CHANGELOG.md, and this repo has zero git tags, so versions exist only
  as CHANGELOG headings. 1.5.0 is therefore FREE for whatever genuinely earns a minor bump.
  The P3 work itself shipped incrementally through the 1.4.2xx line and closed at 1.4.270 —
  which is why this block's number reads higher than releases that came after it. It is
  aspirational, not chronological.
Issues frozen: 2026-08-14. This block was STALE and is corrected here. It read Status: Draft
  with a milestone of "the log is authoritative", describing work that had already been
  consciously declined. Do not re-open it as a goal without the product decision below.
Front-door reviewed: No
Shakedown reviewed: No
License file: No
Description: CORRECTED 2026-08-14. P3 Event-Sourced Core is COMPLETE — Phase 5 closed out
  2026-08-09 (PROJECT/3-COMPLETED/P3-EVENT-SOURCED-CORE.md). Phases 0-3 delivered: the
  append-only per-workspace ledger, the reminder-domain event types, the projections, the
  entity-linking read-model, and the GH-355 baseline import that took the prod shadow-diff
  from 11 mismatches to 0.
  The authority flip did NOT happen, and that is a DECISION rather than an unfinished task.
  Generation-binding of the coverage marker was FALSIFIED: a crashed append writes nothing
  to the ledger, so no ledger-derived quantity can distinguish "no append was attempted"
  from "an append was lost" — and completeness is exactly what serving a projection
  requires. The two candidate read surfaces were also found to gain migration confidence
  but no latency or scale benefit. So the ledger is retained as a NON-AUTHORITATIVE
  projection/research substrate: not audit-grade, and explicitly not a deferred authority
  migration waiting for a later release.
  This is enforced in CODE, not merely config. src/reminders-projection.js blocks all four
  projection flags (REMINDERS_READ_SOURCE, COMPLETED_READ_SOURCE, REBALANCE_EXPORT_SOURCE,
  SUMMARIZE_WEEK_COMPLETED_SOURCE) at compile time, because config alone left a live path
  from a routine parity-harness run straight to a production cutover with no deploy and no
  review. REMINDER_STATE_SOURCE is absent from src/ by design, not by omission.
  WHAT WOULD RE-OPEN IT: a named product consumer plus a fresh proposal — a product
  decision, not an engineering gap. Anyone reading this block as pending engineering work
  is reading it wrong; #56 was filed on exactly that misreading on 2026-08-14 and closed
  the same day as invalid.
  Doc-hygiene item this exposed, NOT fixed here: PROJECT/2-WORKING/P3-EVENT-SCHEMA-EXPANSION.md
  is still in 2-WORKING though its parent closed into 3-COMPLETED, and its `related:` still
  points at the parent's old 2-WORKING path. That orphan is what made this release look live.
  Plan: PROJECT/3-COMPLETED/P3-EVENT-SOURCED-CORE.md (moved from 2-WORKING; the old path
  cited here previously no longer existed, which was the drift signal)
  Marathon: PROJECT/3-COMPLETED/P3-EVENT-SOURCED-CORE/MARATHON.yaml

Release: 1.4.278
Iterations: 1.4.278-1.4.279
Band corrected: 2026-08-14. Originally reserved 1.4.270-1.4.279, but EIGHT of those ten
  slots were spent on unrelated work before any Roundup issue shipped — 1.4.270 on the P3
  close-out, then .271 GH-37, .272 the public-reference sanitize, .273 GH-44, .274 GH-43,
  .275 GH-48, .276 GH-50, .277 GH-51. ZERO Roundup issues have shipped. The band now states
  the two slots that actually remain rather than implying ten. Four issues in two versions
  is fine: a single version routinely carries several (1.4.274 carried all four GH-43 phases).
Status: Draft
Codename: "Roundup"
Milestone: Every open bug closed — correctness first, then the tooling that hides bugs
Target Date:
GH_URL: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/26
Issues: #25, #26, #39, #41
Issues frozen: 2026-08-14. Reconciled against the live board rather than the original
  description: #22 CLOSED (shipped 1.4.264, PR #29) and removed. #40 CLOSED on this date —
  the changelog parser now reads the top heading correctly, verified. #42 CLOSED on this date —
  vendored harness synced to 824d9388417c and validate.sh verified green (145 suites, 2327 pass,
  0 fail, 198/198), after a first run's exit 0 turned out to carry no verdict line at all. #39 and #41 were open and
  assigned to NO release; both are "tooling that hides bugs", which is this release
  milestone verbatim, so they are frozen in here rather than left orphaned.
Front-door reviewed: No
Shakedown reviewed: No
License file: No
Description: Clear the open-issue board of the tooling that hides bugs. RECONCILED
  2026-08-14 — this release originally read as "three issues, correctness first"; that is
  no longer what it is. GH-22 (multiple reminder assignees), the only user-visible defect
  it carried, SHIPPED in 1.4.264 via PR #29 and is closed. What remains is entirely tooling
  — four checks and one script that are broken in a way which makes OTHER problems harder
  to see. That is now the whole point of the release, so the milestone reads honestly.
  The unifying defect: a check that is always red, always warning, or silently skipping
  teaches people to ignore it, and then it can never signal the condition it exists for.
  GH-39 (`validate:commands` permanently red on development — ask-reminders is registered
  dynamically and invisible to the static scan) and GH-41 (`validate:ai` silently skips any
  prompt asset missing from its hardcoded EXPECTED_PAIRS map, so a new prompt pair is
  unvalidated until someone remembers to add it) are the two worst, because both fail
  SILENTLY in the direction of false confidence. Both were open and assigned to NO release
  before this reconciliation.
  GH-26 (RELEASES.md <!--test--> fixture errors every releases check, plus Codename
  absorbed by the preceding block) is the highest-leverage of the four and is this
  release's anchor: it is what keeps `pdda.sh releases` from ever reaching errors=0, which
  in turn skips `pdda-doc-ready` ENTIRELY. Note that `utils/pdda/*` is synced from a
  canonical PDDA repo, so the fix must be pushed upstream or the next `pdda-sync.sh push`
  overwrites it. GH-25 (sanitize-scan.sh cannot run from a linked git worktree —
  `[ -d .git ]` is false when .git is a file) blocks running the secret/PII gate locally
  before pushing; CI is unaffected, so the cost is a slower feedback loop, not an exposure.
  Closed during this reconciliation, with evidence, rather than carried as open scope:
  GH-40 (changelog parser misread) — the parser now reports the top heading's date exactly,
  and the warning that remains is the check correctly signalling a missing entry. GH-42
  (vendored .xyz harness stale) — synced to 824d9388417c; every /relay-xyz QA in this repo
  had been running on stale harness code until then.
  Deliberately NOT included: the snapshot->Slack relay missing_scope failure (see
  PROJECT/2-WORKING/P2-SNAPSHOT-SLACK-RELAY.md). It is real and live since 2026-06-18, but
  the fix is a Slack app admin re-granting a file-upload scope — an ops action with no code
  change, so it cannot be a marathon phase.
  Done when: GH-25, GH-26, GH-39 and GH-41 are closed; `pdda.sh releases` reports errors=0
  and `pdda-doc-ready` actually runs; `validate:commands` and `validate:ai` are green and
  provably able to FAIL (a check that cannot fail proves nothing); and the full suite is
  green.
  Plan: PROJECT/2-WORKING/GH-26-RELEASES-PARSING.md
  Sequencing note: Roundup ships FIRST (1.4.278-279), before Grounding (1.4.280) and Antecedent
    (1.4.290). Deliberate — GH-39 and GH-41 are the checks that would otherwise let a defect in
    those two releases pass unnoticed. Fix the instruments before running the experiments.
Release: 1.4.280
Iterations: 1.4.280-1.4.289
Status: Draft
Codename: "Grounding"
Milestone: Every scheduled message yields a real quoted task span, not an empty one
Target Date:
GH_URL: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/51
Issues: #51
Issues frozen: 2026-08-14.
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
Status: In Progress — code merged at 1.4.290 with the channel half default-OFF; the release closes
  when the flag is armed and the milestone is observed in production, not on merge.
Sequencing deviation: 2026-08-14. Roundup's note below says Roundup ships FIRST. It did not — GH-55
  was implemented and merged before any Roundup issue shipped. Recorded rather than quietly
  renumbered, because this is the NINTH consecutive version slot to go to work outside the release
  that reserved it. Antecedent took 1.4.290 from its OWN band precisely so it did not become the
  ninth theft of Roundup's: 1.4.278-1.4.279 remain unspent and Roundup's band is intact.
  The sequencing rationale ("fix the instruments before running the experiments") does not apply
  here — GH-39/GH-41 are RELEASES/changelog parsing checks, and nothing in this work was verified
  by them. It was verified by its own instrument: a 9-case noise corpus and five mutations.
Codename: "Antecedent"
Milestone: A follow-up that points at earlier work resolves what it points at, before anything is scheduled
Target Date:
GH_URL: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/55
Issues: #55
Issues frozen: 2026-08-14.
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
  antecedent. Fixing the antecedent fixes ownership — but NOT "for free", as an earlier draft of
  this block claimed: ownership rides on reminder-ownership.js's mentions fallback, which assigns to
  EVERY mention it finds. It resolves correctly in the reported case only because the enriched block
  happens to carry exactly one. Enrichment therefore changes the input to the ownership resolver,
  which is a second-order effect of a change framed as "text only".
  Two blockers, both verified: enrichment is gated on thread_ts and these were top-level
  channel posts (enrichment=none is a hardcoded literal on the auto-schedule path), and
  "get it done" matches none of the three vague-reference patterns. Deliberately NOT fixed by
  adding a verb to the enumerated list — that list is documented in-code as a losing
  whack-a-mole (GH-424 needed two rounds and "see above" still slipped through). The general
  rule is grammatical: an unresolved pronoun plus a scheduling trigger means the task is
  elsewhere, whatever verb surrounds it.
  Shipped as ONE change set, not two gated phases. The two-phase split was removed on operator
  review as ceremony for a single-maintainer project, and its stated justification — containing the
  blast radius of a false positive — did not survive checking against the code: GH-43's grounding
  constraint (reminder-display-selection.js) already DISCARDS a synthesized title naming anything
  absent from the source, so a false positive costs one AI call and a possibly noisy context line,
  not a wrong reminder. The one risk that does survive is mis-stitching, because enrichment WIDENS
  the grounding source — which is what participant continuity exists to contain.
  Nothing here touches the analyzer prompt or schema. That keeps the GH-44 battery valid as a
  REGRESSION GUARD — but not as a measuring stick: it exercises single-message routing with no
  thread context, so it never reaches the enrichment path and cannot show the improvement. A green
  battery is not evidence this works.
  Done when: the flag is armed in production, a pronoun follow-up in a monitored channel schedules
  the real task with the real owner, `enrichedFrom` is present on those events, the GH-44 battery
  shows no regression, and GH-55 is closed. NOT met by the 1.4.290 merge: the channel half — the
  half that fixes the reported case — is default-OFF until an operator arms it.
  Plan: PROJECT/2-WORKING/GH-55-ANTECEDENT-RESOLUTION.md
