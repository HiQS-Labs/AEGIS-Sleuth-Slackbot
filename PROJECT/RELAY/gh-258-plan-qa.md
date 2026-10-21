# RELAY · GH-258 plan QA — reminder title topic + schedule-wording strip
<!--
  Single source of truth for this two-agent relay. Read the ENTIRE file before acting.
  Scaffolded by relay-automation/new-relay.sh on 2026-10-20.
-->

NEXT: Producer
STATUS: Escalated
ROUND: 3 / 3

## ▶ TAKE YOUR TURN — read this first (works for ANY agent: Claude, Codex, agy)
1. **Read this whole file** (header, Setup, Ground rules, every block in the Log).
2. **Check it's your turn:** `NEXT` (top) names the role to act. Confirm you are bound to it and the
   last Log block isn't already yours. If not → STOP and reply "wrong window — nudge the <other> window."
3. **Do your role's work** on the artifact named in Setup:
   - **Reviewer:** review vs the Definition of Done → graded findings
     (`[Blocker]`/`[Should]`/`[Nit]`/`[Pass]`), each with a concrete fix → set a **VERDICT**
     (exactly PASS, FAIL, or PARKED) and a **Basis** (explanation). **Review the whole file, not just the diff** (GH-268):
     a beta test had this loop reach `Approved` in two rounds while an independent audit of the same
     branch found 20 issues (1 critical, 4 high) — every one of them in the pre-existing code the
     change sat on, which nobody had read. Pre-existing defects in a file you are touching are IN
     SCOPE; if you find none, say so explicitly rather than leaving it unstated.
     **Declare it: every review block must contain a literal `swept file: yes` or `swept file: no`
     line.** Without it a reviewer that skipped the sweep is indistinguishable in the transcript from
     one that did it and found nothing — which is how the original 20 issues stayed invisible.
     Any `[Pass]` or "verified"/"confirmed" finding MUST
     carry a quoted span or a `file:line` citation — an uncited one is mechanically downgraded to
     `[Unverified — no citation]` (GH-173 B3). Do **not** edit the artifact; only append findings here.
     **A finding that asks for a behaviour change is a generalization unless you can paste the concrete
     input — a row, a value, a `file:line` — that fails under the current code** (GH-681: the gh673
     final QA relay generalized one late-error observation into "or a later invalid identity", the
     Producer implemented it, the same seat `[Pass]`ed it next round, and one historical NULL-URL
     ledger row then blanked every issue). Every `[Blocker]` or `[Should]` requesting a behaviour
     change MUST carry three lines: `Observed input:` (the failing input you saw), `Affected scope:`
     (the input predicate the change would govern), `Falsifier:` (the fixture or data that would show
     the change unnecessary or wrong, and its expected result).
     A `[Blocker]` must cite an observed failure. This is a protocol rule, not a mechanical check —
     the Producer may disposition a request lacking these as `Declined — unproven generalization`.
   - **Producer:** log a disposition for every open finding (Implemented / Modified / Declined + why,
     including `Declined — unproven generalization` for a behaviour-change request that carries no
     `Observed input:` / `Affected scope:` / `Falsifier:`), make the change, then add new work.
4. **Append ONE block** at the very bottom, directly **above** the marker line. Never edit earlier turns.
   Reviewer headings may be `### Reviewer · Round N`, `### Round N · Reviewer · <agent>`, `### Reviewer (<agent>)` (optionally followed by `— rN`), or `### Reviewer — Round N` (optionally followed by `(<agent>)`); follow the heading with a non-empty review body.
5. **Update the header:** flip `NEXT`; set `STATUS` (`Approved` closes — Reviewer only; else `Open`);
   the Producer bumps `ROUND` when opening a new cycle. If the max `ROUND` ends without `Approved`,
   set `STATUS: Escalated`.
6. **Commit only the relay file** (`relay(gh-258-plan-qa): <role> r<N>`); no push. **Stop** and report one line.
7. **Hand off explicitly — EVERY turn, not just the first** (GH-268). End your turn by naming who acts
   next and what they should do: *"handing off to <other role> — go to the <other> window and say
   'take your turn'"*, or *"relay closed (Approved), no further turn needed"*. The beta report singled
   this out: the Reviewer turn never told the user to return to the Producer window, so a relay that
   was merely waiting looked stalled. A turn that ends without this line is not finished.

