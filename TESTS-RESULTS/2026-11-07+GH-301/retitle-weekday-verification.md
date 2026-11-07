# Retitle weekday alternatives

The deployed normalizer stripped the last weekday from a title such as “Move the call to Monday
or Tuesday,” leaving “Move the call to Monday or.” The shared validator accepted it.

Root cause: the existing dangling-ending guard omitted conjunctions. Adding and/or/but to the
guard preserves the whole phrase, including stacked trailing time expressions; the validator
now rejects an already-incomplete ending before the API writer is called. No new date parsing,
AI call, writer or persistence field. This changes task text only, not reminder scheduling.

Observed verification:
- Seven new title regressions failed on the original code (125 existing checks passed).
- Corrected title/API/real-reminder suites: **332 passed**. API regression checks exact writer
  input and refuses a malformed follow-up without a second write.
- Existing decision replay: **23 passed**, no baseline changes. Typecheck passed.

Production repair and wording-improvement receipts belong in the private operator tracker. No
source thread, real reminder identifier, raw backup or credential is included in this public
receipt. No server test harness was used.


PR #314 review follow-up: the incomplete-ending check also ignores closing parentheses/brackets
before checking unquoted text. Three regressions failed with the prior check (134 passed), then
the corrected three-suite run passed332 checks. Two positive cases protect quoted task names.
Typecheck and23 decision replays passed; no baseline updates or production mutation.
