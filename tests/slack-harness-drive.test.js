'use strict';

/**
 * Tests for the live-drive harness (GH-168 follow-up). This is a privileged write path — it posts
 * to Slack as a human — so every safety claim it makes carries a test that fails if the claim stops
 * being true. The Slack client is injected, so nothing here touches the network or a real token.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  LoadToken,
  ParseArgs,
  ValidateOptions,
  RunAsync,
  DiscoverBotUserIdAsync,
  POLL_INTERVAL_MS,
} = require('../scripts/slack-harness-drive');

const BOT = 'U_BOT';
const CHANNEL = 'C_TEST';

/**
 * Minimal Slack client double. `Replies` is the sequence conversations.replies returns, one entry
 * per poll, so a test can model "no reply yet, then a reply".
 * @param {{ Replies?: Array<Array<object>> }} [ArgOptions]
 */
function MakeClient({ Replies = [[]] } = {}) {
  let PollIndex = 0;
  return {
    auth: { test: jest.fn().mockResolvedValue({ user: 'tester', team: 'TestTeam' }) },
    chat: { postMessage: jest.fn().mockResolvedValue({ ts: '1700000000.000100' }) },
    conversations: {
      list: jest.fn().mockResolvedValue({ channels: [{ id: CHANNEL, name: 'test-channel' }] }),
      history: jest.fn().mockResolvedValue({ messages: [] }),
      replies: jest.fn().mockImplementation(async () => {
        const Page = Replies[Math.min(PollIndex, Replies.length - 1)];
        PollIndex++;
        return { messages: [{ ts: '1700000000.000100', user: 'U_HUMAN' }, ...Page] };
      }),
    },
  };
}

/** @param {object} ArgOverrides */
function MakeOptions(ArgOverrides = {}) {
  return {
    Channel: null, ChannelID: CHANNEL, BotName: null, BotUserID: BOT, Text: 'models',
    Execute: true, Expect: null, TimeoutMs: 5000, TokenFile: '/nonexistent', Help: false,
    ...ArgOverrides,
  };
}

describe('slack-harness-drive — option validation', () => {
  test('refuses conflicting channel selectors rather than silently preferring one', () => {
    expect(() => ValidateOptions(MakeOptions({ Channel: 'test-channel', ChannelID: CHANNEL })))
      .toThrow(/--channel OR --channel-id, not both/);
  });

  test('refuses conflicting bot selectors', () => {
    expect(() => ValidateOptions(MakeOptions({ BotName: 'sleuth-dev', BotUserID: BOT })))
      .toThrow(/--bot-name OR --bot-user-id, not both/);
  });

  test('requires a channel, a bot, and text', () => {
    expect(() => ValidateOptions(MakeOptions({ ChannelID: null }))).toThrow(/--channel or --channel-id is required/);
    expect(() => ValidateOptions(MakeOptions({ BotUserID: null }))).toThrow(/--bot-name or --bot-user-id is required/);
    expect(() => ValidateOptions(MakeOptions({ Text: '   ' }))).toThrow(/--text is required/);
  });

  test('ParseArgs defaults to dry-run — --execute is the only way to post', () => {
    const Parsed = ParseArgs(['--channel-id', CHANNEL, '--bot-user-id', BOT, '--text', 'models']);
    expect(Parsed.Execute).toBe(false);
    expect(ParseArgs(['--channel-id', CHANNEL, '--bot-user-id', BOT, '--text', 'models', '--execute']).Execute).toBe(true);
  });
});

