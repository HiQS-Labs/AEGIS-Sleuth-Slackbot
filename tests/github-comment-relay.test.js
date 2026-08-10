'use strict';

const GitHubCommentRelay = require('../src/github-comment-relay');
const { MockSlackApp } = require('./mocks/mock-slack-app');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock SlackApp with a GITHUB_PAT configured. */
function CreateMockSlackApp() {
  const App = new MockSlackApp({
    WorkspaceInfo: {
      WORKSPACE_NAME: 'TestWorkspace',
      ADMIN_EMAIL: 'admin@example.com',
      LIVE_TOKEN: 'xoxb-test',
      LIVE_SIGNING_SECRET: 'secret',
      LIVE_APP_TOKEN: 'xapp-test',
      OPENAI_API_KEY: 'sk-test',
      REMINDER_CHANNEL_NAME: 'test-reminders',
      MAIN_TIMEZONE: 'America/Los_Angeles',
      GITHUB_PAT: 'ghp_test_token_123',
    },
  });
  App.SetUserDisplayNames({ U_ALICE: 'Alice Smith' });
  return App;
}

/**
 * WorkspaceAI getter whose relevance gate always answers "relay" with full confidence.
 * GH-37 added the gate ahead of every relay, so tests that assert relaying behavior need one; this
 * keeps them focused on the relay mechanics rather than on the gate.
 * @returns {any}
 */
function AlwaysRelayAI() {
  return {
    ProcessMessageWithJsonResponseAsync: jest.fn().mockResolvedValue({
      decision: 'relay',
      confidence: 1,
      rationale: 'test stub always relays',
    }),
  };
}

/**
 * WorkspaceAI getter whose relevance gate answers with the supplied decision.
 * @param {{decision: string, confidence: number, rationale?: string}|Error} ArgDecision Decision to
 * answer with, or an Error the model call should reject with.
 * @returns {() => any}
 */
function GateAI(ArgDecision) {
  return () => ({
    ProcessMessageWithJsonResponseAsync: jest.fn(() =>
      ArgDecision instanceof Error ? Promise.reject(ArgDecision) : Promise.resolve({
        rationale: 'test stub',
        ...ArgDecision,
      })
    ),
  });
}

/**
 * Build a reminder with GitHub URLs whose original message matches the given ts and channel.
 * @param {string} ArgMessageTS ts of the specific message that triggered the reminder.
 * @param {string} ArgChannelID channel the message was posted in.
 * @param {string[]} ArgGitHubUrls GitHub issue/PR URLs to monitor.
 * @param {string|null} [ArgThreadTs] root thread ts when the original message was itself a thread reply; null for top-level messages.
 */
function CreateMonitoredReminder(ArgMessageTS, ArgChannelID, ArgGitHubUrls, ArgThreadTs = null) {
  return {
    ReminderID: 'rem-001',
    CreatedOn: new Date(),
    ShouldPostOn: new Date(),
    TargetChannelID: 'C_REMINDERS',
    OriginalChannelID: ArgChannelID,
    OriginalMessageID: ArgMessageTS,
    OriginalThreadTs: ArgThreadTs,
    OriginalSenderID: 'U_SENDER',
    ReminderMessageText: 'Fix the bug',
    IgnoreSnooze: false,
    GitHubUrls: ArgGitHubUrls,
    State: 'scheduled',
  };
}

// ---------------------------------------------------------------------------
// OnMessageAsync
// ---------------------------------------------------------------------------

