---
title: "Unify Slack attachment handling — one resolver, one dispatch, one download"
status: Active (2-WORKING) — implementing on branch gh-62-unify-attachment-pipeline.
created: 2026-08-17
updated: 2026-08-17
owner: noel
goal: "Collapse the two parallel Slack attachment pipelines into one resolver, one dispatch shared by app_mention and message events, and one download method holding the redirect/auth guard — so the GH-58 OCR feature becomes reachable as a consequence of the structure rather than as a patch, and the duplicated SSRF guard stops existing twice."
branch: gh-62-unify-attachment-pipeline
doc_type: bugfix
gh_issue: 62
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/62
related: "GH-58 / PR #59 (Vision OCR) — this fixes the reachability defect that shipped with it. Blocks GH-64 (explicit commands). Shares a branch with GH-63."
context_tags: [attachments, ocr, dispatch-unification, blast-radius, security-duplication]
---

# GH-62 — Unify Slack attachment handling

## Status

| What was just completed | What's next |
|---|---|
| **Implemented at 1.4.293.** All three seams landed: `ResolveAttachmentIntent()` in the classifier, one `#HandleAttachmentAsync` shared by `#OnAppMentionAsync` + `#OnMessageAsync`, one `DownloadFileAsync(url, encoding)` holding the redirect/auth guard once. 22 new tests across 2 suites driving real Slack payloads through the event handlers, plus `npm run attachments:e2e` (21 checks). **Mutation-verified:** reintroducing the defect fails 4 new tests and 6 e2e checks while the original GH-58 suite still passes 27/27 — the demonstration that the old coverage could never have caught this. 115 suites / 1964 jest, tsc 0, PDDA at the 19-error baseline. | **Merge, then confirm on a real workspace.** The e2e harness stubs the Slack and Gemini network boundaries; `slack:harness:file-upload --execute` against a live workspace is still unrun because this machine has no workspace credentials. Owner: noel. |

## Problem Statement

The Vision OCR list feature shipped in 1.4.292 (GH-58, PR #59) is **unreachable from Slack**.
A user who uploads a screenshot and asks for a list receives the text-context rejection message
instead of a list. The feature's components are individually correct and unit-tested; nothing
connects them to the Slack event entry point.

The proximate defect is a branch-ordering mistake. The underlying cause is that Slack attachments
are handled by **two parallel pipelines** that are unaware of each other.

## Reproduction

`@Sleuth AI create a list` + `fines.png` →

> I can only read text-based files as context — Markdown, plain text, code, logs, CSV/JSON/YAML,
> SQL, and Slack code snippets. *fines.png* isn't a text file I can analyze.

Deterministic proof:

```
$ node -e "const {SelectContextMemoryFile,SelectImageAttachment}=require('./src/context-file-classifier');
const png=[{name:'fines.png',mimetype:'image/png',size:50000}];
console.log('text-path Kind for a PNG :', SelectContextMemoryFile(png).Kind);
console.log('image-path selects it    :', !!SelectImageAttachment(png));"

text-path Kind for a PNG : unsupported
image-path selects it    : true
```

## Fail path

1. `#OnAppMentionAsync` calls `#TryStoreThreadMemoryFileAsync` first and unconditionally
   (`src/chat-module.js:1079`).
2. `SelectContextMemoryFile()` has no image awareness — a PNG matches no text predicate and falls
   through to `Kind: 'unsupported'` (`src/context-file-classifier.js:133`).
3. That branch posts the "text-based files only" message and returns
   `{ FoundContextFile: true, FileWasStored: false }` (`src/chat-module.js:2673`).
4. `src/chat-module.js:1087-1088` sees `FileWasHandled && !FileWasLoaded` and returns.
5. The OCR check at `src/chat-module.js:1101` sits in the `else` branch. It never executes.

## Why CI was green

`tests/gemini-ocr-slack-list.test.js` (27 tests) never requires `src/chat-module.js`. It exercises
the classifier, `GeminiProvider`, `WorkspaceAI`, and `ListsModule` directly; its "integrated flow
summary" test starts at `SelectImageAttachment`, not at a Slack event. The broken seam has no
coverage at any level. **This is the finding that matters most — the fix is not complete without an
entry-point test.**

## The three duplicated layers

**1. Dispatch.** Two entry points in mutually exclusive branches of `#OnAppMentionAsync`. The text
ingest additionally has *two* dispatch sites (`chat-module.js:1079` app_mention,
`chat-module.js:1917` message/hands-free) while the image ingest has *one* — so a screenshot
uploaded without an `@mention` will not OCR even after the ordering is fixed.

**2. Download — security-relevant.** `SlackApp.GetFileContentAsync` (`slack-app.js:1415`) and
`SlackApp.DownloadFileBase64Async` (`slack-app.js:1459`) are ~30 near-verbatim duplicate lines:
identical auth header, identical `redirect: 'manual'` handling, identical HTTPS-only guard,
identical origin-scoped auth-forwarding decision. They differ only in log tag, default
content-type, and `.text()` vs base64 encode. **The duplicated block is the SSRF / bearer-token-leak
guard** — hardening one silently leaves the other on old behavior.

**3. Selection.** `SelectContextMemoryFile` and `SelectImageAttachment` are independent and
disagree: a PNG is `'unsupported'` to one and a valid selection to the other. No single function
answers "what is this attachment, and who owns it?"

## Design

### Seam 1 — one resolver

Add to `src/context-file-classifier.js`:

```js
ResolveAttachmentIntent(ArgFiles, ArgText)
  -> { Kind: 'none'|'text'|'image-ocr'|'unsupported', File: SlackFileInfo|null }
```

Single place that answers what an attachment is and who owns it. `'image-ocr'` requires both an
image attachment and a list/OCR intent in the text; an image with no such intent stays
`'unsupported'` so the existing "I can only read text files" guidance still fires and users are not
silently ignored.

### Seam 2 — one dispatch

One `#HandleAttachmentAsync(ArgSlackApp, ArgEventInfo, ArgText, ArgSuppressConfirmation)` called by
**both** `#OnAppMentionAsync` and `#OnMessageAsync`, replacing the two ad-hoc call sites. Closes the
hands-free gap as a consequence of the structure.

### Seam 3 — one download

Collapse the two methods into `DownloadFileAsync(ArgFileURL, ArgEncoding)` where `ArgEncoding` is
`'text' | 'base64'`. The redirect/auth guard then exists exactly once. Keep `GetFileContentAsync`
and `DownloadFileBase64Async` as thin delegating wrappers so existing callers and tests are
undisturbed.

## Anti-goals

- Not rewriting the OCR extraction or list materialization logic — those work.
- Not changing the text-context ingest's user-facing behavior for text files.
- Not adding new commands — that is GH-64, and it depends on this landing first.
- Not changing provider selection — that is GH-63.

## Verification

- [ ] Unit: `ResolveAttachmentIntent` returns each of the four kinds for representative inputs.
- [ ] **Entry point: a real `app_mention` payload with an image attachment driven through
      `#OnAppMentionAsync` results in a created list.** The test whose absence caused this bug.
- [ ] Entry point: the same via `#OnMessageAsync` (hands-free), proving the second dispatch site.
- [ ] Regression: text-file context ingest still works unchanged, both dispatch sites.
- [ ] Regression: an image with no list intent still gets the "text files only" guidance.
- [ ] `DownloadFileAsync` redirect/auth behavior covered once, both encodings.
- [ ] Full suite green; `npm run build` (tsc) exit 0; `utils/pdda/pdda.sh run` at the 19-error
      baseline, not above it.
