---
gh_issue: 15
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/15
title: "CI deadlock + lost verified-secret scanning after #14 deleted ci.yml"
status: Proposed (1-INBOX — not yet active)
created: 2026-08-06
doc_type: bugfix
related: "GH-14 (DeployHQ adoption, merged 0cf7ff5) introduced this; GH-13 (durability hardening) is blocked behind it"
---

# GH-15 — CI deadlock + lost verified-secret scanning

## Why this exists

Merging [#14](https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/pull/14) deleted
`.github/workflows/ci.yml` on the premise that DeployHQ's build pipeline replaces GitHub Actions.
The premise is *half* true, and the half that isn't left two defects behind. This doc exists so the
repair stays a repair — the failure mode here is turning a one-file regression into a CI/CD
re-architecture.

## Key concepts

**The producer/requirement split.** `main`'s branch protection requires the status context `test`.
The only thing that ever emitted `test` was `jobs.test` in `ci.yml`. #14 removed the producer
without relaxing the requirement, so protection now demands a signal nothing can send.

**Gate timing is not gate content.** DeployHQ's `.deploybuild.yaml` genuinely runs `npm ci`,
`npm run build`, `npm test`, and `utils/sanitize-scan.sh` — all with `halt_on_error: true`. The
gates did not vanish; they *moved from pre-merge to pre-deploy*. Bad code can now reach `main`, but
still cannot reach a server. Getting this distinction wrong in either direction leads to the wrong
fix.

**Diff scope vs full-tree scope.** The deleted workflow documented, in its own comments, that
`push`/`pull_request` events give TruffleHog only the event's diff. Whole-repo coverage came solely
from `schedule` (Mondays 09:00 UTC) and `workflow_dispatch`. Deleting the file deleted the only
full-tree verified-credential scan this public repo had.

**Workflows resolve from the head branch.** For same-repo PRs, Actions reads workflow files from the
PR's head, not from the base. This is why the repair is self-satisfying and needs no protection lift
— see Evidence below.

## The two defects

| | Defect | Severity |
|---|---|---|
| **D1** | Merge deadlock: `test` required, zero workflows emit it. Every PR needs a manual lift-merge-restore of branch protection. | Operational — recurring cost, repeated unprotected window on `main`. |
| **D2** | TruffleHog verified-credential scanning deleted with no replacement, and the weekly full-tree cadence with it. Repo is **public**. | Security — the more serious of the two. |

`sanitize-scan.sh` survives in DeployHQ and *is* full-tree (`git ls-files`), but it is a regex/PII
gate. It does not verify whether a detected credential is live. That capability is currently absent
from the repo entirely.

## Evidence

```
required contexts : ["test"]      (strict: true, enforce_admins: true)
workflows on main : 0
.github/ on main  : empty
repo visibility   : public
```

Cross-referenced breadcrumbs, consistent with every observation this session:

- #14's branch **deleted** `ci.yml` → `statusCheckRollup: []` → `BLOCKED`.
- #13's branch **retains** `ci.yml` → its `pull_request` runs fire normally (`gh run list`).

Together these establish that head-branch workflow presence determines whether `test` reports.

## Falsified along the way

- *"Nothing verifies code anymore."* — False. See "gate timing is not gate content" above.
- *"The fix PR will itself need a protection lift."* — False, per the breadcrumbs above. A branch
  restoring `ci.yml` emits `test` on its own PR.

## Proposed fix

**Restore `.github/workflows/ci.yml` verbatim** — no trigger edits, no rewrite:

```bash
git checkout 5733b5f -- .github/workflows/ci.yml
```

- `jobs.test` returns — the job name must remain `test` to match the required context → closes D1
- `schedule` + `workflow_dispatch` + both TruffleHog steps return → closes D2
- **the `push:` trigger stays.** An earlier draft proposed dropping it to avoid a duplicate run on
  merge. The agy review (2026-08-06) showed that would be a real security hole — see the review
  disposition below. Keeping it also makes the fix a verbatim restore, which is simpler.

Test duplication across Actions (pre-merge) and DeployHQ (pre-deploy) is deliberate defense in depth
at two different stages, costing ~1–2 min of Actions time per PR.

### Review disposition — agy, 2026-08-06 (verdict: Changes requested)

| Finding | Disposition |
|---|---|
| `[Blocker]` Dropping `push` lets a merge commit reach `main` unscanned by TruffleHog until the weekly `schedule`. Conflict resolutions can introduce secrets that exist in *neither* parent, so no PR diff ever contained them; DeployHQ's `sanitize-scan.sh` cannot verify whether a credential is live. | **Implemented.** `push` retained. This is a genuine hole and directly relevant — #14 was itself merged via manual conflict resolution. |
| `[Should]` Dropping `push` degrades PR cache hit rate, since `actions/setup-node` caches are branch-scoped and PRs inherit from the base branch. | **Implemented** — same fix. |
| `[Pass]` Option A needs no protection lift; the head-ref claim holds and `jobs.test` emits exactly the `test` context. | Confirms the effort estimate. |
| `[Blocker]` The `package-lock.json` anti-goal is a trap: `ci.yml` runs `npm ci`, which "enforces the lockfile exactly and fails fast on drift", so pre-existing drift would fail the fix PR's own required check. | **Declined — falsified.** The scheduled run at `5733b5f` had `package.json` 1.4.260 against lock 1.4.254 (six versions apart) and its `Install dependencies` step succeeded. `npm ci` validates *dependency* consistency, not the root `version` field. The anti-goal stands. |
| `[Blocker]` Done criterion 5 is un-checkable pre-merge: GitHub only exposes `workflow_dispatch` for workflows present on the default branch, so no manual full-tree run can be triggered until the fix has merged. | **Implemented.** Criterion 5 reclassified as post-merge below. |

**Rejected — Option B (drop `test` from required contexts):** closes D1, leaves D2 fully open. A
public repo with no verified-credential scanning is a worse posture than the duplication Option A
costs. DeployHQ cannot host the weekly full-tree scan, because it runs on deploy rather than on a
schedule.

## Anti-goals — the scope fence

This is a regression repair, not a CI/CD redesign. Explicitly out of scope:

- Redesigning deploy strategy — DeployHQ keeps owning deploys; that decision stands
- Migrating quality gates between Actions and DeployHQ in either direction
- Any permanent weakening of `main` branch protection
- `package-lock.json` drift (1.4.254 vs 1.4.261) — pre-existing and unrelated; file separately
- Re-litigating the GH-423 public-repo cutover

## Done criteria

**Checkable on the fix PR, before merge:**

1. An open PR into `main` shows a `test` check reaching `completed`
2. That PR reaches `mergeStateStatus: CLEAN` **without** any branch-protection change
3. `gh api .../branches/main/protection` byte-identical to its pre-fix state afterward

**Post-merge only** (GitHub exposes `workflow_dispatch` solely for workflows already on the default
branch, so neither of these can be exercised until the fix lands — do not treat them as pre-merge
gates):

4. `gh api .../actions/workflows --jq .total_count` > 0
5. A `workflow_dispatch`-triggered full-tree TruffleHog run appears in `gh run list` and passes.
   **Run this deliberately after merge** — do not wait for the Monday `schedule` to prove it, since
   a silent failure would then go unnoticed for up to a week.

## Effort ceiling

One file, one PR, no protection lift. If the work exceeds that, an anti-goal above has been
breached — stop and re-scope rather than continuing.

## Blocked behind this

GH-13 is `CONFLICTING`, including a modify/delete on `.github/workflows/ci.yml` (deleted on `main`,
modified on the branch). Resolving that as "keep main's deletion" would silently re-confirm the
no-CI state. This issue should land first.
