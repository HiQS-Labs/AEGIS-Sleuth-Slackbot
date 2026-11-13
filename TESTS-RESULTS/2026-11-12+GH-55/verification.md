# GH-55 recipient-reference verification

Base: `7e9e58f1ec79abe92453fa96724734745e9fb4ac`. Local isolated checkout, synthetic Slack events, real handlers and WorkspaceAI/provider calls. No Slack transport, server harness, production writes, model-setting changes or new provider client. Private incident payloads and credentials are excluded.

## Result and measurement limits

The retained product diff changes three existing helpers: recipient context admission, affirmative framing cleanup, and the leading `inform` verb exemption. Prompt assets are byte-identical to the integration base. The October 20 simplification intentionally retained these helpers; both initial gaps exist in its pre-refactor base `50fa08c`.

A local replay with Luna (`gpt-6-luna`) for analysis/repair and `gpt-4o` for dates passed 3/3 cases on the retained code with original instructions. The title model matches the last read-only production observation; the date model DOES NOT match production's observed Sonnet setting. This is partial configuration coverage, not a production deployment or exact original-Slack incident replay. Mocked date/ownership integration additionally verifies the common contract. No statistical reliability or model ranking is claimed.

| Case | Complete confirmation and stored task | Owner / due / state |
|---|---|---|
| Three preceding human messages, including unrelated report chatter, then a singular communication promise | `Tell them about the April vendor service plan downgrade` | live `U_SENDER`; 2026-11-13 08:00 America/Los_Angeles; scheduled |
| Self-contained communication promise | `Tell the vendor re: April downgrade` | same owner/date/state |
| Recipient promise without a supplied topic | `Follow up on the original message` | same owner/date/state; one repair refused an unsupported recipient |

Recipient identity remains conservative (`them`) when the source does not explicitly identify the recipient; useful subject/effective-month context is recovered. Do not describe this as guaranteed exact wording or perfect recipient resolution.

Complete surfaces and raw model answers: [retained replay](real-replay-retained.log). The analyzer prompt SHA `92669759841fde22e2ee18e2294b59bb5a75204ce2140a49a532684038d11b23` equals base. Existing renderer/writer paths produced the outputs; temporary diagnostics only logged responses and selected the local test workspace's title model via its existing setter. Date calls explicitly stayed on gpt-4o.

## Every experiment and attribution

| Run | Changed input/configuration | Observed outcome | Disposition |
|---|---|---|---|
| Baseline pure probe | unchanged code | recipient not admitted; `Yes I'll tell them` accepted | confirms two gaps |
| Pre-fix new cases | tests only | 8 failed, 2 controls passed; Jest open handle needed termination | failure retained; later commands use repository forceExit convention |
| Two-helper focused run | context + affirmative fixes | 311 passed | plumbing only |
| Context mutation | remove context fix | 4 targeted cases failed | helped, isolated deterministic evidence |
| Affirmative mutation | remove framing fix | 5 targeted cases failed | helped, isolated deterministic evidence |
| First actual-model replay | original prompts, gpt-4o-mini / gpt-4o | 2/3; generic downgrade fallback | failure retained |
| Diagnostic repeat | same code/settings, full logging | 2/3; analyzer and repair `Inform` refused as ungrounded | missing verb reproduced independently |
| Grounding red/mutation | no `inform` exemption | both targeted grounding/selection tests failed | helped, isolated deterministic evidence |
| Amendment prompt v1 | add inform + broad communication clarification, default test models | 2/3; April omitted and unrelated report task added | failed; not shipped |
| Amendment prompt v2 | sharpen same prompt guidance, default test models | 2/3; communication task improved but April omitted | failed; not shipped |
| Prompt identity probe | same v2, main only | 0/1; prompt hash confirmed modified bytes reached real call | stale/wrong-prompt hypothesis disproved |
| Luna + v2 | local title-model setting only, same date model | 3/3 | model/config effect confounded with prior changes; not a bake-off |
| Luna prompt ablation | original prompts, main only, same fixed helpers | 1/1 | no observed benefit of extra prompt wording in this small sample |
| Retained final replay | original prompts, Luna / gpt-4o, all three cases | 3/3 | bounded semantic and main/adjacent smoke pass |
| Grader controls | optional anchored communication openings | valid paraphrases accepted; fallback/plain Downgrade/prefix-only Telephone/empty output/empty opening rejected | removing predicate accepts wrong-action control |
| Final focused suites | retained three-helper product code | 8 suites, 532 passed | 12 added Jest cases in existing suites; 3 replay fixtures, no new runner/framework |

Prompt edits: **no observed effect**, removed; the small ablation does not prove equivalence. Model comparison: **confounded**, no ranking. Existing default gpt-4o-mini can still omit the effective month despite supplying context; keep that quality gap open under GH-55. Do not report the default harness's 2/3 as green or relabel the selected-model 3/3 as a default-model run.

## Commands and reproducibility

- Focused: `npx jest --runInBand --forceExit tests/reminder-context-resolution.test.js tests/reminder-title-contract.test.js tests/reminder-display-selection.test.js tests/task-grounding.test.js tests/reminders-integration.test.js tests/gh55-antecedent-resolution.test.js tests/reminders-ai-pipeline.test.js tests/quoted-text-reminders.test.js`.
- `npm run build`: PASS. `npm run validate:ai`: PASS (experimental prompt stage, subsequently restored unchanged). FSM and pipeline validators PASS; deterministic `npm run decision:replay`: 23 PASS.
- The real-model runner remains `utils/reminder-replay.js`. Its default is gpt-4o-mini/gpt-4o; the strict new main fixture is a known failure there. For local selected-model reproduction, take the three `GH-55` rows from `utils/replay-scenarios.json`, and set the throwaway WorkspaceAI default to `gpt-6-luna` via its existing setter before the call. Do not change live workspace settings. Load the existing documented key by file path, never echo it.
- Diagnostics wrapped `WorkspaceAI.prototype.ProcessMessageWithJsonResponseAsync` to log schema/model, instruction SHA, actual response; wrapped mock logger to show selection/refusal; wrapped simulated-message and module Stop to print ALL confirmation/stored records. The only behavioral override was `this.DefaultModelName = process.env.GH55_TEST_DEFAULT_MODEL` inside the temporary test wrapper; explicit date-model arguments still win. No model response was mocked or altered. Full retained output verifies the provider identity per call.
- Grader manual check extracted the existing pure `Grade` function with Node VM and supplied positive/negative rows; [controls](grader-controls.json) records the outcomes. Removing only the new predicate makes plain `Downgrade` pass, demonstrating sensitivity.
- PDDA frontmatter/status checks report 15/11 findings in unrelated unchanged documents (observe mode exits zero). GH55 is absent from those finding lists. These are findings, not a clean governance pass.

Full repository qualification and hosted CI remain PENDING until final independent review. No package version bump. Rollback is a normal helper revert; no migration. Historical GH55 rollout, exact recipient resolution and default-model quality remain open. Lessons writer: NO_ENTRY (no root lessons file; avoid inventing a process lesson from a model sample).
