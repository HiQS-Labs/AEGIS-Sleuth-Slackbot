---
title: "Three user-facing error posts still bypass the unified diagnostics baseline"
status: Marathon-ready (2-WORKING)
created: 2026-08-18
updated: 2026-08-18
owner: noel
branch: development
doc_type: bugfix
gh_issue: 96
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/96
related: "GH-88 (built the unified baseline — this is its coverage gap, not a defect in the baseline); GH-76 (deduplicated the OCR failure posts that DO carry it)"
effort: 2
complexity: 1
risk: 1
phases: 1
goal: >
  BuildErrorReportAsync is the single formatter and no duplicated baseline strings survive anywhere
  in src/ — the seam GH-88 built is clean. Three user-facing error posts simply never call it, so
  "one system" is not yet true. Route all three through it.
---

# GH-96 — the three error posts that never reach `BuildErrorReportAsync`

## Status

| What was just completed | What's next |
|---|---|
| Issue filed and capture doc written; preflight verdicts **ready** (exit 0), marathon dry-run clean (2026-08-18). | Fire phase p4 of `MARATHON-2026-08-18-DEV-QA/MARATHON.yaml` (after p3 — both edit `src/chat-module.js`). |

## The bypasses

| # | Site | What the user sees today |
|---|---|---|
| 1 | `src/chat-commands/convert-to-list-command.js:62` | `I could not read that text into a list — please try again later.` |
| 2 | `src/chat-module.js:2835-2839` | context-memory download failure |
| 3 | `src/chat-module.js:3170-3174` | `Slack Lists is not configured` |

## Why bypass 1 is the sharp one

`convert text into slack list` and the image→list route are two arms of one capability. They
converge on one extraction schema and one materialization seam by design. But only the image arm
routes its failures through `#FailOcrAsync` → `BuildErrorReportAsync`
(`src/chat-module.js:3128-3133`).

So the same user-visible capability produces differently-shaped failure messages depending on which
arm failed — the exact inconsistency GH-88 was filed to remove.

## Why it matters beyond tidiness

The baseline is what names the workspace, channel, version, provider, and runtime directory that
produced the failure. Without it these posts are unactionable: the user reports "it didn't work" and
there is nothing to correlate against journald.

## Fix

Route all three through `BuildErrorReportAsync`.

- Sites 2 and 3 are inside `chat-module.js`, which already imports it at `src/chat-module.js:21`.
- Site 1 lives in a different module and must import from `src/diagnostics-report.js` directly —
  `#FailOcrAsync` is private to `ChatModule` and is not the seam to reach for here.

Site 1 has two branches (permanent provider-misconfiguration vs transient). Both get the baseline;
the branch-specific sentence stays as the user message and the baseline is appended, matching how
`#FailOcrAsync` composes at `src/chat-module.js:3082-3093`.

## Explicitly out of scope

Do not widen this to every error string in `src/`. The three sites above are the OCR/list capability
surface GH-88 was scoped to. The `no-repo` guard from GH-89 and the bug-reaction path already carry
the baseline.

## Acceptance

- [ ] All three sites post a message containing the `*Diagnostics:*` baseline: `src/chat-commands/convert-to-list-command.js:62`, `src/chat-module.js:2835-2839`, `src/chat-module.js:3170-3174`.
- [ ] Every site obtains it by calling `BuildErrorReportAsync`; none hand-rolls baseline lines.
- [ ] A test per site, each **mutation-verified** — breaking the production line it covers makes it fail.
- [ ] The permanent-vs-transient split at site 1 survives: the two branches still produce different user sentences and both carry the baseline.
- [ ] Each post still goes to the thread, not the channel.
- [ ] No error strings outside these three sites are changed.
- [ ] `npm test` passes.


## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npm test",
  "fix_probes":  [
    { "type": "grep_absent", "path": "src/chat-commands/convert-to-list-command.js", "pattern": "BuildErrorReportAsync" },
    { "type": "path_absent", "path": "tests/convert-to-list-command.test.js" }
  ],
  "artifacts":   [
    "src/chat-commands/convert-to-list-command.js",
    "src/chat-module.js",
    "tests/convert-to-list-command.test.js"
  ],
  "artifacts_new": [
    "tests/convert-to-list-command.test.js"
  ],
  "remediation": { "source": "self#fix", "criteria": "GH-96 — all three bypass sites route through BuildErrorReportAsync, each pinned by a test that fails today" },
  "lanes":       { "agy_safe": [ "src/chat-commands/convert-to-list-command.js", "tests/convert-to-list-command.test.js" ], "orchestrator_only": [ "src/chat-module.js" ] }
}
```

## Provenance

Bypass 1 found by hand during adjudication; bypasses 2 and 3 by an independent GLM 5.3 QA review of
`development` at `11d9e4e` (`relay-system/2026-08-18/consult-dev-qa-081115/glm-5.3.md`).
