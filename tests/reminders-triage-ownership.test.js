'use strict';

jest.mock('../src/workspace-ai');

const fs = require('fs').promises;
const path = require('path');
const MockWorkspaceAI = require('../src/workspace-ai');
const RemindersModule = require('../src/reminders-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');

// GH-43, Codex branch relay r9. The `:wrench:` triage resolved ownership by concatenating EVERY
// trigger's actionable span into one resolver call, while scheduling resolves each trigger group
// independently. A message with two triggers and two owners therefore scheduled correctly as two
// reminders and was then explained as one — confidently, and wrongly.
//
// Earlier rounds tested the helper in isolation, which by construction could not observe the global
// resolver call. This asserts on the RENDERED triage output.

const RuntimeDir = path.join(__dirname, '..', 'data', 'runtime', 'reminders');
const Workspace = {
  ADMIN_EMAIL: 'admin@example.com', LIVE_TOKEN: 'xoxb-test', LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test', OPENAI_API_KEY: 'sk-test', REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles', WORKSPACE_NAME: 'TriageOwnership',
};

const OriginalText = '<@U_ALPHA> I will deploy the patch tomorrow, and please review the notes friday';

/**
 * Two candidates, two triggers, two different owners — the witness.
 * @returns {any}
 */
function TwoTriggerAnalysis() {
  return {
    recommendation: 'schedule',
    rationale: 'two tasks under two triggers',
    reminders: [
      {
        actionable_language: 'I will deploy the patch', scheduling_trigger: 'tomorrow',
        reminder_message: 'Deploy the patch', context: '', owner: 'speaker', owner_mentions: [],
      },
      {
        actionable_language: 'please review the notes', scheduling_trigger: 'friday',
        reminder_message: 'Review the notes', context: '', owner: 'mentioned',
        owner_mentions: ['U_ALPHA'],
      },
    ],
  };
}

describe('GH-43: :wrench: triage resolves ownership PER TRIGGER, as scheduling does', () => {
  beforeAll(async () => { await fs.mkdir(RuntimeDir, { recursive: true }); });
  afterEach(() => { MockWorkspaceAI.mockReset(); });

  test('two triggers with two owners produce TWO labelled resolutions, not one wrong one', async () => {
    MockWorkspaceAI.mockImplementation(() => ({
      ProcessMessageWithJsonResponseAsync: jest.fn().mockImplementation(async (ArgText) => (
        ArgText.includes('BASE DATE:')
          ? { year: 2030, month: 1, day: 1, hour: 9, minute: 0, second: 0, rationale: 'mock' }
          : TwoTriggerAnalysis()
      )),
      ProcessMessageWithTextResponseAsync: jest.fn().mockResolvedValue('mock'),
      get ComplexModelName() { return 'gpt-4o'; },
      get DefaultModelName() { return 'gpt-4o-mini'; },
      set DefaultModelName(_) {},
    }));

    const SlackApp = new MockSlackApp({
      WorkspaceInfo: Workspace,
      ThreadMessagesById: {
        'C_TRIAGE:1.0001': [{ ts: '1.0001', user: 'U_SENDER', text: OriginalText }],
      },
    });
    const Reminders = new RemindersModule(SlackApp);

    try {
      await Reminders.StartAsync();
      await SlackApp.SimulateReactionAddedAsync({
        user: 'U_REACTOR', reaction: 'wrench', item: { channel: 'C_TRIAGE', ts: '1.0001' },
      });

      const Triage = SlackApp.SentMessages.find(ArgMessage => ArgMessage.text.includes(':wrench:'));
      expect(Triage).toBeDefined();

      // one ownership section PER TRIGGER, each labelled. The trigger is run through
      // SanitizeForInlineSlack, which escapes the quotes, so match on the escaped form.
      expect(Triage.text).toMatch(/How ownership resolved — .?"tomorrow.?"/);
      expect(Triage.text).toMatch(/How ownership resolved — .?"friday.?"/);
      expect(Triage.text.match(/How ownership resolved/g)).toHaveLength(2);

      // and they reach DIFFERENT owners — the whole point. Before this fix the single global call
      // reported only U_ALPHA / second-person-ask for both.
      const [TomorrowBlock, FridayBlock] = Triage.text.split(/How ownership resolved — .?"friday.?"/);
      expect(TomorrowBlock).toContain('first-person-commitment');
      expect(TomorrowBlock).toContain('<@U_SENDER>');
      expect(FridayBlock).toContain('second-person-ask');
      expect(FridayBlock).toContain('<@U_ALPHA>');

      // no false limitation warning: the triggers are separate, so production CAN represent both
      expect(Triage.text).not.toContain('known limitation');
    } finally {
      await Reminders.StopAsync();
    }
  });

  test('a single-trigger message keeps the unlabelled heading it always had', async () => {
    MockWorkspaceAI.mockImplementation(() => ({
      ProcessMessageWithJsonResponseAsync: jest.fn().mockImplementation(async (ArgText) => (
        ArgText.includes('BASE DATE:')
          ? { year: 2030, month: 1, day: 1, hour: 9, minute: 0, second: 0, rationale: 'mock' }
          : {
            recommendation: 'schedule', rationale: 'one task',
            reminders: [{
              actionable_language: 'I will deploy the patch', scheduling_trigger: 'tomorrow',
              reminder_message: 'Deploy the patch', context: '', owner: 'speaker', owner_mentions: [],
            }],
          }
      )),
      ProcessMessageWithTextResponseAsync: jest.fn().mockResolvedValue('mock'),
      get ComplexModelName() { return 'gpt-4o'; },
      get DefaultModelName() { return 'gpt-4o-mini'; },
      set DefaultModelName(_) {},
    }));

    const SlackApp = new MockSlackApp({
      WorkspaceInfo: { ...Workspace, WORKSPACE_NAME: 'TriageOwnershipSingle' },
      ThreadMessagesById: {
        'C_TRIAGE:2.0001': [{ ts: '2.0001', user: 'U_SENDER', text: 'I will deploy the patch tomorrow' }],
      },
    });
    const Reminders = new RemindersModule(SlackApp);

    try {
      await Reminders.StartAsync();
      await SlackApp.SimulateReactionAddedAsync({
        user: 'U_REACTOR', reaction: 'wrench', item: { channel: 'C_TRIAGE', ts: '2.0001' },
      });
      const Triage = SlackApp.SentMessages.find(ArgMessage => ArgMessage.text.includes(':wrench:'));
      expect(Triage.text).toContain('How ownership resolved');
      expect(Triage.text).not.toMatch(/How ownership resolved — /);
    } finally {
      await Reminders.StopAsync();
    }
  });
});
