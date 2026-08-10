#!/usr/bin/env node
'use strict';

/**
 * decision-replay.js — replay AI-decision scenarios and diff them against a committed baseline.
 *
 * GH-44 Phase 6. This is the ONE harness for before/after comparison of decision behavior; it is
 * deliberately not a fourth scenario runner (GH-397: "build ONE capture harness"). It reuses
 * scripts/projection-parity-harness.js's canonicalize/serialize/compare shape and the thread
 * scenario format scripts/reminder-thread-battery.js already validates.
 *
 * Scenarios are THREADS. `turns` is an ordered array of {user, text}; a single-message case is a
 * one-turn thread and nothing special-cases it.
 *
 * Deterministic by construction: each scenario carries a `recordedResponse` that is replayed in
 * place of the model, so a run makes ZERO network calls and two runs on one commit are
 * byte-identical. A scenario with no recorded response is reported SKIP — never silently passed.
 *
 * Usage:
 *   node scripts/decision-replay.js --scenarios <file> [--baseline <file>] [--update-baseline] [--json]
 *   npm run decision:replay
 *
 * Exit: 0 all rows PASS/SKIP · 1 any FAIL or CHANGED-vs-baseline · 2 usage/IO error.
 */

const fs = require('fs');
const path = require('path');

const RemindersAIPipeline = require('../src/reminders-ai-pipeline');
const { ResetAssetCache } = require('../src/ai-decision');
const DecisionExplain = require('../src/decision-explain');
const ReminderOwnership = require('../src/reminder-ownership');

const DefaultScenariosPath = path.join(
  __dirname, '..', 'tests', 'fixtures', 'decision-scenarios', 'reminder-extraction-battery.json',
);
const DefaultBaselinePath = path.join(
  __dirname, '..', 'tests', 'fixtures', 'decision-scenarios', 'baseline.json',
);

// ---------------------------------------------------------------------------
// canonical serialization — same shape as projection-parity-harness.js so a
// reader of one recognizes the other.
// ---------------------------------------------------------------------------

/**
 * @param {any} ArgValue
 * @returns {any}
 */
function Canonicalize(ArgValue) {
  if(Array.isArray(ArgValue)) return ArgValue.map(Canonicalize);
  if(!ArgValue || typeof ArgValue !== 'object') return ArgValue;
  const Result = /** @type {Record<string, any>} */ ({});
  for(const Key of Object.keys(ArgValue).sort()) Result[Key] = Canonicalize(ArgValue[Key]);
  return Result;
}

/**
 * @param {any} ArgValue
 * @returns {string}
 */