## Setup
- Artifact under review: `PROJECT/2-WORKING/GH-258-REMINDER-TITLE-TOPIC.md` (the plan). Source paths
  it relies on, read them: `src/reminder-title-contract.js` (whole file; `NormalizeReminderTitle`,
  `COURTESY_WORD_PATTERN`, `NON_CONTENT_WORDS`), `src/reminder-display-selection.js`
  (`SelectTaskTextRaw`, grounding order), `data/static/ai/reminders-instructions.md` (TITLE CONTRACT,
  lines ~89-140), `data/static/ai/manual-reminder-task-instructions.md`,
  `tests/reminder-title-contract.test.js`, `tests/fixtures/reminder-title-golden.json`,
  `scripts/decision-replay.js` (`ReminderTitleContractViolations`), and
  `src/reminders-display-utils.js` (`BuildCompactReminderLine`, where `· due <date>` is rendered).
  Issue text: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/258 (transcribed in the plan).
- **Operational envelope:** a Slack bot's per-reminder title text. The change is one prompt rule, one
  remove-only normalizer step and a regex widening on the GH-250 contract. Grade against the stated
  requirements and commensurate complexity, NOT enterprise threat models. Challenge any machinery the
  plan adds that the requirements don't need as hard as anything it misses. Existing suites only
  (jest + decision replay); no new suites.
- Questions:
  1. Are the plan's claims grounded (pinned schedule-wording expectations, exact-only courtesy match,
     person-as-object passing the contract, due date already rendered)? Cite file:line for disputes.
  2. Does the schedule strip stay remove-only and keep the GH-43/68 grounding guarantee? Can it eat
     part of an object or a condition (`until after today's deploy`, `Plan the Friday standup`,
     quoted names)? Is the revert guard (min 2 words / dangling connector) sufficient and minimal?
  3. Does stripping `tomorrow`/weekday words interact badly with `NON_CONTENT_WORDS`,
     `HasConcreteObject`, the pointer check, or `BuildFallbackTitle`?
  4. Is the `re: <topic>` prompt rule precise enough to prevent invented topics, and consistent with
     the grounding verifier (`re:` terms must appear in the analyzed source incl. thread context)?
  5. Are the acceptance checks falsifiable (each new rule has a case that fails without it; the
     condition-kept and no-invented-topic paths are covered)? Is the rating 55/25/40/80 grounded?
- Output: graded findings with file:line citations, then VERDICT. Approve if no Blocker/Should remains.
- Reviewer: codex   ·   Producer: claude-a
- Started: 2026-10-20
- Definition of Done: the plan meets every GH-258 acceptance item, is grounded in the real paths,
  extends the GH-250 contract and prompt without a parallel path, keeps transforms remove-only, and
  has falsifiable verification with no unrequested machinery.

## Ground rules
1. This file is the single source of truth. The agents never share memory — read the whole file.
2. Take a turn only if `NEXT` names your role — otherwise reply "not my turn" and stop.
3. One turn = one block appended at the very bottom, above the marker. Never edit earlier turns.
4. Stay tight — findings are bullets, not essays. Grade every finding.
5. **The Reviewer never edits the artifact.** It proposes graded findings; the Producer implements.
6. The relay ends on **Approved** (Reviewer only). End each turn by committing just this file; no push.

## Log

### Reviewer · Round 1 · codex

swept file: yes

VERDICT: FAIL
Basis: the existing owner and remove-only approach fit the task, but the schedule-step ordering and condition guard need correction, and the prompt change needs a falsifiable check. Reviewed the entire 82-line plan, the whole title-contract module and title-contract test, both prompt contracts, golden samples G-01–G-42, and the selector/grounding/render/replay paths named in Setup. No additional pre-existing defects found in the plan beyond the findings below.

Evidence scope: Verify tier with direct seeded-source fallback. Graph project `aegis-sleuth-slack-bot` is a different checkout, generation `2026-10-13T00:42:44Z`; coverage reported changed/untracked source and excluded prompts/scripts/fixtures, so graph absence was not used as evidence. No suites, executable fixtures, git commands, or live-service probes ran. All probe files are under `.relay-scratch/tmp/`.

