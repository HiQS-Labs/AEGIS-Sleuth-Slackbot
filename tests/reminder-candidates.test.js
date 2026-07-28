'use strict';

const { AssembleCandidates } = require('../src/reminder-candidates');

/**
 * @param {Partial<{
 *   ReminderID: string,
 *   ReminderMessageText: string|null,
 *   AssigneeID: string|null,
 *   OriginalSenderID: string|null,
 *   clientId: string|null,
 *   OriginalChannelID: string|null,
 *   TargetChannelID: string|null,
 *   CreatedOn: Date|string|null,
 *   State: string|null,
 * }>} ArgOverrides
 */
function MakeActiveReminder(ArgOverrides = {}) {
  return {
    ReminderID: 'active-1',
    ReminderMessageText: 'Follow up with the client',
    AssigneeID: 'U_ASSIGNEE',
    OriginalSenderID: 'U_SENDER',
    clientId: 'client-a',
    OriginalChannelID: 'C_ORIGINAL',
    TargetChannelID: 'C_TARGET',
    CreatedOn: '2026-07-15T17:30:00.000Z',
    State: 'scheduled',
    ...ArgOverrides,
  };
}

/**
 * @param {Partial<{
 *   reminderId: string,
 *   summary: string|null,
 *   assigneeID: string|null,
 *   sourceChannelID: string|null,
 *   completedMs: number,
 *   clientId: string|null,
 * }>} ArgOverrides
 */
function MakeCompletedReminder(ArgOverrides = {}) {
  return {
    reminderId: 'done-1',
    summary: 'Ship the production fix',
    assigneeID: 'U_DONE',
    sourceChannelID: 'C_DONE',
    completedMs: Date.parse('2026-07-14T12:00:00.000Z'),
    clientId: 'client-b',
    ...ArgOverrides,
  };
}

describe('AssembleCandidates', () => {
  test('normalizes active reminders to the exact candidate shape', () => {
    const IsChannelPrivate = jest.fn(ArgChannelId => ArgChannelId === 'C_ORIGINAL');

    const Result = AssembleCandidates({
      activeReminders: [MakeActiveReminder()],
      completedReminders: [],
      isChannelPrivate: IsChannelPrivate,
    });

    expect(Result).toEqual([{
      id: 'active-1',
      text: 'Follow up with the client',
      assigneeId: 'U_ASSIGNEE',
      senderId: 'U_SENDER',
      clientId: 'client-a',
      channelId: 'C_ORIGINAL',
      channelIsPrivate: true,
      timestampMs: Date.parse('2026-07-15T17:30:00.000Z'),
      state: 'scheduled',
      isCompleted: false,
    }]);
    expect(IsChannelPrivate).toHaveBeenCalledWith('C_ORIGINAL');
  });

  test('normalizes completed reminders to the exact candidate shape', () => {
    const IsChannelPrivate = jest.fn(ArgChannelId => ArgChannelId === 'C_DONE');

    const Result = AssembleCandidates({
      activeReminders: [],
      completedReminders: [MakeCompletedReminder()],
      isChannelPrivate: IsChannelPrivate,
    });

    expect(Result).toEqual([{
      id: 'done-1',
      text: 'Ship the production fix',
      assigneeId: 'U_DONE',
      senderId: null,
      clientId: 'client-b',
      channelId: 'C_DONE',
      channelIsPrivate: true,
      timestampMs: Date.parse('2026-07-14T12:00:00.000Z'),
      state: 'completed',
      isCompleted: true,
    }]);
    expect(IsChannelPrivate).toHaveBeenCalledWith('C_DONE');
  });

  test('falls back to the target channel and defaults channel privacy to false when unknown', () => {
    const Result = AssembleCandidates({
      activeReminders: [
        MakeActiveReminder({
          ReminderID: 'fallback-channel',
          OriginalChannelID: null,
          TargetChannelID: 'C_TARGET_ONLY',
        }),
      ],
      completedReminders: [],
    });

    expect(Result).toEqual([{
      id: 'fallback-channel',
      text: 'Follow up with the client',
      assigneeId: 'U_ASSIGNEE',
      senderId: 'U_SENDER',
      clientId: 'client-a',
      channelId: 'C_TARGET_ONLY',
      channelIsPrivate: false,
      timestampMs: Date.parse('2026-07-15T17:30:00.000Z'),
      state: 'scheduled',
      isCompleted: false,
    }]);
  });

  test('de-dupes by id and prefers the completed record as the terminal fact', () => {
    const Result = AssembleCandidates({
      activeReminders: [
        MakeActiveReminder({
          ReminderID: 'shared-id',
          ReminderMessageText: 'Old active text',
          clientId: 'client-active',
          OriginalChannelID: 'C_ACTIVE',
        }),
      ],
      completedReminders: [
        MakeCompletedReminder({
          reminderId: 'shared-id',
          summary: 'Final completed text',
          clientId: 'client-completed',
          sourceChannelID: 'C_COMPLETED',
          completedMs: 1234567890,
        }),
      ],
      isChannelPrivate: ArgChannelId => ArgChannelId === 'C_COMPLETED',
    });

    expect(Result).toEqual([{
      id: 'shared-id',
      text: 'Final completed text',
      assigneeId: 'U_DONE',
      senderId: null,
      clientId: 'client-completed',
      channelId: 'C_COMPLETED',
      channelIsPrivate: true,
      timestampMs: 1234567890,
      state: 'completed',
      isCompleted: true,
    }]);
  });

  test('drops records with no usable id', () => {
    const Result = AssembleCandidates({
      activeReminders: [MakeActiveReminder({ ReminderID: '' })],
      completedReminders: [MakeCompletedReminder({ reminderId: '   ' })],
      isChannelPrivate: () => true,
    });

    expect(Result).toEqual([]);
  });
});
