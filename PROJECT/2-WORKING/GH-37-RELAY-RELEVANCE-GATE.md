---
title: "GitHub relay posts unrelated follow-up messages onto a linked issue in multi-task threads"
status: Active (2-WORKING) — built and green on gh-37-relay-relevance-gate; QA + PR outstanding
created: 2026-08-10
updated: 2026-08-10
owner: noel
goal: "Relay a Slack thread reply to a linked GitHub issue only when it is a high-confidence continuation of that issue's task, and make the octocat reaction the discoverable stop trigger — sharing one AI-decision helper with the existing dedup path."
branch: gh-37-relay-relevance-gate
doc_type: bugfix
gh_issue: 37
source: https://github.com/HiQS-Suite/aegis-sleuth-slack-bot/issues/37
related: "Reuses the reminder-dedup AI call path in src/reminders-ai-pipeline.js; adjacent to GH-27 (incidental thread replies duplicating a reminder), same multi-task-thread problem space"
context_tags: [github-relay, reminders, ai-decision, slack-reactions, dry]
---

# GH-37 — GitHub relay relevance gate + octocat stop trigger

## Why this exists

The relay's gate is purely structural ([src/github-comment-relay.js:91-98](../../src/github-comment-relay.js#L91-L98)):
once **any** reminder in a Slack thread carries a GitHub URL, **every** later text reply in that
thread is posted as a comment on that issue.

Observed 2026-08-10: a thread whose first task linked GH 18 (`UCLA SACTO — SACT countdown reminder`)
received a follow-up about an unrelated task (`fix NN Yard IDs -> for email notifications`). Sleuth
correctly scheduled it as its *own* new reminder **and** relayed it onto GH 18. The operator deleted
the GitHub comment by hand. The same root cause turns `thanks` and `ok will do` into GitHub comments.