- [Should] **R1 — preserve temporal conditions, not just dangling words.** `PROJECT/2-WORKING/GH-258-REMINDER-TITLE-TOPIC.md:40-43` permits removing `until Friday`; neither stated revert predicate protects `Keep staging online until Friday`. The prescribed result `Keep staging online` has three words and no dangling connector, but loses the duration of the task. The blanket prompt rule at lines 36–37 needs the same distinction. Cheapest fix: conservatively keep condition/duration clauses (including `until`), limit stripping to clear scheduling adjuncts, and pin this example alongside a deadline that should disappear. No general language parser is requested.
  Observed input: `Keep staging online until Friday`; applying the plan's explicit deletion yields `Keep staging online` and passes its two revert predicates.
  Affected scope: leading/trailing temporal wording that expresses an operational condition or duration rather than the reminder's due slot.
  Falsifier: an existing-suite case keeps `Keep staging online until Friday` and `Hold the release until after today's deploy` intact, while `Deploy the hotfix by Friday` becomes `Deploy the hotfix`.
  Probe: `node "$TMPDIR/gh258-probe.js"` (exit 0), using `CountTitleWords(deleted)<2`, the plan's exact dangling-connector set, and `ValidateReminderTitle(deleted)`. Decisive output: `{"prescribedDeletion":"Keep staging online","fewerThanTwoWords":false,"danglingConnector":false,"validation":{"ok":true,"reasons":[]}}`. This measures the proposed predicates, not an implemented schedule matcher.

- [Should] **R2 — a leading schedule strip must expose framing to the existing framing pass.** The plan places `schedule` *after* request framing (`...TOPIC.md:39-41`), but the framing patterns are start-anchored (`src/reminder-title-contract.js:92-103`, applied at 264–279). For `Tomorrow I'll deploy the hotfix`, that pass cannot see `I'll`; stripping `Tomorrow` afterward leaves `I'll deploy the hotfix`, rejected as a status remark (`:112`, `:371`). With only the source/span available, this can degrade a clear task into a fallback. Cheapest fix: remove the leading schedule before the existing framing pass, or reapply that same framing logic after the leading removal; keep trailing stripping after it. Pin the final selector output, not merely a removed prefix.
  Observed input: `Tomorrow I'll deploy the hotfix`; existing normalization preserves it, and the prescribed leading deletion exposes `I'll deploy the hotfix`.
  Affected scope: a leading schedule phrase preceding request/commitment framing, including titles sourced from verbatim/span/fallback.
  Falsifier: with empty model candidate and that source, the existing selector test returns `Deploy the hotfix`, without `Tomorrow`, `I'll`, or a `Follow up:` fallback; `Tomorrow, can you review the logs?` likewise becomes `Review the logs`.
  Probe: `node "$TMPDIR/gh258-probe.js"` (exit 0). Decisive output after the explicit leading deletion: `{"prescribedDeletion":"I'll deploy the hotfix","fewerThanTwoWords":false,"danglingConnector":false,"validation":{"ok":false,"reasons":["status-remark"]}}`. The schedule implementation does not exist yet; this is a sequencing counterexample to the plan.

- [Should] **R3 — make the prompt acceptance evidence independent of hand-authored candidate titles.** The plan's golden samples (`...TOPIC.md:47-50`) feed supplied candidates into the selector (`tests/reminder-title-contract.test.js:204-214`), and decision replay supplies a recorded model response (`scripts/decision-replay.js:13-16`). Both can stay green if the new prompt line is removed. The smoke at plan lines 81–82 names no fixed positive topic input or expected result. Also, the verifier intentionally checks entities rather than every word (`src/task-grounding.js:19-29`): an invented lowercase topic can pass. Cheapest fix: name fixed topic-present and topic-absent inputs and concrete assertions for the planned A/B preview or the existing real-model reminder replay, exercise both edited prompt assets, and record the red control with the new prompt rule removed. Add the required `npm run validate:ai` to verification (`AGENTS.md:203-205`). Keep the current grounding algorithm; no new suite or lexical verifier is needed.
  Observed input: source `Please reply to <@U1> tomorrow`, candidate `Reply to <@U1> re: invoice approval`, with no earlier context: `UngroundedTerms` returns `[]` despite the absent topic. A golden candidate alone cannot establish that the prompt refrains from inventing it.
  Affected scope: evidence for the new person-topic prompt rule and its no-topic exception in automatic and manual extraction.
  Falsifier: a fixed earlier thread `The invoice approval is blocked` plus that live reply yields a title naming `invoice approval`; the same live reply without topic-bearing context yields no `re:`. Removing the prompt addition must break the positive prompt check. Selector cases separately prove a thread-only topic survives grounding and an invented entity topic is rejected.
  Probe: `node "$TMPDIR/gh258-probe.js"` (exit 0). Decisive outputs: invented `re: invoice approval` has `ungrounded:[]`; invented `re: billing-sync` has `ungrounded:["billing-sync"]`; supplying the earlier invoice context selects `Reply to <@U1> re: invoice approval` with `source:"title"`. Prompt/model outcomes remain **[Unverified — needs clone run]**.

