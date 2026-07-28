'use strict';

// Regression tests for the GH-428 mention-resolution seed of the "unified outbound message
// pipeline" — the single chokepoint intended for anywhere raw Slack message text is rendered
// outside Slack's own client (GitHub issue bodies, thread-memory transcripts, etc).

const { ResolveMentionsForExternalDisplayAsync } = require('../src/slack-message-pipeline');

/**
 * Build a minimal duck-typed SlackApp stand-in backed by a fixed id->name map.
 * @param {Record<string, string|null>} ArgNamesById Map of user id to display name (or null to
 *   simulate a failed/unknown lookup).
 * @returns {{ GetUserDisplayNameAsync: (ArgUserId: string) => Promise<string|null> }}
 */
function BuildSlackAppStub(ArgNamesById) {
  return {
    GetUserDisplayNameAsync: jest.fn(async (ArgUserId) => ArgNamesById[ArgUserId] ?? null),
  };
}

describe('ResolveMentionsForExternalDisplayAsync', () => {
  test('resolves a single mention to its display name', async () => {
    const SlackApp = BuildSlackAppStub({ U08BHQEAX: 'Matt' });
    const Resolved = await ResolveMentionsForExternalDisplayAsync(SlackApp, 'thanks to you <@U08BHQEAX> for the cut over!');
    expect(Resolved).toBe('thanks to you @Matt for the cut over!');
  });

  test('resolves multiple distinct mentions, matching GH-428\'s reported message', async () => {
    const SlackApp = BuildSlackAppStub({
      U08BHQEAX: 'Matt',
      U000EXAMPLE1: 'Robin',
      U000EXAMPLE3: 'Priya',
      U000EXAMPLE2: 'Sam',
    });
    const RawText = '1 Slack reminder has been scheduled for <@U08BHQEAX>, <@U000EXAMPLE1>, <@U000EXAMPLE3>, <@U000EXAMPLE2>.';

    const Resolved = await ResolveMentionsForExternalDisplayAsync(SlackApp, RawText);

    expect(Resolved).toBe('1 Slack reminder has been scheduled for @Matt, @Robin, @Priya, @Sam.');
  });

  test('resolves each distinct user id only once even when mentioned repeatedly', async () => {
    const SlackApp = BuildSlackAppStub({ U08BHQEAX: 'Matt' });
    const Resolved = await ResolveMentionsForExternalDisplayAsync(SlackApp, '<@U08BHQEAX> and <@U08BHQEAX> again');

    expect(Resolved).toBe('@Matt and @Matt again');
    expect(SlackApp.GetUserDisplayNameAsync).toHaveBeenCalledTimes(1);
  });

  test('falls back to the raw id when the lookup returns no name', async () => {
    const SlackApp = BuildSlackAppStub({ U_UNKNOWN: null });
    const Resolved = await ResolveMentionsForExternalDisplayAsync(SlackApp, 'ping <@U_UNKNOWN> please');

    expect(Resolved).toBe('ping @U_UNKNOWN please');
  });

  test('falls back to the raw id when the lookup throws', async () => {
    const SlackApp = { GetUserDisplayNameAsync: jest.fn().mockRejectedValue(new Error('boom')) };
    const Resolved = await ResolveMentionsForExternalDisplayAsync(SlackApp, '<@U_ERROR>');

    expect(Resolved).toBe('@U_ERROR');
  });

  test('falls back to the raw id for every mention when no SlackApp is available', async () => {
    const Resolved = await ResolveMentionsForExternalDisplayAsync(null, '<@U_A> and <@U_B>');
    expect(Resolved).toBe('@U_A and @U_B');
  });

  test('handles the piped-label mention form `<@U123|label>`', async () => {
    const SlackApp = BuildSlackAppStub({ U08BHQEAX: 'Matt' });
    const Resolved = await ResolveMentionsForExternalDisplayAsync(SlackApp, '<@U08BHQEAX|matt.saw>');
    expect(Resolved).toBe('@Matt');
  });

  test('passes through text with no mentions unchanged', async () => {
    const SlackApp = BuildSlackAppStub({});
    const Resolved = await ResolveMentionsForExternalDisplayAsync(SlackApp, 'no mentions here');
    expect(Resolved).toBe('no mentions here');
    expect(SlackApp.GetUserDisplayNameAsync).not.toHaveBeenCalled();
  });

  test('passes through falsy/non-string input unchanged', async () => {
    const SlackApp = BuildSlackAppStub({});
    expect(await ResolveMentionsForExternalDisplayAsync(SlackApp, '')).toBe('');
    expect(await ResolveMentionsForExternalDisplayAsync(SlackApp, null)).toBeNull();
    expect(await ResolveMentionsForExternalDisplayAsync(SlackApp, undefined)).toBeUndefined();
  });

  test('a caller-supplied cache is shared across calls, resolving each id at most once (GH-429)', async () => {
    const SlackApp = BuildSlackAppStub({ U08BHQEAX: 'Matt' });
    const SharedCache = new Map();

    const First = await ResolveMentionsForExternalDisplayAsync(SlackApp, 'hi <@U08BHQEAX>', SharedCache);
    const Second = await ResolveMentionsForExternalDisplayAsync(SlackApp, 'bye <@U08BHQEAX>', SharedCache);

    expect(First).toBe('hi @Matt');
    expect(Second).toBe('bye @Matt');
    expect(SlackApp.GetUserDisplayNameAsync).toHaveBeenCalledTimes(1);
  });

  test('without a shared cache, each call resolves independently (default fresh Map per call)', async () => {
    const SlackApp = BuildSlackAppStub({ U08BHQEAX: 'Matt' });

    await ResolveMentionsForExternalDisplayAsync(SlackApp, 'hi <@U08BHQEAX>');
    await ResolveMentionsForExternalDisplayAsync(SlackApp, 'bye <@U08BHQEAX>');

    expect(SlackApp.GetUserDisplayNameAsync).toHaveBeenCalledTimes(2);
  });

  test('accepts a pre-populated cache and skips the lookup entirely for a cached id', async () => {
    const SlackApp = BuildSlackAppStub({});
    const SharedCache = new Map([['U_PRESEEDED', 'Priya']]);

    const Result = await ResolveMentionsForExternalDisplayAsync(SlackApp, '<@U_PRESEEDED>', SharedCache);

    expect(Result).toBe('@Priya');
    expect(SlackApp.GetUserDisplayNameAsync).not.toHaveBeenCalled();
  });
});
