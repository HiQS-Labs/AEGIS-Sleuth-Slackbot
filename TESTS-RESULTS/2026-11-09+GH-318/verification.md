# GH-318 verification

Plan QA Approved at84feb73b9b9c7beaa03462f448b93bbf56b01552; receipt in relay-system/2026-11-09/gh318-plan.md. Synthetic cases only in this repository.

## Red and focused green
Before implementation: existing grounding/selection suites with new regression rows:5 failed/90 passed. Compile-only, URL→URLs, API→APIs and selected title/context positives fail; refusal controls pass.
After implementation: grounding, selection, title-contract and analyzed-context suites:4 suites/239 tests passed. Initial implementation revealed quoted plural acronym acceptance; that control was preserved by retaining quote provenance in the canonical classifier, reusing the existing quoted-span pattern. This is within the approved quoted-entity constraint.

Main smoke: SelectTaskText retains `Compile a list of publicly indexable reference URLs` with source=title, without repair/fallback. Adjacent smoke: the same candidate with absent Acme is refused; selected output contains no Acme. Executed by existing selector suite, no Slack transport or server harness.

Full build/gates and branch real-model repeat: pending. Do not infer passes. Raw production transcripts and provider receipts remain private; public evaluation receipt will contain aggregates and method only.
