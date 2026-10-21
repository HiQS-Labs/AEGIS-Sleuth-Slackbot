# GH-258 smoke receipt — 2026-10-20

## Intended fixture updates

- G-01 · `Wrap up the layout improvements tonight` → `Wrap up the layout improvements` · requirement 2.
- G-14 · `Deploy the changes tomorrow morning` → `Deploy the changes` · requirement 2.
- G-16 · `Review the PR by EOD` → `Review the PR` · requirement 2.
- G-19 · `Send the logs tomorrow` → `Send the logs` · requirement 2.
- G-28 · `Rotate the API keys on Monday` → `Rotate the API keys` · requirement 2.
- G-29 · `Re-run the migration in staging tomorrow` → `Re-run the migration in staging` · requirement 2.
- G-32 · `Draft the launch email by Thursday` → `Draft the launch email` · requirement 2.
- G-38 · `Review the quoted migration tomorrow` → `Review the quoted migration` · requirement 2.

## Decision-replay baseline updates

- S-06 · title with a trailing morning schedule → title without its trailing schedule · requirement 2.
- S-13 · title with a trailing time-of-day schedule → title without its trailing schedule · requirement 2.
- S-21 · title with a trailing morning schedule → title without its trailing schedule · requirement 2.

All other replay fields, including ownership, recommendation, context, and trigger outputs, are unchanged.

## Full-suite expected updates

- `reminder-display-selection` verbatim title · schedule wording retained → schedule wording removed · requirement 2.
- `reminder-display-selection` courtesy title · schedule wording retained → schedule wording removed · requirement 2.
- `gh68-grounding-uses-analyzed-source` verbatim title · schedule wording retained → schedule wording removed · requirement 2.

## Final QA correction

- Final relay round 1 found two planned trailing deadline forms that were not yet matched. Added the
  long-form end-of-period and multiword-deadline contract cases; duration/condition veto remains
  unchanged.

## Commands

- `npx jest --runInBand tests/reminder-title-contract.test.js`
- `npm run decision:replay`
- `npm run validate:ai`
- `npm run build`

## Dev-only real-model prompt check

- Automatic prompt: synthetic topic-present and topic-absent cases passed through the real resolver,
  reminder pipeline, and title selector.
- Manual prompt: the same synthetic present/absent shape passed through
  `ExtractManualReminderTaskAsync` and the title normalizer.
- Prompt-only red controls: removing only the new topic instruction from each prompt left both
  synthetic cases passing. The sample is therefore **insensitive** to that instruction; this is
  recorded as an observation, not evidence that the line caused the topic preservation.
- The dev-only checkout, temporary driver, and transient credentials were removed after the run.

## Sanitizer baseline

`utils/sanitize-scan.sh` reports 68 existing repository findings; the same command reports the same
68 findings on the #261 baseline. No finding is in this change, and no unrelated public-history file
was modified.
