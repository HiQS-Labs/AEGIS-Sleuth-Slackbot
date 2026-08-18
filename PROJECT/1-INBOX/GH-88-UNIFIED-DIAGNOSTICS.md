---
gh_issue: 88
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/88
title: "Unify diagnostics: one system, a shared baseline, and route errors through it"
status: Proposed (1-INBOX — not yet active)
created: 2026-08-18
doc_type: refactor
related: "GH-86 (baseline must show the RESOLVED runtime path — two install dirs held divergent state); GH-89 (the 404 reply is a worked example of a context-free error)"
---

# GH-88 — One diagnostics system, one baseline, errors included

## The problem, stated as the user hit it

Running `diagnostics` returns 12 green infra lines and **does not mention** that auto-scheduling is
disabled in the channel it was run in. The reminder-triage output — a completely different code path
— leads with exactly that fact. So the command named *diagnostics* is the one report that omits the
answer to "why did nothing happen."

## Current surfaces

| Surface | Where | Reports |
|---|---|---|
| `diagnostics` command | `src/chat-commands/run-diagnostics-command.js` | config, Slack API, 3 directory probes, data-loaded flags, per-provider AI connectivity, thread-memory, Notion |
| Reminder triage | `src/reminders-module.js:2070+` | channel status, AI analysis, "Why this task text", "How ownership resolved" |
| Error replies | scattered literals | one sentence, no context |
| Startup summary | `src/github-actions-startup-summary.js` | version, branch, CI run |

Four builders, no shared code, no shared format, no shared routing.
`HandleRunDiagnosticsCommandAsync` even receives `ArgEventInfo.channel` and uses it only as a
post target.

## Design

**One module** — `src/diagnostics-report.js` — owning collection and rendering. Every surface calls it.

**Baseline, on every diagnostic output, user- or error-triggered (5 lines):**

1. Version + branch + workspace
2. **Reminders enabled in this channel** (yes/no) + reminder target channel
3. Slack API connectivity
4. Runtime data directory — **resolved path** + writability
5. Configured AI providers + which is active

Line 2 is the user's explicit requirement. Line 4 is not padding: GH-86 is a bug that existed
*because* nothing ever printed which runtime tree was in use, and two of them held different state.

**Contextual section**, appended by the caller: triage adds AI analysis; an OCR failure adds provider
and model; an issue-filing failure adds the attempted repo (GH-89).

**Error routing.** User-visible failures render the terse sentence *plus* the baseline beneath it.
Target: a screenshot of a failure is enough to diagnose it without a log pull. Keep the one-line
summary first — the baseline is context, not a wall to read before the point.

## Plan

**Phase 1 — extract the collector.** Build the module and the baseline; make `diagnostics` the first
consumer. No behaviour change beyond the baseline appearing. Ship alone.

**Phase 2 — migrate triage.** Replace the hand-built channel-status block in `reminders-module.js`
with the shared baseline, keeping its AI-analysis block as the contextual section. Assert the
overlapping facts render identically.

**Phase 3 — route errors.** Introduce one helper for user-facing failure replies and convert the
known offenders (OCR failure, issue-filing failure, list-creation failure). Convert opportunistically
after that; a big-bang string sweep is not required and would balloon the diff.

**Phase 4 — retire duplicates.** Delete the builders that Phases 1-3 superseded. The refactor is not
done while a second renderer of the *same* report still exists — that is how the current state arose.

**Explicitly out of scope: the startup summary.** `src/github-actions-startup-summary.js` is listed
above as a surface, but it is a boot announcement, not a response to a user action or a failure. It
has **no channel context**, so baseline line 2 (per-channel reminders-enabled) is meaningless for it,
and the baseline contract would have to be weakened to accommodate it. It therefore keeps its own
renderer and **Phase 4 must not delete it**. If it should carry the channel-free subset (version,
branch, resolved runtime path, providers), that is a follow-up issue, not part of this one — say so
rather than letting it drift in as unplanned scope.

## Sequencing against GH-86 / GH-89

The three are **not** a dependency knot, but the naive order is wrong in one respect worth stating.

- **GH-86 Phase 1 and GH-89 Phase 3 are ops/config fixes and ship first, independently.** One is a
  live state-divergence hazard, the other a one-variable deployment gap. Neither should queue behind
  a refactor, and neither needs anything from this issue.
- **This issue (Phases 1-2) ships next**, on its own merits.
- **GH-89 Phase 2** (name the attempted repo) then becomes a contextual line on the baseline instead
  of a bespoke string.
- **GH-86's verification** (reading the resolved runtime path off a diagnostic surface) is the last
  step, and is a convenience — `systemctl show` answers the same question without it.

Stated because the tempting summary is "GH-88 first, it builds the baseline the others consume" —
which is true of the *presentation* work and false of the ops work, and following it would park a
production hazard behind a refactor.

## Acceptance

- [ ] One module renders the `diagnostics` command, triage, and error replies; no second builder of
      those remains. The startup summary is exempt by the note above and still exists.
- [ ] Per-channel reminders-enabled appears in the baseline on **every** surface, errors included.
- [ ] `diagnostics` run in a channel with auto-scheduling off says so.
- [ ] A test asserts the baseline lines are present and **identical** between a user-triggered
      diagnostic and an error-triggered one.
- [ ] Baseline collection is resilient: one failing probe degrades to a FAILED line, never an
      exception that suppresses the whole report.

## Risks

- **Scope.** Phases 1-2 are the value; Phase 3 can sprawl across every string literal in the repo.
  Convert the named offenders and stop.
- **Cost.** The baseline runs on every error. Probes must be cheap or cached — a Slack API round-trip
  per error reply is not acceptable. Decide per line: 1 and 2 are in-memory; 3 should be cached.
- **Verbosity.** Errors must not become walls of text. Summary first, baseline beneath.
- **Admin gating.** `diagnostics` is admin-only today. Decide whether the error baseline is shown to
  all users, and make sure it never leaks configuration a non-admin should not see.
