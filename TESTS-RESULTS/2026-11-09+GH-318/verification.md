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

## Post-review correction
Reviewer found padded quoted URLs bypassed quote provenance (discarded review transcript, not an accepted attestation). Captured terms now trim exactly like extracted terms. Eight added parameterized controls: padding variants red before, then4 suites/247 tests passed on bb7b1f1cea18017109ad621f5dde138dd1852b76. Prior54 model calls remain attributed to835f6ca. All50 retained analyzer/title-only candidates and context selections are byte-equivalent under old versus corrected selection;0 additional API calls or budget resets. Fresh full final-code gate pending after final QA.

## Final qualification and independent QA
Plan QA Approved at84feb73b; final QA round2 Approved at75b5bb7, attested in fa984388acbe8f1f545ea0d878d4d092152b055c. Reviewer repeated15 concrete controls100 times, zero mismatches. Source runtime is unchanged between reviewed75b5bb7 and testedfa984388. See committed relay threads.

On final corrected runtime fa984388: build passed, deterministic replay23/23 passed, Node116/116 passed. Full Jest again failed only the independently reproduced baseline thread-memory assertion:3088 passed,1 failed,4 skipped;146 suites passed,1 failed,1 skipped. Gate HEAD before/after equalsfa984388. Full qualification is not green and the PR starts as a draft pending hosted required checks. No code changes or retests made just to mask the known failure. Existing focused247/247 remains valid.

## Hosted qualification
GitHub Actions Run Tests / test passed on058e040363eca3304da04b4de9782a860be8f56d (run42657057958, job129298255016). CodeRabbit was skipped because the PR was Draft, not a completed review. Plan and final independent relay QA remain Approved. Local baseline failure remains documented rather than rewritten as a passing local run. Subsequent closeout-only commits do not alter runtime/tests; latest exact-head hosted status is on PR319.

## Greptile two-letter acronym correction
Greptile discussion r4515362920 correctly observed that PRs/IDs/DBs classify as supported acronyms but cannot singularize under the old length floor. Regression red:6 failed/248 passed; corrected focused suite:254/254. The existing suffix matcher now takes a stem floor, lowered only for uppercase two-letter acronym + lowercase plural s; the existing ArgAllowPlural gate still blocks quoted/proper-name relaxation. Ordinary short words, invented acronyms and padded quotes remain refused. All50 captured candidate/context selections remain identical to the54-call branch run;0 new model calls. Prior final review remains bound to75b5bb7; correction has fresh round3 QA pending and needs final-code qualification.

## Final third-round correction qualification
Greptile's short-acronym finding was addressed in9ba4a455. Independent final round3 Approved at30dd58eb, attested3e67ae95;52 narrow reviewer probes passed. Final corrected-runtime build passed, Node116/116 and replay23/23 passed. Full Jest on3e67ae95:3095 passed/1 failed/4 skipped, only the same independently reproduced baseline thread-memory assertion. HEAD before/after unchanged. Focused254/254 passed before review. No claim of a green local full suite. Historical gates.json now explicitly points to final-gates.json, which points to short-acronym-final-gates.json; prior counts/revision provenance remain intact. No new API calls; all50 retained candidate/context selections unchanged. Hosted checks must be verified on the next published head.

## Authorized ponytail test reduction and release request
User requested the agreed31→14 added test cases, full CI, merge into development then main, and production deployment monitoring. Removed17 duplicate cases; all pre-existing tests and production code unchanged. Remaining10 helper cases plus4 display/context cases retain each changed rule, all four quote formats and the required safety boundaries. Focused237/237 passed; build, Node116/116 and replay23/23 passed. Full local Jest retains the same independently reproduced baseline thread-memory failure (3078 passed/1 failed/4 skipped); do not call it a passing full local run. Complete hosted CI on the new head is required before merging. Prior source QA approvals remain applicable to unchanged runtime. Deployment requires verified production backups and read-only smoke per private SOP; no server harnesses.
