---
title: "GH-230: selftest T4 later-upload, T6 memory-reuse scenarios and T5 zero-download assertion"
status: Working (2-WORKING)
created: 2026-10-10
updated: 2026-10-10
owner: noel
branch: feat/gh-230-selftest-scenarios
doc_type: project
gh_issue: 230
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/230
complexity: 2
risk: 1
effort: 2
phases: 1
ratings_provisional: false
non_goals:
  - No production behavior change, selftest guard, command-catalog or Compass scenario change
  - No runner or module change (a Mention-with-preposted-ts option for the true delayed-event race is rejected as out of scope)
  - No new framework, CI job or dependency; T7 steps 3-4 and human-typed mentions stay manual
related:
  - "#222 acceptance record (T4, T5, T6 map here)"
  - "GH-221 / PR #223 (selftest), GH-225 / PR #227 (thread-context provider)"
goal: >
  Close the three uncovered #222 live-acceptance gaps inside the existing selftest: a T6 memory-reuse scenario,
  a T4 later-upload scenario, and a zero-download assertion on the T5 oversized-file scenario.
---

# GH-230 — selftest T4/T6 scenarios and T5 zero-download assertion

## Status

| What was just completed | What's next |
|---|---|
| Issue filed, clone provisioned off origin/development 6696312, captured, rated 35/15/50/75, recon done. Plan QA pending. | Codex plan QA, then build the three scenario edits. |

## Observed state (recon, 2026-10-10, base 6696312)

- Live run 2026-10-10 on dev: `@Sleuth-dev selftest all` = 4 pass, 1 skip, `exit_code=0`. T1/T2/T3/T5 are covered; T4 and T6 have no scenario; T5's `lookback-skip-bad` asserts no "too large" post and a normal answer but not zero downloads (#222 acceptance).
- Runner context (`src/selftest/runner.js`): `Upload`, `Say`, `Mention`, `Expect`, `Fixture.DownloadCount()/GetRepliesAsync()`, `Skip`. `Mention(Text)` posts the question as the bot into the scenario root, then calls `SimulateAppMentionAsync` with `files: []` and the question's ts. It awaits the whole handler, so a scenario cannot interleave an upload between the question post and its dispatch.
- `DownloadCount()` counts only `GetFileContentAsync` calls whose URL was recorded by `Upload` for this scenario (`FixtureUrls`), so a download of any fixture file counts, including the oversized one.
- Memory: the earlier-file look-back is skipped when `${channel}:${thread}` already has memory (GH-219), so a second `Mention` in the same root must reuse memory with no second download (T6), and an upload after hydration is not read (T4 control).
- `tests/selftest.test.js`: the loader-contract test auto-covers new files (each at most 40 lines, `Name` and `Run` present, names unique). The "runs all five against MockSlackApp" test hard-codes five filenames via a `readdir` spy and expects 6 report lines; it stays valid but its name and list go stale.
- Existing skip rule in every look-back scenario: skip when `GetMapping(WorkspaceInfo, Channel)` is truthy (a Compass-mapped channel).

## Plan (one phase, ordered)

1. `src/selftest/scenarios/lookback-reuse.js` (T6): skip if Compass-mapped; write a synthetic JSON with a unique canary; `Upload`; `Mention('what is the marker in the uploaded file?')`; assert a later reply quotes the canary; `Mention('what is the marker value again?')`; assert a later reply (after the second baseline ts) quotes the canary; `Expect(DownloadCount() === 1, 'one download across both mentions')`.
2. `src/selftest/scenarios/lookback-later-upload.js` (T4 control): skip if Compass-mapped; `Upload` old.json (token A); `Mention('which file?')`; assert the answer quotes token A; `Upload` new.json (token B) after hydration; second `Mention`; assert no reply in the thread ever contains token B and the answer still quotes token A; `Expect(DownloadCount() === 1)`. Header states plainly that this is a normal-ordering, post-hydration control and not the delayed-event race: it shows a later upload is not selected, not that the later file was invisible during candidate selection.
3. `src/selftest/scenarios/lookback-skip-bad.js` (T5): add `Context.Expect(Context.Fixture.DownloadCount() === 0, 'no download of the oversized file')`; keep the existing assertions; stay at most 40 lines.
4. `tests/selftest.test.js`: add the two new filenames to the `readdir` spy list, rename the test to "runs every scenario against MockSlackApp" and expect 8 report lines (7 scenarios plus the summary). No other test change.
5. `CHANGELOG.md`: two-paragraph entry in the existing format (next patch above the current top entry); no `package.json` bump.

