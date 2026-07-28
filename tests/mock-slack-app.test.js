'use strict';

const { MockSlackApp } = require('./mocks/mock-slack-app');

describe('MockSlackApp', () => {
  test('SimulateAppMentionAsync stops after first handler returning true', async () => {
    const SlackApp = new MockSlackApp();
    const CallOrder = [];

    SlackApp.HandleAppMention(async () => {
      CallOrder.push('first');
      return false;
    });

    SlackApp.HandleAppMention(async () => {
      CallOrder.push('second');
      return true;
    });

    SlackApp.HandleAppMention(async () => {
      CallOrder.push('third');
      return true;
    });

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      text: `${SlackApp.AppMentionString} test flow`,
    });

    expect(WasHandled).toBe(true);
    expect(CallOrder).toEqual(['first', 'second']);
  });

  test('SimulateAppMentionAsync logs handler errors and continues', async () => {
    const SlackApp = new MockSlackApp();

    SlackApp.HandleAppMention(async () => {
      throw new Error('boom');
    });

    SlackApp.HandleAppMention(async () => true);

    const WasHandled = await SlackApp.SimulateAppMentionAsync({
      text: `${SlackApp.AppMentionString} recover`,
    });

    expect(WasHandled).toBe(true);
    expect(SlackApp.Logger.ErrorMessages.some((ArgMessage) => ArgMessage.includes('Error in app_mention handler:'))).toBe(true);
  });
});
