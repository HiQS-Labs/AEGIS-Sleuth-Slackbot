---
title: "Extract structured list items from image uploads via Gemini Vision OCR into Slack Lists"
status: Active (2-WORKING) — branch cut and working doc established
created: 2026-08-16
updated: 2026-08-16
owner: noel
goal: "Extract itemized list content from image attachments in Slack threads using lightweight Gemini Flash models, and materialize them directly into structured Slack Lists."
branch: gh-58-gemini-ocr-slack-list
doc_type: feature
gh_issue: 58
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/58
related: "Extends ListsModule for list generation and GeminiProvider / WorkspaceAI for multimodal vision processing."
context_tags: [ocr, gemini, multimodal, slack-lists, vision, ai-provider]
---

# GH-58 — Gemini Vision OCR and Slack List Creation Pipeline

## Status

| What was just completed | What's next |
|---|---|
| Issue #58 filed, branch `gh-58-gemini-ocr-slack-list` cut, project working doc initialized. | Qwen 3.7 Flash build execution via Command Code harness (`cmd`), test suites and verification gate. |

## Why this exists

Users frequently post screenshots or photos containing itemized lists, tables, or notes into Slack threads (e.g. video slides listing compliance violations, checklists, or action items). Previously, Sleuth ignored or rejected binary media attachments as unsupported context in `src/context-file-classifier.js`.

By adding multimodal OCR extraction using fast, low-cost Gemini Flash models (`gemini-2.5-flash` / `gemini-1.5-flash` / `gemini-2.0-flash`), Sleuth can extract structured JSON list items with titles, amounts, and notes, and then invoke `ListsModule` to create a permanent Slack List.

## Quad Concepts

- **Vision OCR is multimodal structured extraction, not plain text scraping.** Enforcing structured JSON schema (`responseSchema`) ensures typed outputs (`item_number`, `title`, `amount_penalty`, `notes`) that feed directly into Slack Lists without fragile regex string splitting.
- **Lightweight models win on latency and cost.** Gemini Flash models provide high-accuracy visual character recognition across phone screenshots at fractions of a cent per image with sub-2s latency.
- **Tenant and binary boundary safety.** Image downloads must respect Slack authentication tokens, validate size limits, and pass safely through `WorkspaceAI` without cross-tenant leakage.
- **First-class Lists integration.** Extracted items materialize into Slack Lists using the existing `ListsModule` harness, posting an announcement with the permalink back into the thread.

## Architectural Changes

1. **Multimodal File Classification & Image Download**:
   - `src/context-file-classifier.js`: Add classifier helper `SelectImageAttachment(ArgFiles)` and `IsImageMediaFile(ArgFile)`.
   - `src/slack-app.js`: Add helper to download Slack private image attachments with Bot Token and return base64 / binary buffer.
2. **Gemini Vision Structured Extraction**:
   - `data/static/ai/ocr-list-extraction-instructions.md`: Structured extraction prompt for image list parsing.
   - `data/static/ai/ocr-list-extraction-schema.json`: JSON schema defining itemized output format.
   - `src/ai-providers/gemini-provider.js`: Support multimodal `generateContent` with `inlineData` image parts.
   - `src/workspace-ai.js`: Add `ProcessMultimodalMessageWithJsonResponseAsync` or extend `ProcessMessageWithJsonResponseAsync` to accept optional image payload.
3. **Slack List Materialization**:
   - `src/lists-module.js`: Add method `CreateCustomListWithItemsAsync(ArgListName, ArgColumns, ArgItems, ArgOptions)` to create and populate custom Slack lists from extracted OCR items.
   - `src/chat-module.js` / mention handler: Recognize list extraction intent from image attachments and trigger the OCR + list creation flow.

## Verification

- `npm run build` (Clean JSDoc/TS compilation).
- `npm test` (Unit tests for classifier, Gemini provider multimodal handling, and list creation).
- `npm run validate:ai` (AI prompts & schema validation).
- `npm run validate:workspace-isolation` and `validate:reminder-render`.
