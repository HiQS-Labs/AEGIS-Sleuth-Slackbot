---
gh_issue: 138
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/138
title: "ask-code/scan-image: review the whole thread above for an OCR or text-analysis target (not just one prior message)"
status: Proposed (1-INBOX — not yet active)
created: 2026-08-26
updated: 2026-08-26
owner: noel
doc_type: feedback
effort: 3
complexity: 3
risk: 1
phases: 1
---

# GH-138 — review the thread above for an OCR/analyze target

## Asks / acceptance criteria

Both `scan image for text` (`src/chat-commands/scan-image-command.js`) and the natural-language
attachment path (`ResolveAttachmentIntent` in `src/context-file-classifier.js`) only look at the
*current* message's attachments (`ArgEventInfo.files`). Reproduced live 2026-08-26: uploading an
image, then replying "scan image in message above" gets back the bare usage string instead of
resolving the earlier upload.

**Scope expanded 2026-08-26** — this is "review the messages above", not just the one message
directly above or the first message above:

1. **Precedence / trigger, stated explicitly** (sharpened via relay-xyz + agy, 2026-08-26): if the
   current message has a matching attachment, use it immediately — the existing fast path is
   unchanged and must not regress. The thread-history fetch only runs when (a) the current message
   has no matching attachment, or (b) the message text contains a lookback signal ("above",
   "earlier", "previous") even if the current message *also* has its own attachment (the user's text
   wins when it explicitly points elsewhere). This also answers the perf question: no
   `GetConversationMessagesAsync` call is added to the common same-message case.
2. **Full-thread fetch is NOT `CaptureThreadAsync` reuse — corrected 2026-08-26.** Verified against
   `src/thread-memory.js:227-285`: `CaptureThreadAsync` builds a text-only transcript and discards
   each message's `files` array entirely (`src/thread-memory.js:243-264`). It cannot be reused as-is.
   This work needs its own call to `ArgSlackApp.GetConversationMessagesAsync(channel, thread_ts)`
   (the same underlying Slack API primitive, not the same helper function) that maps over the
   returned messages and reads `.files` per message — a parallel, purpose-built path, not a wire-up.
3. **Cap the evaluation input.** Feed at most the most recent 5 matching attachments (images for OCR,
   text-like files for analyze) found scanning backward from the current message — not the entire
   thread unbounded — to bound LLM cost/latency and avoid confusing the evaluation step with an
   unrelated attachment from early in a long thread.
4. **An evaluation/transform step over what's found** — not just "first attachment of the right type
   wins" among the capped candidates. `remember above` fetches full-thread data today but only stores
   it verbatim for search; nothing currently runs an LLM pass to reason about *which* of several
   candidate images or text/MD files the request actually means. That reasoning step is new work.
5. **Ambiguity: fail loudly, never guess silently.** If the evaluation step can't confidently pick one
   candidate among the (capped) matches, reply asking the user to be specific — e.g. "I found
   multiple images in this thread — reply directly to the one you want scanned." Silently picking the
   wrong file is the worse failure mode.
6. Must cover BOTH surfaces: the explicit `scan image for text` command and the natural-language
   attachment-analysis path (`ResolveAttachmentIntent`'s `text` / `image-text` / `image-list` kinds).
7. Feed whatever the evaluation step selects into the existing extraction pipelines unchanged
   (`ExtractTextFromImageAsync` for OCR; the existing text-context path for analyze). This changes how
   the target is found and reasoned about, not how it's extracted once found.
8. Still bounded to the current Slack thread (`thread_ts`) — no cross-thread/whole-channel scan.

## Non-goals

- No new file-type support beyond what OCR/text-context already handle.
- No cross-thread lookup.
- No unbounded thread scan — capped at 5 candidate attachments (item 3 above).
