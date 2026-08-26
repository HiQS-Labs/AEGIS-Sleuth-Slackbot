# ROUTER.md

This file is the first entry point for an AI agent working in this repo: it tells you what to read,
what to run, and which files are canonical.

## Branches

`development` is the **primary branch** (the repo default). Cut work from it and target PRs at it.
`main` is the **release branch** — protected, requires the `test` check, and production deploys from
it. `development` is intentionally unprotected: CI runs there but does not block. Full contract in
`CONTRIBUTING.md` -> "Branches"; deploy split in `docs/deployhq.md`.

## Role split

- `ROUTER.md` = startup order and canonical entry points
- `AGENTS.md` = Sleuth's own behavioral contract and non-negotiables (architecture-first search, RAG
  usage, Slack Bolt/OpenAI/Express stack, multi-tenant isolation) — the canonical agent contract for
  this repo and intentionally contract-only; read it in full, but use `ARCHITECTURE.md` for
  system/persistence inventories and reminder write-path details, `docs/web-api.md` for
  endpoint/auth payload inventories, and `src/workspaces.js` for workspace field definitions,
  required/optional validation, and compatibility rules
- `CLAUDE.md` = thin pointer to `AGENTS.md` for Claude Code specifically
- `GUIDING-PRINCIPLES.md` = the doc-governance north star that PDDA's checks answer to (not Sleuth's
  product principles — those live in `AGENTS.md` / `ARCHITECTURE-DECISIONS.md`)
- `README.md` = human-facing repo/product overview
- `docs/getting-started.md` = human first-run onboarding (requirements checklist + clone → Slack → verify)
- `docs/deployhq.md` = operator deploy path (DeployHQ for development + production; deploys do not
  use GitHub Actions — Actions still runs PR/push CI and the secret scans, see GH-15)
- `ARCHITECTURE.md` = living canonical system design; `ARCHITECTURE-DECISIONS.md` = graph-derived
  snapshot of past decisions (regenerated via `codebase-memory-mcp`, not hand-authored — see its file
  header for regen steps)
- `ROADMAP-DASHBOARD.md` = the generated, read-only view of the roadmap ledger (read this; regenerate
  with `utils/roadmap-dashboard.sh`)
- `ROADMAP.md` = LEGACY ledger, frozen since the `ROADMAP_SOURCE=releases` flip (`.pdda-mode`,
  2026-08-26) — `releases.db` (via `releases.sql`) is the source of truth; write via
  `python3 utils/py/releases_app.py roadmap add`, never by editing this file. The marathon scheduling
  layer (`utils/marathon-plan.sh`, vendored via `.xyz/`) still parses this frozen file directly and
  has not been updated for releases-mode upstream — a known gap (same one XYZ-forge's own GH-243
  left open for itself); do not rely on a marathon run here picking up anything parked after the flip
  until that script is updated
- `CHANGELOG.md` = the end-of-iteration running log (governed by `PROJECT/PDDA.md`)
- `RELEASES.md` = the forward-looking release-planning ledger (governed by `PROJECT/PDDA.md`)
- `PROJECT/PDDA.md` = the canonical PDDA contract and automation rules for this repo's docs
- `utils/pdda/PDDA-INSTALL.md` = the extraction/install manifest (PDDA is synced in from its
  standalone HQ repo via `install.sh`; this repo does not carry that installer)
- `utils/pdda/pdda.sh` = the unified runnable PDDA surface (dispatcher + every deterministic check +
  `run`)
- `utils/pdda/pdda-doc-ready.sh` = the opt-in LLM readiness review

## Startup sequence

1. Read `ROUTER.md` (this file). -> expect one clear next file, not a repo-wide scavenger hunt.
2. Read `AGENTS.md` in full before making recommendations or edits. -> expect Sleuth's stack
   constraints, RAG-first search discipline, and non-negotiables honored; use the canonical docs it
   points to for detailed inventories.
3. Read `GUIDING-PRINCIPLES.md` if the task touches doc governance, roadmap hygiene, or the PDDA
   layer itself. -> expect the north star PDDA's checks answer to.
