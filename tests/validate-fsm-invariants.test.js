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
