---
gh_issue: 89
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/89
title: "Bug reporting 404s: SLEUTH_ISSUE_REPO is unset so the API URL is repos//issues"
status: Proposed (1-INBOX — not yet active)
created: 2026-08-18
doc_type: bugfix
related: "GH-86 (the dead /root/sleuth-app still carries the old NeochromeTeam remote); GH-88 (the failure reply should carry the diagnostics baseline)"
---

# GH-89 — Unconfigured bug reporting must say so instead of 404ing

## Observed

> couldn't file the GitHub issue (GitHub returned 404). Check the logs.

## Root cause

`src/github-issue-filer.js:6`
```js
const ISSUE_REPO = process.env.SLEUTH_ISSUE_REPO || '';
```

`SLEUTH_ISSUE_REPO` is set **nowhere** on the production box — verified by grepping both install
directories and `/etc/systemd`; the only matches are the two source files that read it. So `Repo` is
`''` and line 44 builds `https://api.github.com/repos//issues`, which GitHub answers 404.

The 404 is genuine. It just means "that path does not exist", not "you lack access to the repo" —
which is what the message implies and what a reader would waste time investigating.

The empty default is **correct** and should stay: `github-issue-filer.js:3-5` explains that a
hardcoded vendor repo would file users' bug reports into someone else's tracker. The defect is
failing to distinguish *unset* from *failed*.

## Plan

**Phase 1 — guard before the request.** Add `reason: 'no-repo'` alongside the existing `'no-pat'`,
returned before any `fetch`. A request that cannot succeed should not be sent, and the user should be
told the actual condition: bug reporting is not configured for this workspace.

**Phase 2 — name the repo in genuine failures.** For real 404/403s, include the attempted
`owner/repo` in the Slack reply so "which repo did it even try?" is answerable without a log pull.
Overlaps GH-88 — if the diagnostics baseline lands first, this becomes a contextual line on it
rather than a bespoke string.

**Phase 3 — configure production.** Set `SLEUTH_ISSUE_REPO=HiQS-Suite/AEGIS-Sleuth-Slackbot` on both
servers, add it to the `.env` example and the deploy docs so a fresh install cannot repeat this.

**Phase 4 — verify the PAT.** The empty-repo 404 masks whether the workspace `GITHUB_PAT` can open
issues on the new repo at all, since that URL 404s regardless of token scope. Confirm after Phase 3.

## Sequencing against GH-86 / GH-88

**Phase 3 (set the variable) ships first and alone** — it is one line of config and unblocks bug
reporting today. Phase 1's guard follows on its own merits. Phase 2 waits for GH-88's baseline so
the repo name arrives as a contextual line rather than a bespoke string; if GH-88 slips, Phase 2 can
still ship as a plain string and be folded in later. Nothing here blocks on anything.

## Acceptance

- [ ] With `SLEUTH_ISSUE_REPO` unset: no HTTP request is made, and the reply names the missing config.
- [ ] A test asserts `fetch` was **not** called in that case.
- [ ] With it set, `:bug:` files into `HiQS-Suite/AEGIS-Sleuth-Slackbot`.
- [ ] A genuine 404/403 reply states which repo was attempted.

## Risks

- Low. The change is a guard plus config. The one judgement call is wording: it must not imply the
  user did something wrong — this is a deployment gap, not a user error.
