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