- [Pass] **The baseline claims and ownership are grounded.** Schedule-bearing expectations are pinned at `tests/reminder-title-contract.test.js:21-27,36-37`; courtesy is exact-only at `src/reminder-title-contract.js:80`; the compact renderer explicitly emits `· due ${SlackDateFormat}` at `src/reminders-display-utils.js:267`. The pure probe above (exit 0) returns `Reply to <@U1>` with `validation:{"ok":true,"reasons":[]}`, supporting the person-object diagnosis without claiming the prompt explicitly calls a person concrete. Grounding uses full analyzed context at `src/reminder-display-selection.js:107-111`, then rechecks normalized text at `:163-170`; quoted names are protected at `src/reminder-title-contract.js:223-230`. Retain those paths. `NON_CONTENT_WORDS` already excludes weekdays/relative dates (`:129-148`), and fallback subjects reuse normalization/validation (`:459-466`); the cleaned `Check again on this` should therefore fall through as a pointer rather than being forced to survive as a title.

- [Nit] The `55/25/40/80` rating at plan line 5 has only a qualitative small-change rationale; confidence 80 is an estimate, not measured evidence. Label it provisional until the preview/clone results exist; no new scoring machinery is warranted.

Handing off to Producer (claude-a): disposition R1–R3 and the rating note, revise only the plan in the Producer turn, then request Round 2 review.

### Producer · Round 1 · claude-a

Dispositions (plan revised in `PROJECT/2-WORKING/GH-258-REMINDER-TITLE-TOPIC.md`; no code yet):

- **R1 — Implemented.** `until`, `for`, `over` removed from the lead-ins; only deadline lead-ins
  `by|before|on|at|due|no later than` remain, and `for`/`over` join the connector-revert set. The
  prompt rule now separates a due-date phrase (to `scheduling_trigger`) from a duration/condition
  (stays). Pinned: `Keep staging online until Friday`, `Hold the release until after today's
  deploy`, `Let rate limiting run over the weekend` unchanged; `Deploy the hotfix by Friday` ->
  `Deploy the hotfix`; `Ship it after Friday` unchanged (connector revert). Requirements 1, 2, 5.
- **R2 — Implemented.** Leading strip runs BEFORE the framing pass; trailing strip after it.
  Pinned through the real selector with an empty model candidate: `Tomorrow I'll deploy the
  hotfix` -> `Deploy the hotfix`, `Tomorrow, can you review the logs?` -> `Review the logs`.
- **R3 — Implemented.** Verification now names fixed topic-present / topic-absent inputs and
  assertions for a real-model run (real `ResolveContextAsync` + real pipeline + selector, dev
  server model), both prompt assets, with a red control (prompt line removed, topic header off).
  `npm run validate:ai` added. Golden gains a thread-only topic sample and an invented entity topic
  rejected by grounding; grounding algorithm unchanged.
- **Nit (rating) — Implemented.** Re-rated 55/30/45/75 and labelled provisional.

New work (scope addition, evidence-driven): **Requirement 4, thread topic context.** The
2026-10-20 read-only prod preview found the motivating case's topic only in the thread's opening
message (index 0); the live reply is index 3 and the unreferenced lookback is 1 human message
(`src/reminder-context-resolution.js:182`, pinned by `tests/reminder-context-resolution.test.js:80`),
so the `re:` rule alone cannot fire. Proposal: for in-thread UNREFERENCED messages only, add the
human opening message under a separate `[thread topic, for reference only]` header with mentions
neutralized; referenced messages unchanged; markers/strip/prompt learn the header. Reviewer please
grade this against the cap's documented incident (neighbour task + @mention -> wrong owner,
`src/reminder-context-resolution.js:171-181`) and say whether the mitigations are sufficient or the
addition should split into its own issue.

Requesting Round 2 review.

### Reviewer · Round 2 · codex

swept file: yes

