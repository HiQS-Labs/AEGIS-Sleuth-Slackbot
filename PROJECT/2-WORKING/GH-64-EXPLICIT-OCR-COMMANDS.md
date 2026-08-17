---
title: "Register explicit 'scan image for text' and 'convert text into Slack list' commands"
status: Active (2-WORKING) — implementing on branch gh-62-unify-attachment-pipeline.
created: 2026-08-17
updated: 2026-08-17
owner: noel
goal: "Make image OCR and list conversion explicit, discoverable commands registered in command-catalog.json — so rmm can resolve natural-language variations onto them and help/commands can list them — instead of a hand-rolled inline regex no discovery surface can see."
branch: gh-62-unify-attachment-pipeline
doc_type: feature
gh_issue: 64
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/64
related: "Depends on GH-62 (unified attachment dispatch) — must not add a third parallel path. Follow-up to GH-58."
context_tags: [commands, command-catalog, rmm, discoverability, ocr]
---

# GH-64 — Explicit OCR and list-conversion commands

## Status

| What was just completed | What's next |
|---|---|
| **Discovery gap measured, not assumed.** `command-catalog.json` holds 58 entries and 0 mention OCR/image/screenshot, so `rmm`, `help`, and the commands list cannot reach the feature; intent is a hand-rolled 4-branch regex. Confirmed the catalog's `Aliases` + `IntentPhrases` are the right mechanism for phrasing variation. Plan doc and ROADMAP pointer landed. | **Land GH-62 first**, then register two catalog entries and add `scan-image-command.js` + `convert-to-list-command.js` dispatching through the unified resolver, and retire `#IsImageListCreationRequest`. Owner: noel. |

## Problem Statement

Operator request: users should be able to invoke image OCR and list conversion **explicitly**,
rather than depending on the model inferring intent from phrasing. Today the OCR path is an inline
regex (`src/chat-module.js:1101`), not a registered command — so every discovery surface Sleuth has
is blind to it.

Measured:

```
$ node -e "const c=require('./data/static/ai/command-catalog.json');
const arr=Array.isArray(c)?c:Object.values(c)[0];
console.log('catalog entries total :', arr.length);
console.log('mentioning OCR/image/screenshot:', arr.filter(e=>JSON.stringify(e).match(/ocr|image|screenshot|photo/i)).length);"

catalog entries total : 58
mentioning OCR/image/screenshot: 0
```

Consequences of absence from `data/static/ai/command-catalog.json`:

- **`rmm` cannot reach it.** `rmm` resolves natural language against catalog entries and returns a
  `CatalogEntry`; with no entry it can never suggest OCR, and `rmm ifl` can never execute it.
- **`help` / `commands` cannot list it.** Both render from `LoadCommandCatalogSync()`.
- **Intent matching is a hand-rolled 4-branch regex** (`#IsImageListCreationRequest`,
  `chat-module.js:1429-1432`), so any phrasing outside those four patterns falls through to
  generic chat.

## Requested commands

**1. Scan image for text** — aliases: `scan image for text`, `ocr image for text`, `ocr this`,
`read the text in this image`, `extract text from image`. Output: extracted text, no list side
effects.

**2. Convert text into Slack list** — aliases: `convert text into slack list`,
`make a slack list from this`, `turn this into a list`. Input: message text, quoted text, or thread
context memory. Output: a Slack List.

The existing image→list behavior is preserved as the composed path.

## Design note — not free plumbing

List creation is currently **fused** into the OCR handler, and
`ListsModule.CreateListFromExtractedItemsAsync` consumes structured items
(`{ item_number, text, amount, notes }`), **not** raw text. Command #2 therefore needs its own
text→items extraction pass. Reuse `ocr-list-extraction-schema.json` so both commands converge on
one item shape and `CreateListFromExtractedItemsAsync` stays the single materialization seam:

```
image --[scan]--> text --[convert]--> items --> Slack List
```

Each arrow independently addressable and testable — a strict improvement over one fused handler.

## Design

1. Add two entries to `command-catalog.json` with `Aliases`, `IntentPhrases`, `SyntaxExamples`, and
   `RegisteredRoutes`. `#RegisterCatalogRegexAliasesAsync` then auto-registers deterministic
   matching, and `rmm` / `help` / `commands` pick them up with no extra wiring.
2. Add `src/chat-commands/scan-image-command.js` and `src/chat-commands/convert-to-list-command.js`
   following the existing command-module contract.
3. Route both through GH-62's unified attachment resolver — **not** a third parallel path.
4. Retire `#IsImageListCreationRequest` once catalog aliases cover it, so intent lives in one place.
5. Keep the natural-language path working; the commands are an explicit, discoverable route *in
   addition to* inference.

## Anti-goals

- Not removing natural-language inference — explicit commands supplement it.
- Not building a general text-parsing DSL; reuse the existing extraction schema.
- Not adding a third attachment pipeline (the entire point of sequencing this after GH-62).

## Verification

- [ ] `rmm scan image for text` resolves to the new catalog entry.
- [ ] `rmm convert this into a list` resolves to the second entry.
- [ ] Both appear in `help` and the commands list.
- [ ] Command #1 returns text without creating a list.
- [ ] Command #2 creates a list from pasted text with no image involved.
- [ ] The composed image→list path still works end to end.
- [ ] `npm run validate:commands` does not regress beyond its known pre-existing failure.
