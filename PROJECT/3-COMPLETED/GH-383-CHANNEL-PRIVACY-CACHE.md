---
title: "ask-reminders: cache channel privacy so a transient Slack outage can't silently drop matches"
status: Planned (1-INBOX) — not started
created: 2026-07-16
updated: 2026-07-16
owner: noel
branch: fix/gh-383-channel-privacy-cache
doc_type: project
gh_issue: 383
source: https://github.com/NeochromeTeam/sleuth-app/issues/383
related: "#367 (query core), #380 (assignor filter); ask-reminders-command.js, reminder-query-engine.js"
effort: 2
complexity: 2
risk: 2
phases: 2
---

# GH-383 — Channel-privacy resolution is fail-closed on transient errors → silent false negatives

## Problem (verified on prod 2026-07-15)
A 2-second Slack `conversations.info` outage (6× `channel_not_found` @ 22:35:55–56) made every
candidate channel resolve to `null`. `IsChannelPrivateAsync` swallows the error → `null`;
`BuildPrivateChannelSetAsync` treats `null` as **private (fail-closed)** → all 8 Client A reminders
scoped out → **"No matching tasks found."** Same query re-run: `matchedCount 8 of 13`.

Fail-closed is **correct for security** (never leak a private channel) but conflates "couldn't
determine" with "genuinely private", turning a transient blip into a confident wrong answer.

## Integration points
- `src/chat-commands/ask-reminders-command.js` — `BuildPrivateChannelSetAsync()` (the per-query
  privacy resolver + the `Result.matchedCount === 0` short-circuit reply).
- `src/slack-app.js#IsChannelPrivateAsync` (L978) — live `conversations.info`, catches → `null`.
- `src/reminder-candidates.js#AssembleCandidates` / `reminder-query-engine.js#IsVisibleUnderScope`
  — consume the resolved `channelIsPrivate` boolean. **No change needed** (fix is upstream).

## Design (deterministic-first, security preserved)
Two roles kept distinct: **known-private** (exclude, silent) vs **unresolved** (exclude for safety,
but *surface it*). Warm channels never hit the live API, so an outage is a non-event for them — and
the Client A client channels are hit constantly, so they're effectively always warm.

## Phase 1 — Channel-privacy cache (the primary fix)
- [ ] **P1.1 — `src/channel-privacy-cache.js` (pure-ish core, testable).** Per-workspace
      `Map<channelId, { isPrivate: boolean, atMs: number }>`; `ResolvePrivacyAsync(channelId, liveResolver, nowMs, ttlMs)`:
      fresh cache hit → return cached; miss/stale → call `liveResolver`; on boolean → store + return;
      on `null`/throw → **do not store**, return sentinel `UNRESOLVED`. TTL default ~1h.
      Unit tests: hit/miss/stale/error-no-store/UNRESOLVED-passthrough (fake resolver + injected `nowMs`).
- [ ] **P1.2 — wire into ask-reminders.** `BuildPrivateChannelSetAsync` resolves via the cache;
      module-level cache keyed by workspace. Warm channel + live outage ⇒ result unchanged (uses cache).
      Security invariant: `UNRESOLVED` still excludes (fail-closed) — cache only removes the *live
      dependency*, never relaxes exclusion.

### QA gate — Phase 1
- [ ] Simulated `conversations.info` failure with a warm cache ⇒ matched set **unchanged** (the bug).
- [ ] A genuinely private non-query channel is still excluded (no security regression).
- [ ] Cold + errored lookup still excludes (fail-closed preserved).

## Phase 2 — Surface partial resolution failure (defense in depth)
- [ ] **P2.1 — track UNRESOLVED channels for the query.** Collect channelIds that resolved to
      `UNRESOLVED` this run.
- [ ] **P2.2 — honest empty-result reply.** If `matchedCount === 0` **and** ≥1 candidate channel was
      UNRESOLVED, reply *"Couldn't verify N channel(s) right now — results may be incomplete, try
      again."* instead of the flat "No matching tasks found." (Genuine empty ⇒ unchanged copy.)

### QA gate — Phase 2
- [ ] Empty result with an UNRESOLVED channel ⇒ "may be incomplete" copy (not a flat empty).
- [ ] Empty result with all channels resolved ⇒ unchanged "No matching tasks" copy.

## Out of scope (YAGNI — note for later)
- Membership-event-driven cache invalidation (TTL covers staleness for v1).
- Sharing the cache with other command paths (start local to ask-reminders; promote if a second
  caller wants it).
- Retrying the failed **reply post** (that's Slack being down; orthogonal to the false-negative).

## Constraints
Fail-closed for security is non-negotiable (multi-tenant isolation, AGENTS.md MUST). Deterministic
core with injected clock/resolver — no real Slack in tests. `npm test` green. Bump version + CHANGELOG.

## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npx jest channel-privacy-cache ask-reminders --forceExit",
  "fix_probes":  [
    { "type": "path_absent", "path": "src/channel-privacy-cache.js" }
  ],
  "artifacts":   [
    "src/chat-commands/ask-reminders-command.js",
    "src/slack-app.js",
    "src/reminder-candidates.js"
  ],
  "remediation": { "source": "self#phases", "criteria": "GH-383 Phase 1 (privacy cache P1.1/P1.2) + Phase 2 (UNRESOLVED surfacing)" },
  "lanes":       { "agy_safe": [], "orchestrator_only": [] }
}
```

<!-- Preflight note: `artifacts` are EXISTING anchors at the ref; the NEW file the lane creates
     (src/channel-privacy-cache.js) goes in the MARATHON.yaml phase `artifact` write-allowlist. -->

## Progress log
- 2026-07-16: diagnosed from prod logs (transient `channel_not_found` burst), issue #383 filed, plan
  drafted, parked in ROADMAP. Not started. Branch to be cut from `development`.
- 2026-07-15: added to the `sleuth-hardening-383-387-388` marathon (phase p2, before #388) + preflight
  contract. Still not started.
