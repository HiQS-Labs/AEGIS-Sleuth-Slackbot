---
title: "RELEASES.md: <!--test--> fixture errors every releases check; Codename absorbed by preceding block"
status: Active (2-WORKING) — both defects reproduced, fixes proposed
created: 2026-08-07
updated: 2026-08-07
owner: noel
branch: development
doc_type: bugfix
gh_issue: 26
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/26
related: "GH-23 added the 1.5.0 goal post and hit defect 2; PDDA releases check shipped via PR #20; release 1.4.270 'Roundup'"
context_tags: [pdda, releases-ledger, parser, doc-hygiene]
---

# GH-26 — RELEASES.md fixture error + Codename absorbed by preceding block

## Why this exists

`pdda.sh releases` has never reported `errors=0`. One leftover fixture keeps it permanently red,
which also causes `pdda-doc-ready` to be skipped entirely (*"fix the deterministic findings above
first"*). A check that is always red teaches everyone to ignore it — which is exactly when it stops
catching anything.

## Key concepts

**A block starts at each `Release:` line.** Everything between one `Release:` and the next belongs
to the first. Fields written *before* a block's own `Release:` are therefore silently attributed to
the **previous** block. Nothing warns.

**The empty-`Release:` guard is correct.** Defect 1 is a true positive. The fix is to the fixture,
not to the check.

## Defect 1 — `<!--test-->` fixture errors on every run

`RELEASES.md:9-17` holds scratch content — `Codename: "Test"`, `Description: FTest`, and two typos
(`Shakdedown`, `reviwed`) — whose `Release:` value is empty:

```
ERROR [pdda-check-releases] RELEASES.md:11 a 'Release:' block near line 11 has no version
SUMMARY [pdda-check-releases] errors=1 warns=0 info=0
```

**Preferred fix:** delete the fixture block. If a fenced-fixture concept is genuinely wanted instead,
have the check skip regions between `<!--test-->` markers — and add a test proving a malformed *real*
block outside such a region still errors.

## Defect 2 — `Codename:` absorbed by the preceding block

```text
Codename: "Silverlining"
Release: TBD
```

`"Silverlining"` attaches to the fixture block above it. Observed live while adding the 1.5.0 goal
post: inserting a block above it rendered as

```
• 1.5.0 ("Silverlining") — Draft
```

Worked around in PR #23 by placing the new block last. The trap remains, and it is silent.

**Fix both halves:** normalise `RELEASES.md` so every block leads with `Release:`, **and** have the
check `warn` when a recognised field appears before a block's first `Release:` line. The second half
is the durable one — without it the file drifts back the first time someone copy-pastes a block.

## Upstream sync consequence

`utils/pdda/pdda.sh` and `pdda-lib.sh` are synced in from a canonical PDDA repo (see
`utils/pdda/PDDA-INSTALL.md` and `PDDA-SOURCE.md`). Editing them here creates a **diverged target**
on the next `pdda-sync.sh push`. The change must be pushed upstream or it will be overwritten. Do not
silently fork the vendored copy.

## Anti-goals

- Do not weaken the empty-`Release:` guard — it is working correctly.
- Do not touch the 3 pre-existing governance dead-reference warnings in `ROUTER.md` / `AGENTS.md`.
- Do not restructure `RELEASES.md` content beyond field ordering.

## Acceptance

- [ ] `pdda.sh releases` reports **errors=0, warns=0**
- [ ] `pdda.sh releases-current` still renders `1.5.0 ("Ledger")` and `1.4.270 ("Roundup")` with
      correct codenames and Iterations bands
- [ ] the new warn fires on a field-before-`Release:` block
- [ ] the new warn does **not** fire on a well-formed block
- [ ] `pdda.sh run` shows no new findings
- [ ] the upstream-sync consequence is stated in the turn

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npm test",
  "fix_probes":  [ { "type": "grep_present", "path": "RELEASES.md", "pattern": "FTest" } ],
  "artifacts":   [ "RELEASES.md", "utils/pdda/pdda.sh", "utils/pdda/pdda-lib.sh" ]
}
```

`grep_present`, not `grep_absent`: probe types name the **pre-fix** state and report `landed` when it
flips. `FTest` is the fixture's own marker string, present only while the scratch block survives, so
`landed` means defect 1 is genuinely resolved. Using `grep_absent` here would invert the signal.
