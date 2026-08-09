# p2 — GH-25: sanitize-scan.sh cannot run from a linked git worktree

Release 1.4.270 "Roundup" · issue [#25] · depends on p1

## The defect

`utils/sanitize-scan.sh:80`:

```sh
[ -d "${REPO_ROOT}/.git" ] || die "${REPO_ROOT} is not a git repository."
```

In a **linked worktree** `.git` is a *file* containing `gitdir: …`, not a directory, so the test
fails and the script dies with `FATAL: <path> is not a git repository.` at exit `2`.

## Reproduce first

```bash
git worktree add /tmp/wt --detach HEAD
cd /tmp/wt && ./utils/sanitize-scan.sh --allowlist utils/sanitize-allowlist.txt; echo "exit: $?"
# FATAL: … is not a git repository.   exit: 2
```

## Scope — small on purpose

Replace the `-d` test with one that resolves all checkout shapes:

```sh
git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1 || die "…"
```

That is the whole fix. Do not restructure the script.

## Do NOT relax the failure contract

The script's header states it *"exits 2 (never 0) if it cannot verify its own tooling — so a broken
scanner can never be mistaken for a clean tree."* That behaviour is **correct and load-bearing**.
The bug is the detection test, not the fail-closed response. A "fix" that makes the script continue
when it cannot establish a repo root is a security regression, not a fix.

## Done when — all four, or it is not done

1. Passes in a normal clone.
2. Passes in a **linked worktree** (the bug).
3. Still exits **non-zero** in a genuinely non-git directory (e.g. `mktemp -d`). A guard that can no
   longer fail proves nothing — verify it still fails.
4. Still detects a planted secret. Plant a fixture matching an existing allowlist-adjacent pattern,
   confirm non-zero, remove it. Confirming only the happy path would let a broken scanner ship
   looking green.

Record the observed exit codes for all four in the turn.

## Out of scope

Anything else in the script — allowlist semantics, pattern set, performance. GH-26 is p3.
