---
title: "npm test breaks nondeterministically: unanchored jest testMatch collects relay-harness orphan backups under .tick/"
status: Completed (3-COMPLETED) — merged to development 2026-08-11 via PR #49; CI green
created: 2026-08-11
updated: 2026-08-11
owner: noel
goal: "Make npm test collect only the repo's real test directory, so a relay-harness containment revert can never inject a phantom failing suite into the merge gate."
branch: gh-48-anchor-jest-testmatch
doc_type: bugfix
gh_issue: 48
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/48
related: "Surfaced twice while running gates for GH-37 (#37 / PR #38); the orphan-backup mechanism is documented in .claude/skills/relay-xyz/SKILL.md"
context_tags: [jest, test-config, relay-harness, merge-gate, tooling]
---

# GH-48 — anchor the jest globs to the real source and test directories

## Status

| What was just completed | What's next |
|---|---|
| Both jest globs anchored to `<rootDir>`; reproduced the failure first, then mutation-tested the fix. Full gate green with an orphan backup still on disk: 109 suites / 1849 jest tests, 116 node tests, `npm run build` exit 0. Suite count unchanged, no legitimate suite dropped. **Merged to `development` 2026-08-11 via PR #49.** | Done. The anchor is now protecting the gate for downstream work (GH-50, GH-51) on the same branch lineage. |

## Why this exists

`package.json`'s jest config globbed `**/tests/**/*.test.js` — unanchored, so it matched *any*
directory named `tests/` anywhere under the repo root. The relay harness writes partial snapshots to
`.tick/orphan-backups/<utc>-<pid>/` whenever its containment reverts a file mid-turn (see
`.claude/skills/relay-xyz/SKILL.md`). Those snapshots contain a test file **without** its sibling
`src/`, so they can never resolve:

```
FAIL .tick/orphan-backups/20260810T200653Z-31579/tests/github-comment-relay.test.js
  ● Test suite failed to run
    Cannot find module './github-sync-module'
```

The signature is a run reporting a **failed suite with zero failed tests**.

`collectCoverageFrom` carried the same unanchored shape (`src/**/*.js`), so a coverage run could pull
in the orphaned `src/` copies too — the identical defect in a second place.

## Quad Concepts

- **A gate that cries wolf stops being a gate.** The failure is unrelated to the change under test
  and appears on an unpredictable schedule, which trains people to skim `npm test` output.
- **Anchor the glob, don't blocklist the offender.** `<rootDir>/tests` excludes every stray `tests/`
  — orphan backups, vendored copies, worktrees, `temp/` — not just the one that bit us.
- **`.tick/` is machine scratch.** Nothing under it should ever be collected by any tool.
- **Fix the class, in every place it appears.** Both globs were unanchored; fixing only the one that
  had failed would leave the same bug live in coverage.

## What shipped

`package.json` jest config only:

- `testMatch`: `**/tests/**/*.test.js` → `<rootDir>/tests/**/*.test.js`
- `collectCoverageFrom`: `src/**/*.js` → `<rootDir>/src/**/*.js`
- `_comment_glob_anchoring` recording why, so the anchor is not "tidied" back out later.

**A `<rootDir>/.tick/` entry in `testPathIgnorePatterns` was written and then deliberately removed.**
Mutation testing showed the anchor alone and the ignore alone each fully prevent the collection, so
carrying both is redundant machinery (GUIDING-PRINCIPLES §1, §3). The anchor is the more general of
the two — it covers every stray directory, not only `.tick/` — so it is the one kept.

## Verification

- **Reproduced first:** with the old config, `npx jest --listTests` collected
  `.tick/orphan-backups/20260811T013147Z-94408/tests/` alongside the real suite.
- **Fixed:** the same command now returns only `tests/` — with that orphan backup still on disk.
- **Mutation-tested:** unanchoring `testMatch` again re-collects the orphan; re-anchoring stops it.
- **Full gate, orphan backup still present on disk:** 109 suites / **1849 jest tests** pass, 116 node
  tests pass, 0 failures; `npm run build` exits 0.
- **No suite lost:** `find . -name '*.test.js' -not -path './node_modules/*'` returns only `./tests`
  and the orphan copy, so anchoring drops nothing legitimate. Suite count is unchanged at 109.

## Out of scope

The orphan backups themselves are left alone. They are the harness's recovery mechanism for a
wrongly-reverted edit — deleting them on a schedule would remove the safety net this repo has already
needed once (GH-37's parity fix was recovered from one). The fix stops jest from *reading* them, not
the harness from *writing* them.
