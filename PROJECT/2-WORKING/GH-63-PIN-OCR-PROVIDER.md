---
title: "Pin Vision OCR to Gemini and report provider mismatch honestly"
status: Active (2-WORKING) — implementing on branch gh-62-unify-attachment-pipeline.
created: 2026-08-17
updated: 2026-08-17
owner: noel
goal: "Pin the OCR call to a Gemini vision model the way web search already pins its provider, so a workspace whose default model is Claude or GPT still gets OCR — and when no Gemini model is configured, say that plainly instead of reporting a permanent misconfiguration as a transient failure."
branch: gh-62-unify-attachment-pipeline
doc_type: bugfix
gh_issue: 63
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/63
related: "GH-58 / PR #59 (Vision OCR). Independent of GH-62 but shipped on the same branch."
context_tags: [ocr, provider-selection, error-honesty, ai-providers]
---

# GH-63 — Pin Vision OCR to a Gemini provider

## Status

| What was just completed | What's next |
|---|---|
| **Mismatch identified and traced.** OCR passes `DefaultModelName`; only `GeminiProvider` implements `ProcessMultimodalMessageWithJsonResponseAsync`, so a Claude/GPT-default workspace throws and the user is told "try again later". Established the in-repo precedent (`workspace-ai.js:538` pins web search). Plan doc and ROADMAP pointer landed. | **Resolve an OCR model by preference order** (`gemini-2.5-flash` → `2.0` → `1.5`) restricted to configured models, and split the honest configuration message from the transient one. Owner: noel. |

## Problem Statement

The OCR call passes the workspace's **default chat model**, but only `GeminiProvider` implements
the multimodal method. On any workspace whose default model is Claude or GPT, OCR fails
permanently — and the user is told the failure is transient.

## Fail path

`src/chat-module.js:2944` passes the workspace default:

```js
this.#WorkspaceAI.DefaultModelName        // <-- not pinned to Gemini
```

`WorkspaceAI` resolves the provider from that name and throws when the method is absent
(`src/workspace-ai.js:514-516`):

```js
if(typeof Provider.ProcessMultimodalMessageWithJsonResponseAsync !== 'function') {
  throw new Error(`Provider '${Provider.Id}' does not implement ProcessMultimodalMessageWithJsonResponseAsync.`);
}
```

Only `src/ai-providers/gemini-provider.js` implements it. `anthropic-provider.js` and
`openai-provider.js` do not.

The handler catches the throw and posts **"Image analysis failed — please try again later."** That
reads as transient; the condition is a permanent configuration mismatch. Retrying never succeeds,
and the diagnostic detail stays in the logs.

## Precedent

The web-search paths deliberately pin their provider regardless of workspace default —
`src/workspace-ai.js:538`:

> Pinned to OpenAI even when the workspace's default chat model is Claude — Claude's hosted web
> tool is a separate integration.

The OCR path did not follow the established pattern. This is a consistency fix, not a new idea.

## Why tests did not catch it

`tests/gemini-ocr-slack-list.test.js` hardcodes `'gemini-2.5-flash'` in every call, so the
default-model resolution path is never exercised.

## Design

1. Resolve an OCR model by preference order — `gemini-2.5-flash` → `gemini-2.0-flash` →
   `gemini-1.5-flash` — restricted to models the workspace actually has configured, mirroring how
   web search pins its provider.
2. When no Gemini model is available, do **not** attempt the call. Fail with a message naming the
   real cause, e.g. *"Image OCR needs a Gemini model, which isn't configured for this workspace."*
3. Keep the transient message only for genuine runtime failures (network, API error), so the two
   conditions stay distinguishable to the user.

## Anti-goals

- Not implementing multimodal support in the Anthropic or OpenAI providers. Out of scope; if a
  provider gains it later, the preference list is the single place to extend.
- Not changing the workspace default-model mechanism itself.

## Verification

- [ ] A workspace whose default is Claude/GPT still routes OCR to Gemini.
- [ ] A workspace with no Gemini configured gets the honest message, not "try again later".
- [ ] Genuine API failure still reports the transient message.
- [ ] Existing GH-58 OCR tests remain green.
