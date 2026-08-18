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
