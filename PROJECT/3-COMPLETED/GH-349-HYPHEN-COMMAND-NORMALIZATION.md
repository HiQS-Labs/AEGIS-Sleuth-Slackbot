---
gh_issue: 349
source: https://github.com/NeochromeTeam/sleuth-app/issues/349
title: Normalize hyphenated vs. non-hyphenated commands automatically (zero-argument commands)
status: Completed — shipped 1.4.211 (commit d91f7ed, via marathon automation 2026-07-07), both phases landed (generic matcher + redundant regex cleanup); found undocumented during the 2026-07-09 marathon preflight sweep, ledger/CHANGELOG backfilled; issue #349 closed via PR #359
created: 2026-07-03
updated: 2026-07-09
owner: noel
doc_type: feedback
effort: 2
complexity: 2
risk: 1
phases: 2
goal: >-
  Auto-derive hyphen/space tolerance for argument-invariant zero-argument commands from
  BuildCanonicalCommand's existing canonical-string switch, instead of hand-writing more
  regex entries in command-normalization.json.
---

# Normalize hyphenated vs. non-hyphenated commands automatically

## Status

| What was just completed | What's next |
|---|---|
| Shipped 1.4.211 (commit `d91f7ed`, 2026-07-07) — both phases landed; found undocumented during the 2026-07-09 marathon preflight sweep and ledger/CHANGELOG backfilled. | _None — issue closed._ |

## Ask

Only 4 command families (`model-switch`, `set/show/clear-channel-model`) currently tolerate both
hyphen and space forms, via hand-written regexes in `data/static/ai/command-normalization.json`.
Every other zero-argument command must match its `CommandRouter` pattern exactly, or it falls
through to the LLM-based `rmm` resolver for what's often just a formatting mismatch. See
[GH issue #349](https://github.com/NeochromeTeam/sleuth-app/issues/349) for the full two-phase
breakdown and QA gates.

## Design (via `/ponytail`, refined via a 2-round Agy relay review — see Review history)

`BuildCanonicalCommand` (`src/command-intent-resolver.js:199`) already maps every catalog intent
to its exact router-matching string — the single source of truth for what the router expects.
Rather than hand-writing more `(?:-|\s+)` regex entries (a second source of truth that can drift),
derive hyphen/space tolerance automatically: for any intent whose canonical output is
**argument-invariant**, build a matcher that treats hyphen/space as interchangeable per token
boundary and rewrites to that literal.

**Argument-invariance check:** an intent qualifies only if `BuildCanonicalCommand(id, {})` (no
args) and `BuildCanonicalCommand(id, SentinelArgs)` (every arg slot filled) return the **same**
non-null literal. `SentinelArgs` is a `Proxy` (not a hardcoded key list), so any argument key the
switch reads — including ones added later — resolves to a non-empty sentinel automatically:
`new Proxy({}, { get: () => 'x', has: () => true })`.

## Explicit non-goal / safety boundary

Argument-bearing commands (`web-search <query>`, `ask-self <question>`, `search reminders
<keywords>`, model-switch's quoted model names) are excluded — no blind text scanning inside
argument content, ever. This also covers **optionally** argument-bearing commands like
`search-projects` and `test-github-sync`, which return a fixed literal with no arguments but also
accept a trailing query — the argument-invariance check excludes these automatically (their
no-arg and sentinel-filled outputs differ), so no separate allowlist or catalog metadata is
needed.

## Acceptance criteria

See the Phase 1 / Phase 2 checklists and QA gates in
[GH issue #349](https://github.com/NeochromeTeam/sleuth-app/issues/349). Phase 1 adds the generic
matcher for zero-argument (argument-invariant) commands only, with `search-projects` and
`test-github-sync` as explicit negative test cases. Phase 2 is conditional cleanup (remove
now-redundant hand-written model-switch regexes only if Phase 1 fully subsumes them) plus an
`ARCHITECTURE.md` note so future agents reuse the generic mechanism instead of hand-writing
another regex.

## Review history

2026-07-03 — 2-round relay review with Agy (`/relay-xyz`), reviewer-only. Round 1 (Blocker):
flagged that the original "non-null → safe" heuristic misclassified `search-projects` and
`test-github-sync`. Fixed with the argument-invariance check. Round 2 (Should, addressed):
hardcoded sentinel argument keys would silently miss future argument types — fixed with a
`Proxy` sentinel. Verdict: Approved. Full transcript in the xyz-3-agents-swarm harness repo:
`relay-system/2026-07-03/gh-349-hyphen-space-command-normalization-plan-review.md`.

## Swarm Preflight Contract

⚠️ **Chat-ladder collision cluster.** Write-set touches `src/command-intent-resolver.js` +
`data/static/ai/command-normalization.json` — the same spine as First-time-user UX and Command
Near-Miss Recovery. Those are currently HELD (not active), so there is no live collision today, but
**this lane must not share a wave with either of them** once they activate. Independent of the current
active lanes (GH-338 reminder-display, GH-355 events-projection, GH-351 web-api, GH-352/GH-348 docs).

```json
{
  "target": { "repo": ".", "ref": "development" },
  "gate": "npx jest command-intent-resolver",
  "fix_probes": [
    { "type": "grep_absent", "path": "tests/command-intent-resolver.test.js", "pattern": "hyphen" }
  ],
  "artifacts": [
    "src/command-intent-resolver.js",
    "data/static/ai/command-normalization.json",
    "tests/command-intent-resolver.test.js"
  ],
  "remediation": {
    "source": "self#approach",
    "criteria": "In src/command-intent-resolver.js, auto-derive hyphen<->space tolerance for argument-INVARIANT commands from BuildCanonicalCommand's canonical-string switch, using the Proxy-sentinel invariance check from the approved Agy review (so optionally-argument-bearing commands like search-projects / test-github-sync are NOT wrongly normalized). Remove now-redundant hand-written hyphen entries from data/static/ai/command-normalization.json where the derived logic subsumes them. Add hyphen/space normalization cases to tests/command-intent-resolver.test.js. DONE when: the resolver test covers hyphen<->space normalization (freshness probe flips to landed), argument-bearing commands are provably excluded, `npx jest command-intent-resolver` green."
  },
  "lanes": { "agy_safe": [], "orchestrator_only": [] }
}
```
