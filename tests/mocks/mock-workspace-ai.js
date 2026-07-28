'use strict';

/**
 * Shared WorkspaceAI mock helper for integration tests.
 *
 * Usage in test files:
 *   jest.mock('../src/workspace-ai');
 *   const MockWorkspaceAI = require('../src/workspace-ai');
 *   const { ConfigureMockWorkspaceAI } = require('./mocks/mock-workspace-ai');
 *
 *   // then in a beforeEach or individual test:
 *   const MockProcess = ConfigureMockWorkspaceAI(MockWorkspaceAI, { recommendation: 'ignore' });
 *
 * @param {jest.Mock} ArgMockWorkspaceAI The jest-mocked WorkspaceAI constructor (from require after jest.mock).
 * @param {Object} [ArgOptions] Configuration for mock responses.
 * @param {'schedule'|'ignore'} [ArgOptions.recommendation] Recommendation from reminder analysis.
 * @param {string} [ArgOptions.reminderMessage] Reminder message text returned by analysis.
 * @param {string} [ArgOptions.manualReminderMessage] Reminder task text returned by manual force-schedule extraction.
 * @param {string} [ArgOptions.schedulingTrigger] Scheduling trigger returned by analysis.
 * @param {{ year: number, month: number, day: number, hour: number, minute: number, second: number }} [ArgOptions.extractedDate] Date extraction result.
 * @returns {jest.Mock} The mock ProcessMessageWithJsonResponseAsync function for assertions.
 */
function ConfigureMockWorkspaceAI(ArgMockWorkspaceAI, ArgOptions = {}) {
  const Recommendation = ArgOptions.recommendation || 'schedule';
  const ReminderMessage = ArgOptions.reminderMessage || 'Test reminder task';
  const ManualReminderMessage = ArgOptions.manualReminderMessage || ReminderMessage;
  const SchedulingTrigger = ArgOptions.schedulingTrigger || 'tomorrow';
  const ExtractedDate = ArgOptions.extractedDate || { year: 2026, month: 4, day: 1, hour: 9, minute: 0, second: 0 };

  const MockProcessMessage = jest.fn().mockImplementation(
    async (ArgMessageText, ArgInstructions, ArgSchema, ArgModelName) => {
      // date extraction calls include "BASE DATE:" in the message text.
      if(ArgMessageText.includes('BASE DATE:')) {
        return { ...ExtractedDate, rationale: 'mock date extraction' };
      }
      if(ArgSchema?.name === 'manual_reminder_task_response') {
        return {
          rationale: 'mock manual reminder task extraction',
          reminder_message: ManualReminderMessage,
        };
      }
      // otherwise treat as reminder analysis.
      return {
        recommendation: Recommendation,
        rationale: 'mock analysis',
        reminders: Recommendation === 'schedule'
          ? [{ actionable_language: ReminderMessage, scheduling_trigger: SchedulingTrigger, reminder_message: ReminderMessage }]
          : [],
      };
    }
  );

  ArgMockWorkspaceAI.mockImplementation(() => ({
    ProcessMessageWithJsonResponseAsync: MockProcessMessage,
    ProcessMessageWithTextResponseAsync: jest.fn().mockResolvedValue('mock text response'),
    get ComplexModelName() { return 'gpt-4o'; },
    get DefaultModelName() { return 'gpt-4o-mini'; },
    set DefaultModelName(_) {},
  }));

  return MockProcessMessage;
}

module.exports = { ConfigureMockWorkspaceAI };
