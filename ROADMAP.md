---
title: Sleuth Roadmap
status: Legacy — frozen 2026-08-26 (ROADMAP_SOURCE=releases)
created: 2026-06-21
updated: 2026-08-07
branch: development
goal: >
  FROZEN. Kept for history and for utils/marathon-plan.sh's still-direct parsing of the Ledger
  section below (not yet repointed at the DB — see ROUTER.md's "RELEASES DB" section). New
  intake and current state live in the RELEASES DB: park with
  `python3 utils/py/releases_app.py roadmap add`, read via ROADMAP-DASHBOARD.md or
  `releases_app.py roadmap list`. Do not hand-edit this file.
---

# Sleuth Roadmap

> **FROZEN — legacy file, do not edit.** Since the `ROADMAP_SOURCE=releases` flip (`.pdda-mode`,
> 2026-08-26), `releases.db` is the roadmap's source of truth. Read current state at
> [ROADMAP-DASHBOARD.md](ROADMAP-DASHBOARD.md) or `python3 utils/py/releases_app.py roadmap list`;
> park new intake with `releases_app.py roadmap add`. See `ROUTER.md` -> "RELEASES DB" for the full
> contract. This file is kept only because `utils/marathon-plan.sh` still parses its Ledger section
> directly and has not yet been updated for releases-mode.

## Now / Next

| In progress | Next |
|---|---|
| **10-day GH-issue triage batch shipped 2026-07-17 (v1.4.235)** — GH-365/367/393/399 closed, docs in `3-COMPLETED`; GH-366 P2.2 shipped, P2.3/P2.4/Phase 3 remain. **Full PDDA doc-hygiene sweep same day** reconciled 7 more stale docs/issues that had shipped but were never closed out (GH-337, GH-383, GH-387, GH-388, the near-miss doc, task-bucketing) — all closed/archived; ROADMAP pointers and a changelog-check regex bug fixed. GH-397 (Flash-Lite router) confirmed shipped + active on prod (`neochrome`), issue stays open as an ongoing data-collection deliverable. | **GH-366 P2.3 (digest wiring)** needs its own preflight contract before it's marathon-ready. **P3 read-path cutover decision** — steps 1-2 done; only step 3 remains: flip `SUMMARIZE_WEEK_COMPLETED_SOURCE=projection` (human-gated, not assumed). `P2-RESCHEDULE-REMINDER.md` and `sleuth-product-strategy-brief.md` retired 2026-07-17 (operator call, moved to `4-MISC`). **Live prod bug found 2026-07-17:** the snapshot→Slack relay's file-attachment path has been silently failing with `missing_scope` since at least 2026-06-18 — see `P2-SNAPSHOT-SLACK-RELAY.md`. |

## Ledger

<!-- Section names/bullet style below match the xyz-3-agents-swarm ledger convention
     (utils/marathon-plan.sh parses "### Queue / parked intake" / "### In progress" /
     "### Completed" / "### Deferred · vision" + a **bold** leading title) so the roadmap
     can feed that tool directly. Same content as before — reformatted, not rewritten. -->

### In progress

- **OCR follow-ups: intent grammar, resolver action split, catalog entry, wiring cleanups
  (GH-73/74/75/76)** — branch `gh-73-ocr-followups`. The GH-58 OCR feature, repaired in 1.4.293
  (#62/63/64), still mis-routed the production request "make a todo list for by OCRing the
  attached image" to the text-files-only rejection: `HasListCreationIntent` required `list`
  immediately after verb+article, so the modifier "todo" broke every alternation. One branch closes
  all four graded follow-ups: widen the grammar and split the resolver result into `image-list`
  vs `image-text` so scan-only requests stop after extraction (#73, Codex-refined), add an explicit
  `make-list-from-image` catalog entry + route instead of mirroring phrases into mismatched
  entries (#74), constructor-inject ListsModule into ChatModule (#75), and deduplicate the seven
  OCR failure-post blocks into a posting-only helper (#76). →
  [PROJECT/2-WORKING/GH-73-OCR-FOLLOWUPS.md](PROJECT/2-WORKING/GH-73-OCR-FOLLOWUPS.md)

- **The 2026-08-18 `development` QA fixes (GH-94, GH-95, GH-96)** — **planned; plan built,
  preflighted ready, dry-run clean, not fired.** An independent GLM 5.3 review of `development` at
  `11d9e4e` surfaced one blocking defect and two coverage gaps. GH-94: presentation jitter runs
  before the past-date rollover, so an anchor within 45 minutes of "now" fires today or tomorrow
  depending on `Math.random()` — a residual of #87 that #87's own invariants cannot observe. GH-95:
  the #91 command-router fallthrough matches raw text while the router routes normalized text, so a
  normalization-dependent command plus an attachment is still unreachable. GH-96: three user-facing
  error posts never call `BuildErrorReportAsync`, so #88's "one system" is not yet true. Two
  unticketed phases ride along — coverage for the #76/#88 merge seam (untested today: reverting
  `#FailOcrAsync` to a bare post leaves the suite green) and the missing #91 CHANGELOG entry. Five
  phases, `agy` reviewing, `codex` building. →
  [PROJECT/2-WORKING/MARATHON-2026-08-18-DEV-QA/MARATHON.yaml](PROJECT/2-WORKING/MARATHON-2026-08-18-DEV-QA/MARATHON.yaml),
  [PROJECT/2-WORKING/GH-94-JITTER-ORDERING.md](PROJECT/2-WORKING/GH-94-JITTER-ORDERING.md),
  [PROJECT/2-WORKING/GH-95-FALLTHROUGH-NORMALIZATION.md](PROJECT/2-WORKING/GH-95-FALLTHROUGH-NORMALIZATION.md),
  [PROJECT/2-WORKING/GH-96-DIAGNOSTICS-BYPASSES.md](PROJECT/2-WORKING/GH-96-DIAGNOSTICS-BYPASSES.md)

- **Pronoun follow-ups schedule the literal sentence (GH-55)** — **planned, not started; release
  goalpost 1.4.290 ("Antecedent").** "Can we try to get it done by end of day on Monday?" was
  scheduled verbatim, with the task it points at never read and the owner lost with it — observed
  live 2026-08-14 following "@Vishal please make the fast-search GH issue and work on it", and
  assigned to the sender instead of Vishal. Telemetry shows the analyzer behaved correctly on the
  text it was handed (`ratio_usable=yes`, `analyzer_owner=unclear`, `resolved_by=sender-fallback`);
  it was handed the wrong text. **The inverse of GH-43/GH-51** — those shorten a long message, this
  adds context to a 50-character one — and the wrong assignee is the same root cause, not a second
  defect, since "can we get it done" has no grammatical subject to own. Two verified blockers:
  enrichment is gated on `thread_ts` (these were top-level channel posts; `enrichment=none` is a
  hardcoded literal on the auto-schedule path) and "get it done" matches none of the three
  vague-reference patterns. Deliberately **not** fixed by adding a verb — that list is documented
  in-code as a losing whack-a-mole. Phase 1 generalizes reference detection in-thread and ships
  independently; Phase 2 adds channel-level lookback behind a default-OFF flag with a recency
  window and does not open until Phase 1's gate is green. →
  [PROJECT/2-WORKING/GH-55-ANTECEDENT-RESOLUTION.md](PROJECT/2-WORKING/GH-55-ANTECEDENT-RESOLUTION.md)

- **Five entry paths each decided context independently (GH-143)** — **SHIPPED to production
  2026-08-28**, release "Antecedent". The successor to GH-55 above, and the reason that entry's
  Phase 2 could not be finished as written: enrichment was not one gate to widen but five separate
  ones. A thread reply "can do, I'll work on it today" scheduled verbatim and was assigned to the
  person who ASKED rather than the one who committed, because it arrived through a door that did no
  lookback at all — which is why an earlier fix looked deployed and changed nothing.
  `src/reminder-context-resolution.js` is now the single answer to "what earlier context exists",
  with no admission flag: each door enforces its own admission before calling, and lookback depth
  follows from the message rather than the caller. Reviewed by three independent models (GLM 5.3
  Flash, Codex over three rounds, agy); every finding fixed or answered with a reason. Also adds
  `utils/reminder-replay.js`, an offline harness that runs real events through the real pipeline and
  a real model call — every defect here had passed the full unit suite, which stubs the model.
  **Known ceiling: extraction is nondeterministic** — the same thread can yield different task sets,
  and one observed run reproduced the original defect shape.
  → [#147](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/pull/147),
  [#149](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/149) (follow-up umbrella)

- **Span-ratio rounding hides the most deeply buried tasks (GH-51)** — **release goalpost 1.4.280
  ("Grounding")** for the open remainder. `DescribeSynthesisRouting`
  rounded the actionable-span ratio with `toFixed(2)` **before** the buried-task gate read it, so any
  span under 0.5% of the message collapsed to exactly `0` and `SpanRatioUsable` read that as "no span
  was quoted at all". A 35-character commitment quoted from a 7,000-character note — the most deeply
  buried task there is, and precisely what the gate exists to catch — was classified as having no
  evidence of a buried task. The gate failed hardest where it mattered most. Fixed by deciding on the
  raw ratio (`LongestSpan > 0` for usability, raw comparison against the ceiling) while keeping the
  2dp **reported** value so telemetry format is unchanged. Mutation-tested; 1852 jest / 116 node.
  **Measured, not assumed:** against 30 days of production telemetry this explains **at most 1** of
  the 128 zero-ratio messages — the median is 241 chars, where nothing rounds away — so
  **issue #51 stays open** for the ~127 empty-`actionable_language` cases, blocked on the GH-50
  corpus. →
  [PROJECT/2-WORKING/GH-51-SPAN-RATIO-PRECISION.md](PROJECT/2-WORKING/GH-51-SPAN-RATIO-PRECISION.md)

- **Anchor the jest globs so the merge gate stops crying wolf (GH-48)** — `testMatch` was unanchored
  (`**/tests/**`), so jest collected the partial snapshots the relay harness writes to
  `.tick/orphan-backups/<utc>-<pid>/` when its containment reverts a file mid-turn. Those copies hold
  a test file without its sibling `src/`, so they can never resolve and always fail — `npm test` broke
  on an unpredictable schedule with a suite unrelated to the change, twice during GH-37. Both globs
  (`testMatch` and `collectCoverageFrom`) are now anchored to `<rootDir>`. Verified with the orphan
  backup still on disk: 109 suites / 1849 tests green, no suite lost. →
  [PROJECT/2-WORKING/GH-48-JEST-TESTMATCH-ANCHOR.md](PROJECT/2-WORKING/GH-48-JEST-TESTMATCH-ANCHOR.md)

- **Arm the decision corpus in production (GH-50)** — GH-44 built the capture path end to end and
  never connected it: `SetDecisionCapture` had **zero callers outside tests**, so no decision record
  was ever written in any deployed environment. The corpus was dead code that passed its own tests.
  Found while diagnosing a production mis-render where the only post-hoc evidence was a single,
  deliberately lossy journald line. Capture is now wired at pipeline construction behind
  `DECISION_CAPTURE_ENABLED` (**default off** — records carry raw tenant text) with an optional
  `DECISION_CAPTURE_WORKSPACES` allowlist, mirroring the GH-397 router-shadow convention. Blocks
  GH-51, which needs input→output pairs. **Retention policy is a prerequisite before arming
  anywhere real.** →
  [PROJECT/2-WORKING/GH-50-WIRE-DECISION-CAPTURE.md](PROJECT/2-WORKING/GH-50-WIRE-DECISION-CAPTURE.md)
- **Reminder extraction fidelity (GH-43)** — **all 4 phases built in 1.4.273 on
  `gh-43-reminder-extraction-fidelity`; awaiting review/merge.** Fixed the three defects one
  production message exposed at once. Ownership now reads the **grammatical subject of the
  commitment** rather than scraping mentions, so a first-person commitment belongs to its author and
  the people it was addressed to become `NotifyIDs` instead of assignees. Synthesis routing gained a
  newline-aware sentence count and a **buried-task ratio gate**, so a long note with a small buried
  task no longer dumps the whole message into the bullet. `context` is a distinct field rendered
  subordinately, and a **grounding constraint** enforced in code lets the display title be rewritten
  only within the source's vocabulary while `actionable_language` stays byte-exact. Reconciling the
  two ownership paths exposed that the thread extractor's "Never invent users" prompt rule was never
  enforced; both paths now share one code-level guard. Measured, not asserted: the GH-44 battery went
  **4 FAIL / 11 PASS on unmodified `development` → 20 PASS**, and every mechanism is proven load
  bearing by a perturbation test that turns the battery red when it is disabled. GH-22 shared
  assignment intact (guard: S-06). Stacked on `gh-44-decision-capture-debug` (needs its harness).
  See `PROJECT/2-WORKING/GH-43-REMINDER-EXTRACTION-FIDELITY.md`.

- **Unified AI decision capture, replay + debugging (GH-44)** — **all 6 phases built in 1.4.272 on
  `gh-44-decision-capture-debug`; awaiting review/merge.** Consolidated the three partial
  implementations rather than adding a fourth: `router-shadow-store` generalized into
  `decision-corpus-store` (prod filename and its 22 tests untouched), capture + a `Validate` hook
  inside `DecideAsync`, reminder analysis *and* the thread multi-task extractor migrated onto
  `AiDecisionSpec`, `:wrench:` promoted to a decision-agnostic explain surface showing routing and
  ownership, and `npm run decision:replay` as the one thread-aware replay/diff harness. No prompt,
  schema, or model changes — the multi-task prompt moved to a `data/static/ai` asset byte-identically
  and is now covered by `validate:ai` for the first time. agy relay QA closed `Approved` at r3/3.
  GH-43 Phase 0 consumes this: the battery reports its 4 known defects RED against a committed
  baseline. See `PROJECT/2-WORKING/GH-44-DECISION-CAPTURE-DEBUG.md`.

- **sanitize-scan.sh cannot run from a linked worktree (GH-25)** — the public repo's secret/PII gate
  dies with `FATAL: … is not a git repository` (exit 2) in any `git worktree`, because
  `utils/sanitize-scan.sh:80` tests `[ -d .git ]` and `.git` is a *file* in a linked worktree. CI and
  DeployHQ are unaffected (`actions/checkout` makes a real `.git/`), so the cost is that the gate
  cannot be run locally before pushing. One-line fix (`git rev-parse --git-dir`); the fail-closed
  exit-2 contract must be preserved. Preflight **ready**. Phase p2 of the "Roundup" marathon. →
  [PROJECT/2-WORKING/GH-25-SANITIZE-SCAN-WORKTREE.md](PROJECT/2-WORKING/GH-25-SANITIZE-SCAN-WORKTREE.md)

- **RELEASES.md fixture error + Codename absorption (GH-26)** — `pdda.sh releases` has never reported
  `errors=0`: a leftover `<!--test-->` fixture with an empty `Release:` keeps it red, which also
  causes `pdda-doc-ready` to be skipped entirely. Second defect in the same file: a block's fields
  are attributed to the *previous* block when they precede its own `Release:` line, so
  `Codename: "Silverlining"` attaches to the fixture — observed live when a new block rendered as
  `1.5.0 ("Silverlining")`. Worked around in PR #23 by appending last; the trap is still there and is
  silent. Fix is delete-the-fixture plus a warn when a field precedes `Release:`. **Note:**
  `utils/pdda/*` is synced from a canonical PDDA repo, so the check change must be pushed upstream or
  the next `pdda-sync.sh push` overwrites it. Preflight **ready**. Phase p3 of "Roundup". →
  [PROJECT/2-WORKING/GH-26-RELEASES-PARSING.md](PROJECT/2-WORKING/GH-26-RELEASES-PARSING.md)

- **DM support gates (GH-412)** — a plain 1:1 DM to Sleuth today silently no-ops: reminders gates on
  a per-channel enabled-Set that defaults empty, and chat's hands-free mode requires `thread_ts` (a
  DM's first message is always top-level). Root cause traced to a plumbing gap — `MessageEventInfo`
  doesn't carry Slack's own `channel_type` field — plus the two gates themselves. Slack app config
  (scopes/events/Messages Tab) is already correct; this is pure conversational-behavior code.
  **All 3 phases built 2026-07-17** (`channel_type` plumbed through + both gates bypass for true
  1:1 DMs only, group DMs untouched). **`/consult`-QA'd (agy + Codex)** — both independently found
  and confirmed two real bugs (threaded DM follow-ups silently ignored; DM messages with a mention
  silently dropped), both fixed by reordering the DM check to run first, unconditionally. 1495/1495
  tests green incl. 8 new regression tests. Follow-up **GH-413** (admin DM-reminders kill switch)
  filed and parked, deliberately deferred. **Not yet committed/pushed** — awaiting operator
  go-ahead. → [PROJECT/2-WORKING/GH-412-DM-SUPPORT-GATES.md](PROJECT/2-WORKING/GH-412-DM-SUPPORT-GATES.md)

- **Operator-managed Clients Slack List — wiring + backfill (GH-396)** — shipped dormant in 1.4.229
  (`refresh clients` had no `ListId`/`Columns` to read). **Never parked in this ledger at the time —
  found and back-filled during this PDDA sweep 2026-07-17.** Wired live 2026-07-17: manually sharing
  a human-created Slack List to the bot hit a Slack UI wall (*"Sending messages to this app has been
  turned off"*), so Sleuth created its own List instead (`slackLists.create` + self-grant, the same
  mechanism `ListsModule` uses for per-user reminder lists) — sidesteps the wall and returns real
  `column_id`s directly. Created list `F000EXAMPLE1` in `neochrome`, added the `ClientsList` config
  block, then did a first-pass backfill (6 rows: Client F repo-pattern extension + 5 new clients —
  Client E, WP DB Toolkit, WP Code Check, Rebalance OS, AI-DDTK) sourced from local
  `git-pulse` history, deliberately leaving ~16 older/ambiguous repos for a human pass. Permission
  model (the bot's `lists:write` scope was never the blocker — Slack Lists have a separate
  per-resource ACL) documented in `ARCHITECTURE.md`'s `operator-clients-list` manual section.
  `tests/client-mapping.test.js` + `tests/refresh-clients-command.test.js` green (52). **Not yet
  merged** — open PR [#416](https://github.com/NeochromeTeam/sleuth-app/pull/416), issue
  [#396](https://github.com/NeochromeTeam/sleuth-app/issues/396). → [CHANGELOG.md](CHANGELOG.md)

- **P2 snapshot→Slack relay** — forwards `/snapshot` output into private `#repo-snapshots` via Sleuth. **Re-verified live 2026-07-17 via direct SSH to prod** (commit 0615d427/v1.4.232, service running current code): `SNAPSHOT_RELAY_WORKSPACES=neochrome` → channel `C000EXAMPLE3` (#repo-snapshots), the only enabled workspace/channel pair. **Live bug found (not fixed here):** the file-attachment path has failed with `missing_scope` on every attempt since at least 2026-06-18 (~1 month) — the text summary always posts, the actual snapshot content never has. Needs a Slack app admin to re-grant the bot's file-upload scope. → [PROJECT/2-WORKING/P2-SNAPSHOT-SLACK-RELAY.md](PROJECT/2-WORKING/P2-SNAPSHOT-SLACK-RELAY.md)

- **"Make Sleuth smart" marathon (GH-360 / GH-361 / GH-362)** — a 6-lane marathon that ends the "compute → render → discard" pattern: stamp client/project identity at creation + operator-defaults config (**#361 A**), `ask-reminders` over live authoritative data (**#361 B**), whole-thread multi-task inference (**#360**), durable deterministic-first project map (**#361 C**), deterministic proactive digest signals (**#362 P1**), then **p6 — an end-to-end net-improvement acceptance test** (`tests/marathon-360-361-362-e2e.test.js`) proving p1-p5 actually connect (data one phase persists is data a later phase reads), not just that each ships in isolation. Cross-model consult (Codex + agy) adjudicated + folded in. Ordered dependency chain, not a concurrency wave. **SHIPPED + merged to main 2026-07-13 (`marathon.complete`, v1.4.212 line); docs closed out to `3-COMPLETED` 2026-07-14.** All 6 lanes green incl. p6 e2e. **Caveat:** only GH-362 **Phase 1** shipped; GH-362 Phases 2 & 3 deferred → **GH-366** (in progress, `feat/gh-366-proactive-phases-2-3`). → [GH-361](PROJECT/3-COMPLETED/GH-361-CONNECT-THE-DOTS.md) · [GH-360](PROJECT/3-COMPLETED/GH-360-MULTI-MESSAGE-INFERENCE.md) · [GH-362](PROJECT/3-COMPLETED/GH-362-PROACTIVE-LAYER.md)

### Queue / parked intake

- **ask-code hands-free thread-sticky routing (GH-137)** (2026-08-25) — `ask-code <slug> <question>`
  is stateless; every follow-up in a thread requires retyping the slug. Needs a sticky-session store
  keyed on `channel:thread_ts` with a bounded exit (idle TTL / explicit stop), so a later unrelated
  reply in the thread can't get silently proxied to a remote RAG endpoint. See
  `PROJECT/1-INBOX/GH-137-ASK-CODE-HANDS-FREE.md`.

- **Runtime state is bound to the install directory (GH-86)** — `Workspaces.GetRuntimeDirPath()`
  falls back to `__dirname/../data/runtime`, so moving the install moves the whole runtime tree.
  Production has two of them and they disagree: `/root/sleuth-app-v3` (live) holds 11 enabled
  channels, the dead `/root/sleuth-app` holds 10 from 2026-08-11. Presents to a user as "the
  reminders toggle reset itself after a deploy" — deploys were **ruled out** (`data/runtime/` is
  gitignored and untracked; the 1.4.298 restart loaded and saved 10 unchanged). `scripts/deploy.sh`
  defaults `APP_DIR` to the dead directory. Second, latent: `StopAsync()` writes in-memory state over
  disk with no floor. Fix is mostly ops — pin `SLEUTH_DATA_DIR` (the lever GH-60 already added)
  outside any install dir. See `PROJECT/1-INBOX/GH-86-RUNTIME-STATE-LOCATION.md`.

- **"for tonight" schedules for tomorrow night (GH-87)** — `tonight` anchors to 9 PM, then ±45min
  presentation jitter can move it before "now", and the past-handler rolls a past date forward a
  full 24 hours (`ShouldKeepSameDayWhenPast` only matches `this morning`). A message sent within 45
  minutes *before* its anchor has ~coin-flip odds of a day's deferral — worst exactly where the
  phrase is most urgent. Jitter is a presentation device and must never change the calendar day.
  See `PROJECT/1-INBOX/GH-87-TONIGHT-JITTER-DAY-ROLL.md`.

- **Unify diagnostics under one system (GH-88)** — four independent builders (the `diagnostics`
  command, reminder triage, ad-hoc error strings, the startup summary) share no baseline, format, or
  routing. `diagnostics` receives the channel and never reports whether reminders are enabled in it,
  so the command named *diagnostics* omits the usual answer to "why did nothing happen". Proposal is
  one module, a 5-line baseline on every surface **including errors** (per-channel reminders-enabled
  and the *resolved* runtime path both in it), plus a contextual section per caller. See
  `PROJECT/1-INBOX/GH-88-UNIFIED-DIAGNOSTICS.md`.

- **Bug reporting 404s (GH-89)** — `SLEUTH_ISSUE_REPO` is set nowhere on production, so
  `ISSUE_REPO` is `''` and the filer POSTs to `https://api.github.com/repos//issues`. The empty
  default is deliberate and right (a vendor default would file users' reports into someone else's
  tracker); the defect is not distinguishing *unset* from *failed*. Guard before the request, name
  the repo in genuine failures, and point production at `HiQS-Suite/AEGIS-Sleuth-Slackbot`. See
  `PROJECT/1-INBOX/GH-89-ISSUE-REPO-CONFIG.md`.

- **CI deadlock + lost verified-secret scanning (GH-15)** — merging GH-14 (DeployHQ adoption) deleted
  `.github/workflows/ci.yml`, the sole producer of the `test` status context that `main`'s branch
  protection still requires, so every PR is permanently `BLOCKED` and needs a manual protection lift.
  The same deletion removed TruffleHog verified-credential scanning and its weekly full-tree cadence
  with no replacement — on a **public** repo. Fix is one restored file, one PR, no protection lift.
  **GH-13 is blocked behind this** (modify/delete conflict on `ci.yml`). See
  `PROJECT/1-INBOX/GH-15-CI-DEADLOCK-AND-SECRET-SCAN-REGRESSION.md`.

- **Public zero-history repo + cutover (GH-423)** — stand up a brand-new public Sleuth repo with no
  commit history, full identifier scrub (155 files mention the workspace name, 91 the client name),
  redacted CHANGELOG, minimal rebuilt doc set, and AGPL-3.0 + commercial dual license
  (`Copyright (c) Neochrome`). New repo becomes canonical; this one is archived read-only once prod
  deploys from it. Target 2026-07-20 → 07-27. **Blocked on GH-420** (credential rotation, owned
  there) before the public flip. Repo name is an open item — "sleuth" collides with Spring Cloud
  Sleuth and sleuth.io. See `PROJECT/1-INBOX/GH-423-PUBLIC-REPO-CUTOVER.md`.

- **Admin-facing DM reminders kill switch (GH-413)** — GH-412 follow-up, deliberately deferred, not
  a blocker. GH-412 lets any user in any workspace auto-schedule reminders via 1:1 DM with no
  opt-in; adjudicated during that issue's `/consult` QA to ship without a kill switch for now and
  track separately. **Re-trigger:** only on real evidence of false-positive DM scheduling (a
  complaint or a pattern in reminder logs), not a hypothetical concern alone. Issue
  [#413](https://github.com/NeochromeTeam/sleuth-app/issues/413). → [PROJECT/1-INBOX/GH-413-DM-REMINDERS-KILL-SWITCH.md](PROJECT/1-INBOX/GH-413-DM-REMINDERS-KILL-SWITCH.md)
- **Needle first-responder router spike (GH-392)** — **⏸️ DEFERRED, gated on GH-397 / PR #401 (Gemini Flash Lite router = the primary router POC).** Flash Lite is built, needs no new infra, and its shadow-store is the eval harness Needle would reuse. **Re-trigger:** only when (1) #401's shadow data shows the routing tier is worth activating AND (2) a privacy/cost/offline driver makes local inference matter — then evaluate Needle as the local-tier alternative *on #401's harness*, not a second rig. Original plan below. Evaluate cactus/Needle (26M ARM on-device tool-calling model) as Sleuth's cheap/local first-responder router, with confidence-based handoff to the main LLM. **Phase 0 = go/no-go technical spike**: build a golden-routing eval set from real traffic, baseline the current main-LLM router, stand Needle up on OCI Always Free Ampere A1 (`cactus serve`), and shadow-diff the two — Needle gets zero authority. GO only if Needle+handoff ≥ baseline at acceptable latency/RAM. **NO-GO still ships the golden-routing eval set as a PDDA-gated regression suite** (the model-agnostic fix for convention drift, cf. #391). Complements the structural guards (GH-387/388/391). Build via /relay, not a solo session. Captured via /idea. Issue [#392](https://github.com/NeochromeTeam/sleuth-app/issues/392). -> [PROJECT/1-INBOX/GH-392-NEEDLE-ROUTER-SPIKE.md](PROJECT/1-INBOX/GH-392-NEEDLE-ROUTER-SPIKE.md)
- **Router shadow corpus — Flash Lite candidate #1 (GH-397)** — **same experiment as #392**, cheapest candidate: shadow-log every `@Sleuth` routing decision (matched AND unmatched) to a separate non-authoritative per-workspace JSONL corpus, then replay Flash Lite / Needle / an embedding tier / a local 0.5B **offline** against it. The **corpus** (a replayable, labeled routing regression set) is the durable deliverable; Flash Lite is just the first model run against it. Integration is near-zero — `gemini-*` already routes to `gemini-provider.js` (which strips the schema keys Gemini rejects), `GEMINI_API_KEY` is already a validated workspace field, and the fire-and-forget unmatched-mention hook (`#EmitNearMissProbeAsync`) already exists. **Load-bearing risk:** the near-miss Phase 0 readout saw only ~2 failures / 6wk on `neochrome`, so shadowing matched inputs (false-alarm/agreement metrics) is non-optional and the window is record-count-timeboxed. Shadow-only, zero authority, tenancy-gated (`NEOCHROME_TEAM_ID`) + kill-switched (`ROUTER_SHADOW_ENABLED`); `rawText` capture is a privacy escalation to scope + retention-bound. **#397 gates #392** — it's the low-hanging-fruit experiment that decides whether Needle is worth pursuing. **Operator-locked scope (2026-07-16):** ship a per-workspace three-state **router mode** `off | shadow | active` now, flipped live by an admin-only `@Sleuth AI router-mode <mode>` Slack command (in-memory, resets to `off` on restart). `shadow` logs the corpus; `active` = Flash Lite **full takeover** above a confidence threshold (incl. Risk-tagged commands, operator's call), else falls back to the current resolver. **SHIPPED and ACTIVE on prod, scoped to `neochrome` (as of v1.4.232+):** router-mode command, sticky mode across restarts (`ROUTER_SHADOW_DEFAULT_MODE`), pinned stable model (`gemini-3.1-flash-lite`), and `models`-command surfacing all landed — see CHANGELOG for the full list. Issue stays open: the corpus itself is an ongoing data-collection deliverable, not a discrete one-shot fix — re-evaluate #392 (Needle) once enough shadow data accumulates. Issue [#397](https://github.com/NeochromeTeam/sleuth-app/issues/397). → [PROJECT/1-INBOX/GH-397-FLASH-LITE-ROUTER-SHADOW.md](PROJECT/1-INBOX/GH-397-FLASH-LITE-ROUTER-SHADOW.md)
- **Proactive layer Phases 2 & 3 (GH-366)** — deferred remainder of GH-362 (Phase 1 shipped p5). **P2:** learned-convention proposals (propose-and-confirm, no LLM) — mine completion history for assignee/cadence concentration, propose operator-gated config edits with evidence. **P3:** dropped-thread watch — deterministic prefilter records unanswered client-channel questions; LLM classifies at digest time only; one-tap convert to a reminder. Both ride the existing digest under the ≤3/day cap. **P2.1 (deterministic proposal core) + P2.2 (suppression + rate-limit store) shipped 2026-07-17 in v1.4.235** (24/24 tests green); P2.3 (digest wiring), P2.4 (confirm/decline actions), and Phase 3 remain — P2.3 needs its own preflight contract before it's marathon-ready. → [PROJECT/2-WORKING/GH-366-PROACTIVE-PHASES-2-3.md](PROJECT/2-WORKING/GH-366-PROACTIVE-PHASES-2-3.md) · [design](PROJECT/3-COMPLETED/GH-362-PROACTIVE-LAYER.md)
- **P3 event-sourced core (event ledger)** — **COMPLETE / closed out 2026-08-09.** Phases 0–3 delivered: dual-write ledger, `summarize-week` projection, and the entity-linking read-model (additive by design — nothing in `src/` imports it). **The read cutover is PARKED BY DECISION, not pending.** Generation-binding of the coverage marker was falsified — a crashed append writes nothing to the ledger, so no ledger-derived quantity distinguishes "never attempted" from "attempted and lost", which means a coverage marker can never certify the completeness that serving a projection requires. The two read surfaces were also judged to gain migration confidence but no latency or scale benefit. The ledger is retained as a **non-authoritative projection/research substrate** — not audit-grade, not a deferred authority migration. All four projection flags (`REMINDERS_READ_SOURCE`, `COMPLETED_READ_SOURCE`, `REBALANCE_EXPORT_SOURCE`, `SUMMARIZE_WEEK_COMPLETED_SOURCE`) are blocked in code and set to `authoritative` on both servers; re-opening the authority path needs a named product consumer and a fresh proposal, deliberately not a config edit. Release `1.5.0` "Ledger" is retired as a goal post — the finish line moved from "flip the flag" to "decide what the ledger is for", and it did. Residual items are deferred with explicit revival triggers in the plan doc's section D; none is a live defect. → [PROJECT/3-COMPLETED/P3-EVENT-SOURCED-CORE.md](PROJECT/3-COMPLETED/P3-EVENT-SOURCED-CORE.md) · [GH-35](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/35) · [RELEASES.md](RELEASES.md)
- **P3 event schema expansion (v2)** — the schema-expansion proposal the entry above says Phase 4 needs before any retry. **Phases A/B delivered and C's field gate + generation-aware coverage checkpoint delivered** (`marathon/p3-phase5-read-cutover-2026-08-08`, PR #31): versioned append validation selected by the event's own `v` so v1 streams read unchanged, complete transition-emission coverage, thread-scoped relay events, `--enrich`/`--retire-orphans` backfill, and a durable per-workspace coverage marker that keeps a projection from serving when an append failed or nothing has ever been verified. **Phase D ran against a copy of live `neochrome` and found three defects no review caught** — removal was never evented (11 reminders would have been resurrected into Slack), imported completions were dropped from both read models (32 of 152 lost), and backfill only ran in one direction. All fixed; real-data read-model parity is now 23/23 active and 152/152 completed. **Operator sequence is `--enrich --retire-orphans` → compaction → re-verify**, since enrich alone leaves strict rejecting historical v1 transition events. **Every projection flag remains BLOCKED** pending a production run. → [PROJECT/2-WORKING/P3-EVENT-SCHEMA-EXPANSION.md](PROJECT/2-WORKING/P3-EVENT-SCHEMA-EXPANSION.md)
- **First-time-user UX** — live question-battery baseline captured (2026-06-21, real LLM). Phase 0.5 metric finalized against real prod data (2026-07-05); **Phase 1 (Q5/Q1 quick wins) is now marathon-ready** with a swarm preflight contract — SOLO lane (reminder-display cluster, serializes after GH-338). Phase 2 held; Phase 3 held (near-miss readout shows 0 reminder-create dead-ends in 6 weeks; needs probe enrichment first). → [remediation](PROJECT/2-WORKING/FIRST-TIME-USER-REMEDIATION.md) · [question battery](PROJECT/2-WORKING/FIRST-TIME-USER-QUESTION-BATTERY.md)
- **Admin bug-report reaction (GH-358)** — new, independent 🐛 reaction on Sleuth's own messages files a GitHub issue (extracted shared filing helper), confirms in-thread with the issue link, and logs to a reminders-shaped local store. **Phase 1 shipped 2026-07-09** via the marathon swarm (codex builder + agy reviewer) — corrected two spec deviations (title truncation, confirmation message text) and a `checkJs` type-narrowing regression the scoped gate missed, added 6 regression tests (none shipped with the lane); full suite green (1207/1207). Phases 2 (wastebasket integration), 3 (`show-bugs`), 4 (`refresh`) not started. → [PROJECT/1-INBOX/GH-358-BUG-REPORT-REACTION.md](PROJECT/1-INBOX/GH-358-BUG-REPORT-REACTION.md)
- **Startup CI-results poll (GH-418)** — the boot-message GitHub Actions follow-up fires 4 seconds
  after boot, so it always reports the run as `in_progress` instead of the real pass/fail outcome
  (confirmed live in the v1.4.238 boot message). Fix is a bounded poll (check, retry up to ~5 min)
  instead of one fixed-delay guess. Small, single-phase, low-risk — marathon-ready with a preflight
  contract. Issue [#418](https://github.com/NeochromeTeam/sleuth-app/issues/418). →
  [PROJECT/2-WORKING/GH-418-STARTUP-CI-RESULTS-POLL.md](PROJECT/2-WORKING/GH-418-STARTUP-CI-RESULTS-POLL.md)

### Completed

- **Image OCR was 400ing on every request (GH-81)** — **merged to `development` 2026-08-18 via PR
  [#82](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/82); CI green; issue
  [#81](https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/81) closed.** Every image OCR
  request failed with a Gemini 400 — deterministically, on every workspace, both servers — and the
  user saw only "Image analysis failed — please try again later", which invited a retry that could
  never succeed. `ocr-list-extraction-schema.json` declares three JSON Schema **union types**;
  Gemini's `responseSchema` takes an OpenAPI 3.0 subset where `type` is a scalar and nullability is a
  separate `nullable` flag, so each union arrived as a repeated value in a non-repeating proto field.
  Fixed in `GeminiProvider.#SanitizeSchemaForGemini` rather than the schema file, so the second call
  site and any future union-typed schema are covered. **Why it shipped:** the existing OCR tests mock
  the provider, so nothing asserted on the bytes actually sent to Google — the regression pin now
  loads the real shipped schema file instead of a fixture. Verified by live A/B against
  `gemini-2.5-flash` (current schema HTTP 400, fixed HTTP 200). Shipped as 1.4.296.

- **OCR list UX: thread, duplicate, and the silent wait (GH-83)** — **merged to `development`
  2026-08-18 via PR [#84](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/84); CI green;
  issue [#83](https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/83) closed.** Three
  presentation defects visible in the first successful run after GH-81 unblocked the feature. The
  list card posted to the **channel root** while the request that produced it was a thread reply;
  every success announced the same list **twice**, the second by raw list ID with a permalink written
  as `<a|url>` (Slack mrkdwn reversed, so it rendered as literal text); and the 10-30s Vision call
  showed **nothing**, making a slow run indistinguishable from a dropped one. ListsModule now takes
  an optional `ThreadTS`; the duplicate is gated on a new `Announced` flag rather than deleted, so
  the two cases where the announcement is skipped (no permalink, channel read access denied) stay
  announced instead of becoming silent successes; and the ack posts after the image downloads, so a
  fetch failure never leaves a promise the next message contradicts. Extraction, list schema, and
  item content unchanged. Shipped as 1.4.297.

- **Unify Slack attachment handling (GH-62)** — **merged to `development` 2026-08-17 via PR
  [#65](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/65); CI green; issue
  [#62](https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/62) closed.** GH-58's Vision OCR
  shipped in 1.4.292 unreachable from Slack — the text-context ingest ran first, classified any image
  as `unsupported`, and returned before the OCR branch. Root cause was two parallel attachment
  pipelines with duplicated dispatch, download, and selection. Now one `ResolveAttachmentIntent()`,
  one `#HandleAttachmentAsync` shared by app_mention + message events (closing a hands-free gap that
  had no image path at all), and one `DownloadFileAsync()` holding the redirect/auth guard once.
  Shipped as 1.4.293 with an entry-point test suite and `npm run attachments:e2e`.
  → [PROJECT/3-COMPLETED/GH-62-UNIFY-ATTACHMENT-PIPELINE.md](PROJECT/3-COMPLETED/GH-62-UNIFY-ATTACHMENT-PIPELINE.md)

- **Pin Vision OCR to a Gemini provider (GH-63)** — **merged to `development` 2026-08-17 via PR
  [#65](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/65); CI green; issue
  [#63](https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/63) closed.** OCR followed the
  workspace default model, but only `GeminiProvider` implements the multimodal method, so a
  Claude/GPT-default workspace failed permanently while being told to try again later. The agy QA
  relay then caught that only `VisionModelPreference[0]` was reachable; the call now walks the whole
  ordered candidate list with a narrow `IsModelUnavailableError()` retry.
  → [PROJECT/3-COMPLETED/GH-63-PIN-OCR-PROVIDER.md](PROJECT/3-COMPLETED/GH-63-PIN-OCR-PROVIDER.md)

- **Explicit OCR and list-conversion commands (GH-64)** — **merged to `development` 2026-08-17 via PR
  [#65](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/65); CI green; issue
  [#64](https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/64) closed.** `command-catalog.json`
  had 58 entries and none mentioning OCR, so `rmm`, `help`, and the commands list could not see the
  feature. Registered `scan-image-for-text` and `convert-text-into-slack-list` with `Aliases` +
  `IntentPhrases`, and split the fused handler into extract/materialize seams.
  → [PROJECT/3-COMPLETED/GH-64-EXPLICIT-OCR-COMMANDS.md](PROJECT/3-COMPLETED/GH-64-EXPLICIT-OCR-COMMANDS.md)

- **Gemini Vision OCR and Slack List Creation Pipeline (GH-58)** — **merged to `development`
  2026-08-17 via PR [#59](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/59); CI green;
  issue [#58](https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/58) closed.** Extract
  structured itemized lists from image attachments uploaded in Slack threads via lightweight Gemini
  Flash models and materialize them directly as interactive Slack Lists via `ListsModule`. Shipped as
  1.4.292 — renumbered from 1.4.291 on merge, because GH-60 took that version first.
  → [PROJECT/3-COMPLETED/GH-58-GEMINI-OCR-SLACK-LIST.md](PROJECT/3-COMPLETED/GH-58-GEMINI-OCR-SLACK-LIST.md)

- **Test suite data/runtime isolation across Jest workers (GH-60)** — **merged to `development`
  2026-08-17 via PR [#61](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/61); CI green.**
  Test suites shared a non-isolated `data/runtime/` tree across parallel Jest worker processes,
  causing cross-process state races and flaky test failures. Fix routes all runtime state under
  `SLEUTH_DATA_DIR` (with per-worker temp directory isolation in Jest setup) and adds a regression
  guard. → [PROJECT/3-COMPLETED/GH-60-ISOLATE-TEST-RUNTIME-DATA.md](PROJECT/3-COMPLETED/GH-60-ISOLATE-TEST-RUNTIME-DATA.md)

- **Anchor the jest globs so the merge gate stops crying wolf (GH-48)** — **merged to `development`
  2026-08-11 via PR [#49](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/49); CI green.**
  `testMatch` was unanchored (`**/tests/**`), so jest collected the partial snapshots the relay
  harness writes to `.tick/orphan-backups/<utc>-<pid>/` when its containment reverts a file mid-turn.
  Those copies hold a test file without its sibling `src/`, so they can never resolve and always fail
  — `npm test` broke on an unpredictable schedule with a suite unrelated to the change, twice during
  GH-37. The signature is a run reporting a **failed suite with zero failed tests**. Both globs
  (`testMatch` and `collectCoverageFrom`) are now anchored to `<rootDir>`; anchoring rather than
  blocklisting `.tick/` excludes every stray `tests/` dir, not just the one that bit us. A
  `testPathIgnorePatterns` entry was written and then **deliberately removed** — mutation testing
  showed the anchor alone and the ignore alone each fully prevent the collection, so carrying both is
  redundant machinery (GUIDING-PRINCIPLES §1, §3). Verified with the orphan backup still on disk: 109
  suites / 1849 tests green, no suite lost. →
  [PROJECT/3-COMPLETED/GH-48-JEST-TESTMATCH-ANCHOR.md](PROJECT/3-COMPLETED/GH-48-JEST-TESTMATCH-ANCHOR.md)
- **GitHub relay leaks unrelated follow-ups onto a linked issue (GH-37)** — **shipped to `development` via PR [#38](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/38) (`3dfb59b`); issue [#37](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/37) closed; deployed to the Vultr dev server.** The relay gated purely on thread structure, so once any reminder in a thread carried a GitHub URL every later reply was commented onto that issue — observed live when a new, unrelated task ("fix NN Yard IDs") landed on GH 18's countdown-reminder issue and was deleted by hand. Each linked reminder is now scored independently by a `github-relay-relevance` prompt pair through a new shared `src/ai-decision.js` helper (also adopted by the existing dedup call, behavior-identically), and the comment goes only to reminders clearing `relay` at `confidence >= 0.7`, fail-closed. Scoring per reminder rather than per message also fixed the fan-out half, where a two-issue thread copied every reply onto both. Adding the 🐙 reaction now stops a thread's relay — the emoji the bot already leaves is the one you click — guarded so the bot's own acknowledgement cannot stop the relay it just started. **Two QA rounds:** agy on the feature (its one blocker, "the reaction handler is untested", was rejected on evidence — 11 passing tests), then Codex on the merge with development's event schema v2, which landed on the same class concurrently. Codex found a genuine **blocker**: narrowing the relay-started write to the gate-filtered subset recreated the ledger/JSON parity divergence `reminders-projection.js:533-554` documents, since that fold applies thread-scoped state to every reminder. Also fixed a stop-path ordering defect where a failed Slack acknowledgement left the store stopped and the ledger silent. Both carry mutation-verified regression tests. → [PROJECT/3-COMPLETED/GH-37-RELAY-RELEVANCE-GATE.md](PROJECT/3-COMPLETED/GH-37-RELAY-RELEVANCE-GATE.md)
- **Thread-reply reminder deduplication (GH-27)** — **shipped to `development` as squash commit `5a148c7` (PR [#28](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/28)), issue [#27](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/27) closed.** An incidental `today` in a later thread reply scheduled the same root-thread task a second time, because the exact-`OriginalMessageID` fast path returned `schedule` unconditionally on a miss — leaving the semantic comparison behind it **unreachable dead code**. The fix derives a thread identity (`OriginalThreadTs ?? OriginalMessageID`) and runs semantic comparison only across reminders sharing it, preserving distinct follow-up work and the zero-extra-AI path for unrelated threads. Reviving that dormant path had a non-obvious side effect caught in review: `CheckForDuplicateReminderAsync` is also called by the **force-schedule escape hatch**, so an AI verdict could suddenly veto an explicit user override — a branch with no test coverage at all. Closed by tagging every dedup exit with `matched_by` (`'message_id' | 'semantic' | null`) and gating the force branch on `'message_id'` only, restoring the pre-existing contract exactly rather than inventing a new one; two regression tests now drive both force-schedule outcomes through the alarm-clock reaction path. Verified 1,518 Jest + 33 Node green, typecheck clean. → [PROJECT/3-COMPLETED/GH-27-THREAD-REMINDER-DEDUP.md](PROJECT/3-COMPLETED/GH-27-THREAD-REMINDER-DEDUP.md)
- **Multiple reminder assignees (GH-22)** — **shipped to `development` via PR [#29](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/29) (squash `9d7e319`); issue [#22](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/22) closed.** A reminder naming two people was persisted and indexed for only the first mention while its confirmation named both, so the second person's `show-me` silently omitted it. One shared record now carries an additive authoritative `AssigneeIDs` array with legacy `AssigneeID` kept as a first-value mirror and normalized on load, so old records stay readable and a rollback stays a flag flip. **The instructive part is where the bug actually lived:** the marathon's p1 lane built the whole contract — normalization, multi-mention scheduling, per-assignee display, per-user Slack List fan-out — across two automated rounds, and never fixed the reported symptom, because the singular `AssigneeID === userId` compare causing it sat in `src/chat-commands/show-me-context.js`, *outside the plan's declared artifact paths*. No lane could touch it; the reviewer identified it and authorized the scope expansion in the same turn a `timeout-gate-failed` escalation killed the phase. Finished by hand: membership now resolves through the canonical `RemindersModule.IsAssignedTo` (deferred require — a top-level import closes a `reminders-module → connection-surfacing → reminder-clustering → show-me-projects-command` cycle), plus the two tests the reviewer asked for, **both verified to fail against the pre-fix code before being accepted**. Also restored the single-assignee confirmation copy, which the builder had reworded to "scheduled as shared work for" for *every* reminder against an explicit brief prohibition. Event-log compatibility verified rather than assumed: `FoldReminders` reads only the singular `assigneeId`, still emitted alongside the additive array, so historical `summarize-week` output is unchanged. Gates: 94/94 suites, 1524 Jest + 33 Node, `validate:fsm` OK, `tsc` clean. **Surfaced a separate standing conflict** — this was the first change ever to push a `phases/*/RELAY.md`, and CI's sanitize gate rejected it on 9 `absolute-local-path` findings; `ef45021` tracks those files because marathon-drive HALTs without them, so every pushed marathon phase will reproduce this until the harness renders repo-relative paths. → [PROJECT/3-COMPLETED/GH-22-MULTIPLE-REMINDER-ASSIGNEES.md](PROJECT/3-COMPLETED/GH-22-MULTIPLE-REMINDER-ASSIGNEES.md)
- **Durability hardening (GH-12)** — **shipped 1.4.261, all 6 phases agy-QA'd (PR [#13](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/13)).** The authoritative JSON stores wrote via plain `fs.writeFile` — truncate-then-rewrite, no temp file, no atomic rename, **zero `fsync` call sites in `src/`** — so a hard kill mid-write left unparseable JSON, every loader degraded that to "start empty", and `#DataLoaded` **did not guard saves**, making the loss permanent on the next ordinary write. Phase 0 re-ranked the tiers against `HONEST.md:128`, which named the wrong two subsystems: the **reminder queue** (10 call sites) was the biggest blast radius and wasn't listed, while the **event ledger was the safest**. Fix: one shared `src/durable-write.js` (temp → `fsync` → rename → `fsync` dir, unique per-write temp names), adopted by every authoritative writer, **plus** a per-store write chain — atomic rename orders nothing, and the lost-update race dropped **3 of 8** completed reminders with serialization bypassed — plus a quarantine guard so a corrupt load is renamed aside rather than overwritten. Verified by a crash-injection harness whose `unsafe` control must reproduce damage or the run self-fails: at N=100 per write shape, whole-file async **23 → 0** corrupt, whole-file sync **3 → 0**, JSONL append **0 → 0** (append confines damage to the tail by construction). The harness caught *itself* twice — a clean control, then a false 35/100 — and neither fault was in the source. Cost measured not assumed: `fsync`-per-append is 57× relative but **571 ms/day**, and the intuitive fd-holding optimization was refuted at ~10% and rejected. `HONEST.md`/`README.md` re-truthed to exactly what was measured — **Say with care**, "survives a hard kill without corrupting its stores", explicitly *not* "crash-proof"/"zero data loss" since `SIGKILL` cannot empty the page cache; **the "not load-tested" claim was left untouched.** Issue [#12](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/12). → [PROJECT/3-COMPLETED/GH-12-DURABILITY-HARDENING.md](PROJECT/3-COMPLETED/GH-12-DURABILITY-HARDENING.md)
- **Unresolved Slack mentions + blank permalink in filed bug reports (GH-428, GH-429, GH-430)** — a `:bug:`-filed GitHub issue (GH-428) showed raw `<@U...>` mentions instead of names in its title/body, and its "View Slack message" link rendered a blank page. Fixed: new `src/slack-message-pipeline.js` (`ResolveMentionsForExternalDisplayAsync`) — the seed of an aspirational unified "make Slack text safe to read outside Slack" pipeline (GH-429, more call sites deferred) — wired into the bug-report and thread-capture flows; `GetPermaLinkAsync` now builds its own canonical archive URL instead of trusting Slack's `chat.getPermalink` response verbatim, sidestepping its occasional redir-wrapped auth-bounce form (GH-430). 16 new regression tests, shipped 1.4.242. **Follow-up (1.4.243):** operator-requested headless Codex `relay-xyz` review of GH-429 for DRY/quality caught 3 real issues — a duplicate-lookup inefficiency (no cross-message cache in `thread-memory.js`) and a mention-token regex independently re-derived in 3 files — all fixed; `SlackFormatUtils` is now the one owner of the mention grammar (`ExtractUserMentions` + new `ReplaceUserMentions`). **Follow-up 2 (1.4.244, GH-432):** `/consult`-validated migration of the pipeline to `github-comment-relay.js` (same GH-428 bug class in relayed GitHub PR/issue comments, plus a separate raw-fallback bug in the author name); confirmed web-api's dashboard export and Slack Lists don't need it. Caught a 3rd missed regex copy in `web-api.js` along the way. Filed **#433** (unrelated Lists piped-mention Block Kit bug, found during the consult, deliberately not fixed here) and a comment on [xyz-3-agents-swarm#296](https://github.com/Claude-AI-Tools-Ventura-County/xyz-3-agents-swarm/issues/296) (relay-drive.sh worktree-isolation path bug hit while QA'ing GH-429, plus a new token-poisoning-on-self-recovery detail). → [CHANGELOG.md](CHANGELOG.md)
- **"above" thread-reference not resolving into the reminder title (GH-424)** — v1.4.239's verb-widening fix (`follow\s+(?:up\s+)?on`) turned out insufficient — "please see above" reproduced the same symptom same day. v1.4.240 replaced the enumerated-verb approach entirely: any thread reply containing the standalone word "above" + a scheduling trigger now resolves via the existing pronoun-reference context-enrichment mechanism (`ABOVE_REFERENCE_PATTERN`), no verb list to maintain. Also built `scripts/reminder-thread-battery.js` — an interactive turn-by-turn test harness (real `RemindersModule`/`WorkspaceAI` via `MockSlackApp.SimulateMessageAsync`, since `slack-harness-post.js` can't reach this code path at all due to Slack Bolt's `ignoreSelf` default). Headless Codex review (`relay-xyz`) of that work then caught a real blocker in the harness itself (crashed under its own documented plain-`node` invocation — missing jest shim) plus 2 hygiene gaps (silent green-exit on a turn error, incomplete/collision-prone cleanup); all fixed in v1.4.241. 23 new regression tests total across both phases. → [PROJECT/3-COMPLETED/GH-424-ABOVE-CONTEXT-SYNTHESIS.md](PROJECT/3-COMPLETED/GH-424-ABOVE-CONTEXT-SYNTHESIS.md)
- **First-responder workspace awareness (GH-405)** — **#397 follow-on, shipped v1.4.234 (PR [#409](https://github.com/NeochromeTeam/sleuth-app/pull/409), merged to development 2026-07-17).** Gives the Flash-Lite router a cached, token-bounded per-workspace snapshot (`openTotal` + top-5 clients by open count) injected into its RMM context, and — in `active` mode — a deterministic "how many open for &lt;client&gt;?" answer recomputed **live** from `GetAllReminders()`. **Doubly gated** (`ROUTER_SNAPSHOT_ENABLED` default off **and** router armed) → dormant on prod. `projectId` null in v1 so projects omitted; week-completions deferred (Phase 0). Independent cross-model `/consult` (codex + agy) applied — the deterministic count now reuses ask-reminders' canonical fail-closed privacy helpers and declines on any unresolved-privacy or time/assignee scope. Issue [#405](https://github.com/NeochromeTeam/sleuth-app/issues/405). → [PROJECT/3-COMPLETED/GH-405-FIRST-RESPONDER-WORKSPACE-SNAPSHOT.md](PROJECT/3-COMPLETED/GH-405-FIRST-RESPONDER-WORKSPACE-SNAPSHOT.md)
- **Friendlier CHANGELOG entries (GH-408)** — **shipped to development.** Both Slack surfaces (the `changelog` command + deploy startup message) read less mechanically now that `CHANGELOG.md` leads each entry with a friendly first-person plain-language TL;DR then a `**Technical:**` block. **Phase 1 (v1.4.232):** top-of-file authoring note (above the first `## ` so the Slack extractor ignores it) + 1.4.232 reformatted as the exemplar. **Phase 2 (v1.4.233):** `scripts/validate-changelog-tone.js` + `validate:changelog-tone` guard (mirrors `validate-reminder-render.js`) enforced under `npm test` — fails a bullet-first / no-`Technical:` newest block; forward-only; `<!-- TONE-OK: -->` pragma. Issue [#408](https://github.com/NeochromeTeam/sleuth-app/issues/408). → [PROJECT/3-COMPLETED/GH-408-CHANGELOG-FRIENDLY-TONE.md](PROJECT/3-COMPLETED/GH-408-CHANGELOG-FRIENDLY-TONE.md)
- **Richer reminder Q&A (GH-367)** — extends `ask-reminders` into deterministic time/user/client/keyword queries via a transport-neutral query core (`src/reminder-query-engine.js`), reused by a local `talk-to-reminders` Claude Code skill. **Phase 1 (Slack v1)** shipped 1.4.213 (PR #370) — parse → assemble → filter (privacy→time→user→client) → short-circuit-on-empty → model phrases only, `SlackApp.IsChannelPrivateAsync` fail-closed. **Phase 2 (export enrichment: `clientId` + bounded `completions-<ws>.json`)** + **Phase 3 (local zero-network skill)** shipped 1.4.214. **Last QA-gate item (ambiguous client first-match, regression-tested in `client-mapping.test.js`) closed 2026-07-17 in v1.4.235 — issue closed.** Plan refined by Codex+agy `/consult`, privacy elevated to a v1 MUST. Deferred: per-workspace client-mapping migration (**#369**); local `--client` needs the server to republish the enriched export. → [PROJECT/3-COMPLETED/GH-367-RICHER-REMINDER-QUERIES.md](PROJECT/3-COMPLETED/GH-367-RICHER-REMINDER-QUERIES.md)
- **Command-catalog gap: `confirm-multi-task-proposal` (GH-365)** — `validate:commands` was red on `main`/`development` since GH-360 wired the route without a matching catalog entry. Fixed 2026-07-17 in v1.4.235; uncovered (not fixed) a second pre-existing validator gap (`ask-reminders` synthetic entry vs. dynamic registration, **#410**) and a suspicious cross-workspace prototype-monkeypatch in `command-catalog.js` (**#411**) — both filed for separate review. Issue closed. → [PROJECT/3-COMPLETED/GH-365-COMMAND-CATALOG-GAP.md](PROJECT/3-COMPLETED/GH-365-COMMAND-CATALOG-GAP.md)
- **Reminder-render primitive (GH-391)** — a second convention-drift incident: `what's open for Client A?` (ask-reminders query path) rendered a **custom text blob with raw `id:fc3d9b07` debug prefixes** instead of the canonical per-reminder individual reactable messages. **Phase 1 shipped 1.4.225** (individual ✅/🗑-reactable messages, no id-blob); **Phase 2 shipped 1.4.226** (documented primitive in AGENTS.md §0.1 + `validate-reminder-render.js` CI guard enforced under `npm test`). Both phases complete; issue reconciled + closed 2026-07-17 (PDDA sweep). → [PROJECT/3-COMPLETED/GH-391-REMINDER-RENDER-PRIMITIVE.md](PROJECT/3-COMPLETED/GH-391-REMINDER-RENDER-PRIMITIVE.md)
- **NaN completion timestamp bypasses time-window filter (GH-393)** — `FilterCandidates`'s time-window guard treated `NaN` as a valid number (`typeof NaN === 'number'`), letting malformed completions (missing `completedMs`) leak into every time-scoped `ask-reminders` query. Found via the GH-391 cross-model `/consult`. Fixed 2026-07-17 in v1.4.235, regression-tested. Issue closed. → [PROJECT/3-COMPLETED/GH-393-NAN-TIMESTAMP-FILTER.md](PROJECT/3-COMPLETED/GH-393-NAN-TIMESTAMP-FILTER.md)
- **Missing/blank `Candidate.title` guard (GH-399)** — a confirm-multi-task-proposal candidate with a missing/blank AI-synthesized title could leak `undefined`/empty text into a persisted reminder. Fixed 2026-07-17 in v1.4.235 — candidates with no usable title are now skipped (logged) rather than scheduled, mirroring the existing duplicate-skip idiom. Issue closed. → [PROJECT/3-COMPLETED/GH-399-CANDIDATE-TITLE-GUARD.md](PROJECT/3-COMPLETED/GH-399-CANDIDATE-TITLE-GUARD.md)
- **Sleuth hardening marathon (GH-383 + GH-387 + GH-388)** — three reliability lanes born from the #384 tenant-isolation incident: **p1 = #387** (CI guard that fails on globals-for-workspace-state / off-pattern route registration — `scripts/validate-workspace-isolation.js`, `npm run validate:workspace-isolation`), **p2 = #383** (channel-privacy cache + UNRESOLVED surfacing, 1.4.223), **p3 = #388** (no silent failures in ask-reminders, 1.4.224). **All three shipped** (found during a full PDDA doc-hygiene sweep 2026-07-17 — docs/issues had never been reconciled after the marathon actually shipped them; all 3 issues closed, docs moved to `3-COMPLETED`). → [GH-383](PROJECT/3-COMPLETED/GH-383-CHANNEL-PRIVACY-CACHE.md) · [GH-387](PROJECT/3-COMPLETED/GH-387-WORKSPACE-ISOLATION-GUARD.md) · [GH-388](PROJECT/3-COMPLETED/GH-388-NO-SILENT-FAILURES.md)
- **Reminder task-text quality (GH-337)** — stop dumping long FYI notes verbatim; synthesize the buried task (two-segment length-aware settings) + unify digest display; folds #193/#3/#29. **All 4 phases shipped** (Phase 3 landed 1.4.209, commit 500470a — found undocumented during a 2026-07-09 marathon preflight sweep; CHANGELOG backfilled). #339 tracks separate non-blocking follow-ups. Doc/issue reconciled 2026-07-17 (PDDA sweep) — issue closed, doc moved to `3-COMPLETED`. → [PROJECT/3-COMPLETED/GH-337-REMINDER-TASK-TEXT.md](PROJECT/3-COMPLETED/GH-337-REMINDER-TASK-TEXT.md)
- **Task bucketing (P2-TASK-BUCKETING)** — client/project inference over reminders; spike complete + `show-me-projects` Phase 1 shipped (1.4.161); remaining phases become a projection under P3 — this doc's own scope is done. Moved to `3-COMPLETED` 2026-07-17 (PDDA sweep). → [PROJECT/3-COMPLETED/P2-TASK-BUCKETING.md](PROJECT/3-COMPLETED/P2-TASK-BUCKETING.md)
- **show-me reactable output (GH-338)** — make `show-me` post each ranked reminder as its own checkmark-closable, permalinked message (reuses the `show reminders` renderer) instead of one consolidated text blob; top 5, bucketed by due date, AI rationale appended per item. Shipped 1.4.209 (commit `2c8ee7d`, 2026-07-03) — found already-implemented-but-undocumented during the 2026-07-09 marathon run; codex added regression test coverage rather than duplicating working code, agy reviewed + approved, full suite green (1201/1201). Unblocks First-time-user UX Phase 1 (was serialized behind this on the reminder-display collision cluster). → [PROJECT/3-COMPLETED/GH-338-SHOWME-COMMAND.md](PROJECT/3-COMPLETED/GH-338-SHOWME-COMMAND.md)
- **Adopt Blend philosophy into GUIDING-PRINCIPLES.md (GH-348)** — gradiated 2-phase merge of `AGENTS-PROPOSED.md` into a new "Engineering Philosophy" section in `GUIDING-PRINCIPLES.md` (amended 2026-07-03, was `AGENTS.md`); reconciled comment format + carved out the DI/seam rule as an accepted test-suite exception (not refactored) before landing. Built via the marathon swarm (codex builder + agy reviewer) 2026-07-09, `npm test` green (1200/1200). → [PROJECT/3-COMPLETED/GH-348-ADOPT-BLEND-PHILOSOPHY.md](PROJECT/3-COMPLETED/GH-348-ADOPT-BLEND-PHILOSOPHY.md)
- **Hyphen/space command normalization (GH-349)** — auto-derive hyphen↔space tolerance for argument-invariant commands from `BuildCanonicalCommand`'s existing canonical-string switch (`Proxy`-sentinel invariance check), instead of hand-writing more regexes; design reviewed + approved via 2-round Agy relay (2026-07-03), catches optionally argument-bearing commands (`search-projects`, `test-github-sync`) that a naive heuristic would have missed. Shipped 1.4.211 (commit `d91f7ed`, via marathon automation 2026-07-07) — both phases landed, redundant hand-written regexes removed. Issue #349 closed; found undocumented during a 2026-07-09 marathon preflight sweep. → [PROJECT/3-COMPLETED/GH-349-HYPHEN-COMMAND-NORMALIZATION.md](PROJECT/3-COMPLETED/GH-349-HYPHEN-COMMAND-NORMALIZATION.md)
- **Flaky fixed-port test (GH-351)** — `tests/web-api-workspace.test.js` hardcoded port `19877`; parallel/leftover-process collisions threw `EADDRINUSE` and failed 3 cases intermittently. Shipped 1.4.211 (commit `578b3e7`, via marathon automation 2026-07-06) — ephemeral OS-assigned port (`TestPort = 0`). Issue #351 closed; found undocumented during a 2026-07-09 marathon preflight sweep. → [PROJECT/3-COMPLETED/GH-351-FLAKY-PORT-TEST.md](PROJECT/3-COMPLETED/GH-351-FLAKY-PORT-TEST.md)
- **Trim AGENTS.md's redundant inventory (GH-352)** — removed §4 (Data Persistence), §5 (Web API Contract Checklist), and §11 (Architecture And Key Paths) from `AGENTS.md`, replacing each with a one-line pointer to its still-current canonical home (`ARCHITECTURE.md`, `docs/web-api.md`, `ARCHITECTURE-DECISIONS.md`); trimmed §12 to just the Process Environment Flags subsection (workspace field tables now point to `src/workspaces.js`). `AGENTS.md` 395 → 305 lines, no information loss. `ROUTER.md` pointers updated to match. Built via the marathon swarm (codex builder + agy reviewer) 2026-07-09, `npm test` green (1200/1200). → [PROJECT/3-COMPLETED/GH-352-TRIM-AGENTS-MD.md](PROJECT/3-COMPLETED/GH-352-TRIM-AGENTS-MD.md)
- **P3 Phase 2 baseline-import (GH-355)** — one-shot idempotent import emitting `BaselineReminderImported` events for pre-ledger reminders (both active + completed stores), fixing the null assignee/sourceChannel gap in the `summarize-week` projection fold; also fixed the fold's `githubUrls` mapping gap. Prod-validated: shadow-diff on real `neochrome` data went from 11 null-field mismatches to 0 — 1.4.211 (`b3075d7`). Cutover sequence steps 1–2 done; the flag flip itself (`SUMMARIZE_WEEK_COMPLETED_SOURCE=projection`) stays a separate, human-gated decision. → [PROJECT/3-COMPLETED/GH-355-P3-BASELINE-IMPORT.md](PROJECT/3-COMPLETED/GH-355-P3-BASELINE-IMPORT.md)
- **ask-self ingest architecture-summary fix (GH-347)** — fixed two silent bugs found via `codebase-memory-mcp` graph research: the module inventory missed `src/chat-commands/` (28 files), `src/ai-providers/`, and `src/plugins/`; the command feature-map matched zero real commands (stale pre-CommandRouter regex). Now recursive + catalog-sourced + real HTTP routes — 1.4.209. Function-boundary-aware chunking and query-time hybrid retrieval deferred (higher effort/coupling). → [PROJECT/3-COMPLETED/GH-347-ASK-SELF-GRAPH-INTEGRATION.md](PROJECT/3-COMPLETED/GH-347-ASK-SELF-GRAPH-INTEGRATION.md)
- **Fix: `search-web`/`search-gemini` reverse-order aliases** — RMM/`rmm ifl` now resolve these deterministically instead of falling through to LLM chat — 1.4.208 (PR #345). → [CHANGELOG.md](CHANGELOG.md)
- **Read-only reminders dashboard** — admin-authenticated Gantt-style view of a workspace's reminders (sortable, searchable, bookmarkable) — 1.4.207 (PR #340). → [CHANGELOG.md](CHANGELOG.md)
- **Admin `send to github` command (GH-341)** — workspace admins can file a GitHub issue from a Slack thread (`@Sleuth AI send to github`) with the transcript, permalink, and metadata as evidence — 1.4.206 (PR #343). → [CHANGELOG.md](CHANGELOG.md)
- **Command routing hardening** — `remember above` now only fires as a standalone command, not when a message merely mentions the phrase (asking *about* it via `ask-self` no longer triggers a write) — 1.4.204. → [CHANGELOG.md](CHANGELOG.md)
- **`remember above` confirmation now names the command that ran** — 1.4.203. → [CHANGELOG.md](CHANGELOG.md)
- **Sleuth MCP connector for Claude Desktop** — read-only reminder + live Slack tools over stdio — 1.4.202. → [mcp/README.md](mcp/README.md)
- **`rmm ifl` demo-UX confirmation softening** — 1.4.201. → [CHANGELOG.md](CHANGELOG.md)
- **Command Near-Miss Recovery** — Phase 0 (miss counter) + Phase 1 ("I Feel Lucky" alias) shipped 1.4.199/1.4.200. **Phase 0 counter READOUT 2026-07-05 (gate resolved):** only 2 near-misses in 6 weeks on prod `neochrome` (scores 9, 4) → too sparse to re-set the score floor (provisional 5 stands), rate too low to justify LLM tiers. **Phase 2-full/3/4 HELD — do not build**; **Phase 2-lite flipped ON on prod 2026-07-06** (`COMMAND_NEAR_MISS_LITE=ON`) — free deterministic "Did you mean?" + thickens the dataset. Doc moved to `3-COMPLETED` 2026-07-17 (PDDA sweep) — this is a settled decision endpoint, not abandoned. → [PROJECT/3-COMPLETED/COMMAND-NEAR-MISS-AI-FALLBACK.md](PROJECT/3-COMPLETED/COMMAND-NEAR-MISS-AI-FALLBACK.md)
- **Reminder false-positive hardening** — diagnosed the 2026-06-08 neochrome false-positive; Phase 6 (`asap` intent-gating) landed, remediation complete; production-observation only. → [PROJECT/3-COMPLETED/P1-REMINDER-FALSE-POSITIVE-HARDENING.md](PROJECT/3-COMPLETED/P1-REMINDER-FALSE-POSITIVE-HARDENING.md)

### Deferred · vision

- **Open-core split (P1-SPLIT)** — carve Sleuth into `sleuth-core` (OSS) + premium plugins; 7-phase strategic plan, not started. Dependency substrate for [P3 event-sourced core](PROJECT/3-COMPLETED/P3-EVENT-SOURCED-CORE.md). An earlier, superseded draft of this plan (`P2-SLEUTH-REBOOT.md`, no PDDA frontmatter, one commit 2026-05-13) was archived to `4-MISC` 2026-07-17 — this doc is the current one. → [PROJECT/2-WORKING/P1-SPLIT.md](PROJECT/2-WORKING/P1-SPLIT.md)

---

## Collision clusters (do-not-parallelize)

When contracting held items for a marathon, keep these off the same wave — shared write-sets:

- **Reminder-display:** `reminders-display-utils.js`, `reminders-module.js` — GH-338, GH-337 (P3), First-time-user UX.
- **Chat-ladder:** `chat-module.js`, `command-catalog.json` — First-time-user UX, Command Near-Miss, Hyphen command normalization (GH-349, also touches `command-intent-resolver.js`).

First-time-user UX straddles both clusters (and is the highest-risk held item) — run it solo, never alongside either.

---

## Entry format

One flat bullet per item: `Project / track name` — one-line status. → `[linked doc](PROJECT/...)`