A second defect shares the root cause: [line 135](../../src/github-comment-relay.js#L135) unions
GitHub URLs across *all* matching reminders and posts to every one, so in a two-issue thread every
reply fans out to both. A per-message yes/no gate does not fix that — the decision must be **per
linked reminder**.

## Quad Concepts

- **Relevance, not just structure.** Being in the thread is necessary but not sufficient to relay;
  the reply must be a continuation of *that* reminder's task.
- **Fail toward silence.** A wrong relay is a public GitHub comment someone deletes by hand; a missed
  relay costs nothing. Default `skip`, relay only on affirmative evidence.
- **One decision path, two callers.** The dedup call and the relevance call are the same mechanism;
  GUIDING-PRINCIPLES §3's "second real case" is met, so the seam is earned rather than speculative.
- **The emoji you see is the emoji you click.** 🐙 already marks a relayed message, so it is the
  discoverable stop affordance — 🛑/⏹ require memory.

## What shipped

Two commits, not the three planned. Commit A landed and went green on its own as intended. B and C
both rewrite the same regions of `github-comment-relay.js`, so they could not be split by file and
landed as one commit — recorded here rather than presented as a clean three-way split.

- `ed99e8f` — this capture doc + roadmap park.
- `067dcad` — Commit A: `src/ai-decision.js` + dedup migration. 12 new tests; the existing 36
  pipeline tests pass unmodified, which is the zero-behavior-delta evidence.
- `ae9e4ea` — Commits B and C: relevance gate + octocat stop trigger. 46 relay tests (26 pre-existing,
  all still passing, plus 20 new).

The bot-guard on the octocat trigger was mutation-checked: deleting the guard fails
`the bot adding octocat does not stop the relay it just started`, so that test is not vacuous.

## Round 2 QA — merge resolution (Codex via /relay-xyz, 2026-08-10)

Second review round, scoped to the merge with `origin/development` (event schema v2), which no
reviewer had seen. Both findings **accepted and fixed**; both fixes mutation-tested.

**Round 1 of this pass failed and was re-run.** `codex exec exceeded 1500s wall-clock cap — killed`
on a 1724-line diff with 7 multi-part questions at high reasoning effort; the relay log was empty.
Re-run with the diff narrowed to the 396-line merge surface, 4 focused questions, and
`RELAY_TURN_TIMEOUT_S=3000`. Recorded because an empty relay log reads exactly like a clean review.

### [Blocker] `NewlyStarted` narrowing recreated the parity divergence — fixed

Narrowing the relay-started write to the gate-filtered `RelevantReminders` leaves a non-relayed
reminder unset in the JSON store, while the emitted ledger event is **thread**-scoped and says
`relayStarted: true`. `src/reminders-projection.js:533-554` folds one thread's ledger state onto
*every* reminder in that thread, so the projection raises the flag the JSON store never set — the
exact invented-key divergence that file documents ("the source of ALL 22 `GitHubRelayStarted` ...
invented keys in the production diff").

Found independently while Codex was still running, then confirmed by Codex with the same diagnosis
and the same fix. Reverted to `MatchingReminders`: `GitHubRelayStarted` is thread-scoped, not
per-issue. The cost is the cosmetic permalink omission described under #3b — parity outranks it.

Regression test: *a partial relay keeps the JSON store in parity with the thread-scoped ledger
event*. The partial-relay case did not exist before GH-37, which is why nothing caught this.

### [Should] Stop path could persist without recording — fixed

In `#StopRelayAsync` the Slack acknowledgement was awaited *before* the ledger emit. A failed
`AddReactionAsync` threw to the handler's outer catch, leaving the JSON store persisted-stopped while
the ledger never heard about it — the same divergence in the other direction. Emit now runs
immediately after a successful save, and the acknowledgement is best-effort in its own try/catch.

Pre-existing on `development` (their code had the same ordering), but this branch widened it to a
second path via the reaction trigger, so it is fixed here rather than deferred.

Regression test: *records the stop in the ledger even when the Slack acknowledgement fails*.

### Passes

Constructor ordering correctly wired at `src/reminders-module.js` (hook 4th, AI getter 5th), no
swapped production call site; the gate fails closed before the posting loop; both event entry points
catch unexpected errors.

### Process note

Both fixes were first written **while the Codex turn was still in flight**, and the harness's
containment reverted them mid-session — the documented GH-141 hazard. Recovered from
`.tick/orphan-backups/`, reapplied after the turn ended, and re-verified. Do not edit a clone while a
driven turn is running in it.

## GUIDING-PRINCIPLES alignment

Engineering Philosophy, judged against the shipped diff:

| § | Principle | Verdict |
|---|---|---|
| 1 | Complexity is the enemy | **Pass.** No force-relay escape hatch, no env-tunable threshold, no per-workspace config — all deferred until a real requirement appears. |
| 2 | One decision, one owner | **Pass.** "Should this reply reach GitHub" is decided in exactly one place, `#SelectRelevantRemindersAsync`. The stop-and-acknowledge sequence, previously inline, is now the single `#StopRelayAsync` used by both stop paths. |
| 3 | No abstraction without a second real case | **Pass.** `ai-decision.js` ships with two real callers, not one plus a hypothetical. Independently confirmed by agy. |
| 4 | Pull complexity downward | **Pass.** The helper absorbs caching, validation, and failure policy so both callers shrink; it is not a pass-through. Confirmed by agy. |
| 5 | Keep essential complexity | **Pass.** Fail-closed behavior, the bot-reaction guard, and the thread-root resolution were all kept rather than simplified away. This is also the basis for declining agy's #2. |
| 6 | Respect the neighborhood | **Pass.** 13 frontmatter, 11 roadmap-coverage, and 54 TS errors were found pre-existing and left alone; `validate:commands`'s `ask-reminders` failure likewise. Only `validate-ai-prompts.js` was touched, because this change adds an asset that gate must cover. |
| 7 | Prefer reversible changes | **Pass.** The gate is one method and one constant; the stop trigger is one handler registration. Both delete cleanly. Prompt assets are data, not code. |
| 8 | Leave a concrete check | **Pass.** 12 helper tests + 20 relay tests, and the bot guard is mutation-tested rather than merely asserted. |

Doc-governance principles: the capture doc, `ROADMAP.md` pointer, and `CHANGELOG.md` entry were
written as the work landed, so a cold agent can recover state from the docs alone (§2) and each fact
lives in one place (§4).

## QA adjudication (agy via /relay-xyz, 2026-08-10)

Headless review turn driven with `relay-drive.sh --review-once`; thread at
`.xyz/relay-system/2026-08-10/gh37-qa.md` (gitignored, local-only). Verdict: changes requested,
9 findings. Adjudicated against `GUIDING-PRINCIPLES.md` below — 3 accepted, 2 rejected on evidence,
1 acknowledged-and-declined, 3 confirmations.

| # | agy severity | Adjudication | Basis |
|---|---|---|---|
| 1 | Pass | Confirmed | `ai-decision.js` absorbs real complexity, not a pass-through (§4). |
| 2 | Nit — dedup falsy parity | **Acknowledged, declined** | Correct observation, wrong fix. |
| 3 | Pass — no comment leak | Confirmed | All gate paths fail closed. |
| 3b | Should — `IsFirstRelay` bookkeeping | **Accepted — fixed in the merge** | Independently fixed on `development`; adopted and narrowed. |
| 4 | Pass — bot guard | Confirmed | Independently mutation-tested. |
| 4b | Should — `GetMessageThreadTsAsync` null | **Rejected** | Factually wrong about the implementation. |
| 5 | Pass — `AssetCache` isolation | Confirmed | Static repo assets only, no tenant data. |
| 5b | Should — `WorkspaceAI` startup window | **Accepted as documented behavior** | Real, narrow, fail-closed by design, logs a warn. |
| 6 | **Blocker** — reaction handler untested | **Rejected** | Factually wrong. |

### Rejected on evidence

**#6 "OnReactionAddedAsync is entirely untested" — false.**
`tests/github-comment-relay.test.js:894` opens
`describe('GitHubCommentRelay.OnReactionAddedAsync (GH-37)')` with **11 tests**, all passing
(`npx jest -t "OnReactionAddedAsync"` → 11 passed). The symbol appears 5 times in the very diff agy
was given, so this is a review miss, not a coverage gap. The bot guard is additionally
mutation-tested: deleting it fails `the bot adding octocat does not stop the relay it just started`.
No action.

**#4b "`GetMessageThreadTsAsync` may return null for a top-level message with no replies" — false.**
`src/slack-app.js:904` returns `MessageInfo.thread_ts ?? MessageInfo.ts ?? null` — a top-level
message has no `thread_ts` but always has `ts`, so it returns `ts`. Null occurs only when the API
call fails or throws (`:902`, `:906`), and in that case the thread root is genuinely unknown.
Falling back to `MessageTS` there, as agy proposed, would match reminders against an unverified
timestamp — strictly worse than bailing. Current behavior is correct. No action.

### Acknowledged and declined

**#2 dedup falsy parity.** The observation is right: the old check rejected `false`/`0`, the new one
accepts them. But dedup's two required fields are `recommendation` (a string enum) and `rationale`
(a string), and the schema is `strict: true` — neither can be `false` or `0`, which agy itself
notes. Adopting the proposed fix would reintroduce the exact trap the new check exists to avoid: the
relay gate's `confidence: 0` is a real answer, and a falsy check would reject it and force the
fallback. Declining preserves both call sites' correctness; §5 ("keep essential complexity") over a
parity that cannot be observed.

### Accepted

**#3b `IsFirstRelay` bookkeeping — accepted, and resolved during the merge.** agy was right that
gating the relay-started write on `IsFirstRelay` leaves a reminder unmarked. It was first deferred as
cosmetic; merging `origin/development` (PR #31, event schema v2) showed that lane had independently
found and fixed the same defect, replacing the `IsFirstRelay` gate with
`NewlyStarted = MatchingReminders.filter(r => !r.GitHubRelayStarted)` — for a stronger reason than
the permalink: the unmarked reminder made the JSON store and the new thread-scoped ledger event
disagree, so parity could never hold.

Their fix was adopted and **narrowed to `RelevantReminders`**: a reminder whose issue received no
comment has not started relaying, so marking every reminder in the thread would be wrong under the
GH-37 gate. `IsFirstRelay` survives only for the permalink decision, which is its correct remaining
role. No follow-up issue is needed.

**#5b `WorkspaceAI` startup window.** Real. Handlers register in the `RemindersModule` constructor
while `#WorkspaceAI` is assigned in `StartAsync`, and per AGENTS.md §2 `SlackApp` starts before
`RemindersModule`, so a reply arriving in that window finds a null AI. Behavior is correct by design
— the gate fails closed and no wrong comment can be posted — and it is **not silent**: the null path
logs a `warn`. Before this change the relay would have posted unscored during that window, so this
is a strict improvement. Documented, no code change.

## Plan (as designed)

Three commits, in order, each green before the next lands.

### Commit A — `src/ai-decision.js` + dedup migration (pure refactor)

Both call sites load an instructions `.md` + schema `.json` from `data/static/ai/`, cache them, call
`WorkspaceAI.ProcessMessageWithJsonResponseAsync`, validate required response fields, and handle
failure. Extract exactly that, parameterized.

- `ArgWorkspaceAI` passed in explicitly, never resolved from a global — AGENTS.md §0.1 isolation
  contract; `WorkspaceAI` is per-workspace.
- Module-level cache keyed by filename for the static prompt assets. Does not trip
  `validate:workspace-isolation`, which flags only `global.__sleuth*.<property>` reads
  ([scripts/validate-workspace-isolation.js:30](../../scripts/validate-workspace-isolation.js#L30)),
  and the assets are workspace-independent.
- `ArgOptions.Fallback` carries per-use-case failure behavior. `Fallback: null` means rethrow, which
  preserves the existing dedup throw exactly — **zero behavior delta** is the bar for this commit.

Scope boundary: the helper owns asset loading, caching, the call, field validation, and fallback.
Prompt-payload shaping and confidence thresholding stay at the call sites (GUIDING-PRINCIPLES §3, §4
— a seam that absorbs complexity, not a pass-through layer).

### Commit B — relevance gate

New `data/static/ai/github-relay-relevance-instructions.md` + `-schema.json` returning
`{ decision: 'relay'|'skip', confidence: number, rationale: string }`. Score **each** matching
reminder; relay only to the URLs of reminders scoring `relay` with `confidence >= 0.7`. Fail-closed
(`Fallback: { decision: 'skip' }`) with a `warn` log.

On skip: no `octocat` reaction, an info log, and the message still falls through to `RemindersModule`
and becomes its own reminder exactly as today.

**Ordering constraint:** the strongest signal — "this message spawned its own reminder" — is not
reachable. `GitHubCommentRelay` runs *before* `RemindersModule` in the message chain
(ARCHITECTURE.md:85), so at relay time the new reminder does not exist. Reordering the chain would be
a High-tier behavior change under AGENTS.md §10; the independent AI call avoids it.

### Commit C — octocat stop trigger

`GitHubCommentRelay.OnReactionAddedAsync`, registered beside the existing `HandleMessage` at
[src/reminders-module.js:443](../../src/reminders-module.js#L443).

Two traps:

1. **The relay would stop itself.** The relay adds `octocat` itself
   ([line 167](../../src/github-comment-relay.js#L167)), firing `reaction_added` with
   `user === BotUserID`. Without an explicit bot guard the first successful relay stops the relay.
2. **Reaction events carry no thread context.** `ReactionAddedEventInfo` has only `user`, `reaction`,
   `item.channel`, `item.ts` ([src/slack-app.js:31-37](../../src/slack-app.js#L31-L37)), and
   `item.ts` is the *reply* timestamp, not the thread root the matching filter keys on.
   `SlackApp.GetMessageThreadTsAsync` ([src/slack-app.js:895](../../src/slack-app.js#L895)) already
   returns the root for a root-or-reply message.

Existing 🛑 / ⏹ / `stop relay` triggers keep working — additive. Handler returns `false` always so the
reaction still reaches `RemindersModule`'s ✅/🗑/⏰ handling. Acknowledgement reuses the existing
`no_entry_sign` reaction and its save-before-ack ordering.

Semantics: 🐙 stops *future* relays; it does not retract a posted comment. `octocat` is a custom Slack
emoji — match a small name allowlist and degrade quietly where it is absent.

## Acceptance

- [ ] `src/ai-decision.js` used by both the dedup path and the relay gate.
- [ ] Dedup migration is behavior-identical; existing dedup tests pass unmodified.
- [ ] Off-topic reply in a monitored thread: not relayed, no 🐙, still becomes its own reminder.
- [ ] On-topic reply: relayed to that reminder's URLs only, not to every linked issue in the thread.
- [ ] User clicking 🐙 stops the thread's relay; the bot adding 🐙 does not.
- [ ] `npm run build`, `npm test`, and the three `validate:*` guards pass.

## Out of scope (deliberate)

- No manual force-relay escape hatch. `send-to-github` files a *new* issue and does not comment on a
  linked one, so a false negative currently means copy-paste. Add only if false negatives show up in
  practice — GUIDING-PRINCIPLES §1.
- Pre-existing `pdda.sh frontmatter` (13) and `roadmap-coverage` (11) errors on unrelated docs are
  untouched. GUIDING-PRINCIPLES §6 — do not widen scope into opportunistic cleanup.