function SerializeCanonical(ArgValue) {
  return `${JSON.stringify(Canonicalize(ArgValue), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

/**
 * @param {string[]} ArgArgv
 * @returns {{ScenariosPath: string, BaselinePath: string, UpdateBaseline: boolean, AsJson: boolean, HelpRequested: boolean}}
 */
function ParseArgs(ArgArgv) {
  let ScenariosPath = DefaultScenariosPath;
  let BaselinePath = DefaultBaselinePath;
  let UpdateBaseline = false;
  let AsJson = false;
  let HelpRequested = false;

  for(let Index = 0; Index < ArgArgv.length; Index++) {
    const Current = ArgArgv[Index];
    if(Current === '--scenarios') {
      ScenariosPath = ArgArgv[++Index];
      if(!ScenariosPath) throw new Error('Missing file path after --scenarios.');
    } else if(Current === '--baseline') {
      BaselinePath = ArgArgv[++Index];
      if(!BaselinePath) throw new Error('Missing file path after --baseline.');
    } else if(Current === '--update-baseline') {
      UpdateBaseline = true;
    } else if(Current === '--json') {
      AsJson = true;
    } else if(Current === '--help' || Current === '-h') {
      HelpRequested = true;
    } else {
      throw new Error(`Unknown argument: ${Current}`);
    }
  }

  return { ScenariosPath, BaselinePath, UpdateBaseline, AsJson, HelpRequested };
}

/** @returns {void} */
function PrintUsage() {
  console.log('Usage: node scripts/decision-replay.js [options]');
  console.log('  --scenarios PATH    scenario file (default: the GH-43 battery)');
  console.log('  --baseline PATH     baseline file to diff against');
  console.log('  --update-baseline   WRITE the baseline from this run (never implicit)');
  console.log('  --json              emit machine-readable rows');
}

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

/**
 * A WorkspaceAI double that replays one recorded response. Fails loudly if the pipeline tries to
 * make a call the scenario did not record, so a silent live-model fallback can never happen.
 * @param {any} ArgRecorded
 * @returns {any}
 */
function MakeReplayWorkspaceAI(ArgRecorded) {
  let Calls = 0;
  return {
    ComplexModelName: 'replay-complex-model',
    SimpleModelName: 'replay-simple-model',
    async ProcessMessageWithJsonResponseAsync() {
      Calls += 1;
      if(Calls > 1) {
        // date extraction et al. are not part of this comparison; only the first decision is.
        throw new Error('decision-replay: unexpected second model call in a replayed scenario');
      }
      return ArgRecorded;
    },
  };
}

/** Minimal SlackApp stand-in: the pipeline only reaches for a logger on this path. */
const SilentSlackApp = { Logger: { info() {}, warn() {}, error() {} } };

/**
 * Run one scenario and return its observed outcome. Never throws — a scenario that blows up is a
 * FAIL row carrying the error, not an aborted batch.
 * @param {any} ArgScenario
 * @returns {Promise<{id: string, status: string, observed: any, error: string|null}>}
 */
async function RunScenarioAsync(ArgScenario) {
  const Id = (ArgScenario && ArgScenario.id) || '(unnamed)';

  if(!ArgScenario || !Array.isArray(ArgScenario.turns) || ArgScenario.turns.length === 0) {
    return { id: Id, status: 'FAIL', observed: null, error: 'scenario has no turns[]' };
  }
  if(ArgScenario.recordedResponse === undefined) {
    // explicitly SKIP rather than pass: an unrecorded scenario proves nothing.
    return { id: Id, status: 'SKIP', observed: null, error: 'no recordedResponse' };
  }

  try {
    ResetAssetCache();
    const WorkspaceAI = MakeReplayWorkspaceAI(ArgScenario.recordedResponse);
    const Pipeline = new RemindersAIPipeline(WorkspaceAI, SilentSlackApp, () => []);

    if(ArgScenario.decision === 'multi-task-extraction') {
      const Thread = ArgScenario.turns.map((ArgTurn, ArgIndex) => ({
        ts: `${ArgIndex + 1}.0`, user: ArgTurn.user || 'U_HARNESS', text: ArgTurn.text,
      }));
      const Result = await Pipeline.ExtractMultiTaskCandidatesAsync(Thread, null, [], []);
      return {
        id: Id,
        status: 'PASS',
        observed: {
          decision: 'multi-task-extraction',
          candidates: (Result.candidates || []).map((/** @type {any} */ ArgC) => ({
            title: ArgC.title, assigneeID: ArgC.assigneeID, deadline: ArgC.deadline,
            confidence: ArgC.confidence, flag: ArgC.flag,
          })),
        },
        error: null,
      };
    }

    // reminder-analysis is single-message by contract; a multi-turn scenario is joined so the
    // harness never silently drops turns (the thread path above is the right home for those).
    const MessageText = ArgScenario.turns.map((/** @type {any} */ ArgTurn) => ArgTurn.text).join('\n');
    const Analysis = await Pipeline.AnalyzeMessageForRemindersAsync(MessageText);
    const Routing = RemindersAIPipeline.DescribeSynthesisRouting(
      RemindersAIPipeline.NormalizeOriginalReminderText(MessageText), Analysis.reminders,
    );

    // Ownership read through the SHARED resolver the write path uses, so this measures real
    // behavior rather than a re-implementation that could drift from it.
    const SenderID = ArgScenario.sender || 'U_SENDER';
    const MentionedIDs = DecisionExplain.ExtractMentionIDs(MessageText);
    const GroupActionable = Analysis.reminders
      .map((/** @type {any} */ ArgR) => ArgR.actionable_language || '').join(' ').trim();
    const Ownership = ReminderOwnership.ResolveAssignees({
      MessageText, ActionableLanguage: GroupActionable, MentionedIDs, SenderID,
    });
    const AssigneeIDs = Ownership.assigneeIDs.length > 0 ? Ownership.assigneeIDs : [SenderID];

    // The displayed bullet, as #SelectReminderTaskText would choose it. This is what makes the
    // verbatim-dump defect observable to the harness instead of invisible behind the raw candidate.
    const DisplayedTasks = Analysis.reminders.map((/** @type {any} */ ArgR) =>
      Routing.synthesisOn
        ? (ArgR.reminder_message || ArgR.actionable_language || '')
        : RemindersAIPipeline.NormalizeOriginalReminderText(MessageText));

    return {
      id: Id,
      status: 'PASS',
      observed: {
        decision: 'reminder-analysis',
        recommendation: Analysis.recommendation,
        candidateCount: Analysis.reminders.length,
        displayedTasks: DisplayedTasks,
        triggers: Analysis.reminders.map((/** @type {any} */ ArgR) => ArgR.scheduling_trigger),
        ownership: {
          assignees: AssigneeIDs,
          senderIsAssignee: AssigneeIDs.includes(SenderID),
          resolvedFrom: Ownership.resolvedBy,
          notify: Ownership.notifyIDs,
        },
        routing: {
          segment: Routing.segment,
          synthesisOn: Routing.synthesisOn,
          sentenceCount: Routing.sentenceCount,
          actionableSpanRatio: Routing.actionableSpanRatio,
        },
      },
      error: null,
    };
  } catch(error) {
    return { id: Id, status: 'FAIL', observed: null, error: String((error && error.message) || error) };
  }
}

/**
 * Check a scenario's observed outcome against its declared expectations.
 *
 * This is what makes the harness capable of reporting a defect rather than only reporting drift.
 * A baseline diff alone can only say "this changed"; on a codebase whose CURRENT behavior is wrong,
 * the first baseline would simply enshrine the bug. Expectations state what SHOULD happen, so a
 * known defect shows up RED on the very first run.
 * @param {any} ArgScenario
 * @param {any} ArgObserved
 * @returns {string[]} human-readable failure reasons; empty means satisfied.
 */
function CheckExpectations(ArgScenario, ArgObserved) {
  const Expected = ArgScenario && ArgScenario.expected;
  if(!Expected || !ArgObserved) return [];

  const Reasons = [];
  const Tasks = ArgObserved.displayedTasks || [];
  const Joined = Tasks.join(' | ');

  if(Expected.recommendation && ArgObserved.recommendation !== Expected.recommendation)
    Reasons.push(`recommendation ${ArgObserved.recommendation} != ${Expected.recommendation}`);

  for(const Needle of (Expected.taskTextContains || [])) {
    if(!Joined.toLowerCase().includes(String(Needle).toLowerCase()))
      Reasons.push(`task text missing ${JSON.stringify(Needle)}`);
  }
  for(const Needle of (Expected.taskTextExcludes || [])) {
    if(Joined.toLowerCase().includes(String(Needle).toLowerCase()))
      Reasons.push(`task text should not contain ${JSON.stringify(Needle)}`);
  }
  if(typeof Expected.maxTaskLength === 'number') {
    const TooLong = Tasks.filter((/** @type {string} */ ArgT) => ArgT.length > Expected.maxTaskLength);
    if(TooLong.length > 0)
      Reasons.push(`task text ${TooLong[0].length} chars > max ${Expected.maxTaskLength}`);
  }
  // `owner` states WHO ends up owning the reminder, not which internal rule fired. Asserting the
  // rule label instead would make every refinement of the resolver look like a regression — it did
  // exactly that when Phase 1A split the old catch-all `mentions` path into `second-person-ask`.
  if(Expected.owner === 'sender' && ArgObserved.ownership && !ArgObserved.ownership.senderIsAssignee)
    Reasons.push(`owner should be the sender, got [${ArgObserved.ownership.assignees.join(', ')}]`);
  if(Expected.owner === 'mentions' && ArgObserved.ownership
     && ArgObserved.ownership.senderIsAssignee)
    Reasons.push(`owner should be the mentioned users, but the sender is assigned [${ArgObserved.ownership.assignees.join(', ')}]`);
  if(Array.isArray(Expected.assignees) && ArgObserved.ownership) {
    const Got = [...ArgObserved.ownership.assignees].sort().join(',');
    const Want = [...Expected.assignees].sort().join(',');
    if(Got !== Want) Reasons.push(`assignees [${Got}] != [${Want}]`);
  }
  if(typeof Expected.synthesisOn === 'boolean' && ArgObserved.routing
     && ArgObserved.routing.synthesisOn !== Expected.synthesisOn) {
    Reasons.push(`synthesisOn ${ArgObserved.routing.synthesisOn} != ${Expected.synthesisOn}`);
  }

  return Reasons;
}

/**
 * @param {any[]} ArgScenarios
 * @returns {Promise<any[]>}
 */
async function RunAllAsync(ArgScenarios) {
  const Rows = [];
  for(const Scenario of ArgScenarios) {
    const Row = await RunScenarioAsync(Scenario);
    if(Row.status === 'PASS') {
      const Reasons = CheckExpectations(Scenario, Row.observed);
      if(Reasons.length > 0) {
        Rows.push({ ...Row, status: 'FAIL', error: Reasons.join('; ') });
        continue;
      }
    }
    Rows.push(Row);
  }
  return Rows;
}

/**
 * Compare observed rows against a baseline, marking drift.
 * @param {any[]} ArgRows
 * @param {Record<string, any>|null} ArgBaseline
 * @returns {any[]}
 */
function DiffAgainstBaseline(ArgRows, ArgBaseline) {
  if(!ArgBaseline) return ArgRows;
  return ArgRows.map(ArgRow => {
    if(ArgRow.status !== 'PASS') return ArgRow;
    const Prior = ArgBaseline[ArgRow.id];
    if(Prior === undefined) return { ...ArgRow, status: 'NEW' };
    const Changed = SerializeCanonical(Prior) !== SerializeCanonical(ArgRow.observed);
    return Changed ? { ...ArgRow, status: 'CHANGED', baseline: Prior } : ArgRow;
  });
}

/**
 * @param {any[]} ArgRows
 * @returns {void}
 */
function PrintTable(ArgRows) {
  const Width = ArgRows.reduce((ArgMax, ArgRow) => Math.max(ArgMax, ArgRow.id.length), 4);
  console.log('');
  for(const Row of ArgRows) {
    const Detail = Row.error ? ` — ${Row.error}` : '';
    console.log(`  ${Row.id.padEnd(Width)}  ${Row.status.padEnd(8)}${Detail}`);
  }
  const Counts = ArgRows.reduce((/** @type {Record<string, number>} */ ArgAcc, ArgRow) => {
    ArgAcc[ArgRow.status] = (ArgAcc[ArgRow.status] || 0) + 1;
    return ArgAcc;
  }, {});
  console.log('');
  console.log(`  ${Object.entries(Counts).map(([ArgK, ArgV]) => `${ArgK}=${ArgV}`).join('  ')}`);
  console.log('');
}

/**
 * @param {string[]} ArgArgv
 * @returns {Promise<number>} process exit code.
 */
async function MainAsync(ArgArgv) {
  let Options;
  try {
    Options = ParseArgs(ArgArgv);
  } catch(error) {
    console.error(`decision-replay: ${(error && error.message) || error}`);
    PrintUsage();
    return 2;
  }
  if(Options.HelpRequested) { PrintUsage(); return 0; }

  let Scenarios;
  try {
    const Parsed = JSON.parse(fs.readFileSync(Options.ScenariosPath, 'utf8'));
    Scenarios = Parsed.scenarios;
    if(!Array.isArray(Scenarios) || Scenarios.length === 0)
      throw new Error('scenario file must have a non-empty "scenarios" array');
  } catch(error) {
    console.error(`decision-replay: cannot read scenarios — ${(error && error.message) || error}`);
    return 2;
  }

  const Rows = await RunAllAsync(Scenarios);

  if(Options.UpdateBaseline) {
    // Record every row that produced an observation, INCLUDING expectation failures. The baseline is
    // the "before" snapshot, and on a codebase with known defects the defective rows are the most
    // important ones to freeze — omitting them would leave exactly the behavior GH-43 is about to
    // change with nothing to diff against.
    const Baseline = /** @type {Record<string, any>} */ ({});
    for(const Row of Rows) if(Row.observed) Baseline[Row.id] = Row.observed;
    fs.mkdirSync(path.dirname(Options.BaselinePath), { recursive: true });
    fs.writeFileSync(Options.BaselinePath, SerializeCanonical(Baseline), 'utf8');
    console.log(`decision-replay: wrote baseline for ${Object.keys(Baseline).length} scenarios -> ${Options.BaselinePath}`);
    return 0;
  }

  let Baseline = null;
  if(fs.existsSync(Options.BaselinePath)) {
    try {
      Baseline = JSON.parse(fs.readFileSync(Options.BaselinePath, 'utf8'));
    } catch(error) {
      console.error(`decision-replay: baseline unreadable — ${(error && error.message) || error}`);
      return 2;
    }
  }

  const Diffed = DiffAgainstBaseline(Rows, Baseline);

  if(Options.AsJson) console.log(SerializeCanonical(Diffed));
  else PrintTable(Diffed);

  // stderr, not stdout: --json must emit parseable JSON and nothing else.
  if(!Baseline) {
    console.error('decision-replay: no baseline on disk — run with --update-baseline to record one');
  }

  const Bad = Diffed.filter(ArgRow => ArgRow.status === 'FAIL' || ArgRow.status === 'CHANGED');
  return Bad.length > 0 ? 1 : 0;
}

module.exports = {
  ParseArgs, Canonicalize, SerializeCanonical, RunScenarioAsync, RunAllAsync,
  DiffAgainstBaseline, CheckExpectations, MainAsync,
};

if(require.main === module) {
  MainAsync(process.argv.slice(2))
    .then(ArgCode => { process.exitCode = ArgCode; })
    .catch(ArgError => {
      console.error(`decision-replay: ${(ArgError && ArgError.message) || ArgError}`);
      process.exitCode = 2;
    });
}
