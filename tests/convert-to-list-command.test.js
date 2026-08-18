'use strict';

const HandleConvertToListCommandAsync = require('../src/chat-commands/convert-to-list-command');
const { MockSlackApp } = require('./mocks/mock-slack-app');

describe('GH-96: convert text into slack list error handling (Site 1)', () => {
  test('transient error produces the transient sentence and baseline', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: { WORKSPACE_NAME: 'Test', LIVE_TOKEN: 'xoxb-test' } });
    const EventInfo = { channel: 'C123', thread_ts: '111.222' };
    const ArgDeps = {
      ExtractItemsFromTextAsync: jest.fn().mockRejectedValue(new Error('transient boom')),
      MaterializeListAsync: jest.fn(),
    };

    await HandleConvertToListCommandAsync(SlackApp, EventInfo, 'some text', ArgDeps);

    const Messages = SlackApp.SentMessages;
    expect(Messages).toHaveLength(1);
    expect(Messages[0].threadTs).toBe('111.222');
    
    const Text = Messages[0].text;
    expect(Text).toContain('I could not read that text into a list — please try again later.');
    expect(Text).toContain('*Diagnostics:*');
  });

  test('permanent provider misconfiguration produces the admin sentence and baseline', async () => {
    const SlackApp = new MockSlackApp({ WorkspaceInfo: { WORKSPACE_NAME: 'Test', LIVE_TOKEN: 'xoxb-test' } });
    const EventInfo = { channel: 'C123', thread_ts: '111.222' };
    const ConfigError = new Error('not configured');
    ConfigError.code = 'provider_not_configured';
    
    const ArgDeps = {
      ExtractItemsFromTextAsync: jest.fn().mockRejectedValue(ConfigError),
      MaterializeListAsync: jest.fn(),
    };

    await HandleConvertToListCommandAsync(SlackApp, EventInfo, 'some text', ArgDeps);

    const Messages = SlackApp.SentMessages;
    expect(Messages).toHaveLength(1);
    expect(Messages[0].threadTs).toBe('111.222');
    
    const Text = Messages[0].text;
    expect(Text).toContain("Converting text into a list needs an AI model that isn't configured");
    expect(Text).toContain('*Diagnostics:*');
  });
});
