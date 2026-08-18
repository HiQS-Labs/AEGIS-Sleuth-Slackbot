# Marathon Phase p3
STATUS: Open
NEXT: agy (Builder)

<!-- marathon-drive: task=MARATHON-P3-TURN builder=agy reviewer=codex round-cap=7 -->

## Phase Brief

---
title: "Phase brief p3 — GH-95 fallthrough normalization"
status: Queued — plan built, preflighted, dry-run clean; not fired
created: 2026-08-18
updated: 2026-08-18
owner: noel
branch: development
doc_type: phase-brief
related: "GH-95; parent plan MARATHON.yaml in this directory"
roadmap_exempt: true
goal: >
  One normalized command string feeds both the attachment fallthrough and the command router.
---

# p3 — GH-95: one normalized command string for both the fallthrough and the router

## Status

| What was just completed | What's next |
|---|---|
| Brief written, plan dry-run clean (2026-08-18). | Fire the parent marathon; this phase runs in plan order. |

Issue: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/95
Capture doc: `PROJECT/2-WORKING/GH-95-FALLTHROUGH-NORMALIZATION.md`

## The defect

The GH-91 fallthrough asks `MatchRouteName` about the **raw** mention text; the router is only ever
handed the **normalized** text. The two ask different questions.

```js
// src/chat-module.js:1142 — raw text into the attachment handler
const AttachmentResult = await this.#HandleAttachmentAsync(
  ArgSlackApp, ArgEventInfo, CommandTextWithoutMention, !!CommandTextWithoutMention, true);

// src/chat-module.js:2752 — fallthrough matches on that raw string
&& this.#CommandRouter?.MatchRouteName(ArgText, ArgEventInfo)

// src/chat-module.js:1159 -> :1183 — the router only ever sees normalized text
const NormalizedCommandTextResult = await NormalizeDirectCommandTextAsync(CommandTextWithoutMention);
if(await this.#CommandRouter.RouteAsync(NormalizedCommandText, ArgEventInfo)) return true;
```

So a phrasing that only matches **after** normalization, sent with an image attached, gets the
"I can only read text-based files…" rejection — while the same text **without** the image routes
fine.

## What to change

Hoist `NormalizeDirectCommandTextAsync` above the `#HandleAttachmentAsync` call at
`src/chat-module.js:1142`, and feed the normalized string to both the attachment handler and the
router. One normalization call.

Fold the duplicate `MatchRouteName` invocation at `src/chat-module.js:2752-2754` into a local — it is
currently called once for the condition and once inside the log line.

Correct the comment at `src/chat-module.js:2744-2746`. It cites `scan image for text` as the
motivating case; GH-73 fixed that phrasing at the resolver (it returns `image-text` now and can no
longer reach `unsupported`). The real beneficiary is `convert text into slack list` + image.

## Check before you hoist — two other consumers of the raw text

| consumer | site | requirement |
|---|---|---|
| `ArgSuppressConfirmation` | `src/chat-module.js:1145` (`!!CommandTextWithoutMention`) | must stay truthy for the same inputs — normalization must not empty a non-empty string |
| attachment intent resolver | `ResolveAttachmentIntent` via `ArgText` | list/scan intent detection must not change under normalization |

Verify both against `data/static/ai/command-normalization.json`. **If either shifts**, do not force
the single-string design: pass raw text to those two consumers and normalized text only to
`MatchRouteName`. Say which route you took and why in your handoff.

## Do NOT

- Do not call `NormalizeDirectCommandTextAsync` a second time inside the fallthrough. That is the
  rejected alternative — it costs a second normalization on the hot path and leaves two call sites
  free to drift apart again.
- Do not change `MatchRouteName`'s own matching logic.
- Do not touch `#OnMessageAsync`'s attachment call at `src/chat-module.js:1956`, which correctly
  omits the fallthrough flag because that path does not reach the router.

## Must not regress

No message may be handled twice. `Handled: true` must still short-circuit both callers
(`src/chat-module.js:1118` and `:1956`).

## Tests

In `tests/attachment-pipeline-entry-point.test.js`:

1. **The failing-today test.** Pick a phrasing from `command-normalization.json` that only matches
   after normalization. Send it with an image. Assert it reaches the router, not the text-files-only
   rejection. Confirm it fails against unmodified code first — if it passes, you picked a phrasing
   that already matched raw, and the test proves nothing.