VERDICT: FAIL
Basis: R2 is addressed, but R1 still permits partial condition deletion, R3's red control changes two variables, and the new topic-only context needs a deterministic fallback boundary. Reviewed the whole revised 127-line plan, the whole title-contract module, selector, context resolver, title-contract test and golden set, both prompt assets, and the named replay/render paths. No additional pre-existing defects in the plan found beyond these findings.

Evidence scope: direct seeded-source Verify fallback; no graph tools are callable in this turn (tool discovery returned no `list_projects`, `index_status`, `search_graph`, or `check_index_coverage`), so no graph completeness claim. No git, suites, executable fixtures, or service/model probes ran. Proposed behavior is distinguished below from implemented behavior. Probe command: `export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"; node "$TMPDIR/gh258-r2-probe.js"` (exit 0); it imports only the pure contract/selector/resolver and models the plan's permitted deletion/header removal. Decisive outputs are preserved in the findings because scratch is disposable.

- [Should] **R1 remains open — optional lead-ins still let bare suffixes match inside conditions.** Plan lines 47–54 say removing `until|for|over` from the lead-ins means conditions are never matched, but a bare `Friday` remains matchable. `Keep staging online through Friday` becomes `Keep staging online through`; `Keep staging online until this Friday` becomes `Keep staging online until this`. Neither result triggers the specified connector or minimum-word revert, and both pass the existing validator. Cheapest fix: conservatively refuse partial temporal-clause matches (including these duration forms); do not build a date parser or keep expanding a dangling-word list without checking the whole matched clause. Also make the manual prompt's existing blanket scheduling prohibition preserve conditions, consistent with requirement 1; plan line 41 currently limits that asset to the new `re:` line.
  Observed input: `Keep staging online through Friday` and `Keep staging online until this Friday`; deleting the explicitly allowed bare weekday produces the strings above.
  Affected scope: leading/trailing schedule removal when the date is embedded in a duration/condition rather than a standalone scheduling adjunct; the same distinction in both prompt assets.
  Falsifier: existing-suite cases preserve both complete inputs while `Deploy the hotfix by Friday` becomes `Deploy the hotfix`; prompt evidence preserves duration wording through the manual path too.
  Probe output: for each damaged string, `"tooShort":false,"connector":false,"validation":{"ok":true,"reasons":[]}`. The deadline control also passes. This is a counterexample to the planned predicates, not a claim that a schedule matcher has been implemented.

- [Should] **R4 — a topic-only root must not become the fallback task.** Plan lines 62–69 add the opening message before ordinary context and teach `StripContextMarkers` the header, but the deterministic consumer uses every stripped context line as a fallback subject (`src/reminder-display-selection.js:202-205,228-232`). `BuildFallbackTitle` preferentially selects an imperative (`src/reminder-title-contract.js:470-475`). Neutralizing mentions and instructing the model cannot constrain this non-model path. Cheapest fix: retain the topic body for analyzer grounding, but exclude the whole topic-only block from fallback subject candidates; pin this in the existing selector suite. Make the manual prompt understand the same topic-only boundary, since plan line 41 currently adds only `re:` there. The bounded root addition can remain in this issue if these consumers honor its semantics; no separate relevance subsystem is requested.
  Observed input: unreferenced live reply `Ask him tomorrow`, immediate antecedent `Ok`, opening task `<@U_OTHER> delete the backups tomorrow`; proposed mention-neutralized opening text is `@someone delete the backups tomorrow`. `DescribeReferenceShape('Ask him tomorrow')` returns `null`, so this is within the new path.
  Affected scope: an unreferenced enriched reply whose model/span/verbatim candidates are refused and whose topic-only opening message names unrelated work.
  Falsifier: the real selector with candidate `{reminder_message:'Ask him', actionable_language:'Ask him'}` and that enriched source returns the generic fallback, never `Delete the backups`; a valid grounded `Reply to Dana re: vendor security review` still survives using topic-only source terms. Include an unrelated opening task in the real-model check for both assets, asserting the live reply's task and owner, since plan lines 119–121 currently use a background statement rather than a competing imperative.
  Probe output: without root, `"text":"Follow up on the original message","source":"fallback"`; after simulating removal of the new header while retaining its body, `"text":"Follow up: Delete the backups tomorrow","source":"fallback","ungroundedTerms":[]`. A future schedule strip merely removes `tomorrow`; it cannot repair the task substitution. This measures the current downstream consumer under the proposed wire-format change, not a completed resolver implementation.

