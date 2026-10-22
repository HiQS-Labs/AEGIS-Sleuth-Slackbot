'use strict';

/**
 * Proves `scripts/validate-fsm-invariants.js` actually catches the bypass patterns it claims
 * to catch — without this, a regression that breaks the validator would silently always pass.
 *
 * The script is invoked as a child process so we exercise its real CLI behavior (exit codes,
 * pragma handling, method-context tracking) rather than refactoring it for unit-testability.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ScriptPath = path.join(__dirname, '..', 'scripts', 'validate-fsm-invariants.js');
const PipelineScriptPath = path.join(__dirname, '..', 'scripts', 'validate-reminder-pipeline.js');

/**
 * Run the validator against a temporary mock repo where `src/reminders-module.js` contains
 * ArgSourceText. Returns the spawn result (status + stdout + stderr) so each test can assert
 * on exit code and message content.
 */
function RunValidatorAgainst(ArgSourceText) {
  const TmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fsm-validator-'));
  const SrcDir = path.join(TmpRoot, 'src');
  const ScriptDir = path.join(TmpRoot, 'scripts');
  fs.mkdirSync(SrcDir, { recursive: true });
  fs.mkdirSync(ScriptDir, { recursive: true });
  fs.copyFileSync(ScriptPath, path.join(ScriptDir, 'validate-fsm-invariants.js'));
  fs.writeFileSync(path.join(SrcDir, 'reminders-module.js'), ArgSourceText, 'utf8');

  const Result = spawnSync(process.execPath, [path.join(ScriptDir, 'validate-fsm-invariants.js')], {
    cwd: TmpRoot,
    encoding: 'utf8',
  });

  fs.rmSync(TmpRoot, { recursive: true, force: true });
  return Result;
}

/**
 * The fixture tree's own baseline, matching the fixture sources below (3/6/3/4/2). Fixed rather than
 * copied from the repository, so an approved change to the real baseline cannot break these controls.
 * @param {Record<string, object>} [ArgOverrides] Per-counter fields to replace.
 */
function FixtureBaseline(ArgOverrides = {}) {
  const Counter = ArgCount => ({count: ArgCount, initial: ArgCount, locations: [], reason: 'fixture', issues: ['#261']});
  const Counters = {
    llm_extraction_specs: Counter(3), key_task_reparse_sites: Counter(6), routing_thresholds: Counter(3),
    display_sources: Counter(4), context_markers: Counter(2),
  };
  for(const [Name, Fields] of Object.entries(ArgOverrides)) Object.assign(Counters[Name], Fields);
  return {version: 1, counters: Counters};
}

/** Run the pipeline ratchet in a minimal disposable source tree. */
function RunPipelineValidatorAgainst(ArgExtraSource = {}, ArgBaseline = FixtureBaseline()) {
  const TmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-validator-'));
  const ScriptDir = path.join(TmpRoot, 'scripts');
  fs.mkdirSync(ScriptDir, {recursive: true});
  fs.copyFileSync(PipelineScriptPath, path.join(ScriptDir, 'validate-reminder-pipeline.js'));
  fs.writeFileSync(path.join(ScriptDir, 'reminder-pipeline-baseline.json'), JSON.stringify(ArgBaseline), 'utf8');
  const Sources = {
    'src/reminders-ai-pipeline.js': [
      'const ReminderDecisionSpec = Object.freeze({});',
      'const ComplexDateDecisionSpec = Object.freeze({});',
      'const ManualReminderDecisionSpec = Object.freeze({});',
      '  static LONG_MESSAGE_SENTENCE_THRESHOLD = 4;',
      '  static BURIED_TASK_MIN_LENGTH = 150;',
      '  static BURIED_TASK_MAX_SPAN_RATIO = 0.35;',
    ].join('\n'),
    'src/reminder-display-selection.js': "/** @returns {{source: 'verbatim'|'title'|'span'|'fallback'}} */\n",
    'src/reminder-context-resolution.js': "const CONTEXT_BLOCK_HEADER = 'a';\nconst LIVE_MESSAGE_HEADER = 'b';\n",
    'src/slack-format-utils.js': [
      '.replace(/Key task/);',
      '.match(/Key task/);',
      "const Marker = '\\n\\nKey task(s):';",
      ".indexOf('\\n\\nKey task(s):');",
    ].join('\n'),
    'src/chat-commands/show-me-projects-command.js': '.match(/Key task/);\n',
    'src/reminders-module.js': ".indexOf('\\n\\nKey task(s):');\n",
    ...ArgExtraSource,
  };
  for(const [RelativePath, Source] of Object.entries(Sources)) {
    const Destination = path.join(TmpRoot, RelativePath);
    fs.mkdirSync(path.dirname(Destination), {recursive: true});
    fs.writeFileSync(Destination, Source, 'utf8');
  }
  const Result = spawnSync(process.execPath, [path.join(ScriptDir, 'validate-reminder-pipeline.js')], {cwd: TmpRoot, encoding: 'utf8'});
  fs.rmSync(TmpRoot, {recursive: true, force: true});
  return Result;
}