describe('GitHubCommentRelay.OnMessageAsync', () => {
  /** @type {MockSlackApp} */
  let SlackApp;

  /** @type {jest.SpyInstance} */
  let FetchSpy;

  beforeEach(() => {
    SlackApp = CreateMockSlackApp();
    FetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {any} */ ({ status: 201, ok: true })
    );
  });

  afterEach(() => {
    FetchSpy.mockRestore();
  });

  test('relays a thread reply to a monitored GitHub issue', async () => {
    const ParentTS = '1700000000.000001';
    const Reminders = [CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/42'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'The JavaScript file is corrupted',
      ts: '1700000000.000010',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    // verify GitHub API was called with correct URL and body.
    expect(FetchSpy).toHaveBeenCalledTimes(1);
    const [ApiUrl, Options] = FetchSpy.mock.calls[0];
    expect(ApiUrl).toBe('https://api.github.com/repos/owner/repo/issues/42/comments');
    expect(Options.method).toBe('POST');
    expect(Options.headers.Authorization).toBe('Bearer ghp_test_token_123');

    const Body = JSON.parse(Options.body);
    expect(Body.body).toContain('**Alice Smith**');
    expect(Body.body).toContain('The JavaScript file is corrupted');
    expect(Body.body).toContain('Relayed from Slack by Sleuth');

    // verify reaction was added.
    expect(SlackApp.AddedReactions).toHaveLength(1);
    expect(SlackApp.AddedReactions[0].reaction).toBe('octocat');
    expect(SlackApp.AddedReactions[0].ts).toBe('1700000000.000010');
  });

  test('resolves @mentions within the relayed message body to display names (GH-432)', async () => {
    // Same bug class as GH-428/429: Slack's own client resolves `<@U...>` mentions, but a GitHub
    // comment does not — the relayed message body must be pre-resolved before it leaves Slack.
    SlackApp.SetUserDisplayNames({ U_ALICE: 'Alice Smith', U_BOB: 'Bob Jones' });
    const ParentTS = '1700000000.000004';
    const Reminders = [CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/7'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'can <@U_BOB> take a look at this?',
      ts: '1700000000.000053',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    const Body = JSON.parse(FetchSpy.mock.calls[0][1].body);
    expect(Body.body).toContain('can @Bob Jones take a look at this?');
    expect(Body.body).not.toContain('<@U_BOB>');
  });

  test('ignores non-thread messages', async () => {
    const Reminders = [CreateMonitoredReminder('1700000000.000001', 'C_DEV', ['https://github.com/owner/repo/issues/1'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'A top-level message',
      user: 'U_ALICE',
    });

    expect(FetchSpy).not.toHaveBeenCalled();
    expect(SlackApp.AddedReactions).toHaveLength(0);
  });

  test('ignores thread replies with no matching reminder', async () => {
    const Reminders = [CreateMonitoredReminder('1700000000.999999', 'C_DEV', ['https://github.com/owner/repo/issues/1'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Reply to unrelated thread',
      thread_ts: '1700000000.000001', // different from reminder's OriginalMessageID
      user: 'U_ALICE',
    });

    expect(FetchSpy).not.toHaveBeenCalled();
  });

  test('ignores thread replies in wrong channel', async () => {
    const ParentTS = '1700000000.000001';
    const Reminders = [CreateMonitoredReminder(ParentTS, 'C_OTHER', ['https://github.com/owner/repo/issues/1'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV', // different from reminder's OriginalChannelID
      text: 'Reply in wrong channel',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).not.toHaveBeenCalled();
  });

  test('skips relay when bot is the sender', async () => {
    const ParentTS = '1700000000.000001';
    const Reminders = [CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/1'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Bot reply',
      thread_ts: ParentTS,
      user: 'UBOT123', // matches MockSlackApp BotUserID
    });

    expect(FetchSpy).not.toHaveBeenCalled();
  });

  test('skips relay when no GITHUB_PAT configured', async () => {
    const NoPATApp = new MockSlackApp(); // no GITHUB_PAT in default config
    const ParentTS = '1700000000.000001';
    const Reminders = [CreateMonitoredReminder(ParentTS, 'C_TEST', ['https://github.com/owner/repo/issues/1'])];
    const Relay = new GitHubCommentRelay(NoPATApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    NoPATApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await NoPATApp.SimulateMessageAsync({
      channel: 'C_TEST',
      text: 'No PAT relay attempt',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).not.toHaveBeenCalled();
  });

  test('deduplicates GitHub URLs across multiple matching reminders', async () => {
    const ParentTS = '1600000000.000001';
    const Reminders = [
      CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/1', 'https://github.com/owner/repo/pull/2']),
      CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/1']), // duplicate URL
    ];
    Reminders[1].ReminderID = 'rem-002';
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Cross-post',
      ts: '1700000000.000050',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    // should post to 2 unique URLs, not 3.
    expect(FetchSpy).toHaveBeenCalledTimes(2);
    const PostedUrls = FetchSpy.mock.calls.map(call => call[0]);
    expect(PostedUrls).toContain('https://api.github.com/repos/owner/repo/issues/1/comments');
    expect(PostedUrls).toContain('https://api.github.com/repos/owner/repo/issues/2/comments');
  });

  test('posts to pull request using issues comment endpoint', async () => {
    const ParentTS = '1600000000.000002';
    const Reminders = [CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/pull/99'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'PR comment',
      ts: '1700000000.000051',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    // both issues and PRs use the issues comment endpoint.
    expect(FetchSpy).toHaveBeenCalledTimes(1);
    expect(FetchSpy.mock.calls[0][0]).toBe('https://api.github.com/repos/owner/repo/issues/99/comments');
  });

  test('falls back to a plain @id mention (not raw <@id> mrkdwn) when display name lookup fails (GH-432)', async () => {
    // The comment leaves Slack's rendering context, so a raw `<@id>` mrkdwn token would show up
    // verbatim to a GitHub reader instead of Slack resolving it client-side — same bug class as
    // GH-428/429, fixed here for the author-name fallback specifically.
    const ParentTS = '1600000000.000003';
    const Reminders = [CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/1'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Message from unknown user',
      ts: '1700000000.000052',
      thread_ts: ParentTS,
      user: 'U_UNKNOWN', // not in SetUserDisplayNames
    });

    const Body = JSON.parse(FetchSpy.mock.calls[0][1].body);
    expect(Body.body).toContain('@U_UNKNOWN');
    expect(Body.body).not.toContain('<@U_UNKNOWN>');
  });

  test('does not add reaction when GitHub API fails', async () => {
    FetchSpy.mockResolvedValue(/** @type {any} */ ({ status: 403, ok: false }));

    const ParentTS = '1600000000.000004';
    const Reminders = [CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/1'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Will fail',
      ts: '1700000000.000053',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).toHaveBeenCalledTimes(1);
    expect(SlackApp.AddedReactions).toHaveLength(0);
  });

  test('handles network errors gracefully', async () => {
    FetchSpy.mockRejectedValue(new Error('network timeout'));

    const ParentTS = '1700000000.000001';
    const Reminders = [CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/1'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Network error test',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(SlackApp.AddedReactions).toHaveLength(0);
    // should not throw — handler returns false gracefully.
  });

  test('always returns false to allow downstream handlers', async () => {
    const ParentTS = '1700000000.000001';
    const Reminders = [CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/1'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);

    const Result = await Relay.OnMessageAsync(SlackApp, {
      channel: 'C_DEV',
      text: 'Test',
      ts: '1700000000.000010',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(Result).toBe(false);
  });

  // regression: relay must match when the monitored message was itself a thread reply.
  // In Slack, thread_ts always points to the thread root — so OriginalMessageID (ts of the
  // specific reply that triggered the reminder) will never equal thread_ts of a subsequent reply.
  // OriginalThreadTs stores the root and is used for matching instead.
  test('relays thread reply when original reminder message was itself a thread reply', async () => {
    const ThreadRootTS = '1700000000.000000'; // ts of the thread root (parent of parent)
    const OriginalMsgTS = '1700000000.000001'; // ts of the specific reply that triggered the reminder
    // OriginalThreadTs is set to the thread root; OriginalMessageID is the specific reply.
    const Reminders = [CreateMonitoredReminder(OriginalMsgTS, 'C_DEV', ['https://github.com/owner/repo/issues/42'], ThreadRootTS)];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    // a subsequent reply to the same thread will carry thread_ts = ThreadRootTS, NOT OriginalMsgTS.
    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Follow-up in thread',
      ts: '1700000000.000010',
      thread_ts: ThreadRootTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).toHaveBeenCalledTimes(1);
    const Body = JSON.parse(FetchSpy.mock.calls[0][1].body);
    expect(Body.body).toContain('Follow-up in thread');
    expect(SlackApp.AddedReactions).toHaveLength(1);
    expect(SlackApp.AddedReactions[0].reaction).toBe('octocat');
  });

  // backward compat: reminders created before OriginalThreadTs was added must still relay
  // correctly for top-level messages (OriginalThreadTs is null, falls back to OriginalMessageID).
  test('relays correctly for legacy reminders without OriginalThreadTs field', async () => {
    const ParentTS = '1700000000.000001';
    // legacy reminder: no OriginalThreadTs property at all.
    const LegacyReminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/1']);
    delete LegacyReminder.OriginalThreadTs;
    const Relay = new GitHubCommentRelay(SlackApp, () => [LegacyReminder], jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Legacy reminder relay',
      ts: '1700000000.000011',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).toHaveBeenCalledTimes(1);
    expect(SlackApp.AddedReactions).toHaveLength(1);
  });

  test('handles multiline Slack messages in comment body', async () => {
    const ParentTS = '1600000000.000005';
    const Reminders = [CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/1'])];
    const Relay = new GitHubCommentRelay(SlackApp, () => Reminders, jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Line one\nLine two\nLine three',
      ts: '1700000000.000054',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    const Body = JSON.parse(FetchSpy.mock.calls[0][1].body);
    // each line should be in a blockquote.
    expect(Body.body).toContain('> Line one\n> Line two\n> Line three');
  });

  // ---------------------------------------------------------------------------
  // constructor guard
  // ---------------------------------------------------------------------------

  test('throws at construction time when no save callback is provided', () => {
    expect(() => new GitHubCommentRelay(SlackApp, () => [])).toThrow(
      'ArgSaveRemindersAsync callback is required'
    );
  });

  // ---------------------------------------------------------------------------
  // stop relay emoji (🛑)
  // ---------------------------------------------------------------------------

  test('stop emoji marks reminder stopped, saves, and adds no_entry_sign reaction', async () => {
    const ParentTS = '1700000100.000001';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/10']);
    const MockSave = jest.fn().mockResolvedValue(undefined);
    const Relay = new GitHubCommentRelay(SlackApp, () => [Reminder], MockSave, AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Please stop relaying this \u{1F6D1}',
      ts: '1700000100.000010',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    // no GitHub comment posted for the stop message itself.
    expect(FetchSpy).not.toHaveBeenCalled();

    // save was called to persist the stopped state.
    expect(MockSave).toHaveBeenCalledTimes(1);

    // reminder is marked as stopped.
    expect(Reminder.GitHubRelayStopped).toBe(true);

    // no_entry_sign reaction added to acknowledge the stop.
    expect(SlackApp.AddedReactions).toHaveLength(1);
    expect(SlackApp.AddedReactions[0].reaction).toBe('no_entry_sign');
    expect(SlackApp.AddedReactions[0].ts).toBe('1700000100.000010');
  });

  test('stop emoji does not add reaction when save fails', async () => {
    const ParentTS = '1700000100.000002';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/11']);
    const MockSave = jest.fn().mockRejectedValue(new Error('disk full'));
    const Relay = new GitHubCommentRelay(SlackApp, () => [Reminder], MockSave, AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: '\u{1F6D1}',
      ts: '1700000100.000011',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    // save was attempted.
    expect(MockSave).toHaveBeenCalledTimes(1);

    // no reaction added because persistence failed.
    expect(SlackApp.AddedReactions).toHaveLength(0);

    // relay is still stopped in memory even though persistence failed.
    expect(Reminder.GitHubRelayStopped).toBe(true);
  });

  test('messages after stop emoji are not relayed to GitHub', async () => {
    const ParentTS = '1700000100.000003';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/12']);
    Reminder.GitHubRelayStopped = true; // already stopped (e.g. persisted from a previous session)
    const Relay = new GitHubCommentRelay(SlackApp, () => [Reminder], jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'This should not be relayed',
      ts: '1700000100.000020',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).not.toHaveBeenCalled();
    expect(SlackApp.AddedReactions).toHaveLength(0);
  });

  test('stop button emoji ⏹ also stops relay', async () => {
    const ParentTS = '1700000100.000004';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/13']);
    const MockSave = jest.fn().mockResolvedValue(undefined);
    const Relay = new GitHubCommentRelay(SlackApp, () => [Reminder], MockSave, AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'killing this \u{23F9}',
      ts: '1700000100.000030',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).not.toHaveBeenCalled();
    expect(MockSave).toHaveBeenCalledTimes(1);
    expect(Reminder.GitHubRelayStopped).toBe(true);
    expect(SlackApp.AddedReactions).toHaveLength(1);
    expect(SlackApp.AddedReactions[0].reaction).toBe('no_entry_sign');
  });

  test('stop button emoji ⏹️ with FE0F variation selector also stops relay', async () => {
    const ParentTS = '1700000100.000005';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/14']);
    const MockSave = jest.fn().mockResolvedValue(undefined);
    const Relay = new GitHubCommentRelay(SlackApp, () => [Reminder], MockSave, AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: '\u{23F9}\u{FE0F}',
      ts: '1700000100.000031',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(Reminder.GitHubRelayStopped).toBe(true);
    expect(SlackApp.AddedReactions[0].reaction).toBe('no_entry_sign');
  });

  test('"stop relay" text command stops relay (case-insensitive)', async () => {
    const ParentTS = '1700000100.000006';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/15']);
    const MockSave = jest.fn().mockResolvedValue(undefined);
    const Relay = new GitHubCommentRelay(SlackApp, () => [Reminder], MockSave, AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Sleuth, STOP RELAY please',
      ts: '1700000100.000032',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).not.toHaveBeenCalled();
    expect(MockSave).toHaveBeenCalledTimes(1);
    expect(Reminder.GitHubRelayStopped).toBe(true);
    expect(SlackApp.AddedReactions[0].reaction).toBe('no_entry_sign');
  });

  test('text containing "stop" without "relay" still relays normally', async () => {
    const ParentTS = '1700000100.000007';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/16']);
    const Relay = new GitHubCommentRelay(SlackApp, () => [Reminder], jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'we should stop deploying for now',
      ts: '1700000100.000033',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(Reminder.GitHubRelayStopped).toBeFalsy();
    expect(FetchSpy).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // first-relay Slack thread permalink
  // ---------------------------------------------------------------------------

  test('first relayed message includes Slack thread permalink in comment body', async () => {
    const ParentTS = '1700000200.000001';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/20']);
    const MockSave = jest.fn().mockResolvedValue(undefined);
    const Relay = new GitHubCommentRelay(SlackApp, () => [Reminder], MockSave, AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'First message in thread',
      ts: '1700000200.000010',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    const Body = JSON.parse(FetchSpy.mock.calls[0][1].body);
    // should contain the mock permalink for the thread root.
    expect(Body.body).toContain(`https://mock.slack.test/C_DEV/${ParentTS}`);
    expect(Body.body).toContain('[View Slack thread]');

    // GitHubRelayStarted should be persisted after first successful relay.
    expect(Reminder.GitHubRelayStarted).toBe(true);
    expect(MockSave).toHaveBeenCalledTimes(1);
  });

  test('subsequent relayed messages do not include Slack thread permalink', async () => {
    const ParentTS = '1700000200.000002';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/21']);
    Reminder.GitHubRelayStarted = true; // already relayed once
    const Relay = new GitHubCommentRelay(SlackApp, () => [Reminder], jest.fn().mockResolvedValue(undefined), AlwaysRelayAI);
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'Second message in thread',
      ts: '1700000200.000020',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    const Body = JSON.parse(FetchSpy.mock.calls[0][1].body);
    // permalink and link text should not appear on subsequent relays.
    expect(Body.body).not.toContain('View Slack thread');
    expect(Body.body).not.toContain('mock.slack.test');
  });
});

// ---------------------------------------------------------------------------
// GH-37 relevance gate
// ---------------------------------------------------------------------------

describe('GitHubCommentRelay relevance gate (GH-37)', () => {
  /** @type {MockSlackApp} */
  let SlackApp;

  /** @type {jest.SpyInstance} */
  let FetchSpy;

  beforeEach(() => {
    SlackApp = CreateMockSlackApp();
    FetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {any} */ ({ status: 201, ok: true })
    );
  });

  afterEach(() => {
    FetchSpy.mockRestore();
  });

  test('does not relay a follow-up the gate judges to be a separate task', async () => {
    // the reported defect: a thread whose first task linked GH 18 received an unrelated new task,
    // and the relay commented it onto GH 18 anyway.
    const ParentTS = '1700000300.000001';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/18']);
    Reminder.ReminderMessageText = 'also work on UCLA SACTO - SACT countdown reminder - GH 18 by 1:45 PM PT today';
    const MockSave = jest.fn().mockResolvedValue(undefined);
    const Relay = new GitHubCommentRelay(
      SlackApp, () => [Reminder], MockSave, GateAI({ decision: 'skip', confidence: 0.95 })
    );
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'please fix NN Yard IDs -> for email notifications by 1:45 PM PT today',
      ts: '1700000300.000010',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).not.toHaveBeenCalled();
    expect(SlackApp.AddedReactions).toHaveLength(0);
    expect(Reminder.GitHubRelayStarted).toBeUndefined();
  });

  test('relays a follow-up the gate judges to continue the linked task', async () => {
    const ParentTS = '1700000300.000002';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/18']);
    const Relay = new GitHubCommentRelay(
      SlackApp, () => [Reminder], jest.fn().mockResolvedValue(undefined),
      GateAI({ decision: 'relay', confidence: 0.9 })
    );
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'the countdown is off by one hour in Arizona',
      ts: '1700000300.000020',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).toHaveBeenCalledTimes(1);
    expect(SlackApp.AddedReactions[0].reaction).toBe('octocat');
  });

  test('treats a low-confidence relay decision as a skip', async () => {
    const ParentTS = '1700000300.000003';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/18']);
    const Relay = new GitHubCommentRelay(
      SlackApp, () => [Reminder], jest.fn().mockResolvedValue(undefined),
      GateAI({ decision: 'relay', confidence: 0.6 })
    );
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'maybe related, hard to say',
      ts: '1700000300.000030',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).not.toHaveBeenCalled();
  });

  test('relays at exactly the confidence threshold', async () => {
    const ParentTS = '1700000300.000004';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/18']);
    const Relay = new GitHubCommentRelay(
      SlackApp, () => [Reminder], jest.fn().mockResolvedValue(undefined),
      GateAI({ decision: 'relay', confidence: 0.7 })
    );
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'same bug, one more detail',
      ts: '1700000300.000040',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).toHaveBeenCalledTimes(1);
  });

  test('fails closed when the gate model call errors', async () => {
    const ParentTS = '1700000300.000005';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/18']);
    const Relay = new GitHubCommentRelay(
      SlackApp, () => [Reminder], jest.fn().mockResolvedValue(undefined),
      GateAI(new Error('model unavailable'))
    );
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'anything at all',
      ts: '1700000300.000050',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    // an AI outage must never post a comment that a human then has to delete.
    expect(FetchSpy).not.toHaveBeenCalled();
    expect(SlackApp.AddedReactions).toHaveLength(0);
  });

  test('fails closed when no workspace AI is available', async () => {
    const ParentTS = '1700000300.000006';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/18']);
    const Relay = new GitHubCommentRelay(
      SlackApp, () => [Reminder], jest.fn().mockResolvedValue(undefined), () => null
    );
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'anything at all',
      ts: '1700000300.000060',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).not.toHaveBeenCalled();
  });

  test('relays only to the linked issue the reply is about, not every issue in the thread', async () => {
    // the fan-out half of the defect: two tasks in one thread each carry their own issue, and a
    // reply about one of them used to be commented onto both.
    const ParentTS = '1700000300.000007';
    const CountdownReminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/18']);
    CountdownReminder.ReminderID = 'rem-countdown';
    CountdownReminder.ReminderMessageText = 'SACT countdown reminder - GH 18';

    const YardIdsReminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/19']);
    YardIdsReminder.ReminderID = 'rem-yard-ids';
    YardIdsReminder.ReminderMessageText = 'fix NN Yard IDs for email notifications - GH 19';

    // score by reminder: relay for the yard-ids task only.
    const ScoringAI = () => ({
      ProcessMessageWithJsonResponseAsync: jest.fn(ArgInput => Promise.resolve(
        ArgInput.includes('Yard IDs')
          ? { decision: 'relay', confidence: 0.95, rationale: 'same yard-ids work' }
          : { decision: 'skip', confidence: 0.95, rationale: 'different task' }
      )),
    });

    const Relay = new GitHubCommentRelay(
      SlackApp, () => [CountdownReminder, YardIdsReminder], jest.fn().mockResolvedValue(undefined), ScoringAI
    );
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'the yard id mapping is still wrong for two sites',
      ts: '1700000300.000070',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).toHaveBeenCalledTimes(1);
    expect(FetchSpy.mock.calls[0][0]).toBe('https://api.github.com/repos/owner/repo/issues/19/comments');

    // only the relayed-to reminder is marked as started.
    expect(YardIdsReminder.GitHubRelayStarted).toBe(true);
    expect(CountdownReminder.GitHubRelayStarted).toBeUndefined();
  });

  test('gives the gate the linked task text and the follow-up message', async () => {
    const ParentTS = '1700000300.000008';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/18']);
    Reminder.ReminderMessageText = 'SACT countdown reminder';

    const Spy = jest.fn().mockResolvedValue({ decision: 'skip', confidence: 0.9, rationale: 'no' });
    const Relay = new GitHubCommentRelay(
      SlackApp, () => [Reminder], jest.fn().mockResolvedValue(undefined),
      () => ({ ProcessMessageWithJsonResponseAsync: Spy })
    );
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'unrelated new task',
      ts: '1700000300.000080',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    const Payload = JSON.parse(Spy.mock.calls[0][0]);
    expect(Payload.linked_task.task_text).toBe('SACT countdown reminder');
    expect(Payload.linked_task.github_urls).toEqual(['https://github.com/owner/repo/issues/18']);
    expect(Payload.follow_up_message).toBe('unrelated new task');
  });

  test('does not consult the gate for a stop-relay trigger', async () => {
    const ParentTS = '1700000300.000009';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/18']);
    const Spy = jest.fn();
    const Relay = new GitHubCommentRelay(
      SlackApp, () => [Reminder], jest.fn().mockResolvedValue(undefined),
      () => ({ ProcessMessageWithJsonResponseAsync: Spy })
    );
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'stop relay',
      ts: '1700000300.000090',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(Spy).not.toHaveBeenCalled();
    expect(Reminder.GitHubRelayStopped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GH-37 octocat reaction stop trigger
// ---------------------------------------------------------------------------

describe('GitHubCommentRelay.OnReactionAddedAsync (GH-37)', () => {
  /** @type {MockSlackApp} */
  let SlackApp;

  beforeEach(() => {
    SlackApp = CreateMockSlackApp();
  });

  /**
   * Wire a relay onto the mock's reaction chain for a thread whose reply resolves to ArgThreadTs.
   * @param {any[]} ArgReminders Reminders the relay should see.
   * @param {jest.Mock} ArgSave Save callback.
   * @returns {GitHubCommentRelay}
   */
  function WireRelay(ArgReminders, ArgSave) {
    const Relay = new GitHubCommentRelay(SlackApp, () => ArgReminders, ArgSave, AlwaysRelayAI);
    SlackApp.HandleReactionAdded(Relay.OnReactionAddedAsync.bind(Relay));
    return Relay;
  }

  test('a user clicking octocat stops the relay for the thread', async () => {
    const ParentTS = '1700000400.000001';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/42']);
    const MockSave = jest.fn().mockResolvedValue(undefined);
    WireRelay([Reminder], MockSave);

    await SlackApp.SimulateReactionAddedAsync({
      user: 'U_ALICE',
      reaction: 'octocat',
      item: { channel: 'C_DEV', ts: ParentTS },
    });

    expect(Reminder.GitHubRelayStopped).toBe(true);
    expect(MockSave).toHaveBeenCalledTimes(1);
    expect(SlackApp.AddedReactions).toHaveLength(1);
    expect(SlackApp.AddedReactions[0].reaction).toBe('no_entry_sign');
  });

  test('the bot adding octocat does not stop the relay it just started', async () => {
    // the relay marks every successful relay with :octocat: itself, which fires this same event.
    // without the bot guard the first relay in a thread would immediately stop the relay.
    const ParentTS = '1700000400.000002';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/42']);
    const MockSave = jest.fn().mockResolvedValue(undefined);
    WireRelay([Reminder], MockSave);

    // guard the guard: a null bot id would make this case pass via the empty-user branch instead,
    // proving nothing about the bot check.
    expect(SlackApp.BotUserID).toBeTruthy();

    await SlackApp.SimulateReactionAddedAsync({
      user: /** @type {string} */ (SlackApp.BotUserID),
      reaction: 'octocat',
      item: { channel: 'C_DEV', ts: ParentTS },
    });

    expect(Reminder.GitHubRelayStopped).toBeUndefined();
    expect(MockSave).not.toHaveBeenCalled();
    expect(SlackApp.AddedReactions).toHaveLength(0);
  });

  test('resolves a reply timestamp to its thread root before matching reminders', async () => {
    // the reaction lands on the relayed *reply*, but reminders are keyed on the thread root.
    const ParentTS = '1700000400.000003';
    const ReplyTS = '1700000400.000030';
    SlackApp = new MockSlackApp({
      WorkspaceInfo: { ...CreateMockSlackApp().WorkspaceInfo },
      ThreadTsById: { [`C_DEV:${ReplyTS}`]: ParentTS },
    });

    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/42']);
    const MockSave = jest.fn().mockResolvedValue(undefined);
    WireRelay([Reminder], MockSave);

    await SlackApp.SimulateReactionAddedAsync({
      user: 'U_ALICE',
      reaction: 'octocat',
      item: { channel: 'C_DEV', ts: ReplyTS },
    });

    expect(Reminder.GitHubRelayStopped).toBe(true);
    // the acknowledgement lands on the message the user actually reacted to.
    expect(SlackApp.AddedReactions[0].ts).toBe(ReplyTS);
  });

  test('ignores an unrelated reaction', async () => {
    const ParentTS = '1700000400.000004';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/42']);
    const MockSave = jest.fn().mockResolvedValue(undefined);
    WireRelay([Reminder], MockSave);

    await SlackApp.SimulateReactionAddedAsync({
      user: 'U_ALICE',
      reaction: 'white_check_mark',
      item: { channel: 'C_DEV', ts: ParentTS },
    });

    expect(Reminder.GitHubRelayStopped).toBeUndefined();
    expect(MockSave).not.toHaveBeenCalled();
  });

  test('accepts the github alias as a stop trigger', async () => {
    const ParentTS = '1700000400.000005';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/42']);
    WireRelay([Reminder], jest.fn().mockResolvedValue(undefined));

    await SlackApp.SimulateReactionAddedAsync({
      user: 'U_ALICE',
      reaction: 'github',
      item: { channel: 'C_DEV', ts: ParentTS },
    });

    expect(Reminder.GitHubRelayStopped).toBe(true);
  });

  test('ignores a reaction on a thread with no monitored reminder', async () => {
    const Reminder = CreateMonitoredReminder('1700000400.999999', 'C_DEV', ['https://github.com/owner/repo/issues/42']);
    const MockSave = jest.fn().mockResolvedValue(undefined);
    WireRelay([Reminder], MockSave);

    await SlackApp.SimulateReactionAddedAsync({
      user: 'U_ALICE',
      reaction: 'octocat',
      item: { channel: 'C_DEV', ts: '1700000400.000006' },
    });

    expect(Reminder.GitHubRelayStopped).toBeUndefined();
    expect(MockSave).not.toHaveBeenCalled();
  });

  test('does not acknowledge twice when the relay is already stopped', async () => {
    const ParentTS = '1700000400.000007';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/42']);
    Reminder.GitHubRelayStopped = true;
    const MockSave = jest.fn().mockResolvedValue(undefined);
    WireRelay([Reminder], MockSave);

    await SlackApp.SimulateReactionAddedAsync({
      user: 'U_ALICE',
      reaction: 'octocat',
      item: { channel: 'C_DEV', ts: ParentTS },
    });

    expect(MockSave).not.toHaveBeenCalled();
    expect(SlackApp.AddedReactions).toHaveLength(0);
  });

  test('does not acknowledge when persisting the stopped state fails', async () => {
    const ParentTS = '1700000400.000008';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/42']);
    const MockSave = jest.fn().mockRejectedValue(new Error('disk full'));
    WireRelay([Reminder], MockSave);

    await SlackApp.SimulateReactionAddedAsync({
      user: 'U_ALICE',
      reaction: 'octocat',
      item: { channel: 'C_DEV', ts: ParentTS },
    });

    // a user must not be told the relay stopped when that will not survive a restart.
    expect(SlackApp.AddedReactions).toHaveLength(0);
  });

  test('never consumes the reaction, so the reminders handler still sees it', async () => {
    const ParentTS = '1700000400.000009';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/42']);
    WireRelay([Reminder], jest.fn().mockResolvedValue(undefined));

    const Downstream = jest.fn().mockResolvedValue(false);
    SlackApp.HandleReactionAdded(Downstream);

    await SlackApp.SimulateReactionAddedAsync({
      user: 'U_ALICE',
      reaction: 'octocat',
      item: { channel: 'C_DEV', ts: ParentTS },
    });

    expect(Downstream).toHaveBeenCalledTimes(1);
  });

  test('ignores the reaction when the workspace has no GitHub PAT', async () => {
    SlackApp = new MockSlackApp({
      WorkspaceInfo: { ...CreateMockSlackApp().WorkspaceInfo, GITHUB_PAT: '' },
    });
    const ParentTS = '1700000400.000010';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/42']);
    const MockSave = jest.fn().mockResolvedValue(undefined);
    WireRelay([Reminder], MockSave);

    await SlackApp.SimulateReactionAddedAsync({
      user: 'U_ALICE',
      reaction: 'octocat',
      item: { channel: 'C_DEV', ts: ParentTS },
    });

    expect(Reminder.GitHubRelayStopped).toBeUndefined();
    expect(MockSave).not.toHaveBeenCalled();
  });

  test('a stopped relay no longer posts comments for later replies', async () => {
    // end-to-end: click octocat, then a genuinely on-topic reply must not reach GitHub.
    const ParentTS = '1700000400.000011';
    const Reminder = CreateMonitoredReminder(ParentTS, 'C_DEV', ['https://github.com/owner/repo/issues/42']);
    const FetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {any} */ ({ status: 201, ok: true })
    );

    const Relay = new GitHubCommentRelay(
      SlackApp, () => [Reminder], jest.fn().mockResolvedValue(undefined), AlwaysRelayAI
    );
    SlackApp.HandleReactionAdded(Relay.OnReactionAddedAsync.bind(Relay));
    SlackApp.HandleMessage(Relay.OnMessageAsync.bind(Relay));

    await SlackApp.SimulateReactionAddedAsync({
      user: 'U_ALICE',
      reaction: 'octocat',
      item: { channel: 'C_DEV', ts: ParentTS },
    });

    await SlackApp.SimulateMessageAsync({
      channel: 'C_DEV',
      text: 'one more detail about the same bug',
      ts: '1700000400.000110',
      thread_ts: ParentTS,
      user: 'U_ALICE',
    });

    expect(FetchSpy).not.toHaveBeenCalled();
    FetchSpy.mockRestore();
  });
});
