---
title: First-Time-User Question Battery — capture current responses, then fine-tune
created: 2026-06-21
updated: 2026-06-21
branch: development
status: SKETCH + LIVE CAPTURE DONE (2026-06-21, dev box, real LLM). Findings below; fine-tune levers ranked + awaiting operator pick. Harness: scripts/first-time-user-battery.js (untracked).
owner: noel
author: Claude (Opus 4.8, 1M)
goal: >
  Capture Sleuth's actual replies to 5 representative first-time-user questions, one per
  dispatch-ladder rung, then rank the cheapest fine-tune lever for each gap found.
surface:
  - src/chat-module.js                       # the mention dispatch ladder (the thing under test)
  - data/static/HELP.md                      # what `help` returns
  - data/static/deterministic-responses.json # canned replies (only ping→pong today)
  - data/static/ai/chat-instructions.md      # the free-chat persona (shapes the AI-fallback answers)
  - data/static/ai/command-catalog.json      # 54 command entries + NL aliases (routing source of truth)
related:
  - PROJECT/1-INBOX/COMMAND-NEAR-MISS-AI-FALLBACK.md  # near-miss recovery — same fallback seam this battery probes
  - PROJECT/3-COMPLETED/P1-TEST-HARNESS.md            # the harness inventory referenced below
---

## Status

| What was just completed | What's next |
|---|---|
| Live capture run on the dev box against the real `neochrome-dev` workspace (real LLM); all 5 first-time questions captured and ranked into a fix list (see below). | Operator picks levers from the ranked fix list; chosen fixes move into [FIRST-TIME-USER-REMEDIATION.md](PROJECT/2-WORKING/FIRST-TIME-USER-REMEDIATION.md) and the harness re-runs as the *after* baseline. |

## TL;DR

Pick **5 questions a brand-new user actually types at Sleuth on day one**, each chosen to land on a
*different rung* of the mention dispatch ladder, so the battery doubles as a diagnostic of the whole
ladder. Capture Sleuth's *actual* reply to each, compare against the ideal first-impression answer, and
tune the cheapest lever that closes the gap (deterministic JSON / HELP.md / chat-instructions / a catalog
RegexAlias — in that order of preference).

**Live-server status (checked 2026-06-21):** the Vultr **development** box (`Sleuth-app-v2-DEV`,
`203.0.113.12`) is `active`, running `1.4.201` / `df9911b` — identical to local HEAD, restarted
14:52 UTC today. **Capture ran against its real `neochrome-dev` workspace (real LLM) — results below.**
Its default chat model is `gemini-3.5-flash` (complex `gpt-5`), *not* the doc's `gpt-4o-mini`.

## The dispatch ladder (the thing we're probing)

First-match-wins, top to bottom ([src/chat-module.js](src/chat-module.js)):
1. context-memory / file uploads → 2. deterministic responses → 3. model-identity guard →
4. command router (+ catalog NL aliases) → 5. unsupported-reminder-action intercept →
6. web-search auto-routes → 7. near-miss probe (fire-and-forget log, 1.4.199) →
8. **generic AI-chat fallback** (free-form, persona from [chat-instructions.md](data/static/ai/chat-instructions.md)).

The fine-tuning question is always: *did this question land on the rung that gives the best
first-impression answer, or did it fall through to generic chat that "answers" but doesn't onboard?*

## The battery — 5 questions, 1 per rung

