---
title: Radar report — 2026-10-10 (run 1)
status: complete
created: 2026-10-10
updated: 2026-10-10
owner: radar
goal: Windowed SDLC read of development (2026-09-19 → 2026-10-10) across flow, recurring defects, and release alignment
doc_type: report
---

# Radar report — AEGIS-Sleuth-Slackbot — 2026-10-10

Window: 2026-09-19 → 2026-10-10 (21 days) on `development`, HEAD `aca655d`. Prior window: 2026-08-29 → 2026-09-19. First radar run in this repo; no prior reports found in `RADAR/`, `docs/radar/`, or `PROJECT/1-INBOX/`. SOP: none. Analysis was read-only; this file and the `radar` issue are the only writes.

## Executive summary

Three weeks, four shipped features: Product Compass release questions (#216, `72d60c9`), reading text files uploaded earlier in a thread (#220, `25a07a3`), the dev-only selftest mode landed by marathon (#223, `aca655d`), and the read-slack permalink skill (`0d82359`). The reminder pipeline absorbed four sharp user-facing fixes (first-person excitement `d07d643`, "this week" `6e90bd8`, quoted text `cf9fe6d`, own-reminder completion `6584d6f`) with same-day turnaround, and the Compass cleanup (#218, `34ea31b`) landed two days after the feature it tightened. The trunk test lane was 25 of 25 green for the whole window.

Run share fell from 87% to 71% (76% adjusted) and Grow rose from 8% to 19%, but volume fell three-fold (62 → 21 commits), and 8 of the 15 Run commits are ledger reconciles and dependency bumps, so the engineering Run is 3 fixes and 2 docs. Two seams deserve attention. The reminder judgement layer is chronic: six issues in 20 days, each patched as one more pre-filter, with umbrella #149 already naming the root cause. Product Compass shows a short-cycle regression: feature on 10-07, cleanup fix on 10-09, and #222 still open on the same thread-context seam; `src/chat-module.js` was touched by three of four features plus a fix. Release planning has detached: no milestones exist, orphan share is 100%, and none of this window's work sits on any release manifest.

## Lens 1 — flow distribution

Tally proven: `git log --no-merges` 21 (current) / 62 (prior) equals `rev-list --count`; bucket sums equal `wc -l` in both windows. Harness bucket 0 in both. `rgt:` adoption: 0 of 128 PROJECT docs. Corpus: 1-INBOX 18 · 2-WORKING 34 · 3-COMPLETED 56 · 4-MISC 20.

| Window | Run | Grow | Transform | Unclassified | RGT denom | Run % | Grow % |
|---|---|---|---|---|---|---|---|
| 2026-09-19 → 10-10 | 15 | 4 | 0 | 2 | 21 | 71% | 19% |
| 2026-08-29 → 09-19 | 54 | 5 | 0 | 3 | 62 | 87% | 8% |

Transform: 0% (rgt: adoption: 0 docs).

Unclassified, verbatim (current window):
- `ebbcd47 Complete a reminder by replying in its thread (#202)` — adjusted Grow (GH-201)
- `cf9fe6d Ignore text inside quotation marks when detecting reminders (#212)` — adjusted Run (GH-211)

Adjusted read: Run 16/21 = 76%, Grow 5/21 = 24%. Source-fixable measurement defect: GitHub squash-merge titles (#202, #207, #212) drop the conventional prefix. Of the 15 Run commits, 8 are `chore: reconcile after PR` / `chore(deps): bump` (`cd7b46f 7dc81a4 fd3af87 986872f 48a9763 c763d17 93b2f68 efc3a8f 6c028df`).

## Lens 2 — recurring defects & regressions

Signal yields:
1. `related:` frontmatter — 55 docs carry it; references are mixed free-text/array, usable as a hint, not a join key. Available.
2. Shared seam — 3 strict `fix:` commits (`34ea31b 6584d6f 6e90bd8`). Mechanical recurrences are ledger write-through (CHANGELOG, releases.db/.sql, RELEASES-PREVIEW.html, ROADMAP-DASHBOARD.md), excluded. Adjusted seam: `src/reminders-ai-pipeline.js` hit by `6e90bd8` (10-02, #207) and `cf9fe6d` (10-07, #212) — 2 days, 2 PRs → recurring. `src/reminders-module.js` + `src/reminders-app-mention-handler.js` hit by `ebbcd47 cf9fe6d 6584d6f` (all 10-07, #202/#212/#213) — passes only when joined with prior-window `d07d643` (09-17, #198). Yield: 1 code seam.
3. Issue similarity — 113 issues (59 open / 54 closed). Clusters: reminder detection/completion {#197 #201 #205 #211 closed; #206 #114 open; #149 umbrella} (7); Compass/thread-context {#215 #217 #219 closed; #222 open} (4); selftest {#221 closed, #222 open}; OCR/vision {#58 #75 #76 #91 #138 open, no window commits}; deploy/observability {#111 #164 #102 #214 open}. Yield: 5 clusters.
4. False closes — 54 closed; 14 doc-only grep hits, none an in-window doc-only close (`PROJECT/2-WORKING/GH-217-COMPASS-CONTEXT-CLEANUP.md:65` states code+tests). Available and empty.
5. `reported_from:` — 0 docs. Structurally unavailable.
6. Operational evidence — no `temp/logs/*.log` or degraded captures in window. Structurally unavailable.
7. Bounceback — `72d60c9` feat Compass (10-07, #216) → `34ea31b` fix(GH-217) (10-09, #218), overlap `src/product-compass.js`, `src/chat-module.js`, `tests/product-compass.test.js`; different PR, different day → **Potential Regression**. `ebbcd47` (#202) → `6584d6f` (#213) same day, same issue → weak. 0 reverts.
8. Umbrellas — 3 open, all pre-window, no `### Cluster signature` block (legacy): #108 "Symptom ≠ Problem", #105 duplication & fragmentation audit, #149 reminder judgement layer (prefix form differs). No fix-PR cutoff for any → all read holding.
9. Trunk CI — 29 runs in window: `Run Tests` 25/25 green, 0 red days. 4 reds are the Dependabot Updates workflow (`37672258691 37708928565 37709949389 37737296600`, 10-07/10-08, "Dependabot encountered 1 error", existing PR #204 cited). PR-branch reds: feat/product-compass `FAIL tests/chat-module.integration.test.js` (dynamic import without `--experimental-vm-modules`, fixed before merge); marathon/gh-221 `secret + PII scan ✗ 42` (absolute path in transcripts, fixed before merge, upstream XYZ-forge#1013).

### Targets

| ID | Cluster | Seam / class | Span | Kind | Score |
|---|---|---|---|---|---|
| RADAR-class-reminder-detection-judgement | #197 #205 #201 #211 #206 #114 #149 | `src/reminders-ai-pipeline.js`, `src/reminders-module.js`, `src/reminders-app-mention-handler.js`, `src/reminder-text-completion.js` | 09-17 → 10-07 (20 d) | chronic | ≈18 |
| RADAR-product-compass-context | #215 #216→#217 #219 #222 | `src/product-compass.js`, `src/chat-module.js` | 10-07 → 10-10 (3 d) | regression | ≈10 |
| RADAR-dependabot-stale-pr-redruns | PR #204 + 4 red runs | Dependabot Updates workflow | 10-01 → 10-08 | ops | ≈5 |

Why they recur: reminder false-positives and false-closes are each patched as a new pre-filter rather than one scored judgement with a regression corpus (#149 says this); Compass evidence and thread reads were added inline to the shared dispatcher without a context-budget contract. Durable fixes: one gated judgement layer with a seeded false-positive/false-close corpus every new exclusion must extend; one thread-context provider with an explicit size cap shared by Compass, lookback and selftest. Verify with: `tests/reminders-fsm-invariants*` and `tests/product-compass.test.js` (existing jest suites; no registry/fuzzer detected).

### Regressed after declared fixed

None found (54 closed issues, zero doc-only closes).

## Step 2b — open PRs

One open PR: #204 dependabot nodemailer 9.1.1 → 10.0.9, base development, mergeable/clean, `test` pass. No overlap with any target. Ready and verified: merge it; it is the cited "existing PR" behind the four red Dependabot runs.

## Step 2c — CI churn

SOP: none (no `docs/CI-CHURN-RECOVERY-SOP.md`; no SOP issue).

| Trigger | Value | Threshold | Source | Fired |
|---|---|---|---|---|
| E1 | 0% of last 20 trunk `Run Tests` failed | ≥30% or 5 consecutive | gh run list | no |
| E2 | median created→merged 51 h (9 PRs; human PRs 0.4–7.4 h, dependabot 51–205 h) | >48 h | gh pr list | marginal |
| E3 | 0 open PRs sharing a file | ≥50% | open PR files | no |
| E4 | no suite registry | — | — | unavailable |
| E5 | 1 recurring seam + 3 open umbrellas | ≥5 repeat fixes or score ≥40 | signals 2, 8 | yes |
| E6 | 0 red→green on same sha | ≥2 | gh run list | no |
| E7 | `timeout-minutes: 10` (ci.yml:34) vs max 3.0 min | <1.25× | ci.yml, run durations | no |
| E8 | Run 71% (76% adjusted); prior 87%; no prior radar baseline | ≥80% twice | Lens 1 | yes |

Declaration rule met on E5 + E8. Proposal delivered in-session; operator **accepted** on 2026-10-10: one short time-boxed cycle of root-cause analysis on the reminder judgement layer (#149, #206, #114) and Compass context (#222), via whack-a-mole then start-task. Caveat recorded: the trunk test lane is green; the churn is product-defect churn, not broken CI.

## Lens 3 — release alignment

`releases check`: clean, generation 54, 56 receipts intact; 6 `mig-ref-stale` warnings (46 days) and 11 grandfather entries pending. Unshipped, all `target=unplanned`: Confluence (draft), Roundup, Grounding, Antecedent, LTVera Ask-Code, Retrospect (draft). Last shipped: Ledger 1.5.0 (2026-08-09). Milestones: none → join impossible; claim status read from blurbs, which are stale (Roundup still frames GH-37/43/44/48/50/51 as pending). Orphan share 59/59 open issues = 100%, which here measures a missing binding, not an unplanned backlog. The plan says Confluence/Roundup/Antecedent/Grounding; the repo is doing Compass, thread lookback, selftest. Roadmap ledger is missing GH-201, GH-211, GH-219, GH-203, GH-206, GH-214, GH-222. Every target above is **UNCLAIMED** by any release band.

## Checklist as of this run

### RADAR-class-reminder-detection-judgement — 7 issues over 20 days · first-seen: 2026-10-10 · runs: 1
- [ ] Replace the pre-filter chain in `src/reminders-ai-pipeline.js` with one gated judgement step; owner umbrella #149
- [ ] Seed a false-positive/false-close corpus in the existing `tests/reminders-*` suites that every new exclusion must extend
- [ ] Close #206 and #114 against that corpus with commit SHAs

### RADAR-product-compass-context — 4 issues over 3 days · first-seen: 2026-10-10 · runs: 1
- [ ] Extract one thread-context provider with an explicit size cap from `src/chat-module.js`, used by `src/product-compass.js`, the GH-219 lookback and selftest
- [ ] Cover the cap in `tests/product-compass.test.js`
- [ ] Close #222 with the commit SHA

### RADAR-dependabot-stale-pr-redruns — 1 PR, 4 red runs · first-seen: 2026-10-10 · runs: 1
- [ ] Merge or close dependabot #204; confirm the next Dependabot Updates run on trunk is green

## Umbrellas — re-scored
- [ ] #149 — filed at legacy, now ≥5 (4 member fixes + 2 open issues in window), fix merged not yet → holding
      cluster reminder-judgement · legacy — no signature (reconstructed) · quiet 0/2 · class RADAR-class-reminder-detection-judgement
- [ ] #108 — filed at legacy, now n/a (no window members), fix merged not yet → holding
      cluster symptom-not-problem · legacy — no signature (reconstructed) · quiet 0/2 · class none
- [ ] #105 — filed at legacy, now n/a (no window members), fix merged not yet → holding
      cluster duplication-fragmentation · legacy — no signature (reconstructed) · quiet 0/2 · class none

## CI churn — 2026-10-10
- [x] Operator: declare a CI churn recovery, or decline — **accepted 2026-10-10** as one time-boxed RCA cycle on the two targets above.

## Degradation applied
Lens 2 signals 5 and 6 structurally unavailable; E4 unavailable; no prior report so no multi-week arc; no milestones so Lens 3 join replaced by blurb reads.