4. For repo-management, doc-governance, or "what changed recently" tasks, read `CHANGELOG.md` (top
   entries), `PROJECT/PDDA.md`, and `ROADMAP-DASHBOARD.md` (or `python3 utils/py/releases_app.py
   roadmap list`) in that order before going further. -> expect current operational state and the
   source of truth for lifecycle/enforcement rules; recent work concentrates here, not in
   `README.md`. (`ROADMAP.md` is the frozen legacy file — do not read it for current state or edit
   it.)
5. Read `README.md` for the product's purpose and baseline usage. -> expect a short explanation of
   what Sleuth does; this is a conditional background read, not required once step 4 already covers
   the task.
6. Before reporting success on repo changes, run `utils/pdda/pdda.sh run` or a narrower check
   (`utils/pdda/pdda.sh <check>`). -> expect deterministic findings first, then any LLM review.

## Debugging an AI decision (analysis, extraction, synthesis, triggers)

When a reminder, a routed command, or any other model-backed decision comes out wrong, start here
rather than reading the pipeline top to bottom. Every AI decision in Sleuth funnels through one
chokepoint and one debugging surface (GH-44):

| You want to know | Use |
|---|---|
| Why did THIS message produce THAT reminder? | React `:wrench:` on the message in Slack. The triage reply shows the recommendation, rationale, per-candidate trigger/task/date-parse, **why the task text looks the way it does** (synthesis routing facts), and **how ownership resolved** — running the real resolver, so triage cannot describe a rule the pipeline no longer follows. |
| Why is this reminder assigned to the WRONG person? | The `resolvedFrom` value in that triage section names the rule that fired: `first-person-commitment`, `second-person-ask`, `analyzer-speaker`, `analyzer-mentioned`, `mentions`, or `sender-fallback`. Ownership comes from the **grammatical subject of the commitment**, never from scraping mentions — see `src/reminder-ownership.js` (GH-43). |
| Why was my whole message pasted into the task bullet? | The `routed_by` and `synthesis` values in the `reminder display source:` log line, also surfaced in `:wrench:`. A message routes to synthesis by sentence count OR by the buried-task ratio; `ratio_usable=no` means no quoted span was available to judge it by. Thresholds and their derivation are inlined at `BURIED_TASK_MIN_LENGTH` / `BURIED_TASK_MAX_SPAN_RATIO`. |
| Why did the reminder quote me instead of using a tidy title? | The grounding constraint rejected the model's title because it named an entity, identifier, or number absent from your message. Look for `discarding an ungrounded reminder title` in the logs; the rule lives in `src/task-grounding.js`. |
| What does the pipeline decide across many messages? | `npm run decision:replay` — replays the scenario battery at `tests/fixtures/decision-scenarios/` and reports `PASS`/`FAIL`/`CHANGED-vs-baseline` per scenario. Deterministic, zero network calls. |
| Did my change alter behavior? | `npm run decision:replay` diffs against the committed baseline; `--update-baseline` re-records it (never implicit). |
| What did production actually decide? | Enable capture (`SetDecisionCapture`) and read the JSONL corpus under `data/runtime/shadow/`. Replay it with `--from-corpus`. |

Where the pieces live:

- `src/ai-decision.js` — **the chokepoint.** `DecideAsync` owns asset loading, the model call,
  required-field validation, the caller's own `Validate` hook, the failure policy, and corpus
  capture. A decision is declared as an `AiDecisionSpec`; add `DebugFacts` to it and the facts show
  up in `:wrench:` and the corpus with no rendering code to touch.
- `src/decision-corpus-store.js` — append-only per-workspace JSONL, never throws into a hot path,
  non-authoritative and deliberately outside `data/runtime/events/`.
  `src/router-shadow-store.js` is a back-compat facade over it pinned to the GH-397 stream.
- `src/decision-explain.js` — decision-agnostic renderer for debug facts, plus the ONE shared
  mention-extraction rule ownership is read from.
- `src/reminder-ownership.js` — **who owns a reminder** (GH-43). Reads the grammatical subject of the
  commitment; the analyzer's `owner` verdict only breaks ties where grammar is ambiguous.
  `ConstrainAssigneeToParticipants` is the shared "never invent users" guard both ownership paths run
  through — it is enforced here in code, not only in the prompts.
- `src/task-grounding.js` — **the grounding constraint** (GH-43). Decides whether a synthesized title
  or context line may be shown: every quoted string, standalone number, identifier, and proper noun
  it names must appear in the source. This is what makes rewriting the display text safe while
  `actionable_language` stays byte-exact as the audit span.
