---
gh_issue: 358
source: https://github.com/NeochromeTeam/sleuth-app/issues/358
title: Admin bug-report reaction (:bug:) → file GitHub issue + show-bugs/refresh commands
status: Phase 1 shipped 2026-07-09 (marathon swarm, codex builder + agy reviewer); Phases 2-4 not started
created: 2026-07-08
doc_type: project
effort: 4
complexity: 3
risk: 3
phases: 4
---

# Admin bug-report reaction (:bug:)

## Ask

Admin-only 🐛 reaction on a **Sleuth-authored** message files a GitHub issue containing a copy of
that message, then Sleuth replies in-thread with the filed issue link. Also add a persisted,
reminders-shaped local log of filed bugs, a `show-bugs` admin command to view the last 15, and a
`refresh` command to re-pull issue titles from GitHub after a human edits them.

**Added 2026-07-08 (same-day follow-up):** the 🗑️ wastebasket reaction's existing false-positive
training-example save (`#SaveTrashedExampleAsync`, `src/reminders-module.js:2378`) also switches
over to file a GitHub issue through the same shared filing helper built for 🐛 — titled with a
distinguishing prefix so training false-positives are easy to find/filter apart from admin bug
reports on GitHub. See [GH issue #358](https://github.com/NeochromeTeam/sleuth-app/issues/358) for
full design notes, non-goals, and acceptance criteria.

## Prior-art search (done before capture)

- No existing feature or open plan covers this — checked `ROADMAP.md`, `PROJECT/1-INBOX`,
  `PROJECT/2-WORKING`, `CHANGELOG.md`, and `ARCHITECTURE.md`.
- Reuse candidates found: `IsAdminOrOwnerAsync` (`src/slack-app.js:1294`) for the admin gate;
  `HandleSendToGithubCommandAsync` (`src/chat-commands/send-to-github-command.js`) for the GitHub
  issue-filing HTTP call and confirmation-reply pattern; `ChatModule#OnReactionAddedAsync`
  (`src/chat-module.js`) for the reaction dispatch slot (alongside existing `octagonal_sign`/`wrench`
  handling); the reminders file-based persistence pattern
  (`data/runtime/reminders/<WORKSPACE_NAME>_reminders.json` + counter) for the new bugs log.
- Corrected a wrong premise in the original ask: 🛑 (`octagonal_sign`) stops handsfree mode, not a
  "save for training" path — that's actually 🗑️ (`wastebasket`) on reminder-detection messages
  (`src/reminders-reaction-handler.js:202-268`). Confirmed with the requester: this feature uses a new,
  independent 🐛 reaction and does not touch either existing path.

## Decisions locked at capture time

- New independent 🐛 reaction (not a repurpose of 🛑 or 🗑️).
- Fires only when the reacted-to message was authored by Sleuth's own bot user.
- Target repo: `NeochromeTeam/sleuth-app` (same as `send to github`).
- Confirmation reply posts immediately after the GitHub API call resolves — no engineered delay.
- Bug records are a flat log, not routed through the reminder FSM.

## Decision added 2026-07-08 — wastebasket integration

- `#SaveTrashedExampleAsync` extends to also call the shared GitHub-issue-filing helper (the same
  one 🐛 uses), title-prefixed (proposed: `[FP] ` + first 15 chars of the reminder text) so these are
  distinguishable from admin-filed 🐛 bug reports both in the GitHub issue list and in the local log.
- **Assumption (flagged for review, not yet confirmed with requester):** the existing local JSONL
  training-example append (`#TrashedExamplesFilePath`) is **retained unchanged** — this is additive,
  not a replacement, because that file is the actual ML training corpus and the GitHub issue is a
  human-visible mirror, not its replacement.
- **Open risk — permission model mismatch:** the 🐛 reaction is admin-gated
  (`IsAdminOrOwnerAsync`); the 🗑️ wastebasket reaction is **not** — any user can trash a reminder
  today. Switching wastebasket to also file a GitHub issue means **any user**, not just admins, can
  now create GitHub issues (visible to the team / possibly a public repo) simply by trashing a
  reminder. This needs an explicit decision: gate the new GitHub-filing side effect behind
  `IsAdminOrOwnerAsync` (silently skip filing for non-admins, cancellation still succeeds), or accept
  it as open to all reminder-trashers. Raised for `/consult` and requester sign-off before Phase 2
  implementation.
- Logging: reuse the same `data/runtime/bugs/<WORKSPACE_NAME>_bugs.json` store with a `Kind` field
  (`bug` vs `false-positive`) rather than a second parallel store, so `show-bugs` can filter/label by
  kind without a second file format.

## `/consult` review (Codex, one pass, 2026-07-08)

Single-advisor consult (Codex only, per request — no second model to cross-check against, so no
agree/disagree reconciliation, just Codex's findings against the repo's actual code). Full transcript:
`relay-system/2026-07-08/gh358-wastebasket-review-132723/gh358-wastebasket-review.codex.md`.

**Accepted findings — folded into the plan:**

- **[Blocker] Non-blocking requirement.** `#HandleWastebasketReactionAsync` currently `await`s
  `#TrySaveTrashedExamplesAsync` (which calls `#SaveTrashedExampleAsync`) **before** it transitions
  reminder state, deletes the reminders, and deletes the Slack message
  (`src/reminders-reaction-handler.js:202-217`). If GitHub filing is added inside that callback
  synchronously, reminder cancellation — an existing, frequent, latency-sensitive user action — now
  depends on GitHub API health. **Decision: GitHub filing on the wastebasket path must be
  fire-and-forget / best-effort relative to the cancel flow**, not awaited inline before the cancel
  completes.
- **[Blocker] Permission-model resolution.** Gate only the new GitHub-filing side effect behind
  `IsAdminOrOwnerAsync` inside `#SaveTrashedExampleAsync` (or its caller) — cancellation and the local
  JSONL save stay open to all users exactly as today; filing to GitHub silently no-ops for non-admins.
  Do not gate the cancel action itself.
- **[Should] Shared helper, not shared command file.** "Reuse `send-to-github-command.js`" only
  partly holds — the reusable part is the PAT/POST/status-handling logic
  (`src/chat-commands/send-to-github-command.js:126-162`); `BuildIssueBody` and the thread-capture
  flow are specific to the `send to github` command and don't fit wastebasket false-positives.
  **Decision: extract a generic issue-creation helper** (PAT lookup + POST + status handling) that
  both the 🐛 reaction and the wastebasket path call, rather than treating the whole command file as
  shared infra.
- **[Should] `show-bugs` default view.** Confirmed: keep the existing JSONL training corpus
  unchanged (Codex rated this a Pass). But `show-bugs` should **default to `Kind: bug` only**, with
  an explicit filter arg (e.g. `show-bugs false-positive` / `show-bugs all`) to see the other kind —
  not a mixed default list, since the two kinds have different audiences and likely very different
  volumes.
- **[Should] Wastebasket confirmation is awkward — resolved.** `#HandleWastebasketReactionAsync`
  deletes the reacted-to Slack message at the end of its flow (`src/reminders-reaction-handler.js:217`),
  so an in-thread "bug filed under GH `<number>`" reply (which fits 🐛 on a persistent Sleuth message)
  doesn't fit here — the parent is disappearing. **Decision: the wastebasket path files the GitHub
  issue and logs it silently (no additional Slack confirmation message)** — matches its existing
  UX, which already has no chatter beyond deleting the trigger message.
- **[Should] Idempotency key.** De-dup key is workspace + channel + message ts + `Kind`, not just
  message ts, so a 🐛 report and a wastebasket false-positive on messages that could coincidentally
  share a ts (different channels) never collide, and Slack event retries on either path can't double-file.

## Phase plan (see GH issue for full acceptance criteria)

1. **Phase 1 — Core:** `bug` reaction handler + a generic, extracted GitHub issue-creation helper
   (PAT lookup + POST + status handling, factored out rather than reusing
   `send-to-github-command.js` wholesale) + in-thread confirmation reply + persisted
   `data/runtime/bugs/<WORKSPACE_NAME>_bugs.json` log, de-duped on workspace+channel+ts+Kind.
2. **Phase 2 — Wastebasket integration:** extend `#SaveTrashedExampleAsync` to also call the shared
   helper, admin-gated (`IsAdminOrOwnerAsync`, silent no-op for non-admins), fire-and-forget relative
   to the cancel flow, `[FP] `-prefixed title, logged with `Kind: false-positive`, no additional Slack
   message (the reacted-to message is already being deleted).
3. **Phase 3 — `show-bugs` command:** admin-only command listing the last 15 filed bugs, defaulting to
   `Kind: bug`, with an explicit filter for `false-positive`/`all`; styled like the reminders list.
   Four-touchpoint registration per `ARCHITECTURE.md` §Command Catalog.
4. **Phase 4 — `refresh` command:** re-fetch each logged issue's current title from GitHub and update
   the local cache, so manual GitHub edits show up in `show-bugs`.

## Swarm Preflight Contract (scoped to Phase 1)

Independent lane — no write-set overlap with the active Wave-1 items (#338/#348/#349/#351/#352) or
the reminder-display collision cluster. The extracted issue-filing helper is net-new
(`src/github-issue-filer.js`, PAT lookup + `POST /repos/{ISSUE_REPO}/issues` + status handling,
factored out of `src/chat-commands/send-to-github-command.js` per the `/consult` finding above); `bug`
reaction wiring lands in `src/chat-module.js#OnReactionAddedAsync` alongside the existing
`octagonal_sign`/`wrench` cases. Phases 2–4 stay held pending this phase landing first.

```json
{
  "target": { "repo": ".", "ref": "development" },
  "gate": "npm test -- github-issue-filer chat-module",
  "fix_probes": [
    { "type": "grep_present", "path": "src/github-issue-filer.js", "pattern": "GH-358-STUB" }
  ],
  "artifacts": [
    "src/github-issue-filer.js",
    "src/chat-module.js",
    "src/chat-commands/send-to-github-command.js"
  ],
  "remediation": {
    "source": "self#phase-1",
    "criteria": "Phase 1 checklist above: bug reaction handler (admin-gated, Sleuth-authored-message guard) + src/github-issue-filer.js extracted from send-to-github-command.js's PAT/POST/status logic + in-thread confirmation reply + data/runtime/bugs/<WORKSPACE_NAME>_bugs.json log with Kind:bug and de-dup on workspace+channel+ts+Kind. DONE when: npm test is green and src/github-issue-filer.js exists and is called from both the new bug reaction handler and (refactored) send-to-github-command.js."
  },
  "lanes": { "agy_safe": [], "orchestrator_only": [] }
}
```

## Phase 1 — shipped 2026-07-09

Built via the marathon swarm (codex builder + agy reviewer, phase `gh358`): `src/github-issue-filer.js`
(`FileGithubIssueAsync`, extracted from `send-to-github-command.js`'s PAT/POST/status logic),
`#HandleBugReportReactionAsync` in `src/chat-module.js` (admin-gated via `IsAdminOrOwnerAsync`,
Sleuth-authored-message guard via bot-user-ID/`sleuth-*` event-type check, de-dup on
workspace+channel+ts+`Kind`, persisted to `data/runtime/bugs/<WORKSPACE_NAME>_bugs.json`), and
`send-to-github-command.js` refactored to call the shared helper (byte-for-byte same user-facing
messages, verified by its existing test suite still passing unchanged).

**Corrections made after the swarm's own review approved it** (caught in a manual pass, since the
lane shipped with zero test coverage for the new handler):
- **Title deviated from spec.** The builder shipped an 80-char `Slack bug report - #channel - <preview>`
  title instead of the explicitly-specified "first 15 characters of the message body, verbatim."
  Fixed `#BuildBugReportIssueTitle` to match the original ask exactly.
- **Confirmation message deviated from spec.** Shipped a generic `Filed GitHub issue #N: url` instead
  of the specified `You've reported an issue with Sleuth - bug filed under GH <number> (<url>). We'll
  review and resolve ASAP.` Fixed to the exact specified text.
- **`npm run build` regression, not caught by the scoped gate.** `FileGithubIssueResult`'s inline JSDoc
  discriminated union (`{ok:true,...}|{ok:false,...}`) does not narrow via `if(result.ok)` under this
  repo's `checkJs` tsconfig — verified in isolation, fails in both branch directions even split into
  two named typedefs joined by a union. Flattened to one type with optional fields (no union, no
  narrowing needed) — see the comment on `FileGithubIssueResult` in `github-issue-filer.js`.
- **No test coverage was added.** Added `tests/chat-module-bug-reaction.test.js` (6 cases: admin
  files + exact confirmation text + persisted log entry; non-admin denied; non-Sleuth message no-op;
  repeat-reaction de-dup; missing-PAT message; non-`bug` reaction ignored) and a
  `GetMessageThreadTsAsync` mock method on `MockSlackApp` (didn't exist; the new handler calls it).
  Full suite independently re-verified: 71 suites / 1207 tests green, `npm run build` clean (only the
  pre-existing unrelated `snapshot-relay-module.js` errors remain).

Data note: `data/runtime/bugs/` is entirely gitignored (matches `reminders`/`workspaces` convention),
so the bugs log itself is never a git-tracked artifact — Phase 1's contract `artifacts` list correctly
omits it.