- [Should] **R3 remains open — separate the prompt and context red controls.** Plan lines 123–125 remove the prompt addition and disable the topic header in the same control. With the positive topic available only in the opening message (lines 119–121), disabling the header can make that control red even if deleting the prompt line alone changes nothing. That still does not establish sensitivity to the prompt requirement. Cheapest fix: explicitly keep the enriched input identical while removing only the `re:` instruction, for each edited asset; test root availability separately by disabling only the topic block. Keep receipts in the already named `TESTS-RESULTS/2026-10-20+GH-258/` destination. No new suite is needed.
  Observed input: the plan's topic-present thread plus its combined mutation, `new prompt line removed (and with the topic header disabled)`.
  Affected scope: the evidence claimed for the person-topic prompt rule and the new context addition, independently.
  Falsifier: the fixed-input prompt-only mutation loses the required topic while the unchanged enriched source still contains it; the independent header-only mutation measures the resolver contribution. If prompt-only deletion stays green, report it as insensitive and revise the evidence rather than attributing the combined failure to the prompt.
  Real-model results remain **[Unverified — needs clone run]**.

- [Pass] **R2's ordering and selector-level checks are now explicit.** Plan lines 44–46 place leading removal before framing and lines 74–75 require the real selector with an empty model candidate; this addresses the anchored framing pass at `src/reminder-title-contract.js:264-279`. Plan lines 55 and 78–79 preserve opaque quotes and grounding cases; grounding still uses analyzed context and rechecks normalized output (`src/reminder-display-selection.js:107-111,163-170`).
- [Pass] **The rating and existing verification surfaces are appropriately bounded.** Plan line 5 labels `55/30/45/75` provisional, and lines 113–127 name the existing suites, replay, AI validation, real-model check and receipt location. These are plan commitments, not executed passes. The due-date duplication claim remains supported by `src/reminders-display-utils.js:267`.

Root cause: the revised plan treats a removable suffix and a removable marker as complete semantic boundaries; Fix site: requirements 2/4 and verification controls in the plan; Why not upstream/downstream: the established contract/selector/resolver can implement these distinctions without a parallel path or new machinery.

Handing off to Producer (claude-a): disposition R1, R3 and R4, revise the plan, then request Round 3 review.

### Producer · Round 2 · claude-a

Dispositions (plan revised; no code yet):

- **R1 (r2) — Implemented.** Replaced the dangling-word revert with a whole-clause boundary: a match
  is stripped only if it starts with a deadline lead-in or the word before it is not a preposition
  or determiner from one closed list; otherwise the clause is kept. `[this|next|coming] <weekday>`
  is one term, so `until this Friday` is seen whole. Pinned: `Keep staging online through Friday`,
  `Keep staging online until this Friday` unchanged. The manual prompt's blanket scheduling rule is
  reworded to the same due-date-vs-duration distinction.
- **R4 — Implemented.** The topic block body stays in the analyzed source for grounding, but the
  selector excludes the whole topic block from fallback-subject candidates. Pinned with your exact
  input (`Ask him` -> generic fallback, never `Delete the backups`) and the positive grounded
  `re:` case. Both prompt assets learn the topic-only boundary. Real-model check gains the
  competing-imperative case asserting the live reply's task and owner.
- **R3 (r2) — Implemented.** Two separate controls: prompt-only removal on identical enriched input
  per asset (reported as insensitive if green), and topic-block-only removal with the prompt
  unchanged.

Requesting Round 3 review.

### Reviewer · Round 3 · codex

swept file: yes

VERDICT: FAIL
Basis: R2, R3 and R4 are addressed at plan level; R1 still permits deleting a date from inside a duration clause. Swept the entire 145-line plan, the whole title-contract module and title-contract test/golden set, and the selector, resolver, prompt, grounding, replay and rendering paths named in Setup. No additional pre-existing plan defects found beyond R1 below. This is plan QA, not implementation approval; the max round is reached, so STATUS is Escalated.

Evidence scope: Verify with direct seeded-source fallback. `list_projects` pagination completed (84 projects); the nearest graph is a different checkout, `aegis-sleuth-slack-bot`, generation `2026-10-13T00:42:44Z`. Targeted symbol search completed without further pages, and `check_index_coverage` covered all twelve evidence paths; it reports missing/untracked/changed paths and excluded tests/prompts/scripts/fixtures. Consequently material claims below use the seeded files, not graph absence. No git commands, suites, executable fixtures, model calls or service probes ran.

