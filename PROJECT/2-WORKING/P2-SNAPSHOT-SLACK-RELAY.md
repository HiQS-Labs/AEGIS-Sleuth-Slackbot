---
title: P2 — Snapshot → Slack Relay (forward /snapshot output into #repo-snapshots via Sleuth)
created: 2026-06-17
updated: 2026-07-17
branch: feat/snapshot-slack-relay
status: >-
  Phases 0-3 COMPLETE and CONFIRMED LIVE on prod (verified 2026-07-17 via direct SSH to
  `sleuth-production` / 203.0.113.13, commit 0615d427 = v1.4.232, service active since
  2026-07-17T01:45Z — running code postdates the commit). Channel mapping confirmed:
  `SNAPSHOT_RELAY_WORKSPACES=neochrome` (only workspace enabled) → hardcoded channel
  `C000EXAMPLE3` (#repo-snapshots); no other workspace is enabled, no per-workspace channel
  override exists in code today (channelId defaults to `C000EXAMPLE3` for whichever workspace(s)
  the env allowlist names).
  **LIVE PROD BUG (found 2026-07-17, not fixed here):** the "post a short text summary" path
  succeeds every time, but the "attach the full snapshot as a file" path
  (`filesUploadV2` in `src/slack-app.js`) has failed on every attempt with
  `An API error occurred: missing_scope` since at least **2026-06-18** (first occurrence in
  `journalctl -u sleuth-app`, ~1 month of continuous silent failure — non-fatal by design, so
  it never surfaced). Same window shows intermittent GitHub `403`s fetching a couple of the
  queued snapshot files. Net effect: `#repo-snapshots` has been getting the header/summary line
  for each snapshot, never the actual snapshot content. Needs a Slack app admin to check/re-grant
  the bot token's file-upload scope (likely `files:write`) in the Slack app config — this is an
  OAuth-scope/Slack-admin fix, not a code fix.
owner: noel
author: Claude (Opus 4.8, 1M)
model: env-gated local hook (trigger) + Sleuth Slack leaf (delivery) — stateless pass-through, no new authoritative state
goal: >
  Forward every locally generated /snapshot into the private #repo-snapshots Slack channel
  via Sleuth's existing bot — opt-in, stateless, and introducing no new authoritative state.
complexity: 2
risk: 2
effort: 3
phases: 4
related:
  - ~/.claude/skills/snapshot/SKILL.md (the /snapshot skill — UNCHANGED by this plan; sourced from the SHARED upstream repo giant-brains-claude-skills, so it must NOT be forked for this feature)
  - src/slack-app.js (PostMessage :548, post-with-blocks :603, GetChannelIDForName :904)
  - src/web-api.js (Express API on :2020, Bearer-gated :186 — relevant only to Option A)
  - PROJECT/2-WORKING/P3-EVENT-SOURCED-CORE.md (orthogonal — see Non-Conflict note below)
summary: >-
  Forward every locally generated /snapshot into a Slack channel (#repo-snapshots)
  through Sleuth's existing bot, gated by a single opt-in environment variable
  (snapshot_sleuth=true). The /snapshot skill is NOT modified — it stays global and
  unaware. A Claude Code PostToolUse hook fires once when the Write tool touches
  snapshot.md, runs a one-shot forwarding script that no-ops unless the env var is
  set, and ships the newest snapshot entry to Sleuth. Sleuth resolves the channel
  and posts via the PostMessage leaf it already has. This is a stateless notification
  pass-through: it introduces NO authoritative state, never enters the FSM or the
  P3 event log, and therefore does not conflict with the event-sourced-core work.
---

# P2 — Snapshot → Slack Relay

## Status

| What was just completed | What's next |
|---|---|
| **Phases 1–3 COMPLETE — relay ACTIVATED on prod (2026-07-06).** Phase 1 forwarder + hook installed; Phase 2 module (`src/snapshot-relay-module.js`) built + hardened (atomic write, Contents-API read, restart-seed fix, single-atomic-post) and **verified already deployed to prod `main`** (blob `dc74b22`; hardening commits `b31cbcd`/`505d981`/`af14b3b`/`e885147` all in prod HEAD — the earlier "prod runs the pre-hardening module" note was stale). **Activated 2026-07-06:** both prereqs confirmed met (PAT reads the private repo → HTTP 200) and `SNAPSHOT_RELAY_ENABLED=true` set in the `neochrome` workspace + service restarted; log confirms `snapshot-relay: resuming with 2 seen file(s); new arrivals will post`. `#repo-snapshots`=`C000EXAMPLE3`. | **Final live-chain confirmation (operator):** run one `/snapshot` from the laptop → it lands in the pulse repo → the relay polls (~60s) → posts to `#repo-snapshots`. Server side is proven live (seeded, polling); only a fresh snapshot event remains to exercise the full laptop→pulse→server→Slack path end-to-end. |

## Non-Conflict with P3 (Event-Sourced Core)

P3 is scoped to **reminder lifecycle facts** flowing through the FSM's `#TransitionReminderState`
chokepoint into a per-workspace append-only log. This feature is a **stateless notification
pass-through**: it introduces no new authoritative state, never enters the FSM or the event log,
and only calls the existing `PostMessage` leaf. In P3's own authority terms it is "audit-only" —
the lightest tier P3 explicitly does not gate. The two can be built independently. Snapshots are
deliberately kept **off** the event ledger (they are not reminder commitments; modeling them as
events would be over-engineering).

## Privacy Constraint (carried through every phase)

Snapshots capture **verbatim chat content** — the `/snapshot` skill keeps `snapshot.md` out of git
precisely because "it can contain anything pasted into the chat." Forwarding therefore means that
content lands in Slack history (and, under Option B, in a git repo). Non-negotiables for this plan:

- `#repo-snapshots` is a **private** channel.
- The env-var gate is the opt-in — default OFF; nothing forwards unless `snapshot_sleuth=true`.
- Under Option B, the watched drop path must be **gitignored in any human-facing repo** or use a
  dedicated repo whose access matches the channel's.

## Table of Contents

- [Phase 0: Decision Gate & Channel Setup](#phase-0-decision-gate--channel-setup)
- [Phase 1: Local Trigger — Env-Gated Hook + Forwarding Script](#phase-1-local-trigger--env-gated-hook--forwarding-script)
- [Phase 2: Sleuth Delivery Side](#phase-2-sleuth-delivery-side)
- [Phase 3: End-to-End Wiring & Hardening](#phase-3-end-to-end-wiring--hardening)
- [Model Guidance (Sonnet High vs Opus, per phase)](#model-guidance-sonnet-high-vs-opus-per-phase)
- [Appendix A: Transport Options Compared](#appendix-a-transport-options-compared)

---

## Model Guidance (Sonnet High vs Opus, per phase)

Principle: **Opus for judgment** — architecture, security-surface, and one-way-door decisions;
**Sonnet High for bounded execution** — deterministic scripting, wiring, and test runs. Default to
the cheaper tier per phase and escalate only on the named trigger.

| Phase | Default model | Why | Escalate to Opus when |
|---|---|---|---|
| **Phase 0 — Decision Gate & Setup** | **Opus** for the live decisions (transport A/B, content policy, hook scope); **Sonnet High** for the mechanical Slack setup | The decisions set the blast radius for everything downstream; the channel/bot setup is rote | n/a — the decisions *are* the Opus part. If they're already settled, run the whole phase on Sonnet High |
| **Phase 1 — Local Trigger (hook + script)** | **Sonnet High** | Self-contained bash/node, deterministic, well-specified by the plan | A cross-platform/quoting/env-inheritance bug in the hook resists 2+ Sonnet attempts |
| **Phase 2 — Sleuth Delivery Side** | **Opus** for the integration design, then **Sonnet High** for the wiring | Touches Sleuth internals (dedup, watcher lifecycle) and — under Option A — adds a new authenticated inbound surface; integration + security want the stronger tier | **Always Opus for Option A's endpoint** (auth/allowlist on a live server is one-way-door-ish) |
| **Phase 3 — End-to-End & Hardening** | **Sonnet High** | Mostly running the chain, asserting output, writing a regression test | Debugging a cross-machine/transport failure, or auditing the **verbatim-content privacy path** before it goes live |

Rule of thumb: if the step changes *what the system is allowed to do* (a decision, an auth surface,
a privacy posture), reach for Opus; if it changes *how an already-decided thing is wired*, Sonnet
High is the right cost/quality point.

---

## Phase 0: Decision Gate & Channel Setup

One-time setup and the single fork the rest of the plan depends on.

**Model:** Opus for the decisions (transport, content policy, hook scope) · Sonnet High for the Slack setup.

- [x] **Decide transport** → **Option B (file-drop / git-pull).** Rationale: matches the architecture after the SSH-tunnel removal; no new inbound attack surface.
- [x] Create the Slack channel `#repo-snapshots` as a **private** channel → done (Neochrome workspace, `is_private=true`).
- [x] Invite the Sleuth bot ("Sleuth AI v2") to `#repo-snapshots` → done (`is_member=true`).
- [x] Confirm `GetChannelIDForName('repo-snapshots')` resolves → **`C000EXAMPLE3`** (verified against prod via the same public+private list path the app uses; [slack-app.js:904](src/slack-app.js#L904)).
- [x] **Decide hook scope** → **user-level** (`~/.claude/settings.json`, all repos), still gated by `snapshot_sleuth=true` so it only forwards where opted in.
- [x] **Decide content policy** → **full verbatim entry** (the whole newest snapshot entry, including the verbatim last response).
- [x] Record the decision and rationale → see **Phase 0 Decisions (recorded)** below.

### Phase 0 Decisions (recorded) — 2026-06-17

| Decision | Choice | Consequence for the build |
|---|---|---|
| **Transport** | Option B — file-drop / git-pull | Phase 2 builds the Sleuth-side **Node watcher**, not the API endpoint. No `:2020` exposure. |
| **Hook scope** | User-level (`~/.claude`), all repos | Phase 1 hook lives in `~/.claude/settings.json`; the `snapshot_sleuth=true` gate is the per-environment opt-in. |
| **Content policy** | **Full verbatim entry** | Phase 3 forwards the entire newest entry, including the verbatim last response. |

**Hard constraint created by these three together (must hold in Phase 1):**
User-level (all repos) + full verbatim + Option B means the forwarding script **MUST write to a single
dedicated, private drop location** — never into whatever project repo you happen to be in. Committing
verbatim chat content into arbitrary project repos is the failure mode this rules out.

**Drop target decided (2026-06-17): reuse the private `~/git-pulse-sync` repo** (remote
`example-org/export-repo`) — confirmed **private and solo-access** (matches the private
channel's audience), with snapshots in a dedicated `snapshots/` subdir the pulse tooling never touches.
Chosen over a new `sleuth-snapshot-drop` repo because its sync is already proven. The script targets
it via `SNAPSHOT_SLEUTH_DROP_DIR=~/git-pulse-sync` (configurable; the committed script bakes in no personal
path) and **does NO git** — it only writes the file via a temp-file + atomic rename, then exits. The
existing **git-pulse sync carries it** (its `stage_paths` now includes `snapshots/`); delivery latency =
the pulse cadence. The Sleuth **server reads it back via the GitHub Contents API + the existing
`SLEUTH_RAG_GITHUB_PAT`** (the same mechanism the reminders-export timer already uses) — no clone, no new
server credential. *(Revised 2026-06-18 after a Codex design relay: the hook's own git push was both
over-engineered and broke on the pulse clone's detached-HEAD state; transcript in `RELAY-SYSTEM/2026-06-18/`.)*

**Privacy posture (verbatim chosen — eyes open):** full chat content will live in (a) Slack history of
`#repo-snapshots` and (b) the dedicated drop repo. Both MUST be private and access-scoped to the same
audience. The channel-is-private and no-secrets QA items below are now load-bearing, not nice-to-have.

### QA Checklist — Phase 0

- [x] **Observable:** test message posted as the Sleuth bot to `#repo-snapshots` succeeded (`chat.postMessage ok=true`, ts `1781754190.002369`) — proves membership + write permission before any code.
- [x] Transport decision is written down with its trade-off, not just chosen → see recorded-decisions table.
- [x] Privacy: channel confirmed **private** (`is_private=true`).
- [x] Content policy (verbatim vs summary) is decided and written down — not deferred into an implementation phase.
- [x] No secrets (bot token, bearer token) were pasted into the plan or any committed file.
- [x] DRY: confirmed we are reusing the existing `PostMessage`/`GetChannelIDForName` leaf, not adding a second Slack-posting path (Option B's watcher calls the existing leaf).

---

## Phase 1: Local Trigger — Env-Gated Hook + Forwarding Script

The laptop side. Event-driven, opt-in, and completely decoupled from the `/snapshot` skill.

**Model:** Sonnet High (bounded scripting) · escalate to Opus only on a stubborn hook/env bug.

- [x] **PostToolUse hook INSTALLED** in `~/.claude/settings.json` — matcher `Write|Edit` → `node ".../tools/snapshot-sleuth-forward.js"`; `env` block sets `snapshot_sleuth=true` + `SNAPSHOT_SLEUTH_DROP_DIR=~/git-pulse-sync`. JSON validated; existing SessionStart/SessionEnd hooks preserved. Fires on next `/snapshot` (after a settings reload).
- [x] Forwarding script written → [tools/snapshot-sleuth-forward.js](tools/snapshot-sleuth-forward.js) (Node). Gate is the first action: `process.env.snapshot_sleuth !== 'true'` → exit 0.
- [x] Script extracts the **newest entry only** — **delimited by the `# 📸 Snapshot` header, not by `---`** (confirmation caught + fixed a truncation bug: a `---` inside the verbatim body was cutting the entry short).
- [x] Script prepends a **device tag** (`scutil --get ComputerName` → `os.hostname()` fallback) + source-repo name, derived at forward time — never written into `snapshot.md` or the skill.
- [x] Script writes the full verbatim payload to the drop path and **exits** (one-shot; no loop/watcher). Filename is collision-proof: `<utc-seconds>__<host>__<sha8>.md` (confirmation tightened minute→seconds + content hash so two snapshots in one session can't overwrite).
- [x] Documented where `snapshot_sleuth` must live (README §2: shell profile or `settings.json` `env` block; a one-off terminal export won't reach the hook).
- [x] Failures non-fatal: every path is wrapped, always `exit 0`; live test confirmed a push failure (no remote) logs WARN and the forward still completes.

### QA Checklist — Phase 1

- [x] **Observable (gate OFF):** env unset → script exits 0 with no output, nothing forwarded (verified).
- [x] **Observable (gate ON):** `snapshot_sleuth=true` dry-run → exactly the newest entry's full verbatim body is in the payload (verified against real `snapshot.md` + an internal-`---` fixture).
- [x] **Observable (idempotent trigger):** live test — two runs produced two distinct files + two commits, no overwrite (`<utc-s>__<host>__<sha8>`).
- [~] **Observable (device attribution):** payload carries the host tag (`noels-Mac-Studio.local` in the live test); the **in-Slack** appearance is confirmed in Phase 3 once the watcher posts.
- [x] Failure isolation: transport/push failure logs WARN and the forward still completes; script never exits non-zero (verified).
- [x] Operator notes document **where** `snapshot_sleuth` must be set (README §2).
- [x] The `/snapshot` SKILL.md is **byte-for-byte unchanged** (untouched; confirmed by the subagent and orchestrator).
- [x] Observability: success/failure logged to `~/.sleuth-snapshot-drop/forward.log` (fallback `~/.claude/...`) + stderr.

---

## Phase 2: Sleuth Delivery Side

Concrete now that Phase 0 fixed the transport to **Option B**. A Sleuth-side module watches the reused
`export-repo` repo's `snapshots/` dir and posts each new payload to `#repo-snapshots`
(`C000EXAMPLE3`) **exactly once**, via the bot Sleuth already runs.

**Model:** Opus designed this section (below) · **Sonnet High** wires it.

### Design (decided — Opus, 2026-06-17)

- **Where it runs:** a new module `src/snapshot-relay-module.js`, started from [app.js](src/app.js) **after** the Neochrome `SlackApp` is up (it posts through that instance — the bot token is per-workspace). Single-workspace: Neochrome only.
- **Feature-flagged OFF by default** (`SNAPSHOT_RELAY_ENABLED` on the neochrome workspace config / env), mirroring the summarize-week cutover pattern — zero behavior change until explicitly enabled.
- **Source = GitHub Contents API (NOT a clone):** mirrors the existing [publish-reminders-export.mjs](deploy/reminders-export/publish-reminders-export.mjs). The module **polls** (default 60s) by listing `snapshots/` over `api.github.com` and GETting each new file, reusing the PAT already on the server (`SLEUTH_RAG_GITHUB_PAT`, `repo` scope). No clone, no working tree, no deploy key. *(Revised 2026-06-17 after finding the server publishes reminders this same way — see Phase 2 prereqs.)*
- **Minimal server footprint + privacy:** because it only API-reads `snapshots/`, nothing else from the pulse repo (calendar/email/pulse files) ever touches the Vultr box.
- **Exactly-once:** a persisted seen-set (`data/runtime/snapshot-relay-seen.json`) keyed by payload filename (already unique: `<utc-s>__<host>__<sha8>`). A file is marked seen **only after a successful post**, so a failed post retries next cycle and restarts never double-post.
- **No backlog flood:** on first run with no state, **seed the seen-set from existing files without posting** (start-from-now) and `log` how many were skipped — never replay history into the channel.
- **Long-content handling (required):** verbatim entries can exceed Slack's text limit. Post a **compact header message** (device · repo · branch · session · status) and deliver the **full verbatim entry** inline when it fits (~<3500 chars), else as an uploaded `.md` snippet (reuse Sleuth's file-upload leaf; see `tests/slack-harness-file-upload.test.js`). Never let a long entry throw `msg_too_long`.
- **Reuse the existing leaf:** resolve via `GetChannelIDForName` (or the known id `C000EXAMPLE3`) and post via `PostMessage`/post-with-blocks ([slack-app.js:548](src/slack-app.js#L548)/[:603](src/slack-app.js#L603)) — no second bot client.

### Build checklist

- [x] [`src/snapshot-relay-module.js`](src/snapshot-relay-module.js) — `SnapshotRelayModule(ArgSlackApp, ArgLogger, ArgConfig?)`; injectable `gitRunner`, default channel `C000EXAMPLE3`, default OFF.
- [x] Started from [app.js](src/app.js) after the workspace modules; **no-op when the flag is off** (gate inside `StartAsync`).
- [x] On start: seed seen-set by **listing the remote `snapshots/` dir via the Contents API** (404 → empty) without posting; logs `N skipped (seed)`. No clone.
- [x] `RunOnceAsync`: list `snapshots/` via API → GET each unseen file → post → **add to seen-set only on post success** + persist (`data/runtime/snapshot-relay-seen.json`). Injectable `githubClient` for tests.
- [x] All failures non-fatal (pull/scan/post wrapped); recursive `setTimeout` (no overlap); `StopAsync` clears the timer.
- [x] Unit test [tests/snapshot-relay-module.test.js](tests/snapshot-relay-module.test.js) — 4/4 pass; full suite **65 suites / 1122 tests green** (Opus-confirmed, no regressions).

### Phase 2 prerequisites (manual / setup)

- [x] Server read access — **already satisfied**: `SLEUTH_RAG_GITHUB_PAT` (in `/root/sleuth-app/.env.runtime`, `repo` scope) already reads/writes `export-repo` — the reminders-export systemd timer uses it every 5 min (verified active). No deploy key needed.
- [ ] **Only remaining go-live step:** set `"SNAPSHOT_RELAY_ENABLED": true` in `data/runtime/workspaces/neochrome_workspace.json` on the server (repo/dir/branch + PAT default from env), then restart Sleuth.

### QA Checklist — Phase 2

- [x] **Exactly-once** (unit-verified): one file → one post; second `RunOnceAsync` → no re-post. *(live in-channel confirm = Phase 3.)*
- [x] **No double-post** (unit-verified): seen-set persisted; not re-posted across runs.
- [x] **No backlog flood** (unit-verified): N existing files → zero posts, logs `N skipped (seed)`.
- [x] **Long snapshot** (unit-verified): over-limit entry → header post + `UploadFileAsync` snippet, not a raw text post.
- [x] **Flag-off safety** (unit-verified): flag off → no post, no timer, seen-set untouched.
- [x] SOLID/DRY: posting reuses `PostMessageTextAsync` / `UploadFileAsync`; no parallel bot client (Opus-confirmed in review).
- [x] Privacy: clone uses `--filter=blob:none --sparse` + `sparse-checkout set snapshots` — only `snapshots/` lands on the box (code-confirmed; live-confirm on the server in Phase 3).
- [x] Observability: post/skip/seed/error all `logger`-logged with file + outcome.

---

## Phase 3: End-to-End Wiring & Hardening

Prove the whole chain and close the rough edges before calling it done.

**Model:** Sonnet High · escalate to Opus for cross-machine transport debugging or the privacy-path audit.

- [ ] Full path test: `/snapshot` in VS Code (gate ON) → hook → transport → Sleuth → message visible in `#repo-snapshots`.
- [ ] Verify the posted message is **readable** in Slack: title/timestamp/session label survive; markdown/code fences render acceptably.
- [ ] Confirm gate-OFF default across a fresh shell (no leaked env) — opt-in really is opt-in.
- [ ] Implement the content policy chosen in Phase 0 (verbatim entry vs header + summary) and verify the posted message matches that choice.
- [ ] Update `CHANGELOG.md` and operator notes (and `ARCHITECTURE.md` if a new directory/endpoint was added).
- [ ] Add a regression test on the Sleuth side mirroring existing `tests/slack-*.test.js` patterns (mock the Slack client; assert resolve+post on a sample payload).

### QA Checklist — Phase 3

- [ ] **Observable (happy path):** end-to-end run posts a correctly formatted snapshot to the channel.
- [ ] **Observable (default safety):** brand-new environment with no `snapshot_sleuth` → zero forwards.
- [ ] Privacy re-confirmed: channel still private; no snapshot content leaked into a public repo/channel along the way.
- [ ] DRY/observability/SOLID re-checked against the final diff (no second Slack path, all hops logged).
- [ ] Docs match reality: CHANGELOG + operator notes describe the actual wiring and the env-var switch.
- [ ] Rollback is one line: unset `snapshot_sleuth` (and/or remove the hook) fully disables the feature with no residue.

---

## Appendix A: Transport Options Compared

| | **Option B — file-drop / git-pull** (recommended) | **Option A — Sleuth API endpoint** |
|---|---|---|
| How | Hook writes/commits the snapshot to a path Sleuth pulls; Sleuth Node watcher posts it | Hook does an authed `POST /slack/post` to Sleuth on `:2020` |
| Reach | Uses the git-pull path already adopted after the SSH tunnel was removed | Needs laptop → `:2020` reachability — **re-introduces** a tunnel/exposure that was removed |
| Latency | Whenever Sleuth pulls/polls | Instant |
| New Sleuth code | One small Node watcher | One Bearer-gated endpoint (+ channel allowlist) |
| Risk posture | Consistent with current architecture; no new inbound surface | New authenticated inbound surface to secure |

**Recommendation: Option B** — it matches the direction the system already moved (published files over a live tunnel), adds no new inbound attack surface, and the only new code is a small watcher reusing Sleuth's existing process and Slack leaf. Choose Option A only if instant delivery is worth standing the tunnel back up.