- `scripts/decision-replay.js` — the replay/diff harness. Its scenario battery is the falsifiability
  gate for all of the above: several tests deliberately perturb a mechanism and assert the battery
  goes red, so a guard that silently stops working cannot pass as green.
- `data/static/ai/*-instructions.md` + `*-schema.json` — every prompt asset. Keep new pairs
  registered in `scripts/validate-ai-prompts.js`; an asset missing from that map is silently skipped
  and `validate:ai` still exits 0 (issue #41), so assert on its `OK:` output, not the exit code.

Full design and phase history: `PROJECT/2-WORKING/GH-44-DECISION-CAPTURE-DEBUG.md` (the capture and
debugging subsystem) and `PROJECT/2-WORKING/GH-43-REMINDER-EXTRACTION-FIDELITY.md` (extraction
fidelity — ownership, synthesis routing, and the task/context split, with the measured before/after
for each).

## Canonical rules

- `AGENTS.md` is Sleuth's canonical behavioral contract — do not duplicate or contradict it here.
- Do not put phase checklists, build steps, or deep execution notes in the roadmap ledger.
- Every active doc in `PROJECT/2-WORKING/` must be reflected by a pointer row in the roadmap ledger
  (the RELEASES DB) — park it with `python3 utils/py/releases_app.py roadmap add`, or opt out with
  `roadmap_exempt: true` in its frontmatter. (`utils/pdda/pdda.sh roadmap-coverage` still checks the
  legacy `ROADMAP.md` text, not the DB — repointing it is an open follow-up, same as XYZ-forge's own
  reference implementation left for itself.) Governance lives in `PROJECT/PDDA.md`.
- Do not override deterministic PDDA findings with prose.
- Do not report a win you did not verify with the relevant script or test.
- Update `CHANGELOG.md` at the end of each iteration; its governance lives in `PROJECT/PDDA.md` — do
  not re-specify CHANGELOG rules in `AGENTS.md` or elsewhere.
- Generated overlays under `PROJECT/2-WORKING/` (e.g. `MARATHON-PLAN-*.md`, marked `roadmap_exempt:
  true` in frontmatter) are scheduling aids — historically derived from `ROADMAP.md`, and still are:
  the marathon scheduler has not been repointed at the DB (see the `ROADMAP.md` entry above). Treat
  them as a known-stale input until that script is updated, and never hand-edit them or treat them as
  canonical.

## RELEASES DB — release + roadmap ledgers (GH-32, GH-69, GH-238/243)

`releases.db` (SQLite, committed; `releases.sql` is its git-mergeable dump — CLI is the only writer,
never hand-edit either file) holds two ledgers via `python3 utils/py/releases_app.py`:

- **Releases** (GH-32, Phase 0 side-by-side): `RELEASES.md` is still the human-edited canonical file;
  the DB mirrors it via a one-shot `import` and is updated going forward with `add`/`update`/`ship`.
- **Roadmap** (GH-69 shadow -> GH-238/243 canonical, flipped 2026-08-26 via `.pdda-mode`'s
  `ROADMAP_SOURCE=releases`): `roadmap_items` IS the ledger. Write with `roadmap add
  --issue-num N --issue-url U --title T --created YYYY-MM-DD --doc-path P`; read with `roadmap list`
  (`--json` for machine consumers) or `ROADMAP-DASHBOARD.md`; regenerate the dashboard with
  `utils/roadmap-dashboard.sh` after any ledger write (`utils/roadmap-dashboard.sh --check` verifies
  it's in sync). `roadmap sync` mirrors `ROADMAP.md` and is a guarded no-op while the flip marker is
  present — it would delete `add`-parked rows.
- A `.githooks/pre-push` guard refuses a push that writes `releases.sql`/`releases.db` without also
  regenerating `ROADMAP-DASHBOARD.md` (`.githooks/dashboard-staleness-guard.sh`, ported from
  XYZ-forge GH-243). Bypass, deliberately loud: `git push --no-verify`.

## Command rails

For baseline verification and document hygiene:

```bash
utils/pdda/pdda.sh run
```

For targeted PDDA debugging, run a single check by name:

```bash
utils/pdda/pdda.sh frontmatter
utils/pdda/pdda.sh status-table
utils/pdda/pdda.sh hardcoded-paths
utils/pdda/pdda.sh roadmap
utils/pdda/pdda.sh roadmap-coverage
utils/pdda/pdda.sh changelog
utils/pdda/pdda.sh stale
utils/pdda/pdda.sh issue-doc-sync   # flag GH-*.md docs drifted from their GitHub issue state (warn-only)
utils/pdda/pdda.sh releases        # validate RELEASES.md, the release-planning ledger (warn-only)
utils/pdda/pdda.sh releases-current # read-only roll-up: RELEASES.md entries not yet Shipped
utils/pdda/pdda.sh governance      # governance-doc cross-reference + doc/code drift
utils/pdda/pdda.sh quad-concepts   # opt-in: a "## Quad Concepts" section of 1-4 bullets (lever: .pdda-quad / PDDA_QUAD)
utils/pdda/pdda.sh glance          # read-only roll-up: title + Quad Concepts for each PROJECT/2-WORKING doc
utils/pdda/pdda.sh gh-refresh      # refresh the cached GitHub issue-state file (needs gh)
utils/pdda/pdda.sh doc-ready       # LLM readiness review — set PDDA_LLM_BIN (codex/claude/agy) to enable
utils/pdda/pdda.sh catchup         # LLM repo triage and ROUTER.md recommendations — opt-in
utils/pdda/pdda.sh help            # list every command
```

## Routing hints

- If the task is about Sleuth's architecture, Slack/OpenAI integration, RAG usage, or persistence
  path inventory, start in `AGENTS.md` for constraints, then `ARCHITECTURE.md` for the actual
  inventory. For architecture/repo-topology review specifically, also read
  `ARCHITECTURE-DECISIONS.md` right after `ARCHITECTURE.md` — it's a durable, regenerated snapshot.
- If the task is about workspace config fields, required/optional validation, compatibility rules,
  payload examples, bearer-auth details, or endpoint inventory, start in `src/workspaces.js` and
  `docs/web-api.md` rather than expecting `AGENTS.md` to mirror those lists.
- If the task is "what changed recently" or a general catch-up, read `CHANGELOG.md`, `git log
  --oneline -10`, `ROADMAP-DASHBOARD.md` (or `releases roadmap list`), the newest
  `PROJECT/1-INBOX/GH-*.md` captures, and active `PROJECT/2-WORKING` docs — or run `utils/pdda/pdda.sh
  catchup` (opt-in, needs `PDDA_LLM_BIN`) to get this triaged automatically against `ROUTER.md` itself.
- If the task is about document quality, active-doc lifecycle, roadmap sprawl, or PDDA automation
  policy, start in `PROJECT/PDDA.md`.
- If the task is about repo-local maintenance state, start in `ROADMAP-DASHBOARD.md` (or
  `python3 utils/py/releases_app.py roadmap list`). If the task changes the roadmap ledger, write
  through the CLI (`roadmap add`) and finish by regenerating the dashboard
  (`utils/roadmap-dashboard.sh`) — the push gate refuses a ledger write with a stale dashboard. Treat
  any `PROJECT/2-WORKING/MARATHON-PLAN-*.md` as a generated scheduling overlay — it is still derived
  from the frozen `ROADMAP.md` text, not the DB (see "RELEASES DB" above) — read it after the ledger
  when batching work, never hand-edit it.
- If the task is a repo-level question (architecture, past decisions, how something works), start
  in `ARCHITECTURE.md`, then `CHANGELOG.md` and `PROJECT/`.
- If the task is about command aliases, `rmm`, help output, or command normalization, start in
  `ARCHITECTURE.md`'s "Command Catalog, Help, and RMM Intent Resolution" section, then
  `data/static/ai/command-catalog.json` and `data/static/ai/command-normalization.json`.
- If the task is about the Claude Desktop / MCP connector, see `mcp/README.md` — it's a separate
  stdio server, not part of the main `src/` startup path.
- If the task is about installing or upgrading PDDA itself, see `utils/pdda/PDDA-INSTALL.md` — the
  runtime is synced in from the separate `pdda` HQ repo's install.sh / pdda-sync.sh (canonical-only
  tooling; those two scripts are not shipped into this repo).
- To re-run this startup sequence mid-session (task switch, resume, post-compact, context drift),
  invoke the `/pdda` skill (`.claude/skills/pdda/SKILL.md`) instead of re-reading by hand.