describe('validate-fsm-invariants', () => {
  test('exit 0 on a module where all .State assignments are inside #TransitionReminderState', () => {
    const Source = [
      "'use strict';",
      'class RemindersModule {',
      '  #TransitionReminderState(ArgReminder, ArgNext, ArgReason) {',
      '    ArgReminder.State = ArgNext;',
      '  }',
      '}',
      'module.exports = RemindersModule;',
      '',
    ].join('\n');
    const R = RunValidatorAgainst(Source);
    expect(R.status).toBe(0);
    expect(R.stdout).toContain('OK');
  });

  test('exit 1 on a module that assigns reminder.State outside the approved methods', () => {
    const Source = [
      "'use strict';",
      'class RemindersModule {',
      '  #SomeNewBypass(ArgReminder) {',
      "    ArgReminder.State = 'completed';",
      '  }',
      '}',
      '',
    ].join('\n');
    const R = RunValidatorAgainst(Source);
    expect(R.status).toBe(1);
    expect(R.stderr).toContain('#SomeNewBypass');
    expect(R.stderr).toContain('direct .State =');
  });

  test('exit 1 on a module that builds a ReminderInfo inline outside #MakeScheduledReminder', () => {
    const Source = [
      "'use strict';",
      'class RemindersModule {',
      '  #ShortcutScheduler() {',
      '    const r = /** @type {ReminderInfo} */ ({',
      '      ReminderID: "abc",',
      '    });',
      '    return r;',
      '  }',
      '}',
      '',
    ].join('\n');
    const R = RunValidatorAgainst(Source);
    expect(R.status).toBe(1);
    expect(R.stderr).toContain('#ShortcutScheduler');
    expect(R.stderr).toContain('inline ReminderInfo object literal');
  });

  test('FSM-BACKFILL-OK pragma on the same line silences the violation', () => {
    const Source = [
      "'use strict';",
      'class RemindersModule {',
      '  #LoadRemindersAsync(reminder) {',
      "    reminder.State = 'scheduled'; // FSM-BACKFILL-OK",
      '  }',
      '}',
      '',
    ].join('\n');
    const R = RunValidatorAgainst(Source);
    expect(R.status).toBe(0);
    expect(R.stdout).toContain('OK');
  });

  test('comparison `=== State` is not flagged as an assignment', () => {
    const Source = [
      "'use strict';",
      'class RemindersModule {',
      '  #CheckRemindersAsync(Reminder) {',
      "    if(Reminder.State === 'scheduled') return true;",
      "    if(Reminder.State == 'failed') return false;",
      '    return false;',
      '  }',
      '}',
      '',
    ].join('\n');
    const R = RunValidatorAgainst(Source);
    expect(R.status).toBe(0);
  });

  test('the real src/reminders-module.js passes the validator', () => {
    const Result = spawnSync(process.execPath, [ScriptPath], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    });
    expect(Result.status).toBe(0);
    expect(Result.stdout).toContain('OK');
  });
});

