---
Goal: Plan QA of GH-149 reminder judgement consolidation (whack-a-mole addendum 2026-10-10)
Date: 2026-10-10
NEXT: codex (Reviewer)
STATUS: Open
---

# Context

Review the plan in `PROJECT/2-WORKING/GH-149-REMINDER-JUDGEMENT.md` (read it in full: Recon, Plan,
Sweep result, Non-goals, Preflight bet, Acceptance, Rating) against the "Additional remediation tasks"
in the 2026-10-10 whack-a-mole addendum comment on GitHub issue #149 (its text is transcribed in the
doc's "Asks / acceptance criteria" section). Nothing is implemented yet; this is the plan gate.

Operational envelope: a single Slack bot process on one dev server, driven by one operator. Tests and
machinery must be commensurate with that; do not demand enterprise fail-safes, multi-tenant
isolation, feature flags for every gate, or new test infrastructure beyond the one corpus test the
addendum asks for.

Files the plan cites (read the cited regions at HEAD to check the line numbers and claims):
- src/reminders-ai-pipeline.js (:95-125 spec, :364-399 analysis, :732-763 direct ask + period-only, :839-852 fallback, :940-995 date roll-forward)
- src/reminders-module.js (:1539, :1587-1589, :1611-1700, :1815-1860, :1996-2010)
- src/reminders-app-mention-handler.js (:700-702, :721, :772-789)
- src/reminder-text-completion.js (:60-150)
- src/quoted-text.js, src/chat-module.js (:1547-1566, :2153), src/ai-decision.js (:191)
- data/static/ai/reminders-instructions.md (:55-80)
- tests/reminder-text-completion.test.js (:40-80), tests/quoted-text-reminders.test.js (:100-130), tests/reminders-ai-pipeline.test.js (:610-670), tests/chat-module.test.js (:60-87), tests/reminders-fsm-invariants.test.js, tests/mocks/mock-workspace-ai.js

Questions (answer each by number):

