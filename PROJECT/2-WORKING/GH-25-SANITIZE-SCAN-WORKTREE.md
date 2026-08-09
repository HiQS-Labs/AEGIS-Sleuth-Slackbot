---
title: "sanitize-scan.sh cannot run from a linked git worktree"
status: Active (2-WORKING) — cause identified, fix is one line
created: 2026-08-07
updated: 2026-08-07
owner: noel
branch: development
doc_type: bugfix
gh_issue: 25
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/25
related: "GH-15 restored the CI that runs this scan; release 1.4.270 'Roundup' in RELEASES.md"
context_tags: [tooling, secret-scanning, git-worktree, ci]
---

# GH-25 — sanitize-scan.sh cannot run from a linked git worktree

## Why this exists

`utils/sanitize-scan.sh` is the secret/PII gate for this **public** repo. It runs in GitHub Actions
and in DeployHQ's build pipeline. It cannot be run locally from a linked git worktree, which is a
common development pattern here — several worktrees were used across 2026-08-06/07 and the scan was
unrunnable in every one of them.

## Key concepts

**`.git` is not always a directory.** In a linked worktree created by `git worktree add`, `.git` is a
*file* containing `gitdir: /path/to/main/.git/worktrees/<name>`. Code that tests `-d .git` to decide
"is this a git repo" answers *no* for a perfectly valid checkout.

**Fail-closed is correct and must be preserved.** The script's own header states it *"exits 2 (never
0) if it cannot verify its own tooling — so a broken scanner can never be mistaken for a clean
tree."* The defect is the detection test, not the response to it. Any change that lets the script
proceed when it cannot establish a repo root would turn a usability bug into a security one.

## Root cause

`utils/sanitize-scan.sh:80`:

```sh
[ -d "${REPO_ROOT}/.git" ] || die "${REPO_ROOT} is not a git repository."
```

## Reproduction

```bash
git worktree add /tmp/wt --detach HEAD
cd /tmp/wt
./utils/sanitize-scan.sh --allowlist utils/sanitize-allowlist.txt; echo "exit: $?"
# FATAL: /tmp/wt is not a git repository.
# exit: 2
```

## Impact

Bounded. CI and DeployHQ are unaffected — `actions/checkout` produces a normal `.git/` directory and
both run the scan successfully. The cost is purely local: a developer working in a worktree cannot
run the repo's secret gate before pushing, so the first time it runs is CI.

## Proposed fix

```sh
git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1 || die "..."
```

`rev-parse --git-dir` resolves for a main checkout, a linked worktree, and a submodule. Keep the
`die`/exit-2 semantics exactly as they are.

## Anti-goals

- Do not restructure the script, change its allowlist semantics, or touch its pattern set.
- Do not relax the fail-closed contract.
- Do not fix GH-26 here, even though both surface in the same tooling pass.

## Acceptance

- [ ] Passes in a normal clone
- [ ] Passes in a **linked worktree** (the bug)
- [ ] Still exits **non-zero** in a genuinely non-git directory — the guard can still fail
- [ ] Still detects a planted secret — plant a fixture, confirm non-zero, remove it
- [ ] Observed exit codes for all four recorded in the turn

The last three exist because a guard observed only succeeding is not known to work.

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npm test",
  "fix_probes":  [ { "type": "grep_present", "path": "utils/sanitize-scan.sh", "pattern": "-d \"\\$\\{REPO_ROOT\\}/\\.git\"" } ],
  "artifacts":   [ "utils/sanitize-scan.sh" ]
}
```

`grep_present` is the correct type here, not `grep_absent`: probe types name the **pre-fix** state
and report `landed` when it flips. This fix *removes* the `-d "${REPO_ROOT}/.git"` test, so the
pre-fix state is "pattern present" and `landed` means it is gone. `grep_absent` would have inverted
the signal and reported the bug as fixed while it was still there.
