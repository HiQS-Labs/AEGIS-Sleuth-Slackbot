---
title: "OCR follow-ups — intent grammar, resolver action split, catalog entry, wiring cleanups (GH-73/74/75/76)"
status: Active (2-WORKING) — branch gh-73-ocr-followups
created: 2026-08-17
updated: 2026-08-17
owner: noel
branch: gh-73-ocr-followups
doc_type: bugfix
gh_issue: 73
related: "#74 (catalog entry), #75 (ListsModule injection), #76 (failure-post dedup) — all four ship in this one branch; parent feature GH-58"
context_tags: [ocr, attachments, command-catalog, chat-module]
effort: 3
complexity: 3
risk: 2
phases: 4
goal: >
  Close the four graded follow-ups to the GH-58 OCR feature in one branch: widen the attachment
  intent grammar that mis-routed "make a todo list" to the text-files-only rejection (#73), split
  the resolver's image action into image-list vs image-text so scan-only requests stop after
  extraction (#73 refinement), give the image-to-List capability an explicit catalog entry + route
  (#74 refinement), constructor-inject ListsModule into ChatModule (#75), and deduplicate the OCR
  failure-post mechanics (#76).
---

# GH-73/74/75/76 — OCR follow-ups

## Status

| What was just completed | What's next |
|---|---|
| All 4 phases implemented and verified (resolver split, catalog entry, injection, dedup; 20/20 + 23/23 e2e, mutation-verified, build/test green). PR-78 review addressed: drift-boundary guard added in `tests/ocr-provider-pin-and-commands.test.js` (49/49) — every OCR catalog phrasing resolves or sits on an explicit pinned `RmmOnly` allowlist with anti-rot; `convert-text-into-slack-list`'s mixed image behavior pinned per-phrase and documented in its `DisambiguationNotes`. | Merge PR #78. Reviewer takes the attachment-vs-route precedence gap into #80 (documented in #79) — explicitly handed off, not dropped. |

## Quad Concepts

- Plain-English list requests ("make a todo list") hit a regex narrower than real speech and got rejected → widen the grammar to allow modifiers and check an image-text arm separately.
- A single `image-ocr` kind forces every image intent to materialize a List → split the resolver result into `image-list` (extract + create) vs `image-text` (extract + post text only).
- The image→List capability is invisible to `rmm`/help because no catalog entry owns it → add an explicit `make-list-from-image` entry + registered route whose behavior actually matches.
- ChatModule reaches ListsModule through `RemindersModule.ListsModule` and repeats 7 failure-post blocks → direct constructor injection and one posting-only `#FailOcrAsync` helper.

## Table of contents

- [Context](#context)
- [Phase 1 — Intent grammar + resolver action split (GH-73)](#phase-1--intent-grammar--resolver-action-split-gh-73)
- [Phase 2 — Explicit image-to-List catalog entry + route (GH-74)](#phase-2--explicit-image-to-list-catalog-entry--route-gh-74)
- [Phase 3 — Constructor-inject ListsModule (GH-75)](#phase-3--constructor-inject-listsmodule-gh-75)
- [Phase 4 — OCR failure-post dedup (GH-76)](#phase-4--ocr-failure-post-dedup-gh-76)
- [Verification matrix](#verification-matrix)

## Context

The GH-58 OCR feature shipped unreachable (#62), was repaired in 1.4.293 (#62/63/64), and then
mis-routed a real production request — *"make a todo list for by OCRing the attached image"* —
because `HasListCreationIntent` (`src/context-file-classifier.js`) required `list` immediately
after the verb+article. An architecture review graded the feature A- architecture / B+ quality and
filed four follow-ups (#73-#76). Codex refined each on the issue threads; the refinements that
shape this plan:

1. **#73** — do NOT fix "read the text in this image" by returning true from
   `HasListCreationIntent`: that routes to list materialization. Extend `ResolveAttachmentIntent`
   to distinguish `image-list` from `image-text`; the attachment handler dispatches accordingly.
   Tests must assert both the selected branch and its side effect (list created vs not).
2. **#74** — do NOT mirror image-list phrases into `scan-image-for-text` (that entry promises
   text-only) or treat `convert-text-into-slack-list` as equivalent (its source is text). Instead:
   an explicit image-to-Slack-List catalog entry and route; the narrow attachment classifier stays
   authoritative for dispatch.
3. **#75** — direct constructor injection in `src/app.js` (ListsModule is already constructed
   before ChatModule); keep the value nullable and the availability guard + user fallback.
4. **#76** — helper centralizes ONLY posting + returning `{ ok: false }`; each failure site keeps
   its own log level, diagnostic message, and error object. No variadic helper, no new catch
   boundary.

## Phase 1 — Intent grammar + resolver action split (GH-73)

Files: `src/context-file-classifier.js`, `src/chat-module.js`, `tests/attachment-pipeline-entry-point.test.js`, `scripts/attachment-pipeline-e2e.js`.

- Widen the verb→list alternation to allow 0-2 modifier words (`todo`, `task`, `to-do`, …) between
  article and `list`, and accept `checklist` as a list noun.
- Add `HasImageTextExtractionIntent` (`(ocr|scan|read) … (image|picture|photo|screenshot)`).
- `ResolveAttachmentIntent` returns `image-list` (list intent wins) or `image-text` (scan intent,
  no list intent) — replacing the single `image-ocr` kind.
- `#HandleAttachmentAsync`: `image-list` → `#TryProcessImageForListCreationAsync` (unchanged);
  `image-text` → extraction + the scan-command posting shape, no list creation.
- Resolver order unchanged: text file wins, then image arms, else `unsupported`.

**QA gate:** unit table covers the production wording + modifiers + scan arm; e2e tests assert
branch AND side effect for both arms; mutation check (reintroduce narrow grammar → only new tests
red); `npm run build` clean.

## Phase 2 — Explicit image-to-List catalog entry + route (GH-74)

Files: `src/chat-module.js` (`#RegisterCommandRoutes`), `data/static/ai/command-catalog.json`.

- Register `make list from image` route in `#RegisterCommandRoutes` (closure over
  `this.#SlackApp`, canonical pattern) dispatching to `#TryProcessImageForListCreationAsync`.
- Add catalog entry `make-list-from-image` with accurate `Aliases`/`IntentPhrases` and
  `DisambiguationNotes` that separate it from `scan-image-for-text` (text-only) and
  `convert-text-into-slack-list` (text source). Point those two entries' notes at the new entry.
- No phrasing mirroring into mismatched entries.

**QA gate:** `npm run validate:commands` green; `node scripts/generate-help.js` regenerated (entry
is `IncludeInHelp`); catalog entry's `RegisteredRoutes` names the new route.

## Phase 3 — Constructor-inject ListsModule (GH-75)

Files: `src/chat-module.js`, `src/app.js`, `tests/attachment-pipeline-entry-point.test.js`.

- Append nullable `ArgListsModule` to ChatModule's constructor; `#MaterializeListFromItemsAsync`
  reads the injected field instead of `#RemindersModule?.ListsModule`; keep the availability guard
  and its user-facing fallback message.
- `src/app.js` passes `ListsModuleInstance` at construction (already built before ChatModule).
- Update constructor test harnesses to inject directly.

**QA gate:** no behavior change — existing OCR suites pass; grep shows no remaining
`RemindersModule?.ListsModule` reach-through in `src/chat-module.js`.

## Phase 4 — OCR failure-post dedup (GH-76)

Files: `src/chat-module.js`.

- Add `#FailOcrAsync(ArgSlackApp, ArgChannelID, ArgReplyTS, ArgUserMessage)` — posts the message
  and returns `{ ok: false }`. Nothing else.
- Rewrite the seven failure sites in `#ExtractListItemsFromImageAsync` to keep their own
  `Logger.*` call and delegate only the post+return. GH-63 permanent-vs-transient branch preserved
  verbatim at the call site.

**QA gate:** pure refactor — all OCR assertions (message strings included) pass unchanged.

## Verification matrix

| Check | Command |
|---|---|
| Type check | `npm run build` |
| Full suite | `npm test` |
| Catalog guard | `npm run validate:commands` |
| Help regen | `node scripts/generate-help.js` |
| Docs hygiene | `utils/pdda/pdda.sh run` |
| Mutation (GH-73) | reintroduce narrow grammar; confirm only new tests fail |
