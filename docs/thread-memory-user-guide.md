# Thread Memory, Grouped Views & Connection Surfacing — User Guide

This guide covers four features added in v1.4.172:

- **`remember above`** — capture a Slack thread into AEGIS's memory
- **`recall`** — fuzzy-search the threads you've remembered
- **Grouped `show-me`** — see a person's open work clustered by relationship
- **Connection surfacing** — automatic "related work" hints on new reminders

Throughout, `@Sleuth` means however your AEGIS bot is mentioned in your workspace.

---

## 1. `remember above` — capture a thread

When a thread contains something worth keeping (a decision, a debugging session, a spec discussion), reply in that thread:

```
@Sleuth remember above
```

AEGIS reads the whole thread and saves it as a searchable **memory**: every message with its author and time, the participants, and any GitHub issue/PR links it finds.

You'll get a confirmation like:

```
Remembered. 8 messages, 3 participants, refs: PR #47, #52
```

(The `refs:` part only appears when the thread mentions GitHub issues or PRs.)

**Notes**
- Run it **as a reply inside a thread** — it captures the thread you're in. Used outside a thread, AEGIS will tell you so.
- It's **idempotent**: remembering the same thread twice just replies `Already remembered this thread.`
- Memories are **private to your workspace** — they're never visible from any other workspace.

---

## 2. `recall` — find a remembered thread

Search everything you've remembered with a plain-language query:

```
@Sleuth recall checkout flow
```

AEGIS ranks your remembered threads by meaning (not just keywords) and posts the best matches as a single, easy-to-scan message:

```
Found 3 threads matching "checkout flow"

1. #payments-team · @alex · Jun 3
   PR #47, #52
   "Alice (Jun 3): we need to fix the validation before the release…"
   → https://your.slack.com/archives/…

2. #engineering · @noel · May 28
   "Robin (May 28): checkout redesign scope — deferring guest checkout…"
   → https://your.slack.com/archives/…
```

Each result shows the channel, who captured it, the date, any GitHub refs, a short preview, and a **permalink** that jumps you straight back to the original thread.

**Tips**
- Describe the topic, not exact words — `recall payment retries` will find a thread even if it said "failed charges."
- If nothing comes back: `No remembered threads match '…'. Use 'remember above' at the end of a relevant thread.` — that just means the topic hasn't been captured yet.

---

## 3. Grouped `show-me` — work clustered by relationship

`show-me` already gives an AI-ranked "what should they do first" list. It now **also** shows a deterministic breakdown of *all* of that person's open reminders, grouped by how they relate:

```
@Sleuth show-me @jane
```

Below the priority picks you'll see:

```
*All open work, grouped:*

*PR #47* (3)
  1. Fix checkout validation bug
  2. Review PR #47 changes
  3. Update checkout docs

*Client A* (2)
  4. Follow up on invoice
  5. Reconcile Q2 charges

*Other* (1)
  6. Book team lunch
```

How items are grouped (each reminder joins the first that applies):
1. **Shared GitHub PR/issue** — reminders pointing at the same PR/issue
2. **Same client** — based on your client ↔ channel mapping
3. **Same channel** — when two or more share a channel
4. **Other** — everything else, always listed last

Bigger clusters come first. If nothing relates to anything, you just get a plain numbered list — no change from before.

---

## 4. Connection surfacing — automatic "related work" hints

When you create a new reminder, AEGIS checks your other open reminders and, if any are related, adds a one-line footnote to the confirmation:

```
↳ Related: PR #47 (2 open reminders), Client A (1 open reminder)
```

"Related" means they share a GitHub PR/issue or the same client. It's capped at three items and only appears when there's something genuinely connected — so a normal reminder looks exactly as it did before. If you've also remembered relevant threads, the footnote can include a count of those too.

This is informational only; it never changes how or when your reminder fires.

---

## Requirements & behavior without a key

- `remember above` and `recall` use Google's embedding model and require **`GOOGLE_API_KEY`** to be configured for your workspace (the same Google API key the semantic-recall feature uses).
- Without the key:
  - `remember above` still **saves** the thread but replies that search is unavailable — it just isn't searchable yet.
  - `recall` replies `Recall requires GOOGLE_API_KEY to be configured.`
  - Grouped `show-me` and the related-reminder footnote work **with or without** the key (they're rule-based); only the "related remembered threads" count needs it.
- Workspace admins and owners can run `@Sleuth run-diagnostics` to exercise the full synthetic `remember above` / `recall` embedding pipeline without writing a real memory. The diagnostics output now includes `Thread-memory Gemini pipeline: OK` or a concrete failure reason.

Captured memories are stored durably and stay isolated per workspace.

---

## Troubleshooting

**`recall` says it needs `GOOGLE_API_KEY`.**
The key isn't set for this workspace. Ask an admin to configure it.

**I want to verify the key actually works, not just that it's present.**
Run `@Sleuth run-diagnostics` as a workspace admin or owner. The output now includes a synthetic end-to-end `Thread-memory Gemini pipeline` check that uses the live Gemini embedding API and an in-memory sqlite store, so it proves the key is usable without polluting the shared memory database.

**`remember above` said "Use 'remember above' at the end of a Slack thread."**
You ran it on a top-level message. Reply *inside* the thread you want to capture.

**`recall` finds nothing for a topic I'm sure was discussed.**
The thread was discussed but never **remembered**. Open it and run `@Sleuth remember above`, then try `recall` again.

**A remembered thread isn't showing up in `recall`.**
If it was captured while `GOOGLE_API_KEY` was missing, it was saved without a search index entry. Re-run `remember above` on that thread once the key is configured.