describe('slack-harness-drive — bot identity', () => {
  /**
   * @param {Array<object>|Array<Array<object>>} ArgPages One page, or a list of pages that the
   *   double serves in order with a `next_cursor` between them.
   */
  function ClientWithHistory(ArgPages) {
    const Pages = Array.isArray(ArgPages[0]) || ArgPages.length === 0 ? ArgPages : [ArgPages];
    const Client = MakeClient();
    Client.conversations.history = jest.fn().mockImplementation(async ({ cursor }) => {
      const Index = cursor ? Number(cursor) : 0;
      return {
        messages: Pages[Index] || [],
        response_metadata: Index + 1 < Pages.length ? { next_cursor: String(Index + 1) } : {},
      };
    });
    return Client;
  }

  test('resolves an unambiguous name match', async () => {
    const Client = ClientWithHistory([
      { user: 'U_A', bot_profile: { name: 'Sleuth-dev' } },
      { user: 'U_A', bot_profile: { name: 'Sleuth-dev' } },
      { user: 'U_HUMAN' },
    ]);
    await expect(DiscoverBotUserIdAsync(Client, CHANNEL, 'sleuth-dev')).resolves.toBe('U_A');
  });

  test('REFUSES when one name maps to two user IDs — the mid-run drift that addressed the wrong app', async () => {
    const Client = ClientWithHistory([
      { user: 'U_A', bot_profile: { name: 'Sleuth-dev' } },
      { user: 'U_B', bot_profile: { name: 'Sleuth-dev' } },
    ]);
    await expect(DiscoverBotUserIdAsync(Client, CHANNEL, 'sleuth-dev'))
      .rejects.toThrow(/Ambiguous.*U_A, U_B.*--bot-user-id/s);
  });

  test('REFUSES when the second history PAGE hides another same-named bot — one page is not the channel', async () => {
    const Client = ClientWithHistory([
      [{ user: 'U_A', bot_profile: { name: 'Sleuth-dev' } }],
      [{ user: 'U_B', bot_profile: { name: 'Sleuth-dev' } }],
    ]);
    await expect(DiscoverBotUserIdAsync(Client, CHANNEL, 'sleuth-dev'))
      .rejects.toThrow(/Ambiguous.*U_A, U_B/s);
    expect(Client.conversations.history).toHaveBeenCalledTimes(2);
  });

  test('a single bot spread over several pages is still unambiguous', async () => {
    const Client = ClientWithHistory([
      [{ user: 'U_A', bot_profile: { name: 'Sleuth-dev' } }],
      [{ user: 'U_A', bot_profile: { name: 'Sleuth-dev' } }, { user: 'U_HUMAN' }],
    ]);
    await expect(DiscoverBotUserIdAsync(Client, CHANNEL, 'sleuth-dev')).resolves.toBe('U_A');
  });

  test('ignores human messages that happen to carry a matching username', async () => {
    const Client = ClientWithHistory([{ user: 'U_HUMAN', username: 'sleuth-dev' }]);
    await expect(DiscoverBotUserIdAsync(Client, CHANNEL, 'sleuth-dev')).rejects.toThrow(/No recent message from a bot/);
  });
});