describe('validate-reminder-pipeline', () => {
  test('accepts the approved inventory and rejects every growth red control', () => {
    expect(RunPipelineValidatorAgainst().status).toBe(0);
    expect(RunPipelineValidatorAgainst({
      'src/reminders-ai-pipeline.js': [
        'const ReminderDecisionSpec = Object.freeze({});',
        'const ComplexDateDecisionSpec = Object.freeze({});',
        'const ManualReminderDecisionSpec = Object.freeze({});',
        'const ExtraDecisionSpec = Object.freeze({});',
        '  static LONG_MESSAGE_SENTENCE_THRESHOLD = 4;',
        '  static BURIED_TASK_MIN_LENGTH = 150;',
        '  static BURIED_TASK_MAX_SPAN_RATIO = 0.35;',
      ].join('\n'),
    }).status).toBe(1);
    expect(RunPipelineValidatorAgainst({
      'src/new-key-task-parser.js': '.match(/Key task/);\n',
    }).status).toBe(1);
    expect(RunPipelineValidatorAgainst({
      'src/reminders-ai-pipeline.js': [
        'const ReminderDecisionSpec = Object.freeze({});',
        'const ComplexDateDecisionSpec = Object.freeze({});',
        'const ManualReminderDecisionSpec = Object.freeze({});',
        '  static LONG_MESSAGE_SENTENCE_THRESHOLD = 4;',
        '  static BURIED_TASK_MIN_LENGTH = 150;',
        '  static BURIED_TASK_MAX_SPAN_RATIO = 0.35;',
        '  static EXTRA_ROUTING_THRESHOLD = 1;',
      ].join('\n'),
    }).status).toBe(1);
    expect(RunPipelineValidatorAgainst({
      'src/reminder-context-resolution.js': "const CONTEXT_BLOCK_HEADER = 'a';\nconst LIVE_MESSAGE_HEADER = 'b';\nconst EXTRA_HEADER = 'c';\n",
    }).status).toBe(1);
    expect(RunPipelineValidatorAgainst({
      'src/reminder-display-selection.js': "/** @returns {{source: 'verbatim'|'title'|'span'|'fallback'\n * |'new-source'}} */\n",
    }).status).toBe(1);
  });

  test('requires an explicit baseline update after an approved deletion', () => {
    const Result = RunPipelineValidatorAgainst({
      'src/reminders-ai-pipeline.js': [
        'const ReminderDecisionSpec = Object.freeze({});',
        'const ComplexDateDecisionSpec = Object.freeze({});',
        'const ManualReminderDecisionSpec = Object.freeze({});',
        '  static LONG_MESSAGE_SENTENCE_THRESHOLD = 4;',
        '  static BURIED_TASK_MIN_LENGTH = 150;',
      ].join('\n'),
    });
    expect(Result.status).toBe(1);
    expect(Result.stderr).toContain('shrank');
  });

  test('counts an indented decision spec and a prefixed Key task regex as growth', () => {
    expect(RunPipelineValidatorAgainst({
      'src/reminders-ai-pipeline.js': [
        'const ReminderDecisionSpec = Object.freeze({});',
        'const ComplexDateDecisionSpec = Object.freeze({});',
        'const ManualReminderDecisionSpec = Object.freeze({});',
        'function Build() {',
        '  const ExtraDecisionSpec = Object.freeze({});',
        '}',
        '  static LONG_MESSAGE_SENTENCE_THRESHOLD = 4;',
        '  static BURIED_TASK_MIN_LENGTH = 150;',
        '  static BURIED_TASK_MAX_SPAN_RATIO = 0.35;',
      ].join('\n'),
    }).status).toBe(1);
    expect(RunPipelineValidatorAgainst({
      'src/new-key-task-parser.js': 'text.match(/\\n\\nKey task\\(s\\):/);\n',
    }).status).toBe(1);
  });

  test('keeps counting display sources after the verbatim source is deleted', () => {
    const Deleted = RunPipelineValidatorAgainst({
      'src/reminder-display-selection.js': "/** @returns {{source: 'title'|'span'|'fallback'}} */\n",
    });
    expect(Deleted.status).toBe(1);
    expect(Deleted.stderr).toContain('display_sources shrank 4 -> 3');
    expect(RunPipelineValidatorAgainst({
      'src/reminder-display-selection.js': "/** @returns {{source: 'title'|'span'|'fallback'|'a'|'b'}} */\n",
    }).status).toBe(1);
  });

  test('refuses a raised baseline count without its own increase record', () => {
    const Sources = {
      'src/reminders-ai-pipeline.js': [
        'const ReminderDecisionSpec = Object.freeze({});',
        'const ComplexDateDecisionSpec = Object.freeze({});',
        'const ManualReminderDecisionSpec = Object.freeze({});',
        'const ExtraDecisionSpec = Object.freeze({});',
        '  static LONG_MESSAGE_SENTENCE_THRESHOLD = 4;',
        '  static BURIED_TASK_MIN_LENGTH = 150;',
        '  static BURIED_TASK_MAX_SPAN_RATIO = 0.35;',
      ].join('\n'),
    };
    const EditedCount = RunPipelineValidatorAgainst(Sources, FixtureBaseline({llm_extraction_specs: {count: 4}}));
    expect(EditedCount.status).toBe(1);
    expect(EditedCount.stderr).toContain('exceeds its approved ceiling 3');
    expect(RunPipelineValidatorAgainst(Sources, FixtureBaseline({
      llm_extraction_specs: {count: 4, increases: [{to: 4, reason: 'reviewed spec', issue: '#250'}]},
    })).status).toBe(0);
    expect(RunPipelineValidatorAgainst(Sources, FixtureBaseline({
      llm_extraction_specs: {count: 4, increases: [{to: 4, reason: '', issue: 'none'}]},
    })).status).toBe(1);
  });
});
