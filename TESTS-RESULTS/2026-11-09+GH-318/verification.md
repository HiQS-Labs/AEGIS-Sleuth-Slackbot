# GH-318 verification

Plan QA Approved at84feb73b9b9c7beaa03462f448b93bbf56b01552; receipt in relay-system/2026-11-09/gh318-plan.md. Synthetic cases only in this repository.

## Red and focused green
Before implementation: existing grounding/selection suites with new regression rows:5 failed/90 passed. Compile-only, URL→URLs, API→APIs and selected title/context positives fail; refusal controls pass.
After implementation: grounding, selection, title-contract and analyzed-context suites:4 suites/239 tests passed. Initial implementation revealed quoted plural acronym acceptance; that control was preserved by retaining quote provenance in the canonical classifier, reusing the existing quoted-span pattern. This is within the approved quoted-entity constraint.

Main smoke: SelectTaskText retains `Compile a list of publicly indexable reference URLs` with source=title, without repair/fallback. Adjacent smoke: the same candidate with absent Acme is refused; selected output contains no Acme. Executed by existing selector suite, no Slack transport or server harness.

Implementation tested:835f6ca1105d1e324e1c6c58509aba9c3b1133bd. Build passed. Deterministic decision replay23/23 passed. Full Jest suite:146 suites passed,1 failed,1 skipped;3080 tests passed,1 failed,4 skipped. The failure is tests/thread-memory.test.js:140, expected Embedded=false but got true. Independently reproduced on unchanged development6c5576ecb5bdce9085433a995ab2d97a5ed828b1 (25 passed,1 failed in that suite). Removing OPENAI_API_KEY did not change it; ambient key was absent. Do not claim the full suite passed. Separate Node test suite116/116 passed. Gate clone HEAD before/after full suite835f6ca, no fixture mutation.

Changelog tone check passed. PDDA runs in observe mode and reports existing unrelated frontmatter/status/path/legacy-roadmap findings; exit0 is not a clean-docs claim. GH318 is registered in the canonical RELEASES DB, and its legacy coverage check is explicitly exempted. No runtime environment export or server execution.

Retained baseline first-pass draft replay:0/6 accepted at initial selection on baseline;6/6 preserved unchanged on branch, before any model repair. This deterministic result isolates the helper change from model randomness. Fresh branch real-model repeat completed on835f6ca1105d1e324e1c6c58509aba9c3b1133bd:54 scenarios,9 real causal sources ×6 frozen model/instruction settings. All54 first-pass complete provider request hashes match the earlier baseline, including input/system/schema/options. Saved-file checks54/54. Generic fallback cases4→0; model repairs6→0. Fixed-output first-selection control0/6→6/6 preserved titles.138 API attempts, conservative$1.6361, unchanged$5/200-attempt/30min bound. Only task-grounding.js differs in runtime; original prompt bytes restored. Raw sources and readable before/after details remain private. One invitation decision varied between fresh runs despite identical requests; no general model/prompt winner or stable admission effect claimed. Raw production transcripts and provider receipts remain private; public evaluation receipt will contain aggregates and method only.

## Direct synthetic smoke and disposition
`node` called the real SelectTaskText entry point with the synthetic source and Compile candidate, then an adjacent candidate adding absent Acme. Main output source=title, exact candidate retained; adjacent output source=fallback and refused=[Acme]. See smoke.jsonl. No app startup or live Slack posts.

Edit verdicts: grounding classification helped (deterministic same-output control); quoted-acronym first attempt hurt (caught by negative control, corrected); prompt/model changes: none; fresh wording changes: confounded. Lessons Learned: NO_ENTRY — runtime-specific finding belongs in this receipt/changelog, not a new workflow lesson.

Final independent QA and hosted CI pending. Full local Jest remains failed for the independently reproduced baseline reason. Do not label the PR ready until required hosted gates and review are verified.