describe('slack-harness-drive — posting and reply matching', () => {
  test('dry-run never calls chat.postMessage', async () => {
    const Client = MakeClient();
    const Code = await RunAsync(MakeOptions({ Execute: false }), Client);
    expect(Code).toBe(0);
    expect(Client.chat.postMessage).not.toHaveBeenCalled();
    expect(Client.conversations.replies).not.toHaveBeenCalled();
  });

  test('posts the command addressed to the bot, in the requested channel', async () => {
    const Client = MakeClient({ Replies: [[{ ts: '2', user: BOT, text: 'ok' }]] });
    await RunAsync(MakeOptions(), Client);
    expect(Client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(Client.chat.postMessage).toHaveBeenCalledWith({ channel: CHANNEL, text: `<@${BOT}> models` });
  });

  test('only the addressed bot counts as the reply — another app answering in-thread is ignored', async () => {
    const Client = MakeClient({ Replies: [
      [{ ts: '2', user: 'U_OTHER_BOT', bot_id: 'B_OTHER', text: 'not mine' }],
      [{ ts: '2', user: 'U_OTHER_BOT', bot_id: 'B_OTHER', text: 'not mine' }, { ts: '3', user: BOT, text: 'mine' }],
    ] });
    const Code = await RunAsync(MakeOptions(), Client);
    expect(Code).toBe(0);
    // it kept polling past the foreign reply instead of accepting it
    expect(Client.conversations.replies.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('--expect failure exits 4, not 0', async () => {
    const Client = MakeClient({ Replies: [[{ ts: '2', user: BOT, text: 'Default still using x' }]] });
    await expect(RunAsync(MakeOptions({ Expect: '*Aliases*' }), Client)).resolves.toBe(4);
  });

  test('--expect match exits 0', async () => {
    const Client = MakeClient({ Replies: [[{ ts: '2', user: BOT, text: 'here is the *Aliases* block' }]] });
    await expect(RunAsync(MakeOptions({ Expect: '*Aliases*' }), Client)).resolves.toBe(0);
  });

  test('no reply before the deadline exits 3', async () => {
    const Client = MakeClient({ Replies: [[]] });
    await expect(RunAsync(MakeOptions({ TimeoutMs: POLL_INTERVAL_MS + 500 }), Client)).resolves.toBe(3);
    expect(Client.chat.postMessage).toHaveBeenCalledTimes(1);
  });
});

describe('slack-harness-drive — token loading', () => {
  const SavedEnv = process.env.SLACK_DEV_USER_TOKEN;
  /** @type {string} */
  let TempDir;

  beforeEach(() => { TempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-token-')); });
  afterEach(() => {
    if(SavedEnv === undefined) delete process.env.SLACK_DEV_USER_TOKEN;
    else process.env.SLACK_DEV_USER_TOKEN = SavedEnv;
    fs.rmSync(TempDir, { recursive: true, force: true });
  });

  /** @param {string} ArgContents */
  function WriteTokenFile(ArgContents) {
    const FilePath = path.join(TempDir, 'token.txt');
    fs.writeFileSync(FilePath, ArgContents);
    return FilePath;
  }

  test('accepts a user token from the file', () => {
    delete process.env.SLACK_DEV_USER_TOKEN;
    expect(LoadToken(WriteTokenFile('xoxp-file-token\n'))).toBe('xoxp-file-token');
  });

  test('strips a leading VAR= prefix in the file', () => {
    delete process.env.SLACK_DEV_USER_TOKEN;
    expect(LoadToken(WriteTokenFile('SLACK_DEV_USER_TOKEN=xoxp-file-token\n'))).toBe('xoxp-file-token');
  });

  test('rejects a BOT token in the file', () => {
    delete process.env.SLACK_DEV_USER_TOKEN;
    expect(() => LoadToken(WriteTokenFile('xoxb-bot-token'))).toThrow(/not a user \(xoxp\) token/);
  });

  test('the env var does NOT bypass the user-token check — an exported xoxb- is refused', () => {
    process.env.SLACK_DEV_USER_TOKEN = 'xoxb-exported-bot-token';
    // the file is valid, so a pass here would mean the env value was used unchecked
    const FilePath = WriteTokenFile('xoxp-file-token');
    expect(() => LoadToken(FilePath)).toThrow(/SLACK_DEV_USER_TOKEN.*not a user \(xoxp\) token/);
  });

  test('the env var wins when it IS a user token, and the error never echoes a token', () => {
    process.env.SLACK_DEV_USER_TOKEN = 'xoxp-env-token';
    expect(LoadToken(WriteTokenFile('xoxp-file-token'))).toBe('xoxp-env-token');
    process.env.SLACK_DEV_USER_TOKEN = 'xoxb-secret-value';
    try {
      LoadToken(WriteTokenFile('xoxp-file-token'));
      throw new Error('expected a refusal');
    } catch(ArgError) {
      expect(ArgError.message).not.toContain('xoxb-secret-value');
    }
  });
});

describe('smoke-dev-gh168.sh', () => {
  const ScriptText = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'smoke-dev-gh168.sh'), 'utf8');

  test('runs the cross-vendor refusal case UNCONDITIONALLY (GH-174 retired the router-mode gate)', () => {
    // The gate made the script print "all passed" on an active-mode workspace without ever
    // testing the precedence path — the one this repo just fixed. It must not come back.
    expect(ScriptText).toContain(`--text "switch-models:'openai claude opus'" --expect "'openai claude opus' not found"`);
    expect(ScriptText).not.toMatch(/if .*router mode.*active/i);
    expect(ScriptText).not.toMatch(/SKIPPED the cross-vendor refusal/i);
  });

  test('pins the bot by ID, never by name, so it cannot drift onto another app mid-run', () => {
    expect(ScriptText).toContain('--bot-user-id ${SLEUTH_DEV_BOT_USER_ID:-U0917484FM4}');
    expect(ScriptText).not.toContain('--bot-name');
  });
});
