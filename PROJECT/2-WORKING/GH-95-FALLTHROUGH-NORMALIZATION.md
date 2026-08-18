---
title: "Command-router fallthrough matches raw text while the router routes normalized text"
status: Marathon-ready (2-WORKING)
created: 2026-08-18
updated: 2026-08-18
owner: noel
branch: development
doc_type: bugfix
gh_issue: 95
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/95
related: "GH-91 (opened the fallthrough — this is the half that does not line up); GH-73 (made GH-91's in-code motivating example stale)"
effort: 2
complexity: 2
risk: 2
phases: 1
goal: >
  The GH-91 fallthrough asks MatchRouteName about the RAW mention text
  (src/chat-module.js:2752), but the router is only ever handed the NORMALIZED text
  (src/chat-module.js:1159 -> :1183). A command phrasing that only matches after normalization is
  therefore still unreachable when an image is attached. Normalize once, before the attachment
  handler, and feed both consumers the same string.
---

# GH-95 — the fallthrough asks a different question than the router answers

## Status

| What was just completed | What's next |
|---|---|
| Issue filed and capture doc written; preflight verdicts **ready** (exit 0), marathon dry-run clean (2026-08-18). | Fire phase p3 of `MARATHON-2026-08-18-DEV-QA/MARATHON.yaml`. |

## The asymmetry

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

## Failure scenario

Any phrasing that only matches **after** normalization, sent with an image attached:

1. `ResolveAttachmentIntent` returns `unsupported` — the text is a command, not a list/scan request.
2. `MatchRouteName(rawText)` returns `null`, because the raw phrasing is not the canonical form.
3. The fallthrough at `:2751` does not fire, so `#HandleAttachmentAsync` returns `Handled: true`.
4. The user gets the "I can only read text-based files…" rejection.
5. The **same message without the attachment** routes correctly.

The set of affected phrasings is whatever `data/static/ai/command-normalization.json` rewrites, and
it grows every time an entry is added. The asymmetry is the defect, not any one phrasing.

## Fix

Hoist normalization above the attachment call so one normalized string feeds both the attachment
handler and the router.

Rejected alternative: calling `NormalizeDirectCommandTextAsync` inside the fallthrough. It costs a
second normalization on the hot path and leaves two independent call sites free to drift again.

Two other consumers of the raw text must be checked before hoisting, and left correct:

| consumer | site | requirement |
|---|---|---|
| `ArgSuppressConfirmation` | `src/chat-module.js:1145` (`!!CommandTextWithoutMention`) | must stay truthy for the same inputs — normalization must not empty a non-empty string |
| attachment intent resolver | `ResolveAttachmentIntent` via `ArgText` | list/scan intent detection must not change under normalization |

If either shifts, pass the raw text to those two and the normalized text only to `MatchRouteName`.

## Also in scope

- `MatchRouteName` is invoked twice at `src/chat-module.js:2752-2754` — once for the condition, once
  inside the log line. Fold into a local.
- The comment at `src/chat-module.js:2744-2746` still cites `scan image for text` as the motivating
  example. GH-73 fixed that phrasing at the resolver (it now returns `image-text` and never reaches
  `unsupported`), so the comment describes a case that can no longer arrive here. The real
  beneficiary is `convert text into slack list` + image, which is what the test already uses.

## Acceptance

- [ ] One `NormalizeDirectCommandTextAsync` call, whose result reaches both the attachment handler and the router — or, if normalization is shown to change `ArgSuppressConfirmation` or `ResolveAttachmentIntent`, raw text to those two and normalized text only to `MatchRouteName`, with the reason recorded.
- [ ] A test exists that **fails against the current code**: a phrasing from `data/static/ai/command-normalization.json` that only matches post-normalization, sent with an image, asserted to reach the router rather than the text-files-only rejection.
- [ ] The existing GH-91 tests in `tests/attachment-pipeline-entry-point.test.js` pass unchanged.
- [ ] No message is handled twice — `Handled: true` still short-circuits both callers (`src/chat-module.js:1118`, `:1956`).
- [ ] The duplicate `MatchRouteName` invocation at `src/chat-module.js:2752-2754` is folded into a local.
- [ ] The stale `scan image for text` example in the comment at `src/chat-module.js:2744-2746` is corrected to `convert text into slack list`.
- [ ] `npm test` passes.


## Swarm Preflight Contract

```json
{
  "target":      { "repo": ".", "ref": "development" },
  "gate":        "npm test",
  "fix_probes":  [
    { "type": "grep_present", "path": "src/chat-module.js", "pattern": "MatchRouteName\\(ArgText" }
  ],
  "artifacts":   [
    "src/chat-module.js",
    "tests/attachment-pipeline-entry-point.test.js"
  ],
  "remediation": { "source": "self#fix", "criteria": "GH-95 — a single normalized command string feeds both the attachment fallthrough and the router, pinned by a normalization-dependent phrasing plus image" },
  "lanes":       { "agy_safe": [ "tests/attachment-pipeline-entry-point.test.js" ], "orchestrator_only": [ "src/chat-module.js" ] }
}
```

## Provenance

Found by an independent GLM 5.3 QA review of `development` at `11d9e4e`
(`relay-system/2026-08-18/consult-dev-qa-081115/glm-5.3.md`); the raw-vs-normalized mismatch
confirmed by hand against `src/chat-module.js:1142`, `:1159`, `:1183`, and `:2752`.