2. The existing GH-91 tests still pass unchanged.
3. A supported attachment is still handled by the attachment path and not double-routed.

## Gate

`npm test` must pass. Phase-scoped check while iterating:
`npx jest attachment-pipeline-entry-point --forceExit`


---

▶ TAKE YOUR TURN (agy — BUILDER role)

You are the BUILDER for this phase. Read the phase brief above and implement it.
1. Implement the brief by creating/editing the artifact file(s): src/chat-module.js,tests/attachment-pipeline-entry-point.test.js
2. Append a build block to this relay file: `### Round N · Builder · agy` summarizing what you did (files touched, key decisions).
3. Use this exact tick binary (run it from any directory): /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick
   - /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick claim MARATHON-P3-TURN --agent agy --paths "marathon-system/dev-qa-2026-08-18--p3/RELAY.md,src/chat-module.js,tests/attachment-pipeline-entry-point.test.js"
   - /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick ping MARATHON-P3-TURN --agent agy
   - /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick release MARATHON-P3-TURN --agent agy --to codex
4. Edit ONLY these paths: marathon-system/dev-qa-2026-08-18--p3/RELAY.md and src/chat-module.js,tests/attachment-pipeline-entry-point.test.js. Do NOT run git. Do NOT touch any other file — the harness commits for you.
5. HAND OFF EXPLICITLY (GH-268): after releasing the token, end your turn by naming who acts next —
   "handing off to codex — codex, take your turn." A turn that ends without that line
   leaves a human guessing whether the relay is waiting on them or has stalled. Do this EVERY round,
   not just the first. ALSO, you MUST update the `NEXT:` line at the top of this file to exactly: `NEXT: codex (Reviewer)`

---

▶ TAKE YOUR TURN (codex — REVIEWER role)

You are the REVIEWER for this phase. Read the latest builder block above AND review the artifact file(s) on disk: src/chat-module.js,tests/attachment-pipeline-entry-point.test.js. REVIEW THE WHOLE FILE, NOT JUST THE DIFF (GH-268): a beta test had this loop reach 'Approved' in two rounds while an independent audit of the same branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN SCOPE; say so explicitly if you find none. DECLARE IT: your review block MUST contain a literal 'swept file: yes' or 'swept file: no' line — without it a reviewer that skipped the sweep is indistinguishable in the transcript from one that did it and found nothing, which is exactly how those 20 issues stayed invisible.
1. Append a review block: `### Round N · Reviewer · codex` followed by your assessment.
2. If changes needed: add `**Verdict:** Changes requested`, update the `NEXT:` line to exactly `NEXT: agy (Builder)`, then: /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick release MARATHON-P3-TURN --agent codex --to agy
3. If satisfied: add `**Verdict:** Approved`, set `STATUS: Approved`, then: /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick done MARATHON-P3-TURN --agent codex
4. Use this exact tick binary (run it from any directory) for all token operations: /Users/noelsaw/Documents/GH Repos/aegis-sleuth-slack-bot/.xyz/bin/tick
   Edit ONLY marathon-system/dev-qa-2026-08-18--p3/RELAY.md (your review block + STATUS). Do NOT edit the artifact yourself — request changes instead. Do NOT run git.
4b. TO VERIFY A FINDING, WRITE PROBE FILES OUTSIDE THE REPO — under $TMPDIR, never inside the
   working tree. Creating even one scratch file in the repo is an off-lane write: containment
   reverts it and FAILS YOUR WHOLE TURN, discarding the review you just did (GH-441). Observed
   2026-08-08: a reviewer found a real latent crash, wrote two probe files in-tree to demonstrate
   it, and lost the turn for doing so — the finding survived only because RELAY.md happens to be
   on your allowlist. `cp` what you need to "$TMPDIR/probe.$$/" and work there instead. Verifying
   is wanted; verifying in-tree is what costs you the turn.
5. HAND OFF EXPLICITLY (GH-268): end your turn by naming who acts next — "handing off to agy —
   agy, take your turn" when requesting changes, or "relay closed, no further turn needed" when
   approving. The beta report singled this out: the Reviewer turn did not tell the user to go back to the
   Producer, so the relay looked stalled when it was simply waiting. Do this EVERY round.