- [Should] **R1 remains open — the preceding-word test is still not a whole-clause boundary.** `PROJECT/2-WORKING/GH-258-REMINDER-TITLE-TOPIC.md:53-59` permits stripping a bare weekday whenever its immediately preceding word is absent from the closed list. For `Keep staging online until at least Friday`, that word is `least`, so the rule permits `Keep staging online until at least`. The two-word minimum and existing validator both accept this damaged result. This is the same partial-duration deletion as Round 2, with an intervening modifier; another last-word list entry would only patch this instance. Cheapest fix: conservatively keep an ambiguous temporal clause when a duration/condition introducer governs the matched date, including intervening modifiers; explicitly decline stripping such cases rather than building a general date parser. Pin this case in the existing contract suite alongside the deadline control.
  Observed input: `Keep staging online until at least Friday`; proposed suffix `Friday`, preceding word `least`, absent from the plan's closed list.
  Affected scope: leading/trailing schedule deletion that matches only the date inside a condition/duration with intervening modifiers.
  Falsifier: the existing normalizer test preserves `Keep staging online until at least Friday` and `Keep staging online through Friday` intact, while `Deploy the hotfix by Friday` becomes `Deploy the hotfix`.
  Probe command: `export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"; node "$TMPDIR/gh258-r3-probe.js"` (exit 0). The scratch probe extracts the closed list from the plan, evaluates the proposed boundary/minimum-word predicates for an explicit Friday suffix, and calls the existing pure contract. Decisive output: `{"input":"Keep staging online until at least Friday","precedingWord":"least","stripPermitted":true,"proposedOutput":"Keep staging online until at least","validation":{"ok":true,"reasons":[]},"baseline":"Keep staging online until at least Friday"}`. Controls: `through Friday` has `stripPermitted:false` and stays intact; `by Friday` has `stripPermitted:true` and yields `Deploy the hotfix`. This measures the specified predicates, not an implemented schedule matcher.

- [Pass] **R4 now defines the required deterministic boundary.** Plan lines 75–78 exclude the entire topic block from fallback-subject candidates while retaining it for grounding; lines 88–90 pin both the rejected-pointer/generic-fallback case and a grounded topic-bearing title. This directly addresses the fallback consumer at `src/reminder-display-selection.js:202-205,228-232` and the imperative preference at `src/reminder-title-contract.js:470-475`. Both prompt assets receive the topic-only rule (plan lines 71–74), and the competing-task check asserts task and owner (lines 136–138). Retain these commitments; runtime sufficiency remains **[Unverified — needs clone run]**.

- [Pass] **R3 separates the two contributions and does not overclaim sensitivity.** Plan lines 139–143 remove only the prompt instruction on identical enriched input, per asset, and disable only the topic block in a separate control. An insensitive prompt control is explicitly reported as such. Fixed positive/absent/competing inputs and the receipt destination are specified at lines 132–145; `validate:ai` is named at line 127. This is appropriate planned evidence beyond the recorded-response replay (`scripts/decision-replay.js:15-17`); model outcomes remain **[Unverified — needs clone run]**.

- [Pass] **The existing owner and R2 sequencing remain appropriate.** Plan lines 44–48 put leading schedule removal before the anchored framing loop (`src/reminder-title-contract.js:264-275`), with selector-level cases at plan lines 83–84. Opaque quoted names remain required (plan line 60; contract lines 223–230), and the selector grounds both before and after normalization (`src/reminder-display-selection.js:107-111,163-170`). The compact renderer separately emits `· due ${SlackDateFormat}` at `src/reminders-display-utils.js:267`; no new rendering path is required.

Root cause: treating one immediately preceding token as a complete temporal-clause boundary; Fix site: requirement 2's stripping admission rule and its existing-suite cases; Why not upstream/downstream: the shared remove-only normalizer must avoid damaging valid source text, and neither a prompt nor the downstream shape/grounding checks can restore deleted duration content.

Handing off to Producer (claude-a): the three-round limit is reached. Resolve or explicitly disposition the remaining R1 through the escalated relay decision before implementation; return to the Producer window and say 'take your turn'. No artifact or source file was edited in this reviewer turn.

<!-- ↓↓↓ NEXT TURN goes here (append above nothing — this marker stays last) ↓↓↓ -->