1. Grounded paths: does every file:line the plan cites exist at HEAD and say what the plan says it says? Name any that do not.
2. Missing requirement: is any task of the #149 addendum (Reproduce, Guard, Fix, Sweep; Verify is operator post-merge) not covered by the plan, or covered only nominally? In particular: is the FSM-invariant guard ("every `REASONS` token has a corpus row") a real guard for "every future exclusion must add a corpus row", or is there an exclusion shape that would slip past it?
3. Extends vs duplicates: does `src/reminder-judgement.js` as specified extend the existing modules (quoted-text, reminder-text-completion, ai-decision, the pipeline's decision spec) or does it duplicate any of them? Is any regex left with two homes after the sweep table is applied?
4. Ordering of gates: the plan makes the implicit order explicit as quote-strip -> opt-out -> completion -> model -> direct-ask fallback -> trigger classification. Does that preserve today's observable behavior for every case the existing suites pin (name any case whose verdict or reason token would change)? Specifically check: (a) applying the opt-out regex deterministically in `auto` mode before the model, (b) running the request guard AFTER `DetectCompletionReply` rather than at its current position, (c) `force` mode skipping both quote-strip and opt-out.
5. Blast radius / rollback / falsifiable checks: is the rollback story (revert rewiring commits, module additive) accurate given the sweep deletes code from four files? Are the acceptance checks falsifiable as written (red control, grep single-home, invariant)?
6. The roll-forward `while` loop at the date stage is kept (the addendum says retire "IsPeriodOnlyTrigger + while-loop"). The plan's reason: it is date extraction (a non-goal) and GH-205 tests pin it. Is that deviation justified, or is there a way to honor the addendum literally without changing `ExtractDateWithGptAsync`'s observable results?
7. Rating grounded: is 80/65/50/35 (priority/severity/appeal/cheapness) supported by the recurrence evidence in the doc, and is PDDA risk 3 / effort 4 / complexity 4 consistent with the blast radius described?

Flag anything wrong, missing, incorrectly scoped, or over/under-engineered for the envelope. Be
concrete and cite file:line. Every `[Blocker]` or `[Should]` must carry `Observed input:`,
`Affected scope:` and `Falsifier:` lines. You may run narrow read-only probes (node -e, grep) with
output under `.relay-scratch/`; do not run `npm test` or jest and grade such claims
`[Unverified — needs clone run]`.

Vocabulary rule: end your block with exactly one of the lines `VERDICT: PASS` or `VERDICT: FAIL`.
On PASS, change `STATUS: Open` at the top of this file to `STATUS: Approved`. On FAIL, leave STATUS
Open and list the findings; the producer will adjudicate each one in the plan doc (Accepted /
Rejected — Out of Scope / Ponytail) and hand back for the next round. Round cap 3.

<!-- ▽ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK ▽ -->
▶ TAKE YOUR TURN (codex)
<!-- △ RELAY AUTOMATION: DO NOT MODIFY THIS BLOCK △ -->

## Log

### Round 1 — codex review

Plan gate: changes required. The consolidation is proportionate, but the proposed invariant does
not enforce the promised rule, and the completion rewiring is not behavior-preserving.

Evidence scope: read the full seeded plan and the cited source/test regions in this worktree.
Codebase-memory Verify was attempted: both pages of `list_projects` (82 projects) contained no
index for this worktree; `check_index_coverage` with all cited paths and `src`/`tests` scopes returned
`project not found or not indexed`. Therefore these findings use direct source reads, not another
clone's graph or a claimed fresh generation. No git commands, suites, fixtures, network calls, or
source edits were performed. Full-suite behavior is **[Unverified — needs clone run]**. The narrow
pure-function probe below exited 0; its decisive output is retained here because scratch is discarded.

#### 1. Grounded paths

All named files exist. Most cited regions match, with these material corrections:

- Plan :88-93 calls `reminders-module.js:1539` an `OnAppMentionAsync` mention-mode gate. It is
  actually inside `#OnMessageAsync` (:1522), using **strict** mode. The mention-mode gate is
  `reminders-app-mention-handler.js:700-702`, correctly cited elsewhere in the plan.
- `reminders-module.js:1587-1589` is the scheduling call, not strict completion. Strict completion
  is :1539; completion detection is :1615, not :1620 (the latter begins `IsOwner`). Resolution
  is :1623-1625, not :1625-1630. Rewiring rows :186 and the historical trace :105-107 need these
  corrections so implementation does not move or replace the wrong gate.
- `ChatModule.IsReminderActionIntent` does not route to the reminders module. Its caller at
  `chat-module.js:2152-2158` posts an unsupported-creation explanation. The opt-out patch prevents
  that explanation; it is not currently a scheduling pre-filter.
- The #201 request cases are six rows, :62-67, including `snooze this, the client closed for the
  day`. Plan :168-169/:196-197 moves only five and leaves that sixth direct-detector test behind.
- The stubbing statement at plan :120-121 is too broad: `quoted-text-reminders.test.js:95-97`
  constructs an inline AI stub. This does not prevent using the proposed corpus.

#### 2. Requirement coverage

**F1 [Should] — token coverage is not exclusion coverage** (plan :176-178/:238).
The invariant catches adding a new declared token without a row. It cannot catch extending an
existing exclusion regex, adding a branch returning `model_ignore`/`opt_out`, or changing the prompt
exclusions while retaining `model_ignore`. Both sets remain identical. It also does not itself prove
that the source emits only declared tokens. Thus “adding an exclusion without a row fails” is false.
Use the existing invariant suite, with a small explicit exclusion identity/definition contract that
the predicates actually consume and the corpus covers; define the boundary for prompt exclusions.
Do not introduce a new test framework. Require a negative control that adds/extends an exclusion
without a corpus row and makes this guard fail, rather than only flipping an expected verdict.

Observed input: a new `ignore` branch reusing the already-covered `model_ignore` token; the probe's
unchanged `REASONS=['model_ignore']` and one old row still report coverage `true`.
Affected scope: the addendum's Guard requirement and the claimed future-exclusion protection.
Falsifier: in a disposable clone, add an uncovered exclusion using an existing token (including an
extension of an existing predicate); the existing FSM invariant must fail without editing the corpus.

**F2 [Should] — the corpus cannot reproduce #205's warning outcome as specified** (plan :45-48,
:159, :165-174). `PeriodOnly=true` classifies a trigger; it never asserts date extraction or
`wasAdjustedForward`. For example, changing `reminders-ai-pipeline.js:969` to always set
`wasAdjustedForward=true` leaves the entire proposed judgement corpus green. Existing tests at
`reminders-ai-pipeline.test.js:629-658` cover that integration, but the requested unified reproduction
is only nominal. Extend the same corpus test/row with a stubbed past anchor and an assertion on the
real date-stage result (and/or warning), while keeping date extraction outside the judgement owner.

Observed input: the GH-205 `This week` case with a past anchor; :969 controls the warning flag, and
`reminders-module.js:2194` consumes it. No such flag/date input exists in the proposed corpus schema.
Affected scope: Reproduce's “schedule with no past-time warning” requirement.
Falsifier: perturb :969 so a period-only trigger emits a past-time warning; the #205 corpus row fails.

Reproduce otherwise names #197/#211/#201, Fix covers the intended owner, and Verify is explicitly
operator post-merge as requested. Sweep has the loop deviation discussed in answer 6.

#### 3. Extends versus duplicates

Delegating to `quoted-text`, `DetectCompletionReply`, `DecideAsync`, and the existing analysis spec
extends those modules. No need to copy their normalizers, prompt loader, validation, capture, or
completion vocabulary. The sweep gives the moved opt-out, period-only, request and direct-ask regexes
one home; the quote-span regexes correctly retain their existing home in `quoted-text.js`.
Leaving `SCHEDULING_TRIGGER_PATTERN` in the handler is a reasonable explicit scope boundary.

Two contract details need clarification during revision: scheduling early exits must supply a valid
ignore-shaped `Analysis` (as today's quoted-only return at pipeline :370-371 does), since plan :184
returns `Judgement.Analysis` and module :1819 immediately dereferences `.recommendation`. Reserving
`Analysis=null` for completion modes avoids a null dereference. Also, plan :160 says the per-group
fallback comes from the result, but :189 reads an exported constant and the adapter discards that
result field. Choose one consumed contract and describe it consistently; the fallback itself at
module :2005-2007 should remain.

#### 4. Gate ordering and observable behavior

**F3 [Should] — preserve the completion gate semantics and all six migrated cases** (plan :145-154,
:192-197). Today completion takes raw reply text, with request detection after question checks and
before negation/future checks (`reminder-text-completion.js:119-144`). The proposed common quote-strip
changes it: `done "not done"` becomes a completion, while `"done"` stops completing. This broadens
the quoted-text scheduling fix to a terminal deletion path without an explicit requirement.
The post-positive request guard preserves many request verdicts, but changes reasons for
`done, remind me tomorrow` (`contains_request` → `future_or_conditional`) and `snooze this` in strict
mode (`contains_request` → `no_completion_phrase`). Finally, deleting the guard while migrating only
five rows leaves the sixth row at test :67 calling the now-unguarded detector and returning true.
Keep raw-text completion semantics and the request guard's precedence through delegation to the
single owner; repoint every affected caller/test, including the sixth request row. If quote-stripped
completion is intentional, explicitly price it as a behavior change rather than a byte-identical move.

Observed input: the four probe rows below; the snooze row is pinned false at
`tests/reminder-text-completion.test.js:67-71`.
Affected scope: mention/strict completion, reason diagnostics, and a retained unit assertion.
Falsifier: all six request rows remain non-completing through their final tested entry point; overlap
inputs keep their prior reasons and quoted completion inputs keep prior verdicts, or the revised
plan explicitly approves and tests each intentional change. Final suites need a clone run.

(a) The auto-mode opt-out gate is **new deterministic behavior**, not today's implicit order:
pipeline :381 calls the model first. Enforcing the prompt's :72 intent before the model is reasonable,
but it changes call/capture count and overrides a stubbed/model `schedule`. Existing chat opt-out
tests pin routing, not this pipeline result. State that exception to equivalence and assert no model
call with a would-schedule stub. Preserve chat's apostrophe/case normalization when reusing its regex.

(b) The request move has the concrete differences in F3. The existing five migrated request rows
mostly retain verdicts; that does not prove all reasons or all retained tests are preserved.

(c) Force bypass of quote-strip matches the explicit `KeepQuotedText` test at
`quoted-text-reminders.test.js:111-113`; bypassing the new opt-out gate preserves human force intent.
However, today's force path still calls a quote-stripping direct-ask helper when the model ignores
(pipeline :388-389 → :733). “Force skips quote-strip” must specify whether that fallback preserves its
existing helper behavior or also changes. No blanket equivalence claim is supported by the one test.

#### 5. Blast, rollback, acceptance

The radius is correctly every scheduling/text-completion path, with no persistence migration.
Reverting **all** rewiring commits, including deletions and corresponding test changes, restores the
deleted code; calling the new module additive is accurate only under that complete reversal. An
invariant test importing the new module is not literally inert, even if production no longer calls it.
No flag or new infrastructure is needed for this envelope.

Verdict-flip red control is falsifiable but proves assertion plumbing, not guard completeness (F1).
Regex single-home is measurable, provided the grep scope is production `src` and the exact moved
patterns are named; not every quote/completion regex should move. The GH-205 semantic falsifier is
missing (F2). Full-suite/build evidence remains **[Unverified — needs clone run]**.

#### 6. Roll-forward loop

**F4 [Should] — test-pinned results do not require keeping the loop syntax** (plan :202-204 versus
the explicit Sweep ask :55). The GH-205 tests pin future dates and the flag, not an implementation
using `while`. After the initial +1 UTC day at pipeline :962, a finite valid date can be advanced by
`Math.ceil((CurrentUtcDate - ExtractedDate) / 86400000)` further UTC days when still past. That retires
the loop without changing the date-stage API or ordinary observable results. Alternatively, seek an
explicit accepted deviation in the plan; the current “non-goal/tests pin it” rationale alone does
not establish that literal compliance requires changing behavior. Keep the existing GH-205 tests.

Observed input: test :642 seeds a 3-days-plus-1-hour-old anchor; pipeline :967-968 advances in UTC
24-hour increments until the date is not past.
Affected scope: the addendum's explicit while-loop retirement, confined to date roll-forward.
Falsifier: in a disposable clone, the loop is absent and the :629-658 result/flag tests pass (including
exact-day boundaries), or the producer records an explicit agreed scope deviation.

#### 7. Rating

80/65/50/35 is directionally supported by the supplied six-member recurrence narrative, noisy false
positives and broad but bounded rewiring. Exact ledger/churn/history numbers were not independently
audited here. Risk 3 / effort 4 / complexity 4 is consistent with changing all scheduling/completion
doors; no enterprise machinery is warranted. Correct “nothing is lost”: a false text-completion
verdict transitions and deletes a reminder (`reminders-module.js:1654-1659`). The stated four-module
count is also loose: the rewiring table changes five existing source files, plus the new owner.

#### Reproducible narrow probe

Command (exit 0; pure source evaluation and string transformation, no fixture/test execution):

```sh
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
node <<'NODE' > .relay-scratch/review-probe.txt
const fs=require('fs'),vm=require('vm');
const s=fs.readFileSync('src/reminder-text-completion.js','utf8');
function load(s){const c={module:{exports:{}}};vm.runInNewContext(s,c);return c.module.exports.DetectCompletionReply;}
const before=load(s),after=load(s.split('\n').filter(l=>!l.includes('if(REQUEST_PATTERN.test(Text))')).join('\n'));
const {IgnoreQuotedText}=require('./src/quoted-text');
for(const text of ['snooze this, the client closed for the day','done, remind me tomorrow','done "not done"','"done"'])
 console.log(JSON.stringify({text,before:before(text,'mention'),guardRemoved:after(text,'mention'),ownWordsDetection:before(IgnoreQuotedText(text),'mention')}));
const REASONS=['model_ignore'],rows=[{Expect:{Reason:'model_ignore'}}];
console.log('token-coverage-before-and-after-new-exclusion='+REASONS.every(r=>rows.some(x=>x.Expect.Reason===r)));
NODE
```

Decisive output (projection probes isolate each gate change; no proposed module exists yet):

```text
snooze this, the client closed for the day: before=false/contains_request; guardRemoved=true/mention_phrase
done, remind me tomorrow: before=false/contains_request; guardRemoved=false/future_or_conditional
done "not done": before=false/negated_or_partial; ownWordsDetection=true/mention_phrase
"done": before=true/mention_phrase; ownWordsDetection=false/empty
token-coverage-before-and-after-new-exclusion=true
```

VERDICT: FAIL

### Round 1 · Producer · claude-a

Basis: every round-1 finding adjudicated in `PROJECT/2-WORKING/GH-149-REMINDER-JUDGEMENT.md` ("Verification and QA" table); all Accepted, none rejected.

Plan revised (read the doc again in full; the Recon, Plan, Sweep result, Preflight bet, Acceptance and Verification sections changed):

1. Paths corrected: :1539 is the strict gate inside `#OnMessageAsync`; the mention gate is handler :700-702; detection :1615; `IsReminderActionIntent` is a chat-side explanation gate; six #201 rows :62-67; `quoted-text-reminders.test.js:95-97` inline stub noted.
2. F1: the guard is now an `EXCLUSIONS` table that `JudgeReminderTextAsync` iterates (the table is the implementation), plus an invariant that every entry has a corpus row whose text the entry's own `Test` matches. What it cannot guard (regex widening, prompt-only exclusions) is stated. Red control C added.
3. F2: corpus rows carry an optional `Date` block; the #205 row runs the real `ExtractDateWithGptAsync` with a stubbed past anchor and asserts `wasAdjustedForward`. Red control B added.
4. Contract: `Analysis` always model-shaped in scheduling modes (early exits return today's ignore-shaped object), `null` in completion modes. The fallback literal is the exported constant only.
5. F3: completion modes take the raw reply text; `REQUEST_PATTERN` moves to the judgement module and is injected into `DetectCompletionReply(text, mode, { RequestGuard })` at its current position, so every reason token is unchanged. All six request rows migrate to the corpus.
6. 4(a): auto-mode opt-out before the model is stated as the single exception to equivalence and pinned (`ModelCalled: false` with a would-schedule stub). 4(c): the direct-ask helper keeps its own quote-strip in both modes.
7. F4: the `while` loop is replaced by one `Math.ceil` step with identical results; GH-205 tests kept as the oracle.
8. Rating text corrected (a false completion deletes a reminder; five source files + the new owner).

Round-2 ask: re-check questions 1-7 against the revised doc. Your reviewer block MUST contain a non-empty `Basis:` line (the block validator rejected round 1 for lacking one, exit 8) and end with exactly `VERDICT: PASS` or `VERDICT: FAIL`; on PASS set `STATUS: Approved` at the top.

handing off to codex — codex, take your turn.


### Round 2 — codex review

Basis: read the revised GH-149 plan in full, including its adjudication table, and re-read the
cited source/test regions in this worktree. Applied the SWE planning rubric within the stated
operational envelope. Codebase-memory Verify: `list_projects(limit=100)` returned all 82 projects
with no matching worktree; `check_index_coverage` for the cited paths and `src`/`tests` scopes returned
`project not found or not indexed`. Direct source reads therefore supply the evidence; no graph
freshness is claimed. No git commands, test suites, executable fixtures or source edits were run.
Implementation/build/suite results remain **[Unverified — needs clone run]**.

Plan gate: one requirement still needs resolution. F2, F3 and F4 are addressed; F1 is now described
more honestly but its stated acceptance is narrower than the requested Guard.

#### 1. Grounded paths

The material path corrections match the source: strict completion is module :1539, detection
:1615, resolution :1623-1625; mention completion is handler :700-702; chat :2153 posts the unsupported
creation explanation; all six request rows are test :62-67; the quoted-text suite uses an inline
stub at :95-97. The analysis spec, direct-ask helper, period classifier, fallback and date-stage
citations match their stated responsibilities. Two harmless stale references remain: plan :112
still labels module :1587 strict completion (that line schedules), and plan :123 says request rows
:61-66 rather than :62-67. Use the corrected call-site table during implementation.

#### 2. Requirement coverage

**F1-R2 [Should] — narrowing the guard does not satisfy the addendum**
(`PROJECT/2-WORKING/GH-149-REMINDER-JUDGEMENT.md:49-50,149-152,207-219,287-290`).
Reproduce now includes the date-stage assertion, Fix has the common owner and Sweep removes the
loop. But Guard still asks that **every future exclusion must add a corpus row**. The revision
explicitly exempts regex widening, so an added excluded phrase in the existing `opt_out` predicate
passes with the old row. There is also a gap even within the new-entry claim: no unique exclusion
identity is specified. A second entry reusing `opt_out` and matching the old text plus a new phrase
satisfies the proposed per-entry positive-example guard without adding any row. The narrow probe
below demonstrates both. Deriving `REASONS` from the table cannot prove that arbitrary new source
branches never emit an existing token; plan :212-213 overstates that implication.

Cheapest correction: give exclusions distinct identities tied to their definitions and require
matching corpus evidence per identity/definition in the existing invariant suite. Include negative
controls for a widened predicate and a new entry reusing an existing reason, rather than only a
new uncovered reason. Keep prompt-only semantics explicitly separate from what the stubbed test
can verify. If widening protection is intentionally deferred, adjudicate it as a scope deviation
from Guard, rather than recording the requirement as accepted and fulfilled. No new framework or
suite is needed.

Observed input: existing corpus text `don't set a reminder`, reason `opt_out`; widen the predicate
(or add a same-reason predicate) to also exclude `skip deployment`, without changing the corpus.
Affected scope: future deterministic exclusion coverage and red control C; both revised guards
report success for the uncovered new exclusion.
Falsifier: in a disposable clone, each of those two changes makes the existing invariant fail with
the original corpus, while the unmodified owner passes; or an explicit accepted deviation resolves
the original Guard requirement. The final test execution is [Unverified — needs clone run].

#### 3. Extends versus duplicates

The module delegates quote handling to `quoted-text`, completion vocabulary/normalization to
`DetectCompletionReply`, and the model boundary to `DecideAsync` with the existing decision spec.
Injecting the request guard at detector :129 avoids copying the detector or introducing a cycle.
The sweep gives each moved production regex one owner. Keeping the scheduling-trigger gate and
per-group retry in their existing owners is proportionate. The fallback constant contract is now
consistent; it centralizes the literal while retaining the retry at module :2005-2007. The scheduling
`Analysis` early-exit shape fixes the possible :1819 null dereference.

#### 4. Gate ordering

(a) Auto opt-out before the model is now explicitly a behavior change, with a would-schedule stub
and `ModelCalled:false` assertion. Reusing chat's normalization preserves its existing cases,
including `don't forget` and `don't set a calendar event; set a reminder`.

(b) Completion modes retain raw text and inject the request predicate at its current normalized-text
position, after question checks and before negation/future checks. This preserves the previously
identified quoted-input verdicts and overlapping reason precedence. All six request rows migrate.
No pinned completion case identified here changes under the revised contract.

(c) Force sends the full message to the model and skips the new exclusions, while its direct-ask
fallback retains today's independent quote-strip. This matches the existing force test without
asserting that every internal helper takes unstripped text. Suite parity needs a clone run.

#### 5. Blast radius, rollback and proof

The revised rollback correctly includes the deleted source and re-pointed tests in all rewiring
reverts. Keeping the new module independently is viable with its dependent invariant/corpus files
kept consistently. No persistence migration or new operational machinery is warranted.
Red controls A and B are falsifiable; C is falsifiable for its narrow new-entry example but remains
insufficient for Guard (F1-R2). The single-home check should count definitions/importing files,
not every textual match: callers, comments and user-facing prose will still mention these names
and tomorrow morning. The plan states defining-file scope, which is adequate. Date `Now` must be
pinned in the corpus test so its ISO anchor remains past; the specified Date block supports this.

#### 6. Roll-forward loop

The revision now honors literal loop retirement with the arithmetic step at plan :226, retaining
period classification and `wasAdjustedForward = !IsPeriodOnly` semantics at pipeline :969.
A narrow UTC arithmetic probe agrees with the loop on seven age/boundary cases, including exact
whole days and the three-days-plus-one-hour test anchor. This is supporting arithmetic evidence,
not a substitute for the unchanged GH-205 integration tests in a clone. F4 is resolved.

#### 7. Rating

80/65/50/35 and PDDA risk 3 / effort 4 / complexity 4 remain proportionate to the supplied
recurrence narrative and five-source-file scheduling/completion radius. The revised account now
recognizes terminal deletion on false completion (:1654-1659). The precise churn score, ledger
row and historical recurrence counts were not independently audited; no new rating is asserted.

#### Narrow probe evidence

Command: the following pure predicate/arithmetic demonstration, exit **0**, output directed to
`.relay-scratch/round2-probe.txt`. It models the specified guard; no proposed module exists yet.

```sh
export PYTHONDONTWRITEBYTECODE=1 TMPDIR="$PWD/.relay-scratch/tmp"
mkdir -p "$TMPDIR"
node <<'NODE' > .relay-scratch/round2-probe.txt
const rows=[{Text:"don't set a reminder",Expect:{Reason:'opt_out'}}];
const before=[{Reason:'opt_out',Test:t=>/don't set a reminder/.test(t)}];
const widened=[{Reason:'opt_out',Test:t=>/don't set a reminder|skip deployment/.test(t)}];
const added=[...before,{Reason:'opt_out',Test:t=>/don't set a reminder|skip deployment/.test(t)}];
const guard=entries=>entries.every(e=>rows.some(r=>r.Expect.Reason===e.Reason&&e.Test(r.Text)));
console.log(JSON.stringify({beforeGuard:guard(before),widenedGuard:guard(widened),addedSameReasonGuard:guard(added),newlyExcludedText:'skip deployment',beforeExcluded:before.some(e=>e.Test('skip deployment')),afterExcluded:widened.some(e=>e.Test('skip deployment')),corpusRows:rows.length}));
const day=86400000,now=Date.parse('2026-10-10T12:00:00Z');let count=0;
for(const age of [1,day-1,day,day+1,2*day,3*day+3600000,30*day+1]) {
 let loop=now-age+day;while(loop<now)loop+=day;
 let arithmetic=now-age+day;if(arithmetic<now)arithmetic+=Math.ceil((now-arithmetic)/day)*day;
 if(loop!==arithmetic)throw Error('mismatch');count++;
}
console.log('UTC loop/arithmetic parity: '+count+' boundary/age cases');
NODE
```

Decisive output:

```text
{"beforeGuard":true,"widenedGuard":true,"addedSameReasonGuard":true,"newlyExcludedText":"skip deployment","beforeExcluded":false,"afterExcluded":true,"corpusRows":1}
UTC loop/arithmetic parity: 7 boundary/age cases
```

VERDICT: FAIL

### Round 2 · Producer · claude-a

Basis: F1-R2 adjudicated Accepted in `PROJECT/2-WORKING/GH-149-REMINDER-JUDGEMENT.md` ("Verification and QA", round-2 table); the Guard section and the acceptance red controls were rewritten; the two stale references (:112, :123) fixed.

Change: the guard is now bound to each exclusion's definition. `EXCLUSIONS` entries are `{ Id, Reason, Modes, Pattern }` with a unique `Id` and a single `RegExp`; the corpus file records `Definitions[Id] = Pattern.source`; the FSM invariant asserts (1) `Id`s unique, (2) every live entry's recorded definition exists and equals its live `Pattern.source`, (3) every entry has a corpus row with `Expect.Exclusion === Id` whose text the pattern matches, (4) every recorded definition is a live entry, (5) every `REASONS` token has a row. Your two probe cases now fail: widening `opt_out` changes `Pattern.source` and breaks (2); a second `opt_out`-reason entry needs its own `Id`, definition and row (2)/(3). Red controls C2 (widened predicate) and C3 (same-reason second entry) are in the acceptance list beside C1. Prompt-only exclusions are stated as the boundary of what a stubbed corpus can verify, not as an exemption from Guard.

Round-3 ask (final round): confirm whether F1-R2 is resolved and re-check 1-7 against the revised doc. Your block MUST contain a non-empty `Basis:` line and end with exactly `VERDICT: PASS` or `VERDICT: FAIL`; on PASS set `STATUS: Approved` at the top.

handing off to codex — codex, take your turn.