| # | First-time question | Expected rung | Predicted current reply | First-impression risk | Cheapest fine-tune lever |
|---|---|---|---|---|---|
| 1 | `@Sleuth what can you do?` | **8 — AI chat** (no `help` keyword) | Free-form persona answer ("I'm Sleuth AI, a helpful assistant by Neochrome…"). Does **not** list commands or mention reminders. | The classic day-one dead-end: a capability question gets a generic chat reply instead of the [HELP.md](data/static/HELP.md) tour. | Add a catalog `RegexAlias` mapping capability phrasings (`what can you do`, `what are you for`, `help me get started`) → the `help` route. Deterministic, zero-LLM. |
| 2 | `@Sleuth how do I set a reminder?` | 4 or 8 — likely **AI chat** | Free-form answer that *may* describe reminders but can drift / overclaim. chat-instructions line 36–37 forbids claiming it did something, but it won't reliably surface `enable reminders` + reaction + `rmm`. | "How do I" help that doesn't point at the *actual* supported path = friction. | Same RegexAlias family → `help`, or a targeted `help reminders` alias. Verify the persona answer first; only add the alias if capture shows drift. |
| 3 | `@Sleuth remind me to pay invoices tomorrow at 9am` | **5 — unsupported-reminder intercept** | `#TryHandleUnsupportedReminderActionAsync` should catch the freeform reminder attempt and post the supported creation paths. | This is the **single most-likely first action** — users type it verbatim. If the intercept is weak/missing, they think Sleuth silently scheduled it. | If capture shows a good redirect → leave alone (guardrail working). If not → strengthen the intercept copy to name `enable reminders` + `:alarm_clock:` + `rmm`. |
| 4 | `@Sleuth what model are you running?` | **3 — model-identity guard** | Deterministic answer from runtime config (the guard added in 1.4.182), e.g. the dev workspace's effective chat model — **not** an LLM hallucination. | Low risk if the guard fires; high embarrassment if it doesn't (model lies about itself). | None expected — this is a *regression check* that the guard still fires on this phrasing. If it falls through to chat, widen the guard regex. |
| 5 | `@Sleuth show my reminders` | **4 — command router → reminders** | Empty-state reply (new user has zero reminders). | Empty state is a first-impression surface: a bare "no reminders" misses the chance to say *how to make one*. | Tune the empty-state copy in the reminders module to append a one-line "create one with…" pointer. |

**Why this spread:** rungs 3 (guard), 4 (router), 5 (intercept), 8 (chat) are all exercised → one battery
run tells you which rungs are healthy and which leak to generic chat. Questions 1–2 specifically probe the
same fallback seam the [near-miss recovery plan](PROJECT/1-INBOX/COMMAND-NEAR-MISS-AI-FALLBACK.md) targets,
so this battery is also a *before* baseline for that work.

## Captured results — live, dev box, real LLM (2026-06-21)

Driven through the real `ChatModule` + real `WorkspaceAI` (no mocks) against the `neochrome-dev`
workspace via `scripts/first-time-user-battery.js`. Verbatim replies:

| # | Question | Actual rung | Verdict |
|---|---|---|---|
| 1 | `what can you do?` | 8 — AI chat (block + "Search the web" button) | ⚠️ **Generic.** Lists "answer questions / summarize / draft / brainstorm" — **zero Sleuth-specific features** (reminders, web/Notion/ask-self search, `help`). A ChatGPT answer, not an onboarding. *Prediction confirmed.* |
| 2 | `how do I set a reminder?` | **5 — unsupported-reminder intercept** | ✅ Caught. Replies: *"I didn't create a reminder. Supported creation paths are :alarm_clock: … or in a thread `make a Sleuth reminder for @user based on task above`."* Accurate, but the *"I didn't create a reminder"* opener is defensive for a "how do I" question. |
| 3 | `remind me to pay the invoices tomorrow at 9am` | **8 — AI chat (LEAKED past intercept)** | ❌ **The real miss.** The *direct attempt a first-time user actually types* slips past the intercept to generic chat, which tells them to use Slack's native `/remind …` — steering them **off Sleuth's own reminder system**. |
| 4 | `what model are you running?` | **3 — model-identity guard** | ✅ **Green.** Returns effective `gemini-3.5-flash` + workspace default, with *":white_check_mark: Verified answer — read directly from runtime configuration, not generated by the AI."* No change needed — regression-confirmed. |
| 5 | `show my reminders` | **4 — router → reminders** | ⚠️ Works (`"You have no pending reminders."`) but **terse** — a new user's first reminders view doesn't tell them how to make one. |

### The headline finding (Q2 vs Q3)

The intercept catches the **meta** question ("how do I set a reminder?") but **not** the **direct attempt**
("remind me to pay invoices tomorrow at 9am") — which is backwards from what matters. The phrasing most
likely from a real first-time user is exactly the one that leaks to generic chat, and the LLM then
recommends **Slack's `/remind`** instead of Sleuth's reminders — two contradictory reminder answers from
one bot, one of them pointing off-product. This is concrete, measured evidence for the
[near-miss recovery plan](PROJECT/1-INBOX/COMMAND-NEAR-MISS-AI-FALLBACK.md)'s Phase 0 dead-end count.

### Ranked fix list (evidence-based)