## Alternatives rejected

- Add `Mention(Text, { QuestionTs })` to the runner so T4 could upload between the question post and dispatch (the real data condition of the race). Rejected: it changes the runner for one scenario, the issue's non-goals forbid it unless a scenario cannot be written, and the control above covers the #220 blocker class (later upload picked up after hydration). Recorded as a possible follow-up, not built.
- Unit-test each scenario's `Run` against a scripted context. Rejected: #221's acceptance states scenarios are the live test; the loader contract plus the live run is the proof.

## Verification and red control

- Focused: `npx jest selftest --forceExit` (loader contract, runner, mock-context run), then full `npm test` once on the final commit, un-sandboxed.
- Live (post-merge, deploy to dev is automatic via the webhook): `@Sleuth-dev selftest all` in the QA channel; expect seven scenarios, new ones pass, `compass-budget` skipped, `exit_code=0`. Record in a #222 comment.
- Red control: the new assertions run only live, so a failing control cannot run in Jest. The honest limit is stated here: before relying on the T5 assertion, confirm on dev that `lookback-skip-bad` still passes, and confirm the assertion would count a download by checking that `FixtureUrls` is populated for the oversized upload (it is: `Upload` adds both URLs). A deliberate negative live control is not built.

## Blast radius and rollback

Three files under `src/selftest/scenarios/`, one test file, one changelog entry. Armed only on a server that sets `SLEUTH_SELFTEST_CHANNEL`; production behavior unchanged. Rollback: revert the commit; no migration.

## Task rating (2026-10-10)

Rated 35/15/50/75 (priority/severity/appeal/effort-cheapness). Severity low: a test-coverage gap with no user-facing defect. Priority modest: it finishes the #222 automation the operator asked for. Appeal neutral 50 (no operator preference given). Effort 75: three small files and one test edit. Recurrence: the same thread-handling area produced three features in the last 14 days (GH-215/216, GH-217/218, GH-219/220, then GH-225/227) and two pre-merge review blockers on #220 (command routing after hydration, later uploads picked up); no post-merge reopenings found. Trend beyond that window unknown.

## Acceptance

- [ ] `lookback-reuse`, `lookback-later-upload` and the `lookback-skip-bad` zero-download assertion exist, each scenario file at most 40 lines, loader-contract test green.
- [ ] `tests/selftest.test.js` and the full `npm test` pass.
- [ ] Live on dev after deploy: `@Sleuth-dev selftest all` reports the new scenarios (pass, or skipped in a Compass-mapped channel) and the journal shows `exit_code=0`.
- [ ] #222 comment updated mapping T4, T5 and T6 to their scenarios.
- [ ] CHANGELOG entry in the usual two-paragraph format.

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npx jest selftest --forceExit",
  "fix_probes":  [
    { "type": "path_absent", "path": "src/selftest/scenarios/lookback-reuse.js" },
    { "type": "path_absent", "path": "src/selftest/scenarios/lookback-later-upload.js" }
  ],
  "artifacts":   [
    "src/selftest/scenarios/lookback-reuse.js",
    "src/selftest/scenarios/lookback-later-upload.js",
    "src/selftest/scenarios/lookback-skip-bad.js",
    "tests/selftest.test.js",
    "CHANGELOG.md"
  ],
  "artifacts_new": [
    "src/selftest/scenarios/lookback-reuse.js",
    "src/selftest/scenarios/lookback-later-upload.js"
  ],
  "remediation": { "source": "self#plan", "criteria": "GH-230 — T4/T6 selftest scenarios and T5 zero-download assertion" },
  "lanes":       {
    "agy_safe": [
      "src/selftest/scenarios/lookback-reuse.js",
      "src/selftest/scenarios/lookback-later-upload.js",
      "src/selftest/scenarios/lookback-skip-bad.js"
    ],
    "orchestrator_only": [ "tests/selftest.test.js", "CHANGELOG.md" ]
  }
}
```

## Progress log
- 2026-10-10: issue #230 filed from the #222 live-run gaps; fresh clone off origin/development 6696312; captured, rated and promoted; plan drafted. Plan QA pending.
