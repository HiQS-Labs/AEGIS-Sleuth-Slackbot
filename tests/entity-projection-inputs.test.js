'use strict';

const { FoldEntityProjectionInputs } = require('../src/entity-projection-inputs');

/**
 * @param {object} ArgOverrides
 * @returns {object}
 */
function MakeNativeCreated(ArgOverrides = {}) {
  return {
    id: 'evt_created',
    ts: '2026-08-01T09:00:00.000Z',
    workspace: 'acme',
    type: 'ReminderCreated',
    reminderId: 'rem_native',
    payload: {
      text: 'Review <@U_ALICE|Alice>\'s PR!!!',
      assigneeId: 'U_ALICE',
      assigneeIds: ['U_ALICE', 'U_BOB', 'U_ALICE'],
      sourceChannelId: 'C_ENGINEERING',
      targetChannelId: 'C_REMINDERS',
      source: 'fsm',
      githubUrls: ['https://github.com/acme/widgets/pull/7'],
    },
    ...ArgOverrides,
  };
}

describe('FoldEntityProjectionInputs', () => {
  test('folds a native event stream into normalized task inputs and completion data', () => {
    const Records = FoldEntityProjectionInputs([
      MakeNativeCreated(),
      {
        id: 'evt_completed',
        ts: '2026-08-02T10:00:00.000Z',
        workspace: 'acme',
        type: 'ReminderCompleted',
        reminderId: 'rem_native',
        payload: { completedAt: '2026-08-02T10:00:00.000Z' },
      },
    ]);

    expect(Records).toEqual([{
      workspace: 'acme',
      reminderId: 'rem_native',
      normalizedText: 'review s pr',
      assigneeIds: ['U_ALICE', 'U_BOB'],
      originalSenderId: null,
      sourceChannelId: 'C_ENGINEERING',
      targetChannelId: 'C_REMINDERS',
      createdAt: '2026-08-01T09:00:00.000Z',
      completedAt: '2026-08-02T10:00:00.000Z',
      githubUrls: ['https://github.com/acme/widgets/pull/7'],
      githubRepositoryIds: [],
      sourceEventId: 'evt_created',
      sourceEventType: 'ReminderCreated',
    }]);
  });

  test('folds a baseline-imported stream and retains the legacy sender', () => {
    const Records = FoldEntityProjectionInputs([{
      id: 'evt_baseline',
      ts: '2026-07-15T08:00:00.000Z',
      workspace: 'acme',
      type: 'BaselineReminderImported',
      reminderId: 'rem_baseline',
      payload: {
        text: 'Fix <@U_LEGACY>—API...',
        assigneeId: 'U_ASSIGNEE',
        sourceChannelId: 'C_LEGACY',
        targetChannelId: 'C_REMINDERS',
        dueAt: '2026-07-20T08:00:00.000Z',
        state: 'scheduled',
        githubUrls: ['https://github.com/acme/legacy/issues/3'],
        originalSenderId: 'U_SENDER',
        repositoryId: 'acme/legacy',
      },
    }]);

    expect(Records).toEqual([expect.objectContaining({
      reminderId: 'rem_baseline',
      normalizedText: 'fix api',
      assigneeIds: ['U_ASSIGNEE'],
      originalSenderId: 'U_SENDER',
      createdAt: '2026-07-15T08:00:00.000Z',
      githubUrls: ['https://github.com/acme/legacy/issues/3'],
      githubRepositoryIds: ['acme/legacy'],
      sourceEventId: 'evt_baseline',
      sourceEventType: 'BaselineReminderImported',
    })]);
  });

  test('keeps mixed native and baseline records isolated when reminder IDs overlap across workspaces', () => {
    const Native = MakeNativeCreated({ reminderId: 'rem_shared' });
    const Baseline = {
      id: 'evt_baseline_other',
      ts: '2026-08-01T09:01:00.000Z',
      workspace: 'other',
      type: 'BaselineReminderImported',
      reminderId: 'rem_shared',
      payload: {
        text: 'Migrate database', assigneeId: 'U_OTHER', sourceChannelId: 'C_OTHER',
        targetChannelId: 'C_OTHER_REMINDERS', dueAt: null, state: 'scheduled',
      },
    };

    const Records = FoldEntityProjectionInputs([Native, Baseline]);
    expect(Records.map(ArgRecord => [ArgRecord.workspace, ArgRecord.sourceEventType, ArgRecord.reminderId])).toEqual([
      ['acme', 'ReminderCreated', 'rem_shared'],
      ['other', 'BaselineReminderImported', 'rem_shared'],
    ]);
  });

  test('returns an empty array for an empty event stream', () => {
    expect(FoldEntityProjectionInputs([])).toEqual([]);
  });

  test('defaults missing optional event fields without throwing', () => {
    const Records = FoldEntityProjectionInputs([{
      type: 'ReminderCreated',
      reminderId: 'rem_minimal',
      payload: { text: '  Plain, TASK.  ' },
    }]);

    expect(Records).toEqual([{
      workspace: null,
      reminderId: 'rem_minimal',
      normalizedText: 'plain task',
      assigneeIds: [],
      originalSenderId: null,
      sourceChannelId: null,
      targetChannelId: null,
      createdAt: null,
      completedAt: null,
      githubUrls: [],
      githubRepositoryIds: [],
      sourceEventId: null,
      sourceEventType: 'ReminderCreated',
    }]);
  });

  test('is deterministic and does not mutate the supplied event array', () => {
    const Events = [MakeNativeCreated(), {
      id: 'evt_completed',
      ts: '2026-08-02T10:00:00.000Z',
      workspace: 'acme',
      type: 'ReminderCompleted',
      reminderId: 'rem_native',
      payload: { completedAt: '2026-08-02T10:00:00.000Z' },
    }];
    const Before = JSON.stringify(Events);

    const First = JSON.stringify(FoldEntityProjectionInputs(Events));
    const Second = JSON.stringify(FoldEntityProjectionInputs(Events));

    expect(First).toBe(Second);
    expect(JSON.stringify(Events)).toBe(Before);
  });
});