1. **[High] Catch the direct reminder attempt (Q3).** Broaden the unsupported-reminder intercept (or a deterministic pre-chat guard) to also fire on first-person `remind me to <task> <time>`. ⚠️ This is *exactly* the gated near-miss work — the recorded decision is **measure first (Phase 0), don't broaden on faith**. So: feed this capture into the Phase 0 count rather than hot-patching the trigger. **Decision, not a quick fix.**
2. **[High] Unify reminder guidance.** Q2 (intercept) and Q3 (LLM) give *different* answers — `:alarm_clock:`/thread-command vs Slack `/remind`. Pick one canonical creation story and make the intercept own it; stop the LLM from inventing `/remind`. Lever: tighten the intercept copy + add an anti-`/remind` line to [chat-instructions.md](data/static/ai/chat-instructions.md).
3. **[Med] Capability tour (Q1).** Map capability phrasings → `help` via a catalog `RegexAlias`, *or* add a one-line "I can also manage reminders, search the web/Notion, and more — try `@Sleuth AI help`" to [chat-instructions.md](data/static/ai/chat-instructions.md). Alias = cheaper + deterministic.
4. **[Low] Empty-state pointer (Q5).** Append one line to the "no reminders" copy in the reminders module: how to create one (`:alarm_clock:` / `enable reminders`).
5. **[None] Q4 model guard** — leave alone; it's the model of how a rung *should* behave.

## Fine-tune order of preference (cheapest first)

1. **Deterministic JSON** ([deterministic-responses.json](data/static/deterministic-responses.json)) — canned, zero-LLM, instant. Today only holds `ping→pong`.
2. **Catalog RegexAlias** ([command-catalog.json](data/static/ai/command-catalog.json)) — route an NL phrasing to an existing route with a JSON edit; run `npm run validate:commands` after. (This is the lever for #1/#2.)
3. **HELP.md** ([HELP.md](data/static/HELP.md)) — improve the content the `help` route returns.
4. **chat-instructions.md** ([chat-instructions.md](data/static/ai/chat-instructions.md)) — last resort; changes the *generic* persona and affects every free-chat answer, so highest blast radius.

> Anti-goal: do **not** reach for #4 (persona surgery) to fix a single question that should have been
> caught one rung earlier by a deterministic alias. Catch it at the cheapest rung.

## The live harness test — what's feasible, honestly

**What works today:**
- `npm run slack:harness:post -- …` ([scripts/slack-harness-post.js](scripts/slack-harness-post.js)) — one-shot, dry-run by default, lock-guarded. **But it posts *as the bot*,** so it cannot self-trigger an `app_mention` round-trip (Sleuth filters its own messages). It can post test content, not simulate a *user* asking a question.
- Layer-2 mock harness (`tests/mocks/mock-slack-app.js`) — `SimulateAppMentionAsync(event)` drives the real modules and captures replies in `sentMessages`. Deterministic rungs (3/4/5) are fully capturable here with **no LLM spend**.

**The gap:** rungs 1/2 (AI-chat fallback) need a *real* OpenAI call to capture the actual reply. Neither
existing harness does an end-to-end user→bot round-trip on the live server, because the post harness can
only post as the bot.

**Capture path used (DONE):** `scripts/first-time-user-battery.js` — a one-shot harness that instantiates
the real `ChatModule` + real `WorkspaceAI` behind the mock SlackApp, constructs `RemindersModule`
(unstarted → empty = first-time state), calls `SimulateAppMentionAsync` for each question, and prints the
captured `SentMessages`/`SentBlockMessages`. It includes a tiny `jest` shim so the mock loads outside Jest.
Copied to the dev box, run against `neochrome-dev` (real LLM, ~1 chat call + 1 intercept path), then
removed from the box. The local copy is **untracked** — commit it as a permanent harness or delete it.

## Next steps

1. ☑ Battery defined, harness built, live capture run on the dev box (results above).
2. ☐ **Operator picks levers** from the ranked fix list — esp. whether Q3 (catch the direct reminder attempt) goes through the gated near-miss Phase 0 path (recommended) vs a hot patch.
3. ☐ Apply chosen low/med fixes (Q5 empty-state line; Q1 capability tour; unify reminder guidance), then re-run the harness as the *after* baseline.
4. ☐ Feed the Q3 leak into the [near-miss recovery plan](PROJECT/1-INBOX/COMMAND-NEAR-MISS-AI-FALLBACK.md)'s Phase 0 dead-end count — this battery is real evidence the intercept under-fires on direct attempts.
5. ☐ Decide harness disposition: commit `scripts/first-time-user-battery.js` (needs version bump + CHANGELOG per AGENTS.md) or drop it.
