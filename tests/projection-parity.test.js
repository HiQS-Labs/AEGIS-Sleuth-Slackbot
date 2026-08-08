'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  BuildProjectedRebalanceExport,
  FoldReminderReadModels,
  ProjectionParityError,
  ReadWithProjectionFallbackAsync,
} = require('../src/reminders-projection');
const {
  BuildParityReport,
  CompareBytes,
  CompareSemantics,
} = require('../scripts/projection-parity-harness');

const HarnessPath = path.join(__dirname, '..', 'scripts', 'projection-parity-harness.js');

function BaselineEvent(ArgOverrides = {}) {
  return {
    id: 'evt-baseline',
    ts: '2026-08-01T12:00:00.000Z',
    type: 'BaselineReminderImported',
    reminderId: 'rem-1',
    payload: {
      text: 'Ship parity harness', assigneeId: 'U_OWNER', assigneeIds: ['U_OWNER'],
      sourceChannelId: 'C_SOURCE', targetChannelId: 'C_REMINDERS', dueAt: '2026-08-02T12:00:00.000Z',
      state: 'scheduled', githubUrls: ['https://github.com/acme/repo/pull/1'],
      originalSenderId: 'U_SENDER', originalMessageId: '123.456', originalThreadTs: '123.000',
      originalChannelName: 'engineering', ignoreSnooze: false, clientId: 'acme', projectId: 'ledger',
    },
    ...ArgOverrides,
  };
}

describe('P3 Phase 5 projection parity', () => {
  test('baseline events fold to the JSON reminder shape and completed history', () => {
    const Events = [
      BaselineEvent(),
      {
        id: 'evt-completed', ts: '2026-08-03T12:00:00.000Z', type: 'ReminderCompleted', reminderId: 'rem-1',
        payload: { by: 'U_OWNER', method: 'reaction', summary: 'Ship parity harness', completedAt: '2026-08-03T12:00:00.000Z' },
      },
    ];
    const Folded = FoldReminderReadModels(Events, { strict: true });
    expect(Folded.reminders).toEqual([]);
    expect(Folded.completed).toEqual([{
      reminderId: 'rem-1', summary: 'Ship parity harness', assigneeID: 'U_OWNER', sourceChannelID: 'C_SOURCE',
      dueDate: '2026-08-02T12:00:00.000Z', completedMs: Date.parse('2026-08-03T12:00:00.000Z'), clientId: 'acme',
    }]);
  });

  test('strict projection refuses a native event with fields the ledger never captured', () => {
    const Native = BaselineEvent({ type: 'ReminderCreated' });
    delete Native.payload.originalSenderId;
    delete Native.payload.originalMessageId;
    delete Native.payload.originalThreadTs;
    delete Native.payload.originalChannelName;
    delete Native.payload.ignoreSnooze;
    expect(() => FoldReminderReadModels([Native], { strict: true })).toThrow(ProjectionParityError);
  });

  test.each(['REMINDERS_READ_SOURCE', 'COMPLETED_READ_SOURCE', 'REBALANCE_EXPORT_SOURCE'])('%s is independently reversible', async ArgFlagName => {
    const ReadAuthoritativeAsync = jest.fn().mockResolvedValue('json');
    const ReadProjectionAsync = jest.fn().mockResolvedValue('projection');
    const Off = await ReadWithProjectionFallbackAsync({
      flagName: ArgFlagName, environment: {}, ReadAuthoritativeAsync, ReadProjectionAsync,
    });
    expect(Off).toEqual({ value: 'json', source: 'authoritative' });

    const On = await ReadWithProjectionFallbackAsync({
      flagName: ArgFlagName, environment: { [ArgFlagName]: 'projection' }, ReadAuthoritativeAsync, ReadProjectionAsync,
    });
    expect(On).toEqual({ value: 'projection', source: 'projection' });
  });

  test('a projection error logs and returns the authoritative value', async () => {
    const Logger = { warn: jest.fn() };
    const Result = await ReadWithProjectionFallbackAsync({
      flagName: 'REMINDERS_READ_SOURCE', environment: { REMINDERS_READ_SOURCE: 'projection' }, Logger,
      ReadAuthoritativeAsync: async () => 'json',
      ReadProjectionAsync: async () => { throw new Error('induced projection error'); },
    });
    expect(Result.value).toBe('json');
    expect(Result.source).toBe('authoritative');
    expect(Result.fallbackError).toHaveProperty('message', 'induced projection error');
    expect(Logger.warn).toHaveBeenCalled();
  });

  test('the harness reports byte and semantic diffs separately', () => {
    const Authoritative = '{\n  "a": 1,\n  "b": 2\n}\n';
    const Projection = '{\n  "b": 2,\n  "a": 1\n}\n';
    expect(CompareBytes(Authoritative, Projection).equal).toBe(false);
    expect(CompareSemantics(JSON.parse(Authoritative), JSON.parse(Projection)).equal).toBe(true);
  });

  test('the harness runs against JSON fixture files and refuses to claim missing rebalance parity', () => {
    const Root = fs.mkdtempSync(path.join(os.tmpdir(), 'projection-parity-'));
    const Events = [BaselineEvent()];
    const Folded = FoldReminderReadModels(Events, { strict: true });
    fs.writeFileSync(path.join(Root, 'events.json'), JSON.stringify(Events, null, 2) + '\n');
    fs.writeFileSync(path.join(Root, 'reminders.json'), JSON.stringify(Folded.reminders, null, 2) + '\n');
    fs.writeFileSync(path.join(Root, 'completed.json'), JSON.stringify(Folded.completed, null, 2) + '\n');
    try {
      const Output = execFileSync(process.execPath, [HarnessPath,
        '--workspace', 'acme', '--events', path.join(Root, 'events.json'), '--reminders', path.join(Root, 'reminders.json'),
        '--completed', path.join(Root, 'completed.json')], { encoding: 'utf8' });
      const Report = JSON.parse(Output);
      expect(Report.byteDiffs.reminders.equal).toBe(true);
      expect(Report.semanticDiffs.completed.equal).toBe(true);
      expect(Report.missingSurfaces).toEqual(['rebalance']);
      expect(Report.clean).toBe(false);
    } finally {
      fs.rmSync(Root, { recursive: true, force: true });
    }
  });

  test('a captured API rebalance fixture reports the display/source mismatch instead of claiming parity', () => {
    const Folded = FoldReminderReadModels([BaselineEvent()], { strict: true });
    const CapturedApiRebalance = {
      ...BuildProjectedRebalanceExport(Folded.reminders, 'acme'),
      fetchedAt: '2026-08-01T13:00:00.000Z',
      source: { type: 'sleuth-reminders-file', relativePath: 'data/runtime/reminders/acme_reminders.json' },
      display: { timeZone: 'UTC', sectionOrder: [] },
      reminders: [{ ...BuildProjectedRebalanceExport(Folded.reminders, 'acme').reminders[0], display: { label: 'A.' } }],
    };
    const Report = BuildParityReport({ workspace: 'acme', events: [BaselineEvent()], reminders: Folded.reminders, completed: [], rebalance: CapturedApiRebalance });
    expect(Report.byteDiffs.rebalance.equal).toBe(false);
    expect(Report.semanticDiffs.rebalance.equal).toBe(false);
    expect(Report.clean).toBe(false);
  });
});
